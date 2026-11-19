import path from 'node:path';
import { afterEach, describe, expect, vi } from 'vitest';
import { DocxDocument, readZipText } from '@usejunior/docx-core';
import { SessionManager, type DocxSession } from './manager.js';
import { testAllure } from '../testing/allure-test.js';
import { createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';

const { buildDocxFromBodyXml }: { buildDocxFromBodyXml(body: string): Promise<Buffer> } =
  await import(new URL('../../../docx-core/src/testing/ooxml-fixtures.ts', import.meta.url).href);
const TEST_FEATURE = 'pair-comparison-baselines';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
const fragmented = '<w:p><w:r><w:t>By</w:t></w:r><w:r><w:t>laws</w:t></w:r></w:p>'
  + '<w:p><w:r><w:t>Un</w:t></w:r><w:r><w:t>touched</w:t></w:r></w:p>';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

describe('paired comparison baseline resource', () => {
  registerCleanup();
  const managers: SessionManager[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(managers.splice(0).map(manager => manager.clearAllSessions()));
  });
  async function setup(skipNormalization = false) {
    const manager = new SessionManager();
    managers.push(manager);
    const dir = await createTrackedTempDir('baseline-pair-');
    const session = await manager.createSession(await buildDocxFromBodyXml(fragmented), 'input.docx', path.join(dir, 'input.docx'), { skipNormalization });
    return { manager, session };
  }
  function expectUnpublished(session: DocxSession) {
    expect(session.comparisonBaseline).toBeNull();
    expect(session.comparisonBaselineWithBookmarks).toBeNull();
  }

  test.openspec('Shared paired success')('shares preparation and exposes neither half until both complete', async () => {
    const { manager, session } = await setup();
    const entered = gate();
    const resume = gate();
    const serialize = DocxDocument.prototype.toBuffer;
    const spy = vi.spyOn(DocxDocument.prototype, 'toBuffer').mockImplementation(async function (this: DocxDocument, opts) {
      const result = await serialize.call(this, opts);
      if (opts?.cleanBookmarks === false) { entered.release(); await resume.promise; }
      return result;
    });
    const attempts = [manager.ensureBaselines(session), manager.ensureBaselines(session)];
    try {
      await entered.promise;
      expectUnpublished(session);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally { resume.release(); }
    const [first, second] = await Promise.all(attempts);
    expect(first).toBe(second);
    expect(await manager.ensureBaselines(session)).toBe(first);
    expect(session.comparisonBaseline).toBe(first!.clean);
    expect(session.comparisonBaselineWithBookmarks).toBe(first!.withBookmarks);
    expect(await readZipText(first!.clean, 'word/document.xml')).not.toContain('_bk_');
    expect(await readZipText(first!.withBookmarks, 'word/document.xml')).toContain('_bk_');
    expect(spy).toHaveBeenCalledTimes(2);
    // No promise/controller enters the cloneable transaction metadata.
    expect(() => structuredClone({ ...session, doc: undefined })).not.toThrow();
  });

  for (const stage of ['load', 'normalize', 'bookmarks', 'before clean', 'after clean', 'before bookmarked', 'after bookmarked'] as const) {
    test.openspec('Shared failure and retry')(`shares failure at ${stage} and retries the entire pair`, async () => {
      const { manager, session } = await setup();
      const load = DocxDocument.load.bind(DocxDocument);
      const failure = new Error(`injected ${stage}`);
      const entered = gate();
      const resume = gate();
      const spy = vi.spyOn(DocxDocument, 'load').mockImplementationOnce(async buffer => {
        entered.release();
        await resume.promise;
        if (stage === 'load') throw failure;
        const doc = await load(buffer);
        if (stage === 'normalize') vi.spyOn(doc, 'normalize').mockImplementationOnce(() => { throw failure; });
        if (stage === 'bookmarks') vi.spyOn(doc, 'insertParagraphBookmarks').mockImplementationOnce(() => { throw failure; });
        const serialize = doc.toBuffer.bind(doc);
        vi.spyOn(doc, 'toBuffer').mockImplementation(async opts => {
          const half = opts?.cleanBookmarks ? 'clean' : 'bookmarked';
          if (stage === `before ${half}`) throw failure;
          const result = await serialize(opts);
          if (stage === `after ${half}`) throw failure;
          return result;
        });
        return doc;
      });
      const waiting = Promise.allSettled([manager.ensureBaselines(session), manager.ensureBaselines(session)]);
      await entered.promise;
      expectUnpublished(session);
      resume.release();
      for (const result of await waiting) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') expect(result.reason).toBe(failure);
      }
      expectUnpublished(session);
      expect(spy).toHaveBeenCalledTimes(1);
      const [a, b] = await Promise.all([manager.ensureBaselines(session), manager.ensureBaselines(session)]);
      expect(a).toBe(b);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(session.comparisonBaseline).toBe(a!.clean);
      expect(session.comparisonBaselineWithBookmarks).toBe(a!.withBookmarks);
    });
  }

  for (const retirement of ['close', 'clear all', 'expire', 'replace'] as const) {
    test.openspec('Retirement or source replacement during preparation')(`rejects pending publication after ${retirement}`, async () => {
      const { manager, session } = await setup();
      const entered = gate();
      const resume = gate();
      const serialize = DocxDocument.prototype.toBuffer;
      vi.spyOn(DocxDocument.prototype, 'toBuffer').mockImplementationOnce(async function (this: DocxDocument, opts) {
        const result = await serialize.call(this, opts);
        entered.release(); await resume.promise;
        return result;
      });
      const pending = Promise.allSettled([manager.ensureBaselines(session), manager.ensureBaselines(session)]);
      await entered.promise;
      let replacement: DocxSession | undefined;
      if (retirement === 'close') await manager.clearSessionByPath(session.originalPath);
      if (retirement === 'clear all') await manager.clearAllSessions();
      if (retirement === 'expire') session.expiresAt = new Date(0);
      if (retirement === 'replace') replacement = await manager.createSession(session.originalBuffer, session.filename, session.originalPath);
      resume.release();
      for (const result of await pending) expect(result.status).toBe('rejected');
      expectUnpublished(session);
      await expect(manager.ensureBaselines(session)).rejects.toThrow();
      if (replacement) {
        expectUnpublished(replacement);
        const pair = await manager.ensureBaselines(replacement);
        expect(replacement.comparisonBaseline).toBe(pair.clean);
      }
    });
  }

  test.openspec('Retirement or source replacement during preparation')('an obsolete attempt cannot erase a newer source pair', async () => {
    const { manager, session } = await setup();
    const entered = gate();
    const resume = gate();
    const load = DocxDocument.load.bind(DocxDocument);
    vi.spyOn(DocxDocument, 'load').mockImplementationOnce(async buffer => {
      entered.release(); await resume.promise;
      return load(buffer);
    });
    const pending = Promise.allSettled([manager.ensureBaselines(session)]);
    await entered.promise;
    session.originalBuffer = await buildDocxFromBodyXml('<w:p><w:r><w:t>Replacement source</w:t></w:r></w:p>');
    const fresh = await manager.ensureBaselines(session);
    resume.release();
    expect((await pending)[0]!.status).toBe('rejected');
    expect(await manager.ensureBaselines(session)).toBe(fresh);
    expect(await readZipText(fresh.clean, 'word/document.xml')).toContain('Replacement source');
  });

  test('a legacy successful half cannot establish readiness', async () => {
    const { manager, session } = await setup();
    session.comparisonBaseline = Buffer.from('stale half');
    const pair = await manager.ensureBaselines(session);
    expect(session.comparisonBaselineWithBookmarks).not.toBeNull();
    expect(session.comparisonBaseline).toBe(pair.clean);
    expect(session.comparisonBaselineWithBookmarks).toBe(pair.withBookmarks);
    expect(await readZipText(pair.clean, 'word/document.xml')).toContain('Bylaws');
  });

  test.openspec('Original baseline isolation')('an atomic live-document replacement during preparation keeps the original baseline', async () => {
    const { manager, session } = await setup();
    const entered = gate();
    const resume = gate();
    const load = DocxDocument.load.bind(DocxDocument);
    vi.spyOn(DocxDocument, 'load').mockImplementationOnce(async buffer => {
      entered.release(); await resume.promise;
      return load(buffer);
    });
    const pending = manager.ensureBaselines(session);
    await entered.promise;
    const live = session.doc;
    try {
      const result = await manager.mutateSession(session, async candidate => {
        candidate.doc.replaceText({ targetParagraphId: candidate.doc.readParagraphs().paragraphs[0]!.id,
          findText: 'Bylaws', replaceText: 'Concurrent live edit' });
        return { success: true };
      });
      expect(result.success).toBe(true);
      expect(session.doc).not.toBe(live);
    } finally { resume.release(); }
    const pair = await pending;
    expect(await readZipText(pair.clean, 'word/document.xml')).toContain('<w:t>Bylaws</w:t>');
    expect(session.doc.readParagraphs().paragraphs[0]!.text).toBe('Concurrent live edit');
    expect(await manager.ensureBaselines(session)).toBe(pair);
    await manager.clearSessionByPath(session.originalPath);
    await expect(manager.ensureBaselines(session)).rejects.toThrow();
  });

  for (const skipNormalization of [false, true]) {
    test.openspec('Original baseline isolation')(`normalizes original and preserves edited live history (skip=${skipNormalization})`, async () => {
      const { manager, session } = await setup(skipNormalization);
      const doc = session.doc;
      const original = Buffer.from(session.originalBuffer);
      const paragraph = doc.readParagraphs().paragraphs[0]!;
      doc.replaceText({ targetParagraphId: paragraph.id, findText: 'Bylaws', replaceText: 'Live edit' });
      const before = await doc.getMutationSnapshot();
      const minimalBefore = await doc.toBuffer({ cleanBookmarks: true, minimalReserialization: true });
      const cached = doc.buildDocumentView();
      const version = doc.getMutationVersion();
      const liveSerialize = vi.spyOn(doc, 'toBuffer');
      const liveNormalize = vi.spyOn(doc, 'normalize');
      const pair = await manager.ensureBaselines(session);
      for (const buffer of [pair.clean, pair.withBookmarks]) {
        const xml = await readZipText(buffer, 'word/document.xml');
        expect(xml).toContain('<w:t>Bylaws</w:t>');
        expect(xml).not.toContain('Live edit');
      }
      expect(session.originalBuffer).toEqual(original);
      expect(session.doc).toBe(doc);
      expect(await doc.getMutationSnapshot()).toEqual(before);
      expect(doc.buildDocumentView().nodes).toBe(cached.nodes);
      expect(doc.getMutationVersion()).toBe(version);
      expect(liveSerialize).not.toHaveBeenCalled();
      expect(liveNormalize).not.toHaveBeenCalled();
      liveSerialize.mockRestore();
      const minimalAfter = await doc.toBuffer({ cleanBookmarks: true, minimalReserialization: true });
      expect(await readZipText(minimalAfter.buffer, 'word/document.xml'))
        .toEqual(await readZipText(minimalBefore.buffer, 'word/document.xml'));
      expect(session.normalizationStats === null).toBe(skipNormalization);
    });
  }
});
