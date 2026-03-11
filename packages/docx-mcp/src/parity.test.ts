import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { testAllure, type AllureBddContext } from './testing/allure-test.js';
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
import { save } from './tools/save.js';
import { getSessionStatus } from './tools/get_session_status.js';

const SIMPLE_WORD_CHANGE_FIXTURE = fileURLToPath(
  new URL('../../docx-core/src/testing/fixtures/simple-word-change/original.docx', import.meta.url),
);

describe('Parity regression', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: 'Parity' });
  registerCleanup();

  test('tool parity: open -> read -> grep -> edit -> insert -> save -> status', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let paraId: string;
    let outPath: string;

    await given('a minimal document with "Hello world" opened in a fresh session', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      const inputPath = path.join(tmpDir, 'input.docx');
      outPath = path.join(tmpDir, 'output.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Hello world'])));

      const opened = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(opened, 'open');
      expect(opened.session_id).toMatch(/^ses_[A-Za-z0-9]{12}$/);
      sessionId = opened.session_id as string;

      const status1 = await getSessionStatus(mgr, { session_id: sessionId });
      assertSuccess(status1, 'status');

      const read1 = await readFile(mgr, { session_id: sessionId });
      assertSuccess(read1, 'read');
      expect(String(read1.content)).toContain('#SCHEMA id | list_label | header | style | text');
      expect(String(read1.content)).toContain('Hello world');

      const toonLines = String(read1.content).split('\n');
      const firstDataLine = toonLines.find((l) => l.startsWith('_bk_'));
      expect(firstDataLine).toBeTruthy();
      paraId = firstDataLine!.split('|')[0].trim();
      expect(paraId).toMatch(/^_bk_[0-9a-f]{12}$/);
    });

    await when('grep, replaceText, and insertParagraph are applied sequentially', async () => {
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
    });

    await then('save produces a clean file with bookmarks removed', async () => {
      const saved = await save(mgr, {
        session_id: sessionId,
        save_to_local_path: outPath,
        clean_bookmarks: true,
        save_format: 'clean',
      });
      assertSuccess(saved, 'save');
      expect(String(saved.saved_to)).toBe(outPath);

      const outXml = await readDocumentXmlFromPath(outPath);
      expect(outXml.includes('_bk_')).toBe(false);
      expect(outXml.includes('edit-')).toBe(false);
    });
    await and('the session still reflects the edit after save', async () => {
      const readAfterSave = await readFile(mgr, { session_id: sessionId });
      assertSuccess(readAfterSave, 'readAfterSave');
      expect(String(readAfterSave.content)).toContain('Hi world');
    });
  });

  test('grep reports para_index_1based for matches in later paragraphs', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let ids: string[];
    let grepRes: Awaited<ReturnType<typeof grep>>;

    await given('a document with "Alpha paragraph" and "Beta target paragraph" open', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      const inputPath = path.join(tmpDir, 'input.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Alpha paragraph', 'Beta target paragraph'])));
      const opened = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(opened, 'open');
      sessionId = opened.session_id as string;
      const read = await readFile(mgr, { session_id: sessionId, format: 'simple' });
      assertSuccess(read, 'read');
      ids = String(read.content)
        .split('\n')
        .filter((line) => line.startsWith('_bk_'))
        .map((line) => line.split('|')[0]!.trim());
      expect(ids.length).toBe(2);
    });

    await when('grep is called for "target"', async () => {
      grepRes = await grep(mgr, { session_id: sessionId, patterns: ['target'] });
    });

    await then('the match is in the second paragraph with para_index_1based=2', () => {
      assertSuccess(grepRes, 'grep');
      expect(grepRes.total_matches).toBe(1);
      expect(Array.isArray(grepRes.matches)).toBe(true);
      expect((grepRes.matches as Array<Record<string, unknown>>)[0].para_id).toBe(ids[1]);
      expect((grepRes.matches as Array<Record<string, unknown>>)[0].para_index_1based).toBe(2);
      expect((grepRes.matches as Array<Record<string, unknown>>)[0].match_count_in_paragraph).toBe(1);
      expect(typeof (grepRes.matches as Array<Record<string, unknown>>)[0].list_label).toBe('string');
      expect(typeof (grepRes.matches as Array<Record<string, unknown>>)[0].header).toBe('string');
    });
  });

  test('grep dedupes by paragraph by default and reports per-paragraph counts', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let grepRes: Awaited<ReturnType<typeof grep>>;

    await given('a document with two paragraphs where the first contains two occurrences of "closing"', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      const inputPath = path.join(tmpDir, 'input.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Closing and closing in one paragraph', 'No match'])));
      const opened = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(opened, 'open');
      sessionId = opened.session_id as string;
    });

    await when('grep is called with patterns ["Closing", "closing"]', async () => {
      grepRes = await grep(mgr, { session_id: sessionId, patterns: ['Closing', 'closing'] });
    });

    await then('dedupe_by_paragraph is true and the one paragraph returns a count of 2', () => {
      assertSuccess(grepRes, 'grep');
      expect(grepRes.dedupe_by_paragraph).toBe(true);
      expect(grepRes.total_matches).toBe(2);
      expect(grepRes.paragraphs_with_matches).toBe(1);
      expect((grepRes.matches as Array<Record<string, unknown>>).length).toBe(1);
      expect((grepRes.matches as Array<Record<string, unknown>>)[0].match_count_in_paragraph).toBe(2);
      expect(grepRes.matches_truncated).toBe(false);
    });
  });

  test('grep reports truncation metadata when max_results caps returned rows', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let grepRes: Awaited<ReturnType<typeof grep>>;

    await given('a document with three paragraphs each containing "closing"', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      const inputPath = path.join(tmpDir, 'input.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Closing one', 'closing two', 'Closing three'])));
      const opened = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(opened, 'open');
      sessionId = opened.session_id as string;
    });

    await when('grep is called with max_results=2', async () => {
      grepRes = await grep(mgr, { session_id: sessionId, patterns: ['Closing', 'closing'], max_results: 2 });
    });

    await then('total_matches is 3, only 2 rows are returned, and matches_truncated is true', () => {
      assertSuccess(grepRes, 'grep');
      expect(grepRes.total_matches).toBe(3);
      expect(grepRes.paragraphs_with_matches).toBe(3);
      expect((grepRes.matches as Array<Record<string, unknown>>).length).toBe(2);
      expect(grepRes.matches_truncated).toBe(true);
      expect(typeof grepRes.truncation_note).toBe('string');
    });
  });

  test('grep can return full per-match rows when dedupe_by_paragraph is false', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let grepRes: Awaited<ReturnType<typeof grep>>;

    await given('a document with "Closing then closing again" in one paragraph', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      const inputPath = path.join(tmpDir, 'input.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Closing then closing again'])));
      const opened = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(opened, 'open');
      sessionId = opened.session_id as string;
    });

    await when('grep is called with dedupe_by_paragraph=false', async () => {
      grepRes = await grep(mgr, {
        session_id: sessionId,
        patterns: ['Closing', 'closing'],
        dedupe_by_paragraph: false,
      });
    });

    await then('two separate match rows are returned with match_count_in_paragraph=1 each', () => {
      assertSuccess(grepRes, 'grep');
      expect(grepRes.dedupe_by_paragraph).toBe(false);
      expect(grepRes.total_matches).toBe(2);
      expect((grepRes.matches as Array<Record<string, unknown>>).length).toBe(2);
      expect((grepRes.matches as Array<Record<string, unknown>>)[0].match_count_in_paragraph).toBe(1);
    });
  });

  test('open/read preserves existing _bk_* when stacked with edit-* bookmark on same paragraph', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;

    await given('a document with a _bk_keepme bookmark stacked with an edit-* bookmark on the same paragraph', async () => {
      mgr = createTestSessionManager();
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
      sessionId = opened.session_id as string;
      const read1 = await readFile(mgr, { session_id: sessionId, format: 'simple' });
      assertSuccess(read1, 'read');
      expect(String(read1.content)).toContain('_bk_keepme | Target paragraph text.');
    });

    await when('"Target paragraph" is replaced with "Updated paragraph" using _bk_keepme', async () => {
      const edited = await replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: '_bk_keepme',
        old_string: 'Target paragraph',
        new_string: 'Updated paragraph',
        instruction: 'test nested bookmark targeting',
      });
      assertSuccess(edited, 'edit');
    });

    await then('the updated text is visible when reading by the _bk_keepme node ID', async () => {
      const read2 = await readFile(mgr, { session_id: sessionId, node_ids: ['_bk_keepme'], format: 'simple' });
      assertSuccess(read2, 'read2');
      expect(String(read2.content)).toContain('Updated paragraph text.');
    });
  });

  test('save blocks overwrite of original by default', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let inputPath: string;
    let opened: Awaited<ReturnType<typeof openDocument>>;
    let saved: Awaited<ReturnType<typeof save>>;

    await given('a document opened from a specific file path', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      inputPath = path.join(tmpDir, 'input.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Hello world'])));
      opened = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(opened, 'open');
    });

    await when('save is called targeting the original input path', async () => {
      saved = await save(mgr, {
        session_id: opened.session_id as string,
        save_to_local_path: inputPath,
        save_format: 'clean',
      });
    });

    await then('the save is rejected with OVERWRITE_BLOCKED', () => {
      assertFailure(saved, 'OVERWRITE_BLOCKED', 'overwrite block');
    });
  });

  test('save supports tracked changes output', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let trackedPath: string;
    let saved: Awaited<ReturnType<typeof save>>;

    await given('the simple-word-change fixture is open with "The" replaced by "TheX"', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      trackedPath = path.join(tmpDir, 'tracked.docx');
      const opened = await openDocument(mgr, { file_path: SIMPLE_WORD_CHANGE_FIXTURE });
      assertSuccess(opened, 'open');
      sessionId = opened.session_id as string;
      const read1 = await readFile(mgr, { session_id: sessionId });
      assertSuccess(read1, 'read');
      const paraId = String(read1.content).split('\n').find((l) => l.startsWith('_bk_'))!.split('|')[0]!.trim();
      const edited = await replaceText(mgr, { session_id: sessionId, target_paragraph_id: paraId, old_string: 'The', new_string: 'TheX', instruction: 'test' });
      assertSuccess(edited, 'edit');
    });

    await when('save is called with track_changes=true using the atomizer engine', async () => {
      saved = await save(mgr, {
        session_id: sessionId,
        save_to_local_path: trackedPath,
        track_changes: true,
        author: 'Safe-Docx Test',
        clean_bookmarks: true,
        tracked_changes_engine: 'atomizer',
      });
    });

    await then('the tracked docx is saved with w:ins/w:del markup and no _bk_ bookmarks', async () => {
      assertSuccess(saved, 'tracked save');
      expect(String(saved.saved_to)).toBe(trackedPath);
      expect(saved.save_format).toBe('tracked');
      const outXml = await readDocumentXmlFromPath(trackedPath);
      expect(outXml.includes('_bk_')).toBe(false);
      expect(outXml.includes('<w:ins') || outXml.includes('<w:del')).toBe(true);
    });
  });

  test('save defaults to both clean and tracked outputs with timestamped redline name', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let cleanPath: string;
    let saved: Awaited<ReturnType<typeof save>>;

    await given('the simple-word-change fixture is open with "The" replaced by "TheX"', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      cleanPath = path.join(tmpDir, 'output.clean.docx');
      const opened = await openDocument(mgr, { file_path: SIMPLE_WORD_CHANGE_FIXTURE });
      assertSuccess(opened, 'open');
      sessionId = opened.session_id as string;
      const read1 = await readFile(mgr, { session_id: sessionId });
      assertSuccess(read1, 'read');
      const paraId = String(read1.content).split('\n').find((l) => l.startsWith('_bk_'))!.split('|')[0]!.trim();
      const edited = await replaceText(mgr, { session_id: sessionId, target_paragraph_id: paraId, old_string: 'The', new_string: 'TheX', instruction: 'test' });
      assertSuccess(edited, 'edit');
    });

    await when('save is called with only save_to_local_path (no explicit save_format)', async () => {
      saved = await save(mgr, {
        session_id: sessionId,
        save_to_local_path: cleanPath,
        clean_bookmarks: true,
        tracked_changes_engine: 'atomizer',
      });
    });

    await then('save_format is "both" and a timestamped redline file is created alongside the clean file', async () => {
      assertSuccess(saved, 'save');
      expect(saved.save_format).toBe('both');
      expect(saved.cache_hit).toBe(false);
      expect(saved.returned_variants).toEqual(['clean', 'redline']);
      expect(String(saved.clean_saved_to)).toBe(cleanPath);
      expect(String(saved.tracked_saved_to)).toMatch(/\.redline\.\d{8}-\d{6}Z\.docx$/);
      await expect(fs.stat(cleanPath)).resolves.toBeTruthy();
      await expect(fs.stat(String(saved.tracked_saved_to))).resolves.toBeTruthy();
    });
  });

  test('save infers both variants when tracked_save_to_local_path is provided', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let cleanPath: string;
    let trackedPath: string;
    let saved: Awaited<ReturnType<typeof save>>;

    await given('the simple-word-change fixture is open with "The" replaced by "TheX"', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      cleanPath = path.join(tmpDir, 'output.clean.docx');
      trackedPath = path.join(tmpDir, 'output.redline.docx');
      const opened = await openDocument(mgr, { file_path: SIMPLE_WORD_CHANGE_FIXTURE });
      assertSuccess(opened, 'open');
      sessionId = opened.session_id as string;
      const read1 = await readFile(mgr, { session_id: sessionId });
      assertSuccess(read1, 'read');
      const paraId = String(read1.content).split('\n').find((l) => l.startsWith('_bk_'))!.split('|')[0]!.trim();
      const edited = await replaceText(mgr, { session_id: sessionId, target_paragraph_id: paraId, old_string: 'The', new_string: 'TheX', instruction: 'test' });
      assertSuccess(edited, 'edit');
    });

    await when('save is called with tracked_save_to_local_path and track_changes=false (legacy conflict)', async () => {
      saved = await save(mgr, {
        session_id: sessionId,
        save_to_local_path: cleanPath,
        tracked_save_to_local_path: trackedPath,
        track_changes: false,
        clean_bookmarks: true,
        tracked_changes_engine: 'atomizer',
      });
    });

    await then('save_format is "both" with a parameter_warning and the tracked file contains w:ins/w:del', async () => {
      assertSuccess(saved, 'save');
      expect(saved.save_format).toBe('both');
      expect(saved.tracked_saved_to).toBe(trackedPath);
      expect(saved.format_source).toBe('tracked_save_to_local_path');
      expect(typeof saved.parameter_warning).toBe('string');
      const trackedXml = await readDocumentXmlFromPath(trackedPath);
      expect(trackedXml.includes('<w:ins') || trackedXml.includes('<w:del')).toBe(true);
    });
  });

  test('open_document backfills deterministic jr_para ids so unchanged re-opens keep same ids', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let inputPath: string;
    let ids1: string[];
    let ids2: string[];

    await given('a minimal three-paragraph document on disk', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      inputPath = path.join(tmpDir, 'stable-ids.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Alpha', 'Beta', 'Gamma'])));
    });

    await when('the same file is opened twice and paragraph IDs are read from both sessions', async () => {
      const opened1 = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(opened1, 'open1');
      const opened2 = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(opened2, 'open2');
      const read1 = await readFile(mgr, { session_id: String(opened1.session_id), format: 'json' });
      assertSuccess(read1, 'read1');
      ids1 = (JSON.parse(String(read1.content)) as Array<{ id: string }>).map((n) => n.id);
      const read2 = await readFile(mgr, { session_id: String(opened2.session_id), format: 'json' });
      assertSuccess(read2, 'read2');
      ids2 = (JSON.parse(String(read2.content)) as Array<{ id: string }>).map((n) => n.id);
    });

    await then('both sessions yield identical paragraph ID lists', () => {
      expect(ids1).toEqual(ids2);
    });
  });

  test('duplicate signature-block lines remain uniquely addressable with persisted jr_para ids', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let nodes: Array<{ id: string; clean_text: string }>;

    await given('a signature-block document with two identical "By:________" lines open', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      const inputPath = path.join(tmpDir, 'signature-block.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Supplier', 'By:________', 'Name:', 'Title:', 'Customer', 'By:________', 'Name:', 'Title:'])));
      const opened = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(opened, 'open');
      const view = await readFile(mgr, { session_id: String(opened.session_id), format: 'json' });
      assertSuccess(view, 'read');
      nodes = JSON.parse(String(view.content)) as Array<{ id: string; clean_text: string }>;
    });

    await when('the paragraph nodes are filtered to find "By:________" lines', () => {
      // filtering is done in then
    });

    await then('two distinct _bk_ IDs are assigned to the two identical "By:________" lines', () => {
      const byLines = nodes.filter((n) => n.clean_text === 'By:________');
      expect(byLines.length).toBe(2);
      expect(byLines[0]!.id).toMatch(/^_bk_[0-9a-f]{12}$/);
      expect(byLines[1]!.id).toMatch(/^_bk_[0-9a-f]{12}$/);
      expect(byLines[0]!.id).not.toBe(byLines[1]!.id);
    });
  });

  test('save reuses cached artifacts for same session revision and invalidates on edit', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let paraId: string;
    let dl1: Awaited<ReturnType<typeof save>>;
    let dl2: Awaited<ReturnType<typeof save>>;
    let dl3: Awaited<ReturnType<typeof save>>;

    await given('the simple-word-change fixture is open with "The" replaced by "TheX" (revision 1)', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      const opened = await openDocument(mgr, { file_path: SIMPLE_WORD_CHANGE_FIXTURE });
      assertSuccess(opened, 'open');
      sessionId = String(opened.session_id);
      const view = await readFile(mgr, { session_id: sessionId });
      assertSuccess(view, 'read');
      paraId = String(view.content).split('\n').find((l) => l.startsWith('_bk_'))!.split('|')[0]!.trim();
      const edited = await replaceText(mgr, { session_id: sessionId, target_paragraph_id: paraId, old_string: 'The', new_string: 'TheX', instruction: 'edit for cache test' });
      assertSuccess(edited, 'edit');

      // Save once to populate cache
      dl1 = await save(mgr, { session_id: sessionId, save_to_local_path: path.join(tmpDir, 'rev0.clean.docx'), tracked_changes_engine: 'atomizer' });
      assertSuccess(dl1, 'save1');
      expect(dl1.cache_hit).toBe(false);
      expect(dl1.edit_revision).toBe(1);
    });

    await when('a second save at the same revision is requested, then a new edit is applied, then a third save is requested', async () => {
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-cache-');
      dl2 = await save(mgr, { session_id: sessionId, save_to_local_path: path.join(tmpDir, 'rev0.clean.second.docx'), tracked_changes_engine: 'atomizer' });
      assertSuccess(dl2, 'save2');

      const edited2 = await replaceText(mgr, { session_id: sessionId, target_paragraph_id: paraId, old_string: 'TheX', new_string: 'TheY', instruction: 'second edit invalidates cache' });
      assertSuccess(edited2, 'edit2');

      dl3 = await save(mgr, { session_id: sessionId, save_to_local_path: path.join(tmpDir, 'rev1.clean.docx'), tracked_changes_engine: 'atomizer' });
      assertSuccess(dl3, 'save3');
    });

    await then('the second save is a cache hit at revision 1', () => {
      expect(dl2.cache_hit).toBe(true);
      expect(dl2.edit_revision).toBe(1);
      expect(dl2.exported_at_utc).toBe(dl1.exported_at_utc);
    });
    await and('the third save after the new edit is a cache miss at revision 2', () => {
      expect(dl3.cache_hit).toBe(false);
      expect(dl3.edit_revision).toBe(2);
    });
  });

  test('read_file emits <highlight> tags for highlighted runs', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let out: string;

    await given('a document with a yellow-highlighted [PLACEHOLDER] run open', async () => {
      mgr = createTestSessionManager();
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
      sessionId = opened.session_id as string;
    });

    await when('read_file is called', async () => {
      const read1 = await readFile(mgr, { session_id: sessionId });
      assertSuccess(read1, 'read');
      out = String(read1.content);
    });

    await then('the output contains <highlight>[PLACEHOLDER]</highlight>', () => {
      expect(out).toContain('<highlight>[PLACEHOLDER]</highlight>');
    });
  });

  test('replace_text clears placeholder highlight by default', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let outPath: string;

    await given('a document with a yellow-highlighted [PLACEHOLDER] open', async () => {
      mgr = createTestSessionManager();
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>` +
        `<w:p>` +
        `<w:r><w:t xml:space="preserve">Purpose: </w:t></w:r>` +
        `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>[PLACEHOLDER]</w:t></w:r>` +
        `</w:p>` +
        `</w:body></w:document>`;
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      const inputPath = path.join(tmpDir, 'input.docx');
      outPath = path.join(tmpDir, 'output.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(xml)));
      const opened = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(opened, 'open');
      sessionId = opened.session_id as string;
    });

    await when('[PLACEHOLDER] is replaced with "the R&D Business" and the file is saved clean', async () => {
      const view = await readFile(mgr, { session_id: sessionId, format: 'json' });
      assertSuccess(view, 'read json');
      const nodes = JSON.parse(view.content as string) as Array<{ id: string; clean_text: string }>;
      const pid = nodes.find((n) => String(n.clean_text).includes('[PLACEHOLDER]'))?.id;
      expect(pid).toMatch(/^_bk_[0-9a-f]{12}$/);
      const edited = await replaceText(mgr, { session_id: sessionId, target_paragraph_id: pid!, old_string: '[PLACEHOLDER]', new_string: 'the R&D Business', instruction: 'test' });
      assertSuccess(edited, 'edit');
      const saved = await save(mgr, { session_id: sessionId, save_to_local_path: outPath, clean_bookmarks: true, save_format: 'clean' });
      assertSuccess(saved, 'save');
    });

    await then('the replacement run has no highlight', async () => {
      const { runs, runText, hasHighlight } = await parseOutputXml(outPath);
      const termRun = runs.find((r) => runText(r).includes('R&D Business'));
      expect(termRun).toBeTruthy();
      expect(hasHighlight(termRun!)).toBe(false);
    });
  });

  test('replace_text supports explicit <b>/<i>/<u> tags in new_string', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let outPath: string;

    await given('a document with "Value: [X]" open', async () => {
      mgr = createTestSessionManager();
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>` +
        `<w:p><w:r><w:t>Value: [X]</w:t></w:r></w:p>` +
        `</w:body></w:document>`;
      const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
      const inputPath = path.join(tmpDir, 'input.docx');
      outPath = path.join(tmpDir, 'output.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(xml)));
      const opened = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(opened, 'open');
      sessionId = opened.session_id as string;
    });

    await when('[X] is replaced with a new_string containing <b>, <i>, <u> tags and saved', async () => {
      const view = await readFile(mgr, { session_id: sessionId, format: 'json' });
      assertSuccess(view, 'read json');
      const nodes = JSON.parse(view.content as string) as Array<{ id: string; clean_text: string }>;
      const pid = nodes.find((n) => String(n.clean_text).includes('[X]'))?.id;
      expect(pid).toMatch(/^_bk_[0-9a-f]{12}$/);
      const edited = await replaceText(mgr, { session_id: sessionId, target_paragraph_id: pid!, old_string: '[X]', new_string: '<b>bold</b> <i>ital</i> <u>under</u> plain', instruction: 'test' });
      assertSuccess(edited, 'edit');
      const saved = await save(mgr, { session_id: sessionId, save_to_local_path: outPath, clean_bookmarks: true, save_format: 'clean' });
      assertSuccess(saved, 'save');
    });

    await then('each run has the correct formatting applied', async () => {
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
  });

  test('replace_text supports explicit <highlight> tags in new_string', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let outPath: string;

    await given('a document with a yellow-highlighted [VALUE] open', async () => {
      mgr = createTestSessionManager();
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
      outPath = path.join(tmpDir, 'output.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(xml)));
      const opened = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(opened, 'open');
      sessionId = opened.session_id as string;
    });

    await when('[VALUE] is replaced with "<highlight>Final Number</highlight>" and saved', async () => {
      const view = await readFile(mgr, { session_id: sessionId, format: 'json' });
      assertSuccess(view, 'read json');
      const nodes = JSON.parse(view.content as string) as Array<{ id: string; clean_text: string }>;
      const pid = nodes.find((n) => String(n.clean_text).includes('[VALUE]'))?.id;
      expect(pid).toMatch(/^_bk_[0-9a-f]{12}$/);
      const edited = await replaceText(mgr, { session_id: sessionId, target_paragraph_id: pid!, old_string: '[VALUE]', new_string: '<highlight>Final Number</highlight>', instruction: 'test' });
      assertSuccess(edited, 'edit');
      const saved = await save(mgr, { session_id: sessionId, save_to_local_path: outPath, clean_bookmarks: true, save_format: 'clean' });
      assertSuccess(saved, 'save');
    });

    await then('the "Final Number" run has a highlight in the saved output', async () => {
      const { runs, runText, hasHighlight } = await parseOutputXml(outPath);
      const idx = runs.findIndex((r) => runText(r) === 'Final Number');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(hasHighlight(runs[idx]!)).toBe(true);
    });
  });

  test('replace_text falls back to quote-normalized matching', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let paraId: string;

    await given('a document with curly-quoted "Company" means ABC Corp. open', async () => {
      mgr = createTestSessionManager();
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
      sessionId = opened.session_id as string;
      const read1 = await readFile(mgr, { session_id: sessionId });
      assertSuccess(read1, 'read');
      paraId = String(read1.content).split('\n').find((l) => l.startsWith('_bk_'))!.split('|')[0]!.trim();
    });

    await when('replaceText is called with straight-quote old_string matching the curly-quoted text', async () => {
      const edited = await replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: paraId,
        old_string: '"Company" means ABC Corp.',
        new_string: '"Company" means XYZ Corp.',
        instruction: 'test quote normalization fallback',
      });
      assertSuccess(edited, 'edit');
    });

    await then('XYZ Corp. appears in the document', async () => {
      const read2 = await readFile(mgr, { session_id: sessionId, node_ids: [paraId] });
      assertSuccess(read2, 'read2');
      expect(String(read2.content)).toContain('XYZ Corp.');
    });
  });

  test('replace_text falls back to flexible whitespace matching', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let paraId: string;

    await given('a document with "The   Purchase   Price" (triple spaces) open', async () => {
      mgr = createTestSessionManager();
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
      sessionId = opened.session_id as string;
      const read1 = await readFile(mgr, { session_id: sessionId });
      assertSuccess(read1, 'read');
      paraId = String(read1.content).split('\n').find((l) => l.startsWith('_bk_'))!.split('|')[0]!.trim();
    });

    await when('replaceText is called with single-space old_string that matches flexibly', async () => {
      const edited = await replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: paraId,
        old_string: 'The Purchase Price',
        new_string: 'The Final Price',
        instruction: 'test flexible whitespace fallback',
      });
      assertSuccess(edited, 'edit');
    });

    await then('"The Final Price" appears in the document', async () => {
      const read2 = await readFile(mgr, { session_id: sessionId, node_ids: [paraId] });
      assertSuccess(read2, 'read2');
      expect(String(read2.content)).toContain('The Final Price');
    });
  });

  test('replace_text falls back to quote-optional matching', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let paraId: string;

    await given('a document with "The defined term is \u201CCompany\u201D." open', async () => {
      mgr = createTestSessionManager();
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
      sessionId = opened.session_id as string;
      const read1 = await readFile(mgr, { session_id: sessionId });
      assertSuccess(read1, 'read');
      paraId = String(read1.content).split('\n').find((l) => l.startsWith('_bk_'))!.split('|')[0]!.trim();
    });

    await when('replaceText is called with bare "Company" (no quotes) as old_string', async () => {
      const edited = await replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: paraId,
        old_string: 'Company',
        new_string: 'Buyer',
        instruction: 'test quote optional fallback',
      });
      assertSuccess(edited, 'edit');
    });

    await then('the curly-quoted \u201CBuyer\u201D appears in the document', async () => {
      const read2 = await readFile(mgr, { session_id: sessionId, node_ids: [paraId] });
      assertSuccess(read2, 'read2');
      expect(String(read2.content)).toContain('\u201CBuyer\u201D');
    });
  });

  describe('read_file pagination edge cases', () => {
    test('offset/limit normalization and node_ids override', async ({ given, when, then }: AllureBddContext) => {
      let mgr: ReturnType<typeof createTestSessionManager>;
      let sessionId: string;
      let ids: string[];

      await given('a 3-paragraph document (A, B, C) open', async () => {
        mgr = createTestSessionManager();
        const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
        const inputPath = path.join(tmpDir, 'input.docx');
        await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['A', 'B', 'C'])));
        const opened = await openDocument(mgr, { file_path: inputPath });
        assertSuccess(opened, 'open');
        sessionId = opened.session_id as string;
        const readAll = await readFile(mgr, { session_id: sessionId, format: 'simple' });
        assertSuccess(readAll, 'readAll');
        ids = String(readAll.content).split('\n').filter((l) => l.startsWith('_bk_')).map((l) => l.split('|')[0].trim());
        expect(ids.length).toBe(3);
      });

      await when('offset=-1 and offset=2 and node_ids override are tested', () => {
        // tested in then
      });

      await then('offset=-1 returns C, offset=2 returns B, node_ids overrides offset/limit', async () => {
        const readLast = await readFile(mgr, { session_id: sessionId, offset: -1, limit: 1, format: 'simple' });
        assertSuccess(readLast, 'readLast');
        expect(String(readLast.content)).toContain(`${ids[2]} | C`);

        const readSecond = await readFile(mgr, { session_id: sessionId, offset: 2, limit: 1, format: 'simple' });
        assertSuccess(readSecond, 'readSecond');
        expect(String(readSecond.content)).toContain(`${ids[1]} | B`);

        const readOverride = await readFile(mgr, { session_id: sessionId, node_ids: [ids[0]], offset: -1, limit: 1, format: 'simple' });
        assertSuccess(readOverride, 'readOverride');
        expect(String(readOverride.content)).toContain(`${ids[0]} | A`);
      });
    });

    test('offset=0 starts from the first paragraph', async ({ given, when, then }: AllureBddContext) => {
      let mgr: ReturnType<typeof createTestSessionManager>;
      let sessionId: string;
      let res: Awaited<ReturnType<typeof readFile>>;

      await given('a 2-paragraph document (A, B) open', async () => {
        mgr = createTestSessionManager();
        const tmpDir = await createTrackedTempDir('safe-docx-ts-test-');
        const inputPath = path.join(tmpDir, 'input.docx');
        await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['A', 'B'])));
        const opened = await openDocument(mgr, { file_path: inputPath });
        assertSuccess(opened, 'open');
        sessionId = opened.session_id as string;
      });

      await when('readFile is called with offset=0 and limit=1', async () => {
        res = await readFile(mgr, { session_id: sessionId, offset: 0, limit: 1, format: 'simple' });
      });

      await then('the first paragraph A is returned', () => {
        assertSuccess(res, 'offset=0');
        expect(String(res.content)).toContain(' | A');
      });
    });

    test('invalid session id format returns INVALID_SESSION_ID', async ({ given, when, then }: AllureBddContext) => {
      let mgr: ReturnType<typeof createTestSessionManager>;
      let res: Awaited<ReturnType<typeof readFile>>;

      await given('a fresh session manager with no open sessions', () => {
        mgr = createTestSessionManager();
      });

      await when('readFile is called with a malformed session ID "ses_bad"', async () => {
        res = await readFile(mgr, { session_id: 'ses_bad' });
      });

      await then('the result fails with INVALID_SESSION_ID', () => {
        assertFailure(res, 'INVALID_SESSION_ID', 'invalid session id');
      });
    });
  });
});
