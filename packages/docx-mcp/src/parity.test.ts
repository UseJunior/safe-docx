import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { testAllure } from './testing/allure-test.js';
import {
  assertSuccess,
  assertFailure,
  registerCleanup,
  createTrackedTempDir,
  createTestSessionManager,
  parseOutputXml,
} from './testing/session-test-utils.js';
import {
  makeMinimalDocx,
  makeDocxWithDocumentXml,
  readDocumentXmlFromPath,
} from './testing/docx_test_utils.js';

import { openDocument } from './tools/open_document.js';
import { readFile } from './tools/read_file.js';
import { grep } from './tools/grep.js';
import { replaceText } from './tools/replace_text.js';
import { insertParagraph } from './tools/insert_paragraph.js';
import { download } from './tools/download.js';
import { getSessionStatus } from './tools/get_session_status.js';

const SIMPLE_WORD_CHANGE_FIXTURE = fileURLToPath(
  new URL('../../docx-core/src/testing/fixtures/simple-word-change/original.docx', import.meta.url),
);

describe('Parity regression', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: 'Parity' });
  registerCleanup();

  test('tool parity: open -> read -> grep -> edit -> insert -> download -> status', async () => {
    const mgr = createTestSessionManager();

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'input.docx');
    const outPath = path.join(tmpDir, 'output.docx');

    await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Hello world'])));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    expect(opened.session_id).toMatch(/^ses_[A-Za-z0-9]{12}$/);

    const sessionId = opened.session_id as string;

    const status1 = await getSessionStatus(mgr, { session_id: sessionId });
    assertSuccess(status1, 'status');

    const read1 = await readFile(mgr, { session_id: sessionId });
    assertSuccess(read1, 'read');
    expect(String(read1.content)).toContain('#SCHEMA id | list_label | header | style | text');
    expect(String(read1.content)).toContain('Hello world');

    // Extract the paragraph id from the TOON output.
    const toonLines = String(read1.content).split('\n');
    const firstDataLine = toonLines.find((l) => l.startsWith('_bk_'));
    expect(firstDataLine).toBeTruthy();
    const paraId = firstDataLine!.split('|')[0].trim();
    expect(paraId).toMatch(/^_bk_[0-9a-f]{12}$/);

    const grepRes = await grep(mgr, { session_id: sessionId, patterns: ['Hello'] });
    assertSuccess(grepRes, 'grep');
    expect(grepRes.total_matches).toBe(1);
    expect(Array.isArray(grepRes.matches)).toBe(true);
    expect((grepRes.matches as Array<Record<string, unknown>>)[0].para_id).toBe(paraId);
    expect((grepRes.matches as Array<Record<string, unknown>>)[0].para_index_1based).toBe(1);
    expect((grepRes.matches as Array<Record<string, unknown>>)[0].match_count_in_paragraph).toBe(1);
    expect(typeof (grepRes.matches as Array<Record<string, unknown>>)[0].list_label).toBe('string');
    expect(typeof (grepRes.matches as Array<Record<string, unknown>>)[0].header).toBe('string');

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: 'Hello',
      new_string: 'Hi',
      instruction: 'test',
    });
    assertSuccess(edited, 'edit');

    const read2 = await readFile(mgr, { session_id: sessionId, node_ids: [paraId] });
    assertSuccess(read2, 'read2');
    expect(String(read2.content)).toContain('Hi world');

    const inserted = await insertParagraph(mgr, {
      session_id: sessionId,
      positional_anchor_node_id: paraId,
      new_string: 'Second paragraph',
      instruction: 'test insert',
      position: 'AFTER',
    });
    assertSuccess(inserted, 'insert');
    expect(String(inserted.new_paragraph_id)).toMatch(/^_bk_[0-9a-f]{12}$/);

    const read3 = await readFile(mgr, { session_id: sessionId });
    assertSuccess(read3, 'read3');
    expect(String(read3.content)).toContain('Second paragraph');

    const saved = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: outPath,
      clean_bookmarks: true,
      download_format: 'clean',
    });
    assertSuccess(saved, 'save');
    expect(String(saved.saved_to)).toBe(outPath);

    // Verify output document.xml has no _bk_* bookmarks (cleaned).
    const outXml = await readDocumentXmlFromPath(outPath);
    expect(outXml.includes('_bk_')).toBe(false);
    expect(outXml.includes('edit-')).toBe(false);

    // Download must not destroy the session's paragraph IDs (Python behavior).
    const readAfterDownload = await readFile(mgr, { session_id: sessionId });
    assertSuccess(readAfterDownload, 'readAfterDownload');
    expect(String(readAfterDownload.content)).toContain('Hi world');
  });

  test('grep reports para_index_1based for matches in later paragraphs', async () => {
    const mgr = createTestSessionManager();

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'input.docx');

    await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Alpha paragraph', 'Beta target paragraph'])));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const read = await readFile(mgr, { session_id: sessionId, format: 'simple' });
    assertSuccess(read, 'read');
    const ids = String(read.content)
      .split('\n')
      .filter((line) => line.startsWith('_bk_'))
      .map((line) => line.split('|')[0]!.trim());
    expect(ids.length).toBe(2);

    const grepRes = await grep(mgr, { session_id: sessionId, patterns: ['target'] });
    assertSuccess(grepRes, 'grep');
    expect(grepRes.total_matches).toBe(1);
    expect(Array.isArray(grepRes.matches)).toBe(true);
    expect((grepRes.matches as Array<Record<string, unknown>>)[0].para_id).toBe(ids[1]);
    expect((grepRes.matches as Array<Record<string, unknown>>)[0].para_index_1based).toBe(2);
    expect((grepRes.matches as Array<Record<string, unknown>>)[0].match_count_in_paragraph).toBe(1);
    expect(typeof (grepRes.matches as Array<Record<string, unknown>>)[0].list_label).toBe('string');
    expect(typeof (grepRes.matches as Array<Record<string, unknown>>)[0].header).toBe('string');
  });

  test('grep dedupes by paragraph by default and reports per-paragraph counts', async () => {
    const mgr = createTestSessionManager();

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'input.docx');

    await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Closing and closing in one paragraph', 'No match'])));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const grepRes = await grep(mgr, { session_id: sessionId, patterns: ['Closing', 'closing'] });
    assertSuccess(grepRes, 'grep');
    expect(grepRes.dedupe_by_paragraph).toBe(true);
    expect(grepRes.total_matches).toBe(2);
    expect(grepRes.paragraphs_with_matches).toBe(1);
    expect((grepRes.matches as Array<Record<string, unknown>>).length).toBe(1);
    expect((grepRes.matches as Array<Record<string, unknown>>)[0].match_count_in_paragraph).toBe(2);
    expect(grepRes.matches_truncated).toBe(false);
  });

  test('grep reports truncation metadata when max_results caps returned rows', async () => {
    const mgr = createTestSessionManager();

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'input.docx');

    await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Closing one', 'closing two', 'Closing three'])));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const grepRes = await grep(mgr, { session_id: sessionId, patterns: ['Closing', 'closing'], max_results: 2 });
    assertSuccess(grepRes, 'grep');
    expect(grepRes.total_matches).toBe(3);
    expect(grepRes.paragraphs_with_matches).toBe(3);
    expect((grepRes.matches as Array<Record<string, unknown>>).length).toBe(2);
    expect(grepRes.matches_truncated).toBe(true);
    expect(typeof grepRes.truncation_note).toBe('string');
  });

  test('grep can return full per-match rows when dedupe_by_paragraph is false', async () => {
    const mgr = createTestSessionManager();

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'input.docx');

    await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Closing then closing again'])));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const grepRes = await grep(mgr, {
      session_id: sessionId,
      patterns: ['Closing', 'closing'],
      dedupe_by_paragraph: false,
    });
    assertSuccess(grepRes, 'grep');
    expect(grepRes.dedupe_by_paragraph).toBe(false);
    expect(grepRes.total_matches).toBe(2);
    expect((grepRes.matches as Array<Record<string, unknown>>).length).toBe(2);
    expect((grepRes.matches as Array<Record<string, unknown>>)[0].match_count_in_paragraph).toBe(1);
  });

  test('open/read preserves existing _bk_* when stacked with edit-* bookmark on same paragraph', async () => {
    const mgr = createTestSessionManager();

    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p><w:r><w:t>Intro paragraph.</w:t></w:r></w:p>` +
      `<w:bookmarkStart w:id="41" w:name="_bk_keepme"/>` +
      `<w:p>` +
      `<w:bookmarkStart w:id="42" w:name="edit-abc123"/>` +
      `<w:r><w:t>Target paragraph text.</w:t></w:r>` +
      `<w:bookmarkEnd w:id="42"/>` +
      `</w:p>` +
      `<w:bookmarkEnd w:id="41"/>` +
      `</w:body></w:document>`;

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'input.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(xml)));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const read1 = await readFile(mgr, { session_id: sessionId, format: 'simple' });
    assertSuccess(read1, 'read');
    const out = String(read1.content);
    expect(out).toContain('_bk_keepme | Target paragraph text.');

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: '_bk_keepme',
      old_string: 'Target paragraph',
      new_string: 'Updated paragraph',
      instruction: 'test nested bookmark targeting',
    });
    assertSuccess(edited, 'edit');

    const read2 = await readFile(mgr, { session_id: sessionId, node_ids: ['_bk_keepme'], format: 'simple' });
    assertSuccess(read2, 'read2');
    expect(String(read2.content)).toContain('Updated paragraph text.');
  });

  test('download blocks overwrite of original by default', async () => {
    const mgr = createTestSessionManager();

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'input.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Hello world'])));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');

    const saved = await download(mgr, {
      session_id: opened.session_id as string,
      save_to_local_path: inputPath,
      download_format: 'clean',
    });
    assertFailure(saved, 'OVERWRITE_BLOCKED', 'overwrite block');
  });

  test('download supports tracked changes output', async () => {
    const mgr = createTestSessionManager();

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = SIMPLE_WORD_CHANGE_FIXTURE;
    const trackedPath = path.join(tmpDir, 'tracked.docx');

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const read1 = await readFile(mgr, { session_id: sessionId });
    assertSuccess(read1, 'read');
    const paraId = String(read1.content)
      .split('\n')
      .find((l) => l.startsWith('_bk_'))!
      .split('|')[0]!
      .trim();

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: 'The',
      new_string: 'TheX',
      instruction: 'test',
    });
    assertSuccess(edited, 'edit');

    const saved = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: trackedPath,
      track_changes: true,
      author: 'Safe-Docx Test',
      clean_bookmarks: true,
      tracked_changes_engine: 'atomizer',
    });
    assertSuccess(saved, 'tracked download');
    expect(String(saved.saved_to)).toBe(trackedPath);
    expect(saved.download_format).toBe('tracked');

    const outXml = await readDocumentXmlFromPath(trackedPath);

    expect(outXml.includes('_bk_')).toBe(false);
    expect(outXml.includes('<w:ins') || outXml.includes('<w:del')).toBe(true);
  });

  test('download defaults to both clean and tracked outputs with timestamped redline name', async () => {
    const mgr = createTestSessionManager();

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = SIMPLE_WORD_CHANGE_FIXTURE;
    const cleanPath = path.join(tmpDir, 'output.clean.docx');

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const read1 = await readFile(mgr, { session_id: sessionId });
    assertSuccess(read1, 'read');
    const paraId = String(read1.content)
      .split('\n')
      .find((l) => l.startsWith('_bk_'))!
      .split('|')[0]!
      .trim();

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: 'The',
      new_string: 'TheX',
      instruction: 'test',
    });
    assertSuccess(edited, 'edit');

    const saved = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: cleanPath,
      clean_bookmarks: true,
      tracked_changes_engine: 'atomizer',
    });
    assertSuccess(saved, 'download');
    expect(saved.download_format).toBe('both');
    expect(saved.cache_hit).toBe(false);
    expect(saved.returned_variants).toEqual(['clean', 'redline']);
    expect(String(saved.clean_saved_to)).toBe(cleanPath);
    expect(String(saved.tracked_saved_to)).toMatch(/\.redline\.\d{8}-\d{6}Z\.docx$/);

    await expect(fs.stat(cleanPath)).resolves.toBeTruthy();
    await expect(fs.stat(String(saved.tracked_saved_to))).resolves.toBeTruthy();
  });

  test('download infers both variants when tracked_save_to_local_path is provided', async () => {
    const mgr = createTestSessionManager();

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = SIMPLE_WORD_CHANGE_FIXTURE;
    const cleanPath = path.join(tmpDir, 'output.clean.docx');
    const trackedPath = path.join(tmpDir, 'output.redline.docx');

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const read1 = await readFile(mgr, { session_id: sessionId });
    assertSuccess(read1, 'read');
    const paraId = String(read1.content)
      .split('\n')
      .find((l) => l.startsWith('_bk_'))!
      .split('|')[0]!
      .trim();

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: 'The',
      new_string: 'TheX',
      instruction: 'test',
    });
    assertSuccess(edited, 'edit');

    const saved = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: cleanPath,
      tracked_save_to_local_path: trackedPath,
      // Legacy alias should not force clean-only when tracked path is requested.
      track_changes: false,
      clean_bookmarks: true,
      tracked_changes_engine: 'atomizer',
    });
    assertSuccess(saved, 'download');
    expect(saved.download_format).toBe('both');
    expect(saved.tracked_saved_to).toBe(trackedPath);
    expect(saved.format_source).toBe('tracked_save_to_local_path');
    expect(typeof saved.parameter_warning).toBe('string');

    const trackedXml = await readDocumentXmlFromPath(trackedPath);
    expect(trackedXml.includes('<w:ins') || trackedXml.includes('<w:del')).toBe(true);
  });

  test('open_document backfills deterministic jr_para ids so unchanged re-opens keep same ids', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'stable-ids.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Alpha', 'Beta', 'Gamma'])));

    const opened1 = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened1, 'open1');

    const opened2 = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened2, 'open2');

    const read1 = await readFile(mgr, { session_id: String(opened1.session_id), format: 'json' });
    assertSuccess(read1, 'read1');
    const nodes1 = JSON.parse(String(read1.content)) as Array<{ id: string; clean_text: string }>;

    const read2 = await readFile(mgr, { session_id: String(opened2.session_id), format: 'json' });
    assertSuccess(read2, 'read2');
    const nodes2 = JSON.parse(String(read2.content)) as Array<{ id: string; clean_text: string }>;

    const ids1 = nodes1.map((n) => n.id);
    const ids2 = nodes2.map((n) => n.id);
    expect(ids1).toEqual(ids2);
  });

  test('duplicate signature-block lines remain uniquely addressable with persisted jr_para ids', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'signature-block.docx');
    await fs.writeFile(
      inputPath,
      new Uint8Array(
        await makeMinimalDocx([
          'Supplier',
          'By:________',
          'Name:',
          'Title:',
          'Customer',
          'By:________',
          'Name:',
          'Title:',
        ]),
      ),
    );

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');

    const view = await readFile(mgr, { session_id: String(opened.session_id), format: 'json' });
    assertSuccess(view, 'read');
    const nodes = JSON.parse(String(view.content)) as Array<{ id: string; clean_text: string }>;

    const byLines = nodes.filter((n) => n.clean_text === 'By:________');
    expect(byLines.length).toBe(2);
    expect(byLines[0]!.id).toMatch(/^_bk_[0-9a-f]{12}$/);
    expect(byLines[1]!.id).toMatch(/^_bk_[0-9a-f]{12}$/);
    expect(byLines[0]!.id).not.toBe(byLines[1]!.id);
  });

  test('download reuses cached artifacts for same session revision and invalidates on edit', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = SIMPLE_WORD_CHANGE_FIXTURE;
    const cleanPath1 = path.join(tmpDir, 'rev0.clean.docx');
    const cleanPath2 = path.join(tmpDir, 'rev0.clean.second.docx');
    const cleanPath3 = path.join(tmpDir, 'rev1.clean.docx');

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = String(opened.session_id);

    const view = await readFile(mgr, { session_id: sessionId });
    assertSuccess(view, 'read');
    const paraId = String(view.content)
      .split('\n')
      .find((l) => l.startsWith('_bk_'))!
      .split('|')[0]!
      .trim();

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: 'The',
      new_string: 'TheX',
      instruction: 'edit for cache test',
    });
    assertSuccess(edited, 'edit');

    const dl1 = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: cleanPath1,
      tracked_changes_engine: 'atomizer',
    });
    assertSuccess(dl1, 'download1');
    expect(dl1.cache_hit).toBe(false);
    expect(dl1.edit_revision).toBe(1);

    const dl2 = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: cleanPath2,
      tracked_changes_engine: 'atomizer',
    });
    assertSuccess(dl2, 'download2');
    expect(dl2.cache_hit).toBe(true);
    expect(dl2.edit_revision).toBe(1);
    expect(dl2.exported_at_utc).toBe(dl1.exported_at_utc);

    const edited2 = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: 'TheX',
      new_string: 'TheY',
      instruction: 'second edit invalidates cache',
    });
    assertSuccess(edited2, 'edit2');

    const dl3 = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: cleanPath3,
      tracked_changes_engine: 'atomizer',
    });
    assertSuccess(dl3, 'download3');
    expect(dl3.cache_hit).toBe(false);
    expect(dl3.edit_revision).toBe(2);
  });

  test('read_file emits <definition> tags for explicit definitions (quotes absorbed)', async () => {
    const mgr = createTestSessionManager();

    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p><w:r><w:t>"Company" means ABC Corp.</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'input.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(xml)));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const read1 = await readFile(mgr, { session_id: sessionId });
    assertSuccess(read1, 'read');
    const out = String(read1.content);
    expect(out).toContain('<definition>Company</definition> means ABC Corp.');
    expect(out).not.toContain('"Company" means');
  });

  test('read_file emits <highlighting> tags for highlighted runs', async () => {
    const mgr = createTestSessionManager();

    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p>` +
      `<w:r><w:t xml:space="preserve">The value is </w:t></w:r>` +
      `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>[PLACEHOLDER]</w:t></w:r>` +
      `<w:r><w:t>.</w:t></w:r>` +
      `</w:p>` +
      `</w:body></w:document>`;

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'input.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(xml)));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const read1 = await readFile(mgr, { session_id: sessionId });
    assertSuccess(read1, 'read');
    const out = String(read1.content);
    expect(out).toContain('<highlighting>[PLACEHOLDER]</highlighting>');
  });

  test('replace_text clears placeholder highlight by default and treats <definition> as plain quoted text', async () => {
    const mgr = createTestSessionManager();

    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      // Role-model definition style: underline only on the term, quotes not underlined.
      `<w:p>` +
      `<w:r><w:t xml:space="preserve">Definition: </w:t></w:r>` +
      `<w:r><w:t>"</w:t></w:r>` +
      `<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Confidential Information</w:t></w:r>` +
      `<w:r><w:t>" shall mean X.</w:t></w:r>` +
      `</w:p>` +
      // Local context formatting: highlight placeholder.
      `<w:p>` +
      `<w:r><w:t xml:space="preserve">Purpose: </w:t></w:r>` +
      `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>[PLACEHOLDER]</w:t></w:r>` +
      `</w:p>` +
      `</w:body></w:document>`;

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'input.docx');
    const outPath = path.join(tmpDir, 'output.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(xml)));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const view = await readFile(mgr, { session_id: sessionId, format: 'json' });
    assertSuccess(view, 'read json');
    const nodes = JSON.parse(view.content as string) as Array<{ id: string; clean_text: string }>;
    const pid = nodes.find((n) => String(n.clean_text).includes('[PLACEHOLDER]'))?.id;
    expect(pid).toMatch(/^_bk_[0-9a-f]{12}$/);

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: pid!,
      old_string: '[PLACEHOLDER]',
      new_string: 'the <definition>R&D Business</definition>',
      instruction: 'test',
    });
    assertSuccess(edited, 'edit');

    const saved = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: outPath,
      clean_bookmarks: true,
      download_format: 'clean',
    });
    assertSuccess(saved, 'download');

    const { dom, runs, runText, hasUnderline, hasHighlight } = await parseOutputXml(outPath);
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    const termRun = runs.find((r) => runText(r).includes('R&D Business'));
    expect(termRun).toBeTruthy();
    expect(hasUnderline(termRun!)).toBe(false);
    expect(hasHighlight(termRun!)).toBe(false);

    const editedParaText = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'))
      .map((p) => Array.from((p as Element).getElementsByTagNameNS(W_NS, 't')).map((t) => t.textContent ?? '').join(''))
      .find((t) => t.includes('Purpose:'));
    expect(editedParaText).toContain('the "R&D Business"');
  });

  test('replace_text supports explicit <b>/<i>/<u> tags in new_string', async () => {
    const mgr = createTestSessionManager();

    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p><w:r><w:t>Value: [X]</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'input.docx');
    const outPath = path.join(tmpDir, 'output.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(xml)));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const view = await readFile(mgr, { session_id: sessionId, format: 'json' });
    assertSuccess(view, 'read json');
    const nodes = JSON.parse(view.content as string) as Array<{ id: string; clean_text: string }>;
    const pid = nodes.find((n) => String(n.clean_text).includes('[X]'))?.id;
    expect(pid).toMatch(/^_bk_[0-9a-f]{12}$/);

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: pid!,
      old_string: '[X]',
      new_string: '<b>bold</b> <i>ital</i> <u>under</u> plain',
      instruction: 'test',
    });
    assertSuccess(edited, 'edit');

    const saved = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: outPath,
      clean_bookmarks: true,
      download_format: 'clean',
    });
    assertSuccess(saved, 'download');

    const { runs, runText, hasBold, hasItalic, hasUnderline } = await parseOutputXml(outPath);

    const boldRun = runs.find((r) => runText(r).includes('bold'));
    const italicRun = runs.find((r) => runText(r).includes('ital'));
    const underlineRun = runs.find((r) => runText(r).includes('under'));
    const plainRun = runs.find((r) => runText(r).includes('plain'));

    expect(boldRun).toBeTruthy();
    expect(italicRun).toBeTruthy();
    expect(underlineRun).toBeTruthy();
    expect(plainRun).toBeTruthy();

    expect(hasBold(boldRun!)).toBe(true);
    expect(hasItalic(italicRun!)).toBe(true);
    expect(hasUnderline(underlineRun!)).toBe(true);
    expect(hasBold(plainRun!)).toBe(false);
    expect(hasItalic(plainRun!)).toBe(false);
    expect(hasUnderline(plainRun!)).toBe(false);
  });

  test('replace_text supports legacy definition role-model behavior behind env flag', async () => {
    const prevLegacy = process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS;
    process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS = '1';

    try {
      const mgr = createTestSessionManager();

      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>` +
        `<w:p>` +
        `<w:r><w:t xml:space="preserve">Definition: </w:t></w:r>` +
        `<w:r><w:t>"</w:t></w:r>` +
        `<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Confidential Information</w:t></w:r>` +
        `<w:r><w:t>" shall mean X.</w:t></w:r>` +
        `</w:p>` +
        `<w:p>` +
        `<w:r><w:t xml:space="preserve">Purpose: </w:t></w:r>` +
        `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>[PLACEHOLDER]</w:t></w:r>` +
        `</w:p>` +
        `</w:body></w:document>`;

      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      const inputPath = path.join(tmpDir, 'input.docx');
      const outPath = path.join(tmpDir, 'output.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(xml)));

      const opened = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(opened, 'open');
      const sessionId = opened.session_id as string;

      const view = await readFile(mgr, { session_id: sessionId, format: 'json' });
      assertSuccess(view, 'read json');
      const nodes = JSON.parse(view.content as string) as Array<{ id: string; clean_text: string }>;
      const pid = nodes.find((n) => String(n.clean_text).includes('[PLACEHOLDER]'))?.id;
      expect(pid).toMatch(/^_bk_[0-9a-f]{12}$/);

      const edited = await replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: pid!,
        old_string: '[PLACEHOLDER]',
        new_string: 'the <definition>R&D Business</definition>',
        instruction: 'test',
      });
      assertSuccess(edited, 'edit');

      const saved = await download(mgr, {
        session_id: sessionId,
        save_to_local_path: outPath,
        clean_bookmarks: true,
        download_format: 'clean',
      });
      assertSuccess(saved, 'download');

      const { runs, runText, hasUnderline, hasHighlight } = await parseOutputXml(outPath);

      const termIdx = runs.findIndex((r) => runText(r) === 'R&D Business');
      expect(termIdx).toBeGreaterThan(0);
      expect(termIdx).toBeLessThan(runs.length - 1);

      const before = runs[termIdx - 1]!;
      const termRun = runs[termIdx]!;
      const after = runs[termIdx + 1]!;

      expect(runText(before)).toBe('"');
      expect(runText(after)).toBe('"');
      expect(hasUnderline(termRun)).toBe(true);
      expect(hasHighlight(termRun)).toBe(false);
      expect(hasUnderline(before)).toBe(false);
      expect(hasUnderline(after)).toBe(false);
      expect(hasHighlight(before)).toBe(false);
      expect(hasHighlight(after)).toBe(false);
    } finally {
      if (prevLegacy === undefined) delete process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS;
      else process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS = prevLegacy;
    }
  });

  test('replace_text supports explicit <highlighting> tags in new_string', async () => {
    const mgr = createTestSessionManager();

    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p>` +
      `<w:r><w:t xml:space="preserve">Data: </w:t></w:r>` +
      `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>[VALUE]</w:t></w:r>` +
      `</w:p>` +
      `</w:body></w:document>`;

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'input.docx');
    const outPath = path.join(tmpDir, 'output.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(xml)));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const view = await readFile(mgr, { session_id: sessionId, format: 'json' });
    assertSuccess(view, 'read json');
    const nodes = JSON.parse(view.content as string) as Array<{ id: string; clean_text: string }>;
    const pid = nodes.find((n) => String(n.clean_text).includes('[VALUE]'))?.id;
    expect(pid).toMatch(/^_bk_[0-9a-f]{12}$/);

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: pid!,
      old_string: '[VALUE]',
      new_string: '<highlighting>Final Number</highlighting>',
      instruction: 'test',
    });
    assertSuccess(edited, 'edit');

    const saved = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: outPath,
      clean_bookmarks: true,
      download_format: 'clean',
    });
    assertSuccess(saved, 'download');

    const { runs, runText, hasHighlight } = await parseOutputXml(outPath);

    const idx = runs.findIndex((r) => runText(r) === 'Final Number');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(hasHighlight(runs[idx]!)).toBe(true);
  });

  test('replace_text falls back to quote-normalized matching', async () => {
    const mgr = createTestSessionManager();

    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p><w:r><w:t>\u201CCompany\u201D means ABC Corp.</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'input.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(xml)));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const read1 = await readFile(mgr, { session_id: sessionId });
    assertSuccess(read1, 'read');
    const paraId = String(read1.content)
      .split('\n')
      .find((l) => l.startsWith('_bk_'))!
      .split('|')[0]!
      .trim();

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: '"Company" means ABC Corp.',
      new_string: '"Company" means XYZ Corp.',
      instruction: 'test quote normalization fallback',
    });
    assertSuccess(edited, 'edit');

    const read2 = await readFile(mgr, { session_id: sessionId, node_ids: [paraId] });
    assertSuccess(read2, 'read2');
    expect(String(read2.content)).toContain('XYZ Corp.');
  });

  test('replace_text falls back to flexible whitespace matching', async () => {
    const mgr = createTestSessionManager();

    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p><w:r><w:t xml:space="preserve">The   Purchase   Price</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'input.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(xml)));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const read1 = await readFile(mgr, { session_id: sessionId });
    assertSuccess(read1, 'read');
    const paraId = String(read1.content)
      .split('\n')
      .find((l) => l.startsWith('_bk_'))!
      .split('|')[0]!
      .trim();

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: 'The Purchase Price',
      new_string: 'The Final Price',
      instruction: 'test flexible whitespace fallback',
    });
    assertSuccess(edited, 'edit');

    const read2 = await readFile(mgr, { session_id: sessionId, node_ids: [paraId] });
    assertSuccess(read2, 'read2');
    expect(String(read2.content)).toContain('The Final Price');
  });

  test('replace_text falls back to quote-optional matching', async () => {
    const mgr = createTestSessionManager();

    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p><w:r><w:t>The defined term is \u201CCompany\u201D.</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
    const inputPath = path.join(tmpDir, 'input.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(xml)));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const read1 = await readFile(mgr, { session_id: sessionId });
    assertSuccess(read1, 'read');
    const paraId = String(read1.content)
      .split('\n')
      .find((l) => l.startsWith('_bk_'))!
      .split('|')[0]!
      .trim();

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: 'Company',
      new_string: 'Buyer',
      instruction: 'test quote optional fallback',
    });
    assertSuccess(edited, 'edit');

    const read2 = await readFile(mgr, { session_id: sessionId, node_ids: [paraId] });
    assertSuccess(read2, 'read2');
    expect(String(read2.content)).toContain('\u201CBuyer\u201D');
  });

  describe('read_file pagination edge cases', () => {
    test('offset/limit normalization and node_ids override', async () => {
      const mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      const inputPath = path.join(tmpDir, 'input.docx');

      await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['A', 'B', 'C'])));

      const opened = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(opened, 'open');
      const sessionId = opened.session_id as string;

      const readAll = await readFile(mgr, { session_id: sessionId, format: 'simple' });
      assertSuccess(readAll, 'readAll');

      const ids = String(readAll.content)
        .split('\n')
        .filter((l) => l.startsWith('_bk_'))
        .map((l) => l.split('|')[0].trim());
      expect(ids.length).toBe(3);

      const readLast = await readFile(mgr, { session_id: sessionId, offset: -1, limit: 1, format: 'simple' });
      assertSuccess(readLast, 'readLast');
      expect(String(readLast.content)).toContain(`${ids[2]} | C`);

      const readSecond = await readFile(mgr, { session_id: sessionId, offset: 2, limit: 1, format: 'simple' });
      assertSuccess(readSecond, 'readSecond');
      expect(String(readSecond.content)).toContain(`${ids[1]} | B`);

      // node_ids should override offset/limit.
      const readOverride = await readFile(mgr, { session_id: sessionId, node_ids: [ids[0]], offset: -1, limit: 1, format: 'simple' });
      assertSuccess(readOverride, 'readOverride');
      expect(String(readOverride.content)).toContain(`${ids[0]} | A`);
    });

    test('offset=0 starts from the first paragraph', async () => {
      const mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      const inputPath = path.join(tmpDir, 'input.docx');

      await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['A', 'B'])));

      const opened = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(opened, 'open');
      const sessionId = opened.session_id as string;

      const res = await readFile(mgr, { session_id: sessionId, offset: 0, limit: 1, format: 'simple' });
      assertSuccess(res, 'offset=0');
      expect(String(res.content)).toContain(' | A');
    });

    test('invalid session id format returns INVALID_SESSION_ID', async () => {
      const mgr = createTestSessionManager();
      const res = await readFile(mgr, { session_id: 'ses_bad' });
      assertFailure(res, 'INVALID_SESSION_ID', 'invalid session id');
    });
  });
});
