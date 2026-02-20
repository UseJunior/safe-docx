import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import { openDocument } from './open_document.js';
import { readFile } from './read_file.js';
import { smartEdit } from './smart_edit.js';
import { smartInsert } from './smart_insert.js';
import { download } from './download.js';
import {
  extractParaIdsFromToon,
  firstParaIdFromToon,
  makeDocxWithDocumentXml,
  makeMinimalDocx,
} from '../testing/docx_test_utils.js';
import { testAllure } from '../testing/allure-test.js';
import {
  openSession,
  assertSuccess,
  registerCleanup,
  createTrackedTempDir,
  createTestSessionManager,
} from '../testing/session-test-utils.js';

const TEST_FEATURE = 'update-safe-docx-download-defaults-and-stable-node-ids';
interface OpenDownloadDefaults {
  download_defaults?: {
    default_variants?: string[];
    default_download_format?: string;
    supports_variant_override?: boolean;
  };
}

describe('OpenSpec traceability: update-safe-docx-download-defaults-and-stable-node-ids', () => {
  const test = testAllure.epic('OpenSpec Traceability').withLabels({ feature: TEST_FEATURE });

  registerCleanup();

  test.openspec('Re-opening unchanged document yields same IDs')('Scenario: Re-opening unchanged document yields same IDs', async () => {
    const tmpDir = await createTrackedTempDir('safe-docx-id-reopen-');
    const inputPath = path.join(tmpDir, 'input.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['A', 'B', 'C'])));

    const mgr1 = createTestSessionManager();
    const mgr2 = createTestSessionManager();

    const openedA = await openDocument(mgr1, { file_path: inputPath });
    assertSuccess(openedA, 'open A');
    const readA = await readFile(mgr1, { session_id: openedA.session_id as string, format: 'simple' });
    assertSuccess(readA, 'read A');
    const idsA = extractParaIdsFromToon(String(readA.content));

    const openedB = await openDocument(mgr2, { file_path: inputPath });
    assertSuccess(openedB, 'open B');
    const readB = await readFile(mgr2, { session_id: openedB.session_id as string, format: 'simple' });
    assertSuccess(readB, 'read B');
    const idsB = extractParaIdsFromToon(String(readB.content));

    expect(idsA).toEqual(idsB);
  });

  test.openspec('Inserting new paragraph does not renumber unrelated IDs')('Scenario: Inserting new paragraph does not renumber unrelated IDs', async () => {
    const mgr = createTestSessionManager();
    const opened = await openSession(['One', 'Two', 'Three'], { mgr });
    const [id1, id2, id3] = opened.paraIds;

    const inserted = await smartInsert(mgr, {
      session_id: opened.sessionId,
      positional_anchor_node_id: id2!,
      new_string: 'Two and a half',
      instruction: 'insert without renumber',
      position: 'AFTER',
    });
    assertSuccess(inserted, 'insert');

    const after = await readFile(mgr, { session_id: opened.sessionId, format: 'simple' });
    assertSuccess(after, 'read after');
    const afterIds = extractParaIdsFromToon(String(after.content));

    expect(afterIds).toContain(id1!);
    expect(afterIds).toContain(id2!);
    expect(afterIds).toContain(id3!);
    expect(afterIds).toContain(inserted.new_paragraph_id as string);
    expect(afterIds.indexOf(id1!)).toBe(0);
    expect(afterIds.indexOf(id2!)).toBe(1);
    expect(afterIds.indexOf(id3!)).toBe(3);
  });

  test.openspec('Two identical signature-block paragraphs remain uniquely addressable')('Scenario: Two identical signature-block paragraphs remain uniquely addressable', async () => {
    const mgr = createTestSessionManager();
    const sig = 'Supplier / By: / Name: / Title:';
    const opened = await openSession([sig, sig], { mgr });
    expect(opened.paraIds.length).toBe(2);
    expect(opened.paraIds[0]).not.toBe(opened.paraIds[1]);

    const edited = await smartEdit(mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: opened.paraIds[0]!,
      old_string: 'Supplier',
      new_string: 'Vendor',
      instruction: 'unique duplicate targeting',
    });
    assertSuccess(edited, 'edit');

    const readFirst = await readFile(mgr, { session_id: opened.sessionId, node_ids: [opened.paraIds[0]!], format: 'simple' });
    const readSecond = await readFile(mgr, { session_id: opened.sessionId, node_ids: [opened.paraIds[1]!], format: 'simple' });
    assertSuccess(readFirst, 'read first');
    assertSuccess(readSecond, 'read second');
    expect(String(readFirst.content)).toContain('Vendor');
    expect(String(readSecond.content)).toContain('Supplier');
  });

  test.openspec('Missing intrinsic IDs are backfilled once')('Scenario: Missing intrinsic IDs are backfilled once', async () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:bookmarkStart w:id="40" w:name="jr_para_existing"/>` +
      `<w:p><w:r><w:t>Existing id paragraph</w:t></w:r></w:p>` +
      `<w:bookmarkEnd w:id="40"/>` +
      `<w:p><w:r><w:t>Needs backfill</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('safe-docx-backfill-');
    const inputPath = path.join(tmpDir, 'input.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(xml)));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const read1 = await readFile(mgr, { session_id: sessionId, format: 'simple' });
    const read2 = await readFile(mgr, { session_id: sessionId, format: 'simple' });
    assertSuccess(read1, 'read1');
    assertSuccess(read2, 'read2');

    const ids1 = extractParaIdsFromToon(String(read1.content));
    const ids2 = extractParaIdsFromToon(String(read2.content));
    expect(ids1).toContain('jr_para_existing');
    expect(ids1.length).toBe(2);
    expect(ids1[1]).toMatch(/^jr_para_[0-9a-f]{12}$/);
    expect(ids2).toEqual(ids1);
  });

  test.openspec('Default download returns both variants')('Scenario: Default download returns both variants', async () => {
    const mgr = createTestSessionManager();
    const fixturePath = path.resolve(process.cwd(), '../docx-comparison/src/testing/fixtures/simple-word-change/original.docx');
    const tmpDir = await createTrackedTempDir('safe-docx-download-both-');
    const cleanPath = path.join(tmpDir, 'output.clean.docx');

    const opened = await openDocument(mgr, { file_path: fixturePath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const read = await readFile(mgr, { session_id: sessionId });
    assertSuccess(read, 'read');
    const paraId = firstParaIdFromToon(String(read.content));
    await smartEdit(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: 'The',
      new_string: 'TheX',
      instruction: 'edit before dual download',
    });

    const saved = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: cleanPath,
      clean_bookmarks: true,
    });
    assertSuccess(saved, 'download');
    expect(saved.download_format).toBe('both');
    expect(saved.returned_variants).toEqual(['clean', 'redline']);
    expect(saved.cache_hit).toBe(false);
  });

  test.openspec('Explicit variant override returns subset')('Scenario: Explicit variant override returns subset', async () => {
    const mgr = createTestSessionManager();
    const opened = await openSession(['Hello world'], { mgr, prefix: 'safe-docx-download-clean-only-' });
    const outputPath = path.join(opened.tmpDir, 'out.docx');

    const saved = await download(mgr, {
      session_id: opened.sessionId,
      save_to_local_path: outputPath,
      download_format: 'clean',
      clean_bookmarks: true,
    });
    assertSuccess(saved, 'download');
    expect(saved.returned_variants).toEqual(['clean']);
    expect(saved.tracked_saved_to).toBeNull();
  });

  test.openspec('Repeat download reuses cached artifacts')('Scenario: Repeat download reuses cached artifacts', async () => {
    const mgr = createTestSessionManager();
    const fixturePath = path.resolve(process.cwd(), '../docx-comparison/src/testing/fixtures/simple-word-change/original.docx');
    const tmpDir = await createTrackedTempDir('safe-docx-cache-hit-');
    const cleanPath = path.join(tmpDir, 'output.clean.docx');

    const opened = await openDocument(mgr, { file_path: fixturePath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const read = await readFile(mgr, { session_id: sessionId });
    assertSuccess(read, 'read');
    const paraId = firstParaIdFromToon(String(read.content));
    await smartEdit(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: 'The',
      new_string: 'TheX',
      instruction: 'cache test edit',
    });

    const first = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: cleanPath,
      clean_bookmarks: true,
    });
    const second = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: cleanPath,
      clean_bookmarks: true,
    });
    assertSuccess(first, 'first download');
    assertSuccess(second, 'second download');
    expect(first.cache_hit).toBe(false);
    expect(second.cache_hit).toBe(true);
  });

  test.openspec('New edit invalidates previous revision cache')('Scenario: New edit invalidates previous revision cache', async () => {
    const mgr = createTestSessionManager();
    const fixturePath = path.resolve(process.cwd(), '../docx-comparison/src/testing/fixtures/simple-word-change/original.docx');
    const tmpDir = await createTrackedTempDir('safe-docx-cache-invalidate-');
    const cleanPath = path.join(tmpDir, 'output.clean.docx');

    const opened = await openDocument(mgr, { file_path: fixturePath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const read = await readFile(mgr, { session_id: sessionId });
    assertSuccess(read, 'read');
    const paraId = firstParaIdFromToon(String(read.content));

    await smartEdit(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: 'The',
      new_string: 'TheX',
      instruction: 'first revision',
    });
    const first = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: cleanPath,
      clean_bookmarks: true,
    });
    assertSuccess(first, 'first download');
    expect(first.edit_revision).toBe(1);
    expect(first.cache_hit).toBe(false);

    await smartEdit(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: 'TheX',
      new_string: 'TheXY',
      instruction: 'second revision',
    });
    const second = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: cleanPath,
      clean_bookmarks: true,
    });
    assertSuccess(second, 'second download');
    expect(second.edit_revision).toBe(2);
    expect(second.cache_hit).toBe(false);
  });

  test.openspec('Anchors unchanged after dual download')('Scenario: Anchors unchanged after dual download', async () => {
    const mgr = createTestSessionManager();
    const fixturePath = path.resolve(process.cwd(), '../docx-comparison/src/testing/fixtures/simple-word-change/original.docx');
    const tmpDir = await createTrackedTempDir('safe-docx-anchor-stable-');
    const cleanPath = path.join(tmpDir, 'output.clean.docx');

    const opened = await openDocument(mgr, { file_path: fixturePath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;
    const readResult = await readFile(mgr, { session_id: sessionId, format: 'simple' });
    assertSuccess(readResult, 'read');
    const beforeIds = extractParaIdsFromToon(String(readResult.content)).slice();
    expect(beforeIds.length).toBeGreaterThan(0);

    const saved = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: cleanPath,
      clean_bookmarks: true,
    });
    assertSuccess(saved, 'download');

    const afterRead = await readFile(mgr, { session_id: sessionId, format: 'simple' });
    assertSuccess(afterRead, 'read after');
    const afterIds = extractParaIdsFromToon(String(afterRead.content));
    expect(afterIds).toEqual(beforeIds);
  });

  test.openspec('Generating clean artifact does not invalidate redline anchors')('Scenario: Generating clean artifact does not invalidate redline anchors', async () => {
    const mgr = createTestSessionManager();
    const fixturePath = path.resolve(process.cwd(), '../docx-comparison/src/testing/fixtures/simple-word-change/original.docx');
    const tmpDir = await createTrackedTempDir('safe-docx-clean-then-redline-');
    const cleanPath = path.join(tmpDir, 'clean.docx');
    const trackedPath = path.join(tmpDir, 'redline.docx');

    const opened = await openDocument(mgr, { file_path: fixturePath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;
    const readResult = await readFile(mgr, { session_id: sessionId, format: 'simple' });
    assertSuccess(readResult, 'read');
    const baselineIds = extractParaIdsFromToon(String(readResult.content)).slice();

    const cleanOnly = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: cleanPath,
      download_format: 'clean',
      clean_bookmarks: true,
    });
    assertSuccess(cleanOnly, 'clean download');

    const trackedOnly = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: trackedPath,
      download_format: 'tracked',
      clean_bookmarks: true,
    });
    assertSuccess(trackedOnly, 'tracked download');

    const afterRead = await readFile(mgr, { session_id: sessionId, format: 'simple' });
    assertSuccess(afterRead, 'read after');
    expect(extractParaIdsFromToon(String(afterRead.content))).toEqual(baselineIds);
  });

  test.openspec('Open response advertises download defaults')('Scenario: Open response advertises download defaults', async () => {
    const mgr = createTestSessionManager();
    const opened = await openSession(['A'], { mgr, prefix: 'safe-docx-open-metadata-' });

    const openResult = await openDocument(mgr, { file_path: opened.inputPath });
    assertSuccess(openResult, 'open');
    const defaultsMeta = openResult as typeof openResult & OpenDownloadDefaults;
    expect(defaultsMeta.download_defaults?.default_variants).toEqual(['clean', 'redline']);
    expect(defaultsMeta.download_defaults?.default_download_format).toBe('both');
    expect(defaultsMeta.download_defaults?.supports_variant_override).toBe(true);
  });

  test.openspec('Download response reports variant and cache details')('Scenario: Download response reports variant and cache details', async () => {
    const mgr = createTestSessionManager();
    const opened = await openSession(['A'], { mgr, prefix: 'safe-docx-download-metadata-' });
    const outputPath = path.join(opened.tmpDir, 'out.docx');

    const first = await download(mgr, {
      session_id: opened.sessionId,
      save_to_local_path: outputPath,
      download_format: 'clean',
      clean_bookmarks: true,
    });
    const second = await download(mgr, {
      session_id: opened.sessionId,
      save_to_local_path: outputPath,
      download_format: 'clean',
      clean_bookmarks: true,
    });
    assertSuccess(first, 'first download');
    assertSuccess(second, 'second download');

    expect(first.returned_variants).toEqual(['clean']);
    expect(first.cache_hit).toBe(false);
    expect(typeof first.edit_revision).toBe('number');

    expect(second.returned_variants).toEqual(['clean']);
    expect(second.cache_hit).toBe(true);
    expect(second.edit_revision).toBe(first.edit_revision);
  });
});
