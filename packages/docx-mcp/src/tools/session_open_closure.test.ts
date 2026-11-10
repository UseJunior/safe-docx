import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, vi } from 'vitest';
import { DocxDocument } from '@usejunior/docx-core';
import { SessionManager } from '../session/manager.js';
import { testAllure } from '../testing/allure-test.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';
import { openDocument } from './open_document.js';
import { closeFile } from './close_file.js';
import { resolveSessionForTool, resolveOdfSessionForTool, resolveGDocsSessionForTool } from './session_resolution.js';

const adapters = vi.hoisted(() => ({ odfLoad: vi.fn(), gdocsLoad: vi.fn() }));
vi.mock('../odf_loader.js', () => ({
  loadOdfCore: async () => ({
    validateOdfArchiveSafety: async () => ({ ok: true }),
    OdfArchive: { load: adapters.odfLoad },
    OdfDocument: { fromContentXml: () => ({ getParagraphs: () => [] }) },
  }),
}));
vi.mock('../gdocs_loader.js', () => ({
  loadGDocsCore: async () => ({ GoogleDocsDocument: { load: adapters.gdocsLoad } }),
}));

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

const TEST_FEATURE = 'coordinate-session-opens';
const test = testAllure.epic('Document Reading').withLabels({ feature: TEST_FEATURE });
type Provider = 'docx' | 'odf' | 'gdocs';

describe('provider opening and closure coordination', () => {
  registerCleanup();
  const managers: SessionManager[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    adapters.odfLoad.mockReset();
    adapters.gdocsLoad.mockReset();
    await Promise.all(managers.splice(0).map(manager => manager.clearAllSessions()));
  });

  async function setup(provider: Provider) {
    const manager = createTestSessionManager();
    managers.push(manager);
    const dir = await createTrackedTempDir('open-close-');
    const filePath = path.join(dir, `input.${provider === 'odf' ? 'odt' : 'docx'}`);
    await fs.writeFile(filePath, provider === 'docx' ? await makeMinimalDocx(['Opening coordination']) : Buffer.from('synthetic provider input'));
    adapters.odfLoad.mockImplementation(async () => ({ getContentXml: async () => '<document/>' }));
    adapters.gdocsLoad.mockImplementation(async () => ({ injectAnchors: async () => undefined }));
    const docxLoad = DocxDocument.load;
    const load = provider === 'docx' ? vi.spyOn(DocxDocument, 'load')
      : provider === 'odf' ? adapters.odfLoad : adapters.gdocsLoad;
    const original = provider === 'docx' ? docxLoad
      : load.getMockImplementation()!;
    const key = provider === 'gdocs' ? 'gdocs:synthetic-doc-id' : await manager.canonicalizePath(filePath);
    const open = () => provider === 'docx'
      ? resolveSessionForTool(manager, { file_path: filePath }, { toolName: 'read_file' })
      : provider === 'odf'
        ? resolveOdfSessionForTool(manager, { file_path: filePath }, { toolName: 'read_file' })
        : resolveGDocsSessionForTool(manager, { google_doc_id: 'synthetic-doc-id' }, { toolName: 'read_file' });
    function pauseNext(fail = false) {
      const entered = barrier();
      const resume = barrier();
      load.mockImplementationOnce(async (...args: unknown[]) => {
        entered.release();
        await resume.promise;
        if (fail) throw new Error('injected late provider failure');
        return Reflect.apply(original, DocxDocument, args);
      });
      return { entered: entered.promise, release: resume.release };
    }
    return { manager, key, filePath, open, pauseNext, load };
  }

  for (const provider of ['docx', 'odf', 'gdocs'] as const) {
    for (const clearAll of [false, true]) {
      test.openspec('Close during provider opening')(`${provider}: ${clearAll ? 'clear all' : 'close path'} cancels unobserved candidate`, async () => {
        const h = await setup(provider);
        const gate = h.pauseNext();
        const pending = h.open();
        await gate.entered;
        try {
          const closed = await closeFile(h.manager, clearAll ? { clear_all: true, confirm: true } : { file_path: h.key });
          expect(closed.success).toBe(true);
        } finally { gate.release(); }
        const result = await pending;
        expect(result).toMatchObject({ ok: false, response: { error: { code: 'SESSION_CLOSED' } } });
        expect(h.manager.listSessions()).toHaveLength(0);
      });
    }

    for (const failOld of [false, true]) {
      for (const finishNewFirst of [false, true]) {
        test.openspec('Reopen survives late old completion')(`${provider}: late old ${failOld ? 'failure' : 'success'} preserves newer ${finishNewFirst ? 'session' : 'pending identity'}`, async () => {
          const h = await setup(provider);
          const oldGate = h.pauseNext(failOld);
          const oldOpen = h.open();
          await oldGate.entered;
          await h.manager.clearSessionByPath(h.key);
          const newGate = h.pauseNext();
          const newOpen = h.open();
          await newGate.entered;
          if (finishNewFirst) {
            newGate.release();
            expect((await newOpen).ok).toBe(true);
          }
          oldGate.release();
          expect(await oldOpen).toMatchObject({ ok: false, response: { error: { code: 'SESSION_CLOSED' } } });
          if (finishNewFirst) {
            const fresh = await newOpen;
            if (fresh.ok) expect(h.manager.getSessionByPath(h.key)).toBe(fresh.session);
            expect(h.load).toHaveBeenCalledTimes(2);
            return;
          }
          const waiter = h.manager.coordinateSessionOpen(h.key, async () => {
            throw new Error('new pending entry was lost');
          }, provider);
          newGate.release();
          const [leader, follower] = await Promise.all([newOpen, waiter]);
          expect(leader.ok).toBe(true);
          expect(follower.shared).toBe(true);
          expect(follower.outcome).toEqual(leader);
          if (leader.ok) {
            expect(h.manager.getSessionByPath(h.key)).toBe(leader.session);
          }
          expect(h.load).toHaveBeenCalledTimes(2);
        });
      }
    }

    test.openspec('Immediate provider failure permits retry')(`${provider}: synchronous provider failure leaves no poisoned pending entry`, async () => {
      const h = await setup(provider);
      h.load.mockImplementationOnce(() => { throw new Error('immediate failure'); });
      await expect(h.open()).rejects.toThrow('immediate failure');
      expect((await h.open()).ok).toBe(true);
      expect(h.load).toHaveBeenCalledTimes(2);
    });
  }

  for (const explicit of [false, true]) {
    const scenario = explicit ? test.openspec('Explicit local open respects closure') : test.openspec('Close during provider opening');
    scenario(`${explicit ? 'explicit' : 'auto'} DOCX: close during finalization retires artifacts and preserves reopened session`, async () => {
      const h = await setup('docx');
      const entered = barrier();
      const resume = barrier();
      const finalize = h.manager.finalizeNewSession.bind(h.manager);
      let candidatePath = '';
      vi.spyOn(h.manager, 'finalizeNewSession').mockImplementationOnce(async (session, opts) => {
        candidatePath = session.tmpPath;
        entered.release();
        await resume.promise;
        return finalize(session, opts);
      });
      const old = explicit ? openDocument(h.manager, { file_path: h.filePath }) : h.open();
      await entered.promise;
      expect(h.manager.listSessions()).toHaveLength(0);
      await h.manager.clearAllSessions();
      const fresh = await h.open();
      resume.release();
      const cancelled = await old;
      expect(explicit ? cancelled : ('response' in cancelled ? cancelled.response : cancelled)).toMatchObject({ error: { code: 'SESSION_CLOSED' } });
      expect(fresh.ok).toBe(true);
      if (fresh.ok) expect(h.manager.getSessionByPath(h.key)).toBe(fresh.session);
      await expect(fs.stat(path.dirname(candidatePath))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  }

  test.openspec('Immediate provider failure permits retry')('single-flight registers before synchronous reentry and isolates managers', async () => {
    const first = createTestSessionManager();
    const second = createTestSessionManager();
    managers.push(first, second);
    let joined!: ReturnType<typeof first.coordinateSessionOpen<number>>;
    const leader = first.coordinateSessionOpen('synthetic', async () => {
      joined = first.coordinateSessionOpen('synthetic', async () => 99);
      return 42;
    });
    expect(await leader).toEqual({ outcome: 42, shared: false });
    expect(await joined).toEqual({ outcome: 42, shared: true });
    expect(await second.coordinateSessionOpen('synthetic', async () => 7)).toEqual({ outcome: 7, shared: false });
    await expect(first.coordinateSessionOpen('synthetic', () => { throw new Error('sync'); })).rejects.toThrow('sync');
    expect(await first.coordinateSessionOpen('synthetic', async () => 8)).toEqual({ outcome: 8, shared: false });
  });

  test('mismatched provider calls do not join a DOCX open for the same path', async () => {
    const h = await setup('docx');
    const gate = h.pauseNext();
    const pending = h.open();
    await gate.entered;
    try {
      const mismatch = await resolveOdfSessionForTool(h.manager, { file_path: h.filePath }, { toolName: 'read_file' });
      expect(mismatch).toMatchObject({ ok: false, response: { error: { code: 'INVALID_FILE_TYPE' } } });
    } finally { gate.release(); }
    expect((await pending).ok).toBe(true);
  });

  test.openspec('Close during provider opening')('ODF candidate written across close is retired without removing its replacement', async () => {
    const h = await setup('odf');
    const entered = barrier();
    const resume = barrier();
    const write = fs.writeFile.bind(fs);
    let candidatePath = '';
    vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (...args) => {
      candidatePath = String(args[0]);
      await write(...args);
      entered.release();
      await resume.promise;
    });
    const old = h.open();
    await entered.promise;
    await h.manager.clearSessionByPath(h.key);
    const fresh = await h.open();
    resume.release();
    expect(await old).toMatchObject({ ok: false, response: { error: { code: 'SESSION_CLOSED' } } });
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect(h.manager.getSessionByPath(h.key)).toBe(fresh.session);
    await expect(fs.stat(path.dirname(candidatePath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test.openspec('Close during provider opening')('Google Docs close during anchor injection cannot publish', async () => {
    const h = await setup('gdocs');
    const entered = barrier();
    const resume = barrier();
    adapters.gdocsLoad.mockResolvedValueOnce({ injectAnchors: async () => {
      entered.release();
      await resume.promise;
    } });
    const old = h.open();
    await entered.promise;
    await h.manager.clearAllSessions();
    const fresh = await h.open();
    resume.release();
    expect(await old).toMatchObject({ ok: false, response: { error: { code: 'SESSION_CLOSED' } } });
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect(h.manager.getSessionByPath(h.key)).toBe(fresh.session);
  });

  for (const entry of ['auto', 'explicit', 'manager'] as const) {
    for (const clearAll of [false, true]) {
      test.openspec('Close during provider opening')(`${entry}: close during canonical key resolution stays cancelled after reopen (${clearAll ? 'all' : 'path'})`, async () => {
        const h = await setup('docx');
        const content = await fs.readFile(h.filePath);
        const entered = barrier();
        const resume = barrier();
        vi.spyOn(h.manager, 'canonicalizePath').mockImplementationOnce(async () => {
          entered.release();
          await resume.promise;
          return h.key;
        });
        const pending = entry === 'auto' ? h.open() : entry === 'explicit'
          ? openDocument(h.manager, { file_path: h.filePath })
          : h.manager.createSession(content, 'input.docx', h.filePath).catch(error => ({ managerError: error }));
        await entered.promise;
        if (clearAll) await h.manager.clearAllSessions();
        else await h.manager.clearSessionByPath(h.key);
        const fresh = await h.open();
        resume.release();
        const result = await pending;
        if (entry === 'manager') expect(result).toMatchObject({ managerError: { name: 'SessionClosedDuringOpenError' } });
        else if (entry === 'explicit') expect(result).toMatchObject({ error: { code: 'SESSION_CLOSED' } });
        else expect(result).toMatchObject({ ok: false, response: { error: { code: 'SESSION_CLOSED' } } });
        expect(fresh.ok).toBe(true);
        if (fresh.ok) expect(h.manager.getSessionByPath(h.key)).toBe(fresh.session);
      });
    }
  }

  test('closing an unrelated path does not cancel an opener resolving its key', async () => {
    const h = await setup('docx');
    const entered = barrier();
    const resume = barrier();
    vi.spyOn(h.manager, 'canonicalizePath').mockImplementationOnce(async () => {
      entered.release();
      await resume.promise;
      return h.key;
    });
    const pending = h.open();
    await entered.promise;
    await h.manager.clearSessionByPath(path.join(path.dirname(h.filePath), 'other.docx'));
    resume.release();
    expect((await pending).ok).toBe(true);
  });
});
