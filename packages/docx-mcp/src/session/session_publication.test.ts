import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, vi } from 'vitest';
import { DocxDocument } from '@usejunior/docx-core';
import { SessionManager } from './manager.js';
import { openDocument } from '../tools/open_document.js';
import { resolveSessionForTool } from '../tools/session_resolution.js';
import { testAllure } from '../testing/allure-test.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Session publication' });
const TEST_FEATURE = 'finalize-session-publication';
const scenarioTest = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

describe('session publication lifecycle', () => {
  registerCleanup();
  const managers: SessionManager[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(managers.splice(0).map(manager => manager.clearAllSessions()));
  });
  function newManager(): SessionManager {
    const manager = createTestSessionManager();
    managers.push(manager);
    return manager;
  }

  scenarioTest.openspec('Finalized DOCX publication')('creation publishes a finalized session and repeated finalization is inert', async () => {
    const manager = newManager();
    const dir = await createTrackedTempDir('publication-');
    const session = await manager.createSession(await makeMinimalDocx(['ready']), 'input.docx', path.join(dir, 'input.docx'), { skipNormalization: true });
    expect(session.doc.readParagraphs().paragraphs).toHaveLength(1);
    expect(session.normalizationStats).toBeNull();
    const ids = session.doc.readParagraphs().paragraphs.map(p => p.id);
    const normalize = vi.spyOn(session.doc, 'normalize');
    try {
      await manager.finalizeNewSession(session);
      expect(normalize).not.toHaveBeenCalled();
      expect(session.doc.readParagraphs().paragraphs.map(p => p.id)).toEqual(ids);
      expect(await manager.getSessionByFilePath(session.originalPath)).toBe(session);
      expect(session.comparisonBaseline).toBeNull();
      expect(session.comparisonBaselineWithBookmarks).toBeNull();
    } finally { normalize.mockRestore(); }
  });

  scenarioTest.openspec('Failed candidate preserves prior resource')('failed finalization retains the active session and removes candidate artifacts', async () => {
    const manager = newManager();
    const dir = await createTrackedTempDir('publication-failure-');
    const originalPath = path.join(dir, 'input.docx');
    const buffer = await makeMinimalDocx(['active']);
    const active = await manager.createSession(buffer, 'input.docx', originalPath);
    const mkdir = vi.spyOn(fs, 'mkdtemp');
    const normalize = vi.spyOn(DocxDocument.prototype, 'normalize').mockImplementationOnce(() => { throw new Error('injected finalization failure'); });
    try {
      await expect(manager.createSession(buffer, 'input.docx', originalPath)).rejects.toThrow('injected finalization failure');
      expect(await manager.getSessionByFilePath(originalPath)).toBe(active);
      expect(await fs.stat(active.tmpPath)).toBeTruthy();
      const candidateDir = await mkdir.mock.results[0]!.value;
      await expect(fs.stat(candidateDir)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { normalize.mockRestore(); mkdir.mockRestore(); }
  });

  scenarioTest.openspec('Expiry and repeated cleanup')('expiry retires a session and asynchronously removes its artifacts', async () => {
    const manager = newManager();
    const dir = await createTrackedTempDir('publication-expiry-');
    const session = await manager.createSession(await makeMinimalDocx(['expired']), 'input.docx', path.join(dir, 'input.docx'));
    session.expiresAt = new Date(0);
    expect(await manager.getSessionByFilePath(session.originalPath)).toBeNull();
    await manager.clearAllSessions();
    await manager.clearAllSessions();
    await expect(fs.stat(path.dirname(session.tmpPath))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(manager.listSessions()).toEqual([]);
  });

  test('replacement stays private until finalization completes', async () => {
    const manager = newManager();
    const dir = await createTrackedTempDir('publication-private-');
    const originalPath = path.join(dir, 'input.docx');
    const buffer = await makeMinimalDocx(['ready']);
    const active = await manager.createSession(buffer, 'input.docx', originalPath);
    const finalize = manager.finalizeNewSession.bind(manager);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(manager, 'finalizeNewSession').mockImplementationOnce(async (session, opts) => {
      entered();
      await gate;
      return finalize(session, opts);
    });
    const replacing = manager.createSession(buffer, 'input.docx', originalPath);
    try {
      await started;
      expect(await manager.getSessionByFilePath(originalPath)).toBe(active);
      expect(manager.listSessions()).toEqual([active]);
      expect(await fs.readFile(active.tmpPath)).toEqual(buffer);
    } finally { release(); }
    const replacement = await replacing;
    expect(await manager.getSessionByFilePath(originalPath)).toBe(replacement);
    expect(replacement.normalizationStats).not.toBeNull();
    expect(replacement.doc.readParagraphs().paragraphs[0]!.id).toMatch(/^_bk_/);
    expect(replacement.comparisonBaseline).toBeNull();
    expect(replacement.comparisonBaselineWithBookmarks).toBeNull();
    await expect(fs.stat(active.tmpPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('invalid loading allocates no artifacts and preserves the active session', async () => {
    const manager = newManager();
    const dir = await createTrackedTempDir('publication-load-');
    const originalPath = path.join(dir, 'input.docx');
    const active = await manager.createSession(await makeMinimalDocx(['active']), 'input.docx', originalPath);
    const mkdir = vi.spyOn(fs, 'mkdtemp');
    await expect(manager.createSession(Buffer.from('invalid ZIP'), 'input.docx', originalPath)).rejects.toThrow();
    expect(mkdir).not.toHaveBeenCalled();
    expect(await manager.getSessionByFilePath(originalPath)).toBe(active);
    expect(await fs.stat(active.tmpPath)).toBeTruthy();
  });

  for (const provider of ['docx', 'odf'] as const) {
    async function create(manager: SessionManager, buffer: Buffer, filePath: string) {
      return provider === 'docx'
        ? manager.createSession(buffer, path.basename(filePath), filePath)
        : manager.createOdfSession(buffer, path.basename(filePath), filePath, {}, {});
    }

    test(`${provider} write failure cleans candidate and preserves the active session`, async () => {
      const manager = newManager();
      const dir = await createTrackedTempDir('publication-write-');
      const originalPath = path.join(dir, `input.${provider}`);
      const buffer = await makeMinimalDocx(['active']);
      const active = await create(manager, buffer, originalPath);
      const mkdir = vi.spyOn(fs, 'mkdtemp');
      vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('injected write failure'));
      await expect(create(manager, buffer, originalPath)).rejects.toThrow('injected write failure');
      expect(await manager.getSessionByFilePath(originalPath)).toBe(active);
      expect(await fs.stat(active.tmpPath)).toBeTruthy();
      const candidateDir = await mkdir.mock.results[0]!.value;
      await expect(fs.stat(candidateDir)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    scenarioTest.openspec('Retirement failure after publication')(`${provider} retirement failure preserves successful publication and retries on clear-all`, async () => {
      const manager = newManager();
      const dir = await createTrackedTempDir('publication-retirement-');
      const originalPath = path.join(dir, `input.${provider}`);
      const buffer = await makeMinimalDocx(['active']);
      const active = await create(manager, buffer, originalPath);
      vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('injected retirement failure'));
      const replacement = await create(manager, buffer, originalPath);
      expect(await manager.getSessionByFilePath(originalPath)).toBe(replacement);
      expect(await fs.readFile(replacement.tmpPath)).toEqual(buffer);
      expect(await fs.stat(active.tmpPath)).toBeTruthy();
      await manager.clearAllSessions();
      await manager.clearAllSessions();
      await expect(fs.stat(active.tmpPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(replacement.tmpPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  }

  test('failed preparation keeps its original error and retries refused cleanup', async () => {
    const manager = newManager();
    const dir = await createTrackedTempDir('publication-cleanup-failure-');
    const originalPath = path.join(dir, 'input.docx');
    const mkdir = vi.spyOn(fs, 'mkdtemp');
    vi.spyOn(DocxDocument.prototype, 'normalize').mockImplementationOnce(() => { throw new Error('preparation failed'); });
    vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(manager.createSession(await makeMinimalDocx(['bad']), 'input.docx', originalPath)).rejects.toThrow('preparation failed');
    const candidateDir = await mkdir.mock.results[0]!.value;
    expect(manager.listSessions()).toEqual([]);
    expect(await fs.stat(candidateDir)).toBeTruthy();
    await manager.clearAllSessions();
    await expect(fs.stat(candidateDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  for (const lookup of ['path', 'id', 'list'] as const) {
    test(`${lookup} expiry cleanup is drained and retried idempotently`, async () => {
      const manager = newManager();
      const dir = await createTrackedTempDir('publication-expiry-');
      const session = await manager.createSession(await makeMinimalDocx(['expired']), 'input.docx', path.join(dir, 'input.docx'));
      session.expiresAt = new Date(0);
      const rm = vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('transient removal failure'));
      if (lookup === 'path') expect(manager.getSessionByPath(await manager.canonicalizePath(session.originalPath))).toBeNull();
      if (lookup === 'id') expect(() => manager.getSession(session.sessionId)).toThrow('SESSION_EXPIRED:');
      if (lookup === 'list') expect(manager.listSessions()).toEqual([]);
      expect(manager.listSessions()).toEqual([]);
      await manager.clearAllSessions();
      await manager.clearAllSessions();
      expect(rm).toHaveBeenCalledTimes(2);
      await expect(fs.stat(session.tmpPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  }

  test('explicit and implicit production opens return anchored active documents', async () => {
    const manager = newManager();
    const dir = await createTrackedTempDir('publication-open-');
    for (const explicit of [true, false]) {
      const filePath = path.join(dir, `${explicit}.docx`);
      await fs.writeFile(filePath, await makeMinimalDocx(['ready']));
      if (explicit) {
        const opened = await openDocument(manager, { file_path: filePath, skip_normalization: true });
        expect(opened.success).toBe(true);
      } else {
        const resolved = await resolveSessionForTool(manager, { file_path: filePath }, { toolName: 'read_file' });
        expect(resolved.ok).toBe(true);
      }
      const session = await manager.getSessionByFilePath(filePath);
      expect(session?.provider).toBe('docx');
      if (session?.provider !== 'docx') throw new Error('expected DOCX session');
      expect(session.doc.readParagraphs().paragraphs[0]!.id).toMatch(/^_bk_/);
      expect(session.normalizationStats === null).toBe(explicit);
    }
  });

  test('Google Docs creation does not resurrect an expired document', () => {
    const manager = newManager();
    const old = manager.createGDocsSession('synthetic', { version: 'old' });
    old.expiresAt = new Date(0);
    const doc = { version: 'new' };
    const session = manager.createGDocsSession('synthetic', doc);
    expect(session).not.toBe(old);
    expect(session.doc).toBe(doc);
    expect(manager.getSessionByPath('gdocs:synthetic')).toBe(session);
  });
});
