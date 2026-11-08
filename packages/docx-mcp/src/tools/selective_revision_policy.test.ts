import { afterEach, describe, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DocxZip } from '@usejunior/docx-core';
import { isDocxSession } from '../session/manager.js';
import { testAllure } from '../testing/allure-test.js';
import { assertFailure, assertSuccess, createTestSessionManager, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { acceptAiEdits } from './accept_ai_edits.js';
import { rejectAiEdits } from './reject_ai_edits.js';
import { acceptChanges } from './accept_changes.js';
import { replaceText } from './replace_text.js';
import { addComment } from './add_comment.js';
import { save } from './save.js';

const TEST_FEATURE = 'model-selective-revision-policy';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
const AI = 'SafeDocX AI';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const date = '2026-01-01T00:00:00Z';
const ins = (id: number, author: string, text: string) =>
  `<w:ins w:id="${id}" w:author="${author}" w:date="${date}"><w:r><w:t>${text}</w:t></w:r></w:ins>`;

async function fixture(sideStory = false) {
  const opened = await openSession([], {
    mgr: createTestSessionManager({ defaultAiAuthor: AI }),
    xml: `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Anchor</w:t></w:r></w:p>`
      + `<w:p>${ins(101, AI, 'AI first')}</w:p><w:p>${ins(103, AI, 'AI second')}${ins(102, 'Reviewer', 'Human')}</w:p>`
      + '</w:body></w:document>',
    ...(sideStory ? { extraFiles: {
      'word/footnotes.xml': `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1"><w:p>${ins(201, AI, 'AI note')}${ins(202, 'Reviewer', 'Human note')}</w:p></w:footnote></w:footnotes>`,
    } } : {}),
  });
  const session = await opened.mgr.getSessionByFilePath(opened.filePath);
  if (!session || !isDocxSession(session)) throw new Error('Missing DOCX session');
  const exportTo = (name: string, format: 'clean' | 'tracked' | 'both' = 'clean', ack = false) => save(opened.mgr, {
    file_path: opened.filePath, save_to_local_path: path.join(opened.tmpDir, `${name}.docx`),
    save_format: format, allow_discard_preserved_revisions: ack,
  });
  const select = async (id = 101) => {
    const response = await acceptAiEdits(opened.mgr, { file_path: opened.filePath, revision_ids: [id] });
    assertSuccess(response, 'selective accept');
    return response;
  };
  const edit = async () => {
    assertSuccess(await replaceText(opened.mgr, {
      file_path: opened.filePath, target_paragraph_id: opened.firstParaId,
      old_string: 'Anchor', new_string: 'Later', instruction: 'later tracked edit',
    }), 'ordinary edit');
  };
  return { ...opened, session, exportTo, select, edit };
}

async function xmlAt(file: string, part = 'word/document.xml') {
  return (await DocxZip.load(await fs.readFile(file))).readText(part);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('session selective revision policy', () => {
  registerCleanup();
  afterEach(() => vi.restoreAllMocks());

  test.openspec('Selective preservation remains sticky across later edits and saves')('ordinary edits, non-revision writes and acknowledged exports retain sticky policy', async () => {
    const f = await fixture();
    expect(f.session.selectiveRevisionPolicy).toEqual({ mode: 'ordinary' });
    await f.select();
    const policy = structuredClone(f.session.selectiveRevisionPolicy);
    expect(policy).toEqual({ mode: 'preserve', lastAction: {
      tool: 'accept_ai_edits', selector: 'revision_ids', selectedRevisionIds: ['101'], editRevision: 1,
    } });
    await f.edit();
    assertSuccess(await addComment(f.mgr, {
      file_path: f.filePath, target_paragraph_id: f.firstParaId, author: AI, text: 'Root comment',
    }), 'comment');
    const root = (await f.session.doc.getComments())[0]!;
    assertSuccess(await addComment(f.mgr, {
      file_path: f.filePath, parent_comment_id: root.id, author: AI, text: 'Untracked reply',
    }), 'package-only comment reply');
    expect(f.session.nonRevisionManifest.at(-1)?.parts).not.toContain('word/document.xml');
    expect(f.session.selectiveRevisionPolicy).toEqual(policy);
    for (const format of ['clean', 'both'] as const) {
      const blocked = await f.exportTo(`blocked-${format}`, format);
      assertFailure(blocked, 'SELECTIVE_REVISIONS_WOULD_BE_DISCARDED');
      expect(blocked.selective_revision_action).toEqual(policy.mode === 'preserve' ? policy.lastAction : null);
      expect(Object.keys(blocked.selective_revision_action as object).sort()).toEqual(['editRevision', 'selectedRevisionIds', 'selector', 'tool']);
      expect((blocked.preserved_revisions as { count: number }).count).toBeGreaterThan(1);
      await expect(fs.stat(path.join(f.tmpDir, `blocked-${format}.docx`))).rejects.toThrow();
    }
    const before = await f.session.doc.getMutationSnapshot();
    const livePolicy = f.session.selectiveRevisionPolicy;
    const tracked = await f.exportTo('tracked', 'tracked');
    assertSuccess(tracked, 'tracked save');
    expect(await xmlAt(String(tracked.saved_to))).toContain('w:id="103"');
    expect(await xmlAt(String(tracked.saved_to))).toContain('w:id="102"');
    for (const format of ['clean', 'both'] as const) {
      const ack = await f.exportTo(`ack-${format}`, format, true);
      assertSuccess(ack, 'acknowledged export');
      const cleanXml = await xmlAt(String(ack.saved_to));
      expect(cleanXml).not.toContain('w:id="103"');
      expect(cleanXml).toContain('w:id="102"');
      const cached = await f.exportTo(`cached-${format}`, format, true);
      assertSuccess(cached, 'cached acknowledged export');
      expect(cached.cache_hit).toBe(true);
      assertFailure(await f.exportTo(`still-blocked-${format}`, format), 'SELECTIVE_REVISIONS_WOULD_BE_DISCARDED');
    }
    expect(await f.session.doc.getMutationSnapshot()).toEqual(before);
    expect(f.session.selectiveRevisionPolicy).toBe(livePolicy);
  });

  test.openspec('Complete resolution and subsequent AI edits')('repeated selective actions resolve all AI history, retain humans and guard later AI edits', async () => {
    const f = await fixture();
    await f.select();
    assertSuccess(await rejectAiEdits(f.mgr, { file_path: f.filePath, author: AI }), 'reject remaining AI');
    const policy = structuredClone(f.session.selectiveRevisionPolicy);
    expect(policy).toEqual({ mode: 'preserve', lastAction: {
      tool: 'reject_ai_edits', selector: 'author', selectedRevisionIds: ['103'], editRevision: 2,
    } });
    const saved = await f.exportTo('complete');
    assertSuccess(saved, 'complete resolution export');
    expect(saved.selective_revision_disposition).toBeUndefined();
    const xml = await xmlAt(String(saved.saved_to));
    expect(xml).toContain('w:id="102"');
    expect(xml).not.toContain('AI second');
    await f.edit();
    assertFailure(await f.exportTo('later'), 'SELECTIVE_REVISIONS_WOULD_BE_DISCARDED');
    expect(f.session.selectiveRevisionPolicy).toEqual(policy);
  });

  test.openspec('Complete resolution and subsequent AI edits')('global acceptance retains mode and a genuinely reopened session starts ordinary', async () => {
    const f = await fixture();
    await f.select();
    const policy = structuredClone(f.session.selectiveRevisionPolicy);
    assertSuccess(await acceptChanges(f.mgr, { file_path: f.filePath }), 'global accept');
    expect(f.session.selectiveRevisionPolicy).toEqual(policy);
    assertSuccess(await f.exportTo('global'), 'no remaining revisions');
    await f.edit();
    assertFailure(await f.exportTo('new-ai'), 'SELECTIVE_REVISIONS_WOULD_BE_DISCARDED');
    const tracked = await f.exportTo('reopen', 'tracked');
    assertSuccess(tracked, 'persist tracked');
    await f.mgr.clearSessionByPath(f.filePath);
    const reopened = await f.mgr.createSession(await fs.readFile(String(tracked.saved_to)), 'reopened.docx', String(tracked.saved_to));
    expect(reopened.selectiveRevisionPolicy).toEqual({ mode: 'ordinary' });
    assertSuccess(await save(f.mgr, { file_path: String(tracked.saved_to), save_to_local_path: path.join(f.tmpDir, 'reopened-clean.docx'), save_format: 'clean' }), 'ordinary reopened clean');
  });

  test('remaining AI revisions are derived from side stories and human story history survives clean export', async () => {
    const f = await fixture(true);
    await f.select();
    await f.select(103);
    const blocked = await f.exportTo('side-block');
    assertFailure(blocked, 'SELECTIVE_REVISIONS_WOULD_BE_DISCARDED');
    expect(blocked.preserved_revisions).toEqual({ count: 1, author: AI, ids: [201] });
    const saved = await f.exportTo('side-ack', 'both', true);
    assertSuccess(saved, 'ack story export');
    expect(await xmlAt(String(saved.saved_to), 'word/footnotes.xml')).not.toContain('w:id="201"');
    expect(await xmlAt(String(saved.saved_to), 'word/footnotes.xml')).toContain('w:id="202"');
    expect(await xmlAt(String(saved.tracked_saved_to), 'word/footnotes.xml')).toContain('w:id="201"');
  });

  for (const call of [acceptAiEdits, rejectAiEdits]) {
    test.openspec('Failed and no-op selections do not publish policy')(`${call.name} selecting an unsupported grid revision leaves ordinary policy and all bookkeeping untouched`, async () => {
      const opened = await openSession([], {
        mgr: createTestSessionManager({ defaultAiAuthor: AI }),
        xml: `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Anchor</w:t></w:r></w:p>`
          + `<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:tblGridChange w:id="777" w:author="${AI}" w:date="${date}"><w:tblGrid><w:gridCol w:w="900"/></w:tblGrid></w:tblGridChange></w:tblGrid>`
          + '<w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
      });
      const session = await opened.mgr.getSessionByFilePath(opened.filePath);
      if (!session || !isDocxSession(session)) throw new Error('Missing DOCX session');
      const before = await session.doc.getMutationSnapshot();
      const { doc, selectiveRevisionPolicy: policy } = session;
      const result = await call(opened.mgr, { file_path: opened.filePath, revision_ids: [777] });
      assertSuccess(result, 'unsupported-only selection');
      expect(result.selected_revision_ids).toEqual([]);
      expect(result.persistence_required).toBe(false);
      expect(session.doc).toBe(doc);
      expect(await doc.getMutationSnapshot()).toEqual(before);
      expect(session.selectiveRevisionPolicy).toBe(policy);
      expect(session.selectiveRevisionPolicy.mode).toBe('ordinary');
      expect([session.editCount, session.editRevision, session.saveCache.size]).toEqual([0, 0, 0]);
    });

    test.openspec('Failed and no-op selections do not publish policy')(`${call.name} rolls back staged policy and keeps no-op bookkeeping`, async () => {
      const f = await fixture();
      await f.select();
      assertSuccess(await f.exportTo('warm', 'tracked'), 'warm cache');
      f.session.extractionCache = { revision: f.session.editRevision, changes: [] };
      const before = await f.session.doc.getMutationSnapshot();
      const { doc, selectiveRevisionPolicy: policy, extractionCache, editCount, editRevision } = f.session;
      const cacheEntries = [...f.session.saveCache];
      const record = f.mgr.recordSelectiveRevisionAction.bind(f.mgr);
      const injected = vi.spyOn(f.mgr, 'recordSelectiveRevisionAction').mockImplementation((candidate, action) => {
        record(candidate, action);
        throw new Error('injected after policy staging');
      });
      expect((await call(f.mgr, { file_path: f.filePath, revision_ids: [103] })).success).toBe(false);
      injected.mockRestore();
      const noop = await call(f.mgr, { file_path: f.filePath, revision_ids: [999] });
      assertSuccess(noop, 'unknown ID');
      expect(noop.persistence_required).toBe(false);
      // A candidate may stage a policy and claim success, yet unchanged XML
      // still must not publish it. This exercises the atomic boundary itself.
      assertSuccess(await f.mgr.mutateSession(f.session, async candidate => {
        record(candidate, { tool: 'reject_ai_edits', selector: 'revision_ids', selectedRevisionIds: ['999'] });
        return { success: true, persistence_required: true, selected_revision_ids: ['999'] };
      }), 'unchanged candidate');
      expect(f.session.doc).toBe(doc);
      expect(await doc.getMutationSnapshot()).toEqual(before);
      expect(f.session.selectiveRevisionPolicy).toBe(policy);
      expect(f.session.extractionCache).toBe(extractionCache);
      expect([...f.session.saveCache]).toEqual(cacheEntries);
      expect([f.session.editCount, f.session.editRevision]).toEqual([editCount, editRevision]);
    });
  }

  test('save policy generation guard rejects cache publication even when document, revision and author are unchanged', async () => {
    const f = await fixture();
    await f.select();
    const policy = f.session.selectiveRevisionPolicy;
    if (policy.mode !== 'preserve') throw new Error('Expected preservation');
    const entered = deferred();
    const release = deferred();
    const serialize = f.session.doc.toBuffer.bind(f.session.doc);
    vi.spyOn(f.session.doc, 'toBuffer').mockImplementationOnce(options => serialize(options).then(async result => {
      entered.resolve();
      await release.promise;
      return result;
    }));
    const pending = f.exportTo('guard', 'both', true);
    await entered.promise;
    const { doc, editRevision, aiAuthor } = f.session;
    try {
      f.mgr.recordSelectiveRevisionAction(f.session, {
        tool: 'reject_ai_edits', selector: 'revision_ids', selectedRevisionIds: ['777'],
      });
    } finally { release.resolve(); }
    assertSuccess(await pending, 'captured acknowledged export');
    expect(f.session.doc).toBe(doc);
    expect(f.session.editRevision).toBe(editRevision);
    expect(f.session.aiAuthor).toBe(aiAuthor);
    expect(f.session.selectiveRevisionPolicy).not.toBe(policy);
    expect(f.session.saveCache.size).toBe(0);
  });

  test('recorded selected IDs and captured wire diagnostics are independent array snapshots', async () => {
    const f = await fixture();
    await f.select();
    const ids = ['101'];
    f.mgr.recordSelectiveRevisionAction(f.session, { tool: 'accept_ai_edits', selector: 'revision_ids', selectedRevisionIds: ids });
    ids.push('caller-mutation');
    const policy = f.session.selectiveRevisionPolicy;
    if (policy.mode !== 'preserve') throw new Error('Expected preservation');
    expect(policy.lastAction.selectedRevisionIds).toEqual(['101']);
    const entered = deferred();
    const release = deferred();
    const serialize = f.session.doc.toBuffer.bind(f.session.doc);
    vi.spyOn(f.session.doc, 'toBuffer').mockImplementationOnce(options => serialize(options).then(async result => {
      entered.resolve();
      await release.promise;
      return result;
    }));
    const pending = f.exportTo('diagnostic');
    await entered.promise;
    try { policy.lastAction.selectedRevisionIds.push('later-mutation'); } finally { release.resolve(); }
    const result = await pending;
    assertFailure(result, 'SELECTIVE_REVISIONS_WOULD_BE_DISCARDED');
    expect(result.selective_revision_action).toEqual({ tool: 'accept_ai_edits', selector: 'revision_ids', selectedRevisionIds: ['101'], editRevision: 1 });
  });

  for (const cacheHit of [false, true]) {
    test.openspec('Save captures policy and document generation together')(`captured ${cacheHit ? 'cached' : 'fresh'} policy and diagnostics survive a concurrent selective action`, async () => {
      const f = await fixture();
      await f.select();
      const capturedPolicy = structuredClone(f.session.selectiveRevisionPolicy);
      if (cacheHit) assertSuccess(await f.exportTo('warm', 'both', true), 'warm cache');
      const entered = deferred();
      const release = deferred();
      const serialize = f.session.doc.toBuffer.bind(f.session.doc);
      vi.spyOn(f.session.doc, 'toBuffer').mockImplementationOnce(options => serialize(options).then(async result => {
        entered.resolve();
        await release.promise;
        return result;
      }));
      const pending = f.exportTo('captured', 'both');
      await entered.promise;
      try { await f.select(103); } finally { release.resolve(); }
      const saved = await pending;
      assertFailure(saved, 'SELECTIVE_REVISIONS_WOULD_BE_DISCARDED');
      expect(saved.selective_revision_action).toEqual(capturedPolicy.mode === 'preserve' ? capturedPolicy.lastAction : null);
      expect(saved.preserved_revisions).toEqual({ count: 1, author: AI, ids: [103] });
      expect(f.session.saveCache.size).toBe(0);
      assertSuccess(await f.exportTo('current', 'both'), 'current fully resolved save');
    });

    test.openspec('Save captures policy and document generation together')(`acknowledged ${cacheHit ? 'cached' : 'fresh'} export keeps captured artifacts and cannot publish stale cache`, async () => {
      const f = await fixture();
      await f.select();
      if (cacheHit) assertSuccess(await f.exportTo('warm', 'both', true), 'warm cache');
      const before = await f.session.doc.toBuffer({ cleanBookmarks: true, preserveOriginalBookmarks: true });
      const entered = deferred();
      const release = deferred();
      const serialize = f.session.doc.toBuffer.bind(f.session.doc);
      vi.spyOn(f.session.doc, 'toBuffer').mockImplementationOnce(options => serialize(options).then(async result => {
        entered.resolve();
        await release.promise;
        return result;
      }));
      const pending = f.exportTo('captured', 'both', true);
      await entered.promise;
      try { await f.edit(); } finally { release.resolve(); }
      const saved = await pending;
      assertSuccess(saved, 'captured export');
      expect(saved.cache_hit).toBe(cacheHit);
      expect(saved.edit_revision).toBe(1);
      expect(await xmlAt(String(saved.saved_to))).toContain('Anchor');
      expect(await xmlAt(String(saved.saved_to))).not.toContain('Later');
      expect(await xmlAt(String(saved.tracked_saved_to))).toEqual(await (await DocxZip.load(before.buffer)).readText('word/document.xml'));
      expect(f.session.saveCache.size).toBe(0);
      assertFailure(await f.exportTo('still-sticky'), 'SELECTIVE_REVISIONS_WOULD_BE_DISCARDED');
    });
  }
});
