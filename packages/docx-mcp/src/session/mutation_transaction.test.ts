import { afterEach, describe, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DocxDocument, createRevisionIdState, OOXML, buildSyntheticDocx } from '@usejunior/docx-core';
import { OdfArchive, OdfDocument } from '@usejunior/odf-core';
import { testAllure } from '../testing/allure-test.js';
import { SessionManager, getRevisionContextForSession, type DocxSession } from './manager.js';
import { ok, err } from '../tools/types.js';
import { clearFormatting } from '../tools/clear_formatting.js';
import { replaceText } from '../tools/replace_text.js';
import { addComment } from '../tools/add_comment.js';
import { odfInsertParagraph } from '../tools/odf/insert_paragraph.js';
import { odfReplaceText } from '../tools/odf/replace_text.js';
import { odfAddComment } from '../tools/odf/add_comment.js';
import { gdocsReplaceText } from '../tools/gdocs/replace_text.js';
import { acceptAiEdits } from '../tools/accept_ai_edits.js';
import { gdocsFormatLayout } from '../tools/gdocs/format_layout.js';
import { gdocsInsertParagraph } from '../tools/gdocs/insert_paragraph.js';
import { formatLayout } from '../tools/format_layout.js';
import { insertParagraph } from '../tools/insert_paragraph.js';
import { addFootnote } from '../tools/add_footnote.js';
import { updateFootnote } from '../tools/update_footnote.js';
import { deleteFootnote } from '../tools/delete_footnote.js';

// Shared source fixtures are deliberately excluded from core's published build.
const { buildDocxFromBodyXml }: { buildDocxFromBodyXml(body: string): Promise<Buffer> } =
  await import(new URL('../../../docx-core/src/testing/ooxml-fixtures.ts', import.meta.url).href);

const TEST_FEATURE = 'centralize-session-mutations';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
const managers: SessionManager[] = [];
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(managers.splice(0).map(manager => manager.clearAllSessions()));
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function setup(buffer?: Buffer) {
  const manager = new SessionManager();
  managers.push(manager);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mutation-1301-'));
  dirs.push(dir);
  const file = path.join(dir, 'input.docx');
  const source = buffer ?? await buildSyntheticDocx({ paragraphs: ['First', 'Second'] });
  await fs.writeFile(file, source);
  const session = await manager.createSession(source, 'input.docx', file);
  const ids = session.doc.buildDocumentView({ includeSemanticTags: false }).nodes.map(node => node.id);
  return { manager, session, file, ids };
}

function seedMetadata(session: DocxSession) {
  session.saveCache.set('sentinel', {
    cacheKey: 'sentinel', revision: 0, format: 'clean', cleanBookmarks: true,
    trackedAuthor: 'Synthetic', revisedBuffer: Buffer.from('cached'), trackedBuffer: null,
    trackedStats: null, bookmarksRemoved: 0, blocksRestored: 0,
    exportedAtUtc: '2026-01-01T00:00:00Z', cachedAtIso: '2026-01-01T00:00:00Z',
  });
  session.extractionCache = { revision: 0, changes: [] };
  session.revisionIdState = createRevisionIdState(40);
  session.selectiveRevisionPolicy = {
    mode: 'preserve',
    lastAction: { tool: 'reject_ai_edits', selector: 'revision_ids', selectedRevisionIds: ['3'], editRevision: 0 },
  };
  return { doc: session.doc, extraction: session.extractionCache, allocator: session.revisionIdState, policy: session.selectiveRevisionPolicy };
}

describe('local mutation boundary', () => {
  test('table selector refusals and partial application keep package state and counters consistent', async () => {
    const buffer = await buildDocxFromBodyXml('<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>');
    const { manager, session, file } = await setup(buffer);
    const metadata = seedMetadata(session);
    const before = await session.doc.getMutationSnapshot();
    for (const selectors of [
      { row_height: { table_indexes: [0], row_indexes: [9], value_twips: 400, rule: 'exact' } },
      { cell_padding: { table_indexes: [9], top_dxa: 100 } },
      { cell_padding: { table_indexes: [0], row_indexes: [9], top_dxa: 100 } },
      { cell_padding: { table_indexes: [0], cell_indexes: [9], top_dxa: 100 } },
    ]) {
      expect(await formatLayout(manager, { file_path: file, ...selectors })).toMatchObject({ success: false, error: { code: 'INVALID_SELECTOR' } });
      expect(session.doc).toBe(metadata.doc);
      expect(await session.doc.getMutationSnapshot()).toEqual(before);
      expect(session.editRevision).toBe(0);
    }
    const partial = {
      file_path: file, strict: false,
      row_height: { table_indexes: [0, 9], row_indexes: [0, 9], value_twips: 400, rule: 'exact' },
      cell_padding: { table_indexes: [0, 9], row_indexes: [0, 9], cell_indexes: [0, 9], top_dxa: 100 },
    };
    expect(await formatLayout(manager, partial)).toMatchObject({
      success: true, mutation_summary: { affected_rows: 1, affected_cells: 1 },
      warnings: [
        'row_height missing table indexes: 9', 'row_height missing row indexes: 0:9',
        'cell_padding missing table indexes: 9', 'cell_padding missing row indexes: 0:9',
        'cell_padding missing cell indexes: 0:0:9',
      ],
    });
    const xml = session.doc.getDocumentXmlClone();
    expect(xml.getElementsByTagNameNS(OOXML.W_NS, 'trHeight')[0]!.getAttributeNS(OOXML.W_NS, 'val')).toBe('400');
    expect(xml.getElementsByTagNameNS(OOXML.W_NS, 'top')[0]!.getAttributeNS(OOXML.W_NS, 'w')).toBe('100');
    expect(session.editRevision).toBe(1);
    const committed = session.doc;
    expect((await formatLayout(manager, partial)).success).toBe(true);
    expect(session.doc).toBe(committed);
    expect(session.editRevision).toBe(1);
    expect(session.saveCache.size).toBe(0);
    expect(session.extractionCache).toBeNull();
    expect(session.selectiveRevisionPolicy).toEqual(metadata.policy);
  });

  test('style-selected insertion resolves candidate nodes and discards a failed insertion', async () => {
    const buffer = await buildDocxFromBodyXml('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Heading</w:t></w:r></w:p><w:p><w:r><w:t>Body</w:t></w:r></w:p>');
    const { manager, session, file, ids } = await setup(buffer);
    const params = { file_path: file, positional_anchor_node_id: ids[1]!, new_string: 'Inserted', instruction: 'synthetic', target_style: 'heading' };
    const original = session.doc;
    const mark = vi.spyOn(manager, 'markEdited').mockImplementation(() => { throw new Error('after insertion'); });
    expect((await insertParagraph(manager, params)).success).toBe(false);
    expect(session.doc).toBe(original);
    expect(session.doc.getParagraphs()).toHaveLength(2);
    mark.mockRestore();
    expect((await insertParagraph(manager, params)).success).toBe(true);
    expect(session.doc.buildDocumentView().nodes.map(node => [node.text, node.style])).toEqual([['Heading', 'heading'], ['Body', 'body'], ['Inserted', 'heading']]);
    expect(session.editRevision).toBe(1);
  });

  test('footnote side-part edits roll back with body references and leave the queue usable', async () => {
    const { manager, session, file, ids } = await setup();
    const add = await addFootnote(manager, { file_path: file, target_paragraph_id: ids[0]!, text: 'Original note' });
    expect(add.success).toBe(true);
    const noteId = add.note_id as number;
    const before = await session.doc.getMutationSnapshot();
    const original = session.doc;
    const mark = vi.spyOn(manager, 'markEdited').mockImplementation(() => { throw new Error('after side-part edit'); });
    expect((await updateFootnote(manager, { file_path: file, note_id: noteId, new_text: 'Discarded' })).success).toBe(false);
    expect((await deleteFootnote(manager, { file_path: file, note_id: noteId })).success).toBe(false);
    expect(session.doc).toBe(original);
    expect(await session.doc.getMutationSnapshot()).toEqual(before);
    expect(session.editRevision).toBe(1);
    mark.mockRestore();
    expect(await addFootnote(manager, { file_path: file, target_paragraph_id: ids[0]!, text: 'Discarded', after_text: 'absent' })).toMatchObject({ success: false, error: { code: 'TEXT_NOT_FOUND' } });
    for (const request of [
      () => addFootnote(manager, { file_path: file }),
      () => addFootnote(manager, { file_path: file, target_paragraph_id: ids[0] }),
      () => updateFootnote(manager, { file_path: file }),
      () => updateFootnote(manager, { file_path: file, note_id: noteId }),
      () => deleteFootnote(manager, { file_path: file }),
      () => deleteFootnote(manager, { file_path: file, note_id: -1 }),
      () => deleteFootnote(manager, { file_path: file, note_id: 999 }),
    ]) {
      expect((await request()).success).toBe(false);
      expect(session.doc).toBe(original);
      expect(session.editRevision).toBe(1);
    }
    expect((await updateFootnote(manager, { file_path: file, note_id: noteId, new_text: 'Committed' })).success).toBe(true);
    expect((await session.doc.getFootnote(noteId))?.text.trim()).toBe('Committed');
    expect(session.editRevision).toBe(2);
  });

  test('internal candidates do not register as emitted artifacts, while actual exports still do', async () => {
    const { manager, session } = await setup();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mutation-schema-capture-'));
    dirs.push(dir);
    vi.stubEnv('SDX_SCHEMA_CORPUS_DIR', dir);
    const snapshot = await session.doc.getMutationSnapshot();
    expect(Buffer.isBuffer(snapshot)).toBe(true);
    expect(await manager.mutateSession(session, async () => err('VALIDATION_REFUSED', 'candidate is not an export'))).toMatchObject({ success: false });
    expect(await fs.readdir(dir)).toEqual([]);
    await session.doc.toBuffer({ cleanBookmarks: false });
    const emitted = await fs.readdir(dir);
    expect(emitted).toHaveLength(1);
    expect(await fs.readFile(path.join(dir, emitted[0]!), 'utf8')).toContain('First');
  });

  test.openspec('Precommit candidate remains invisible')('reads see the old document until atomic publication; queued writes see the committed predecessor', async () => {
    const { manager, session, file, ids } = await setup();
    const metadata = seedMetadata(session);
    const entered = barrier();
    const resume = barrier();
    const first = manager.mutateSession(session, async candidate => {
      candidate.doc.replaceText({ targetParagraphId: ids[0]!, findText: 'First', replaceText: 'Committed' });
      manager.markEdited(candidate);
      manager.recordNonRevisionChange(candidate, { tool: 'test', parts: ['word/document.xml'], description: 'synthetic attribution' });
      entered.release();
      await resume.promise;
      return ok();
    });
    await entered.promise;
    const second = manager.mutateSession(session, async candidate => {
      expect(candidate.doc.getParagraphTextById(ids[0]!)).toBe('Committed');
      candidate.doc.replaceText({ targetParagraphId: ids[1]!, findText: 'Second', replaceText: 'Queued' });
      manager.markEdited(candidate);
      return ok();
    });
    expect((await manager.getSessionByFilePath(file))?.doc).toBe(metadata.doc);
    expect(session.doc.getParagraphTextById(ids[0]!)).toBe('First');
    expect(session.editRevision).toBe(0);
    expect(session.nonRevisionManifest).toEqual([]);
    expect(session.extractionCache).toBe(metadata.extraction);
    expect(await fs.readFile(session.tmpPath)).toEqual(session.originalBuffer);
    resume.release();
    expect((await first).success).toBe(true);
    expect((await second).success).toBe(true);
    expect(session.editCount).toBe(2);
    expect(session.editRevision).toBe(2);
    expect(session.extractionCache).toBeNull();
    expect(session.saveCache.size).toBe(0);
    expect(session.nonRevisionManifest).toEqual([{ tool: 'test', parts: ['word/document.xml'], description: 'synthetic attribution', editRevision: 1 }]);
    expect(session.selectiveRevisionPolicy).toEqual(metadata.policy);
  });

  test.openspec('Precommit candidate remains invisible')('a direct-DOM tool failure preserves active XML, allocator, cache and usable temp resource', async () => {
    const buffer = await buildDocxFromBodyXml('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>First</w:t></w:r></w:p>');
    const { manager, session, file, ids } = await setup(buffer);
    const metadata = seedMetadata(session);
    const before = await session.doc.getMutationSnapshot();
    const mark = vi.spyOn(manager, 'markEdited').mockImplementation(candidate => {
      expect(candidate.doc.getParagraphElementById(ids[0]!)!.getElementsByTagNameNS(OOXML.W_NS, 'b').length).toBe(0);
      throw new Error('injected after DOM edit');
    });
    const response = await clearFormatting(manager, { file_path: file, clear_bold: true });
    expect(response.success).toBe(false);
    expect(session.doc).toBe(metadata.doc);
    expect(await session.doc.getMutationSnapshot()).toEqual(before);
    expect(session.doc.getParagraphElementById(ids[0]!)!.getElementsByTagNameNS(OOXML.W_NS, 'b').length).toBe(1);
    expect(session.editRevision).toBe(0);
    expect(session.extractionCache).toBe(metadata.extraction);
    expect(session.saveCache.get('sentinel')?.revisedBuffer.toString()).toBe('cached');
    expect(session.revisionIdState).toBe(metadata.allocator);
    expect(await fs.readFile(session.tmpPath)).toEqual(buffer);
    mark.mockRestore();
    expect((await clearFormatting(manager, { file_path: file, clear_bold: true })).success).toBe(true);
    expect(session.editRevision).toBe(1);
  });

  test('failed side-part attribution discards document and revision allocations', async () => {
    const { manager, session, file, ids } = await setup();
    session.aiAuthor = 'Synthetic Agent';
    const metadata = seedMetadata(session);
    vi.spyOn(manager, 'recordNonRevisionChange').mockImplementation(() => { throw new Error('attribution failed'); });
    const response = await addComment(manager, { file_path: file, target_paragraph_id: ids[0], author: 'Jane Doe', text: 'Synthetic note' });
    expect(response.success).toBe(false);
    expect(await session.doc.getComments()).toEqual([]);
    expect(session.doc).toBe(metadata.doc);
    expect(session.revisionIdState).toBe(metadata.allocator);
    expect(session.revisionIdState!.nextId).toBe(40);
    expect(session.editCount).toBe(0);
    expect(session.nonRevisionManifest).toEqual([]);
  });

  test.openspec('No-op preserves bookkeeping')('identical replacement preserves exact active document, caches, allocator and sticky selective policy', async () => {
    const { manager, session, file, ids } = await setup();
    const metadata = seedMetadata(session);
    const cache = session.saveCache;
    const response = await replaceText(manager, { file_path: file, target_paragraph_id: ids[0]!, old_string: 'First', new_string: 'First', instruction: 'no-op' });
    expect(response.success).toBe(true);
    expect(response.edit_count).toBe(0);
    expect(session.doc).toBe(metadata.doc);
    expect(session.saveCache).toBe(cache);
    expect(session.saveCache.get('sentinel')?.revisedBuffer.toString()).toBe('cached');
    expect(session.extractionCache).toBe(metadata.extraction);
    expect(session.revisionIdState).toBe(metadata.allocator);
    expect(session.selectiveRevisionPolicy).toBe(metadata.policy);
    expect(session.editRevision).toBe(0);
  });

  for (const retirement of ['close', 'replace', 'expire'] as const) {
    test.openspec('Retired generation cannot commit')(`a paused mutation cannot commit after ${retirement}`, async () => {
      const { manager, session, file, ids } = await setup();
      const entered = barrier();
      const resume = barrier();
      const pending = manager.mutateSession(session, async candidate => {
        candidate.doc.replaceText({ targetParagraphId: ids[0]!, findText: 'First', replaceText: 'Forbidden' });
        manager.markEdited(candidate);
        entered.release();
        await resume.promise;
        return ok();
      });
      await entered.promise;
      if (retirement === 'close') await manager.clearSessionByPath(file);
      if (retirement === 'replace') await manager.createSession(await buildSyntheticDocx({ paragraphs: ['Replacement'] }), 'input.docx', file);
      if (retirement === 'expire') session.expiresAt = new Date(0);
      resume.release();
      expect(await pending).toMatchObject({ success: false, error: { code: 'SESSION_CLOSED' } });
      expect(session.doc.getParagraphTextById(ids[0]!)).toBe('First');
      expect(session.editCount).toBe(0);
      if (retirement === 'replace') expect((await manager.getSessionByFilePath(file))?.doc.buildDocumentView().nodes[0]?.text).toBe('Replacement');
    });
  }

  test('failed callbacks release the queue without publishing even uncounted direct edits', async () => {
    const { manager, session, ids } = await setup();
    await expect(manager.mutateSession(session, async candidate => {
      candidate.doc.replaceText({ targetParagraphId: ids[0]!, findText: 'First', replaceText: 'Lost' });
      throw new Error('injected');
    })).rejects.toThrow('injected');
    expect((await manager.mutateSession(session, async candidate => {
      expect(candidate.doc.getParagraphTextById(ids[0]!)).toBe('First');
      candidate.doc.replaceText({ targetParagraphId: ids[0]!, findText: 'First', replaceText: 'Kept' });
      return ok();
    })).success).toBe(true);
    expect(session.editRevision).toBe(1);
    expect(await manager.mutateSession(session, async candidate => {
      candidate.doc.replaceText({ targetParagraphId: ids[0]!, findText: 'Kept', replaceText: 'Lost' });
      return err('INJECTED', 'refusal after mutation');
    })).toMatchObject({ success: false });
    expect(session.doc.getParagraphTextById(ids[0]!)).toBe('Kept');
  });

  test('fork preserves the original minimal-reserialization baseline after normalization and edits', async () => {
    const buffer = await buildDocxFromBodyXml('<w:p><w:r><w:t>Unchanged</w:t></w:r><w:r><w:t> block</w:t></w:r></w:p><w:p><w:r><w:t>Edit</w:t></w:r></w:p>');
    const { session, ids } = await setup(buffer);
    session.doc.replaceText({ targetParagraphId: ids[1]!, findText: 'Edit', replaceText: 'Edited' });
    const options = { cleanBookmarks: true, minimalReserialization: true, fileDate: new Date('2006-01-01') };
    const expected = await session.doc.toBuffer(options);
    expect(expected.blocksRestored).toBeGreaterThan(0);
    const fork = session.doc.fork();
    const result = await fork.toBuffer(options);
    expect(result.blocksRestored).toBe(expected.blocksRestored);
    expect(result.buffer).toEqual(expected.buffer);
    fork.replaceText({ targetParagraphId: ids[1]!, findText: 'Edited', replaceText: 'Forked' });
    expect(session.doc.getParagraphTextById(ids[1]!)).toBe('Edited');
    const reopened = await DocxDocument.load((await fork.toBuffer(options)).buffer);
    reopened.insertParagraphBookmarks('reopened');
    expect(reopened.buildDocumentView().nodes.map(node => node.text)).toEqual(['Unchanged block', 'Forked']);
  });

  test.openspec('No-op preserves bookkeeping')('selected unresolved structural revisions do not count as edits', async () => {
    const buffer = await buildDocxFromBodyXml('<w:tbl><w:tr><w:tc><w:tcPr><w:cellMerge w:id="42" w:author="Synthetic"/></w:tcPr><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>');
    const { manager, session, file } = await setup(buffer);
    const metadata = seedMetadata(session);
    expect((await session.doc.fork().acceptAIEdits({ revisionIds: ['42'] })).selectedIds).toEqual(['42']);
    const response = await acceptAiEdits(manager, { file_path: file, revision_ids: ['42'] });
    expect(response).toMatchObject({ success: true, persistence_required: false, selected_revision_ids: [] });
    expect(session.doc).toBe(metadata.doc);
    expect(session.editCount).toBe(0);
    expect(session.extractionCache).toBe(metadata.extraction);
    expect(session.selectiveRevisionPolicy).toBe(metadata.policy);
  });
});

test.openspec('ODF identity across transaction forks')('ODF forks preserve stable session IDs and insertion response keys', async () => {
  const { manager, file } = await setup();
  const xml = '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>First</text:p><text:p>Second</text:p></office:text></office:body></office:document-content>';
  const archive = OdfArchive.create({ contentXml: xml });
  const session = await manager.createOdfSession(await archive.save(), 'input.odt', file + '.odt', archive, OdfDocument.fromContentXml(xml));
  expect(await odfInsertParagraph(manager, session, { positional_anchor_node_id: 'p0', new_string: 'Inserted', instruction: 'insert', position: 'BEFORE' }, {})).toMatchObject({ success: true, new_paragraph_id: 'p2', invalidates_paragraph_ids_after: null, requires_reread_before_next_edit: false });
  const inserted = session.doc.getParagraphs();
  expect(session.doc.fork().getParagraphs()).toEqual(inserted);
  expect((await odfReplaceText(manager, session, { target_paragraph_id: 'p1', old_string: 'Second', new_string: 'Changed', instruction: 'replace' }, {})).success).toBe(true);
  expect((await odfAddComment(manager, session, { target_paragraph_id: 'p0', author: 'Jane Doe', text: 'Original first' }, {})).success).toBe(true);
  expect(session.doc.getParagraphs()).toEqual([{ id: 'p2', text: 'Inserted' }, { id: 'p0', text: 'First' }, { id: 'p1', text: 'Changed' }]);
  expect(session.doc.getComments()[0].anchoredParagraphId).toBe('p0');
  expect(session.editRevision).toBe(3);
  const original = session.doc;
  expect((await odfReplaceText(manager, session, { target_paragraph_id: 'p1', old_string: 'Changed', new_string: 'Changed', instruction: 'no-op' }, {})).success).toBe(true);
  expect(session.doc).toBe(original);
  expect(session.editRevision).toBe(3);
  const before = session.doc.toXml();
  const originalArchive = session.archive;
  const replace = OdfDocument.prototype.replaceTextById;
  for (const code of ['ANCHOR_NOT_FOUND', 'TEXT_NOT_FOUND', 'MATCH_SPANS_MULTIPLE_NODES', 'INJECTED_FAILURE']) {
    const failure = vi.spyOn(OdfDocument.prototype, 'replaceTextById').mockImplementation(function (this: OdfDocument, ...args) {
      replace.apply(this, args);
      throw new Error(code);
    });
    expect(await odfReplaceText(manager, session, { target_paragraph_id: 'p1', old_string: 'Changed', new_string: 'Discarded', instruction: 'failure injection' }, {})).toMatchObject({ success: false, error: { code: code === 'INJECTED_FAILURE' ? 'EDIT_ERROR' : code } });
    expect(session.doc).toBe(original);
    expect(session.doc.toXml()).toBe(before);
    expect(session.archive).toBe(originalArchive);
    expect(session.editRevision).toBe(3);
    failure.mockRestore();
  }
});

test.openspec('Remote write succeeds and refresh fails')('confirmed Google success is counted after failed refresh without claiming rollback', async () => {
  const manager = new SessionManager();
  managers.push(manager);
  let version = 0;
  const doc = {
    getConfirmedWriteVersion: () => version,
    getParagraphTextById: () => 'First',
    ensureCurrentStructure: async () => undefined,
    replaceText: async () => { version++; throw new Error('refresh failed after confirmed remote edit'); },
  };
  const session = manager.createGDocsSession('synthetic', doc);
  const response = await gdocsReplaceText(manager, session, { target_paragraph_id: 'p0', old_string: 'First', new_string: 'Remote', instruction: 'replace' }, {});
  expect(response.success).toBe(false);
  expect(session.editCount).toBe(1);
  expect(version).toBe(1);
});

test('Google writes serialize; rejected writes do not count and retired writes cannot affect a replacement', async () => {
  const manager = new SessionManager();
  managers.push(manager);
  let version = 0;
  const session = manager.createGDocsSession('synthetic', { getConfirmedWriteVersion: () => version });
  const entered = barrier();
  const resume = barrier();
  const order: number[] = [];
  const first = manager.mutateRemoteSession(session, async () => {
    entered.release();
    await resume.promise;
    version++;
    order.push(1);
    return ok();
  });
  await entered.promise;
  const second = manager.mutateRemoteSession(session, async () => {
    expect(session.editCount).toBe(1);
    order.push(2);
    return err('REMOTE_REJECTED', 'no confirmed write');
  });
  expect(session.editCount).toBe(0);
  resume.release();
  await first;
  expect((await second).success).toBe(false);
  expect(order).toEqual([1, 2]);
  expect(session.editCount).toBe(1);

  const finalEntered = barrier();
  const finalResume = barrier();
  const retiredWrite = manager.mutateRemoteSession(session, async () => {
    finalEntered.release();
    await finalResume.promise;
    version++;
    return ok();
  });
  await finalEntered.promise;
  await manager.clearSessionByPath('gdocs:synthetic');
  const replacement = manager.createGDocsSession('synthetic', { getConfirmedWriteVersion: () => 0 });
  finalResume.release();
  await retiredWrite;
  expect(session.editCount).toBe(2);
  expect(replacement.editCount).toBe(0);
  expect(manager.getSessionByPath('gdocs:synthetic')).toBe(replacement);
});

test('Google layout validates all selectors before sending one acknowledged batch', async () => {
  const manager = new SessionManager();
  managers.push(manager);
  let version = 0;
  const execute = vi.fn(async (_requests: unknown[]) => { version++; });
  const session = manager.createGDocsSession('layout', {
    getConfirmedWriteVersion: () => version,
    getParagraphByAnchorId: (id: string) => id === 'missing' ? null : { startIndex: 1, endIndex: 6, ...(id === 'tabbed' ? { tabId: 'tab-1' } : {}) },
    executeBatchUpdate: execute,
    executePlannedBatchUpdate: async (plan: () => unknown[]) => {
      const requests = plan();
      if (requests.length > 0) await execute(requests);
    },
  });
  for (const params of [{}, { paragraph_spacing: {} }, { paragraph_spacing: { paragraph_ids: [] } }, { paragraph_spacing: { paragraph_ids: ['tabbed', 'missing'], before_twips: 120 } }]) {
    expect((await gdocsFormatLayout(manager, session, params, {})).success).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(session.editRevision).toBe(0);
  }
  // Assert only bookkeeping when no formatting fields request a remote write.
  await gdocsFormatLayout(manager, session, { paragraph_spacing: { paragraph_ids: ['tabbed'] } }, {});
  expect(execute).not.toHaveBeenCalled();
  expect(session.editCount).toBe(0);
  const params = { paragraph_spacing: { paragraph_ids: ['tabbed', 'plain'], before_twips: 120, after_twips: 240, line_twips: 480 } };
  expect(await gdocsFormatLayout(manager, session, params, {})).toMatchObject({ success: true, affected_paragraphs: 2, warnings: [] });
  expect(execute).toHaveBeenCalledWith([
    { updateParagraphStyle: { range: { startIndex: 1, endIndex: 6, tabId: 'tab-1' }, paragraphStyle: { spaceAbove: { magnitude: 6, unit: 'PT' }, spaceBelow: { magnitude: 12, unit: 'PT' }, lineSpacing: 200 }, fields: 'spaceAbove,spaceBelow,lineSpacing' } },
    { updateParagraphStyle: { range: { startIndex: 1, endIndex: 6 }, paragraphStyle: { spaceAbove: { magnitude: 6, unit: 'PT' }, spaceBelow: { magnitude: 12, unit: 'PT' }, lineSpacing: 200 }, fields: 'spaceAbove,spaceBelow,lineSpacing' } },
  ]);
  expect(session.editRevision).toBe(1);
  execute.mockImplementationOnce(async () => { throw new Error('remote refused'); });
  expect(await gdocsFormatLayout(manager, session, params, {})).toMatchObject({ success: false, error: { code: 'FORMAT_LAYOUT_ERROR' } });
  expect(session.editRevision).toBe(1);
  execute.mockImplementationOnce(async () => { version++; throw new Error('refresh failed after acknowledgement'); });
  expect((await gdocsFormatLayout(manager, session, params, {})).success).toBe(false);
  expect(session.editRevision).toBe(2);
});

test('Google insertion refusals and acknowledged failures preserve remote bookkeeping', async () => {
  const manager = new SessionManager();
  managers.push(manager);
  let version = 0;
  const insert = vi.fn(async () => { version++; throw new Error('refresh failed'); });
  const session = manager.createGDocsSession('insert', {
    getConfirmedWriteVersion: () => version,
    ensureCurrentStructure: async () => undefined,
    getParagraphTextById: (id: string) => id === 'missing' ? null : 'First',
    insertParagraph: insert,
  });
  const params = { positional_anchor_node_id: 'p0', new_string: 'Inserted', instruction: 'synthetic' };
  expect(await gdocsInsertParagraph(manager, session, { ...params, position: 'INVALID' }, {})).toMatchObject({ success: false, error: { code: 'INVALID_POSITION' } });
  expect(await gdocsInsertParagraph(manager, session, { ...params, positional_anchor_node_id: 'missing' }, {})).toMatchObject({ success: false, error: { code: 'ANCHOR_NOT_FOUND' } });
  expect(insert).not.toHaveBeenCalled();
  expect(session.editCount).toBe(0);
  expect(await gdocsInsertParagraph(manager, session, params, {})).toMatchObject({ success: false, error: { code: 'INSERT_ERROR' } });
  expect(session.editCount).toBe(1);
  insert.mockImplementationOnce(async () => { throw new Error('ANCHOR_NOT_FOUND after queued predecessor'); });
  expect(await gdocsInsertParagraph(manager, session, params, {})).toMatchObject({ success: false, error: { code: 'ANCHOR_NOT_FOUND' } });
  expect(session.editCount).toBe(1);
});
