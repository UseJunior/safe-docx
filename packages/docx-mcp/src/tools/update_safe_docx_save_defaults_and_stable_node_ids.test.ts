import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDocument } from './open_document.js';
import { readFile } from './read_file.js';
import { replaceText } from './replace_text.js';
import { insertParagraph } from './insert_paragraph.js';
import { save } from './save.js';
import {
  extractParaIdsFromToon,
  firstParaIdFromToon,
  makeDocxWithDocumentXml,
  makeMinimalDocx,
} from '../testing/docx_test_utils.js';
import { testAllure, allureStep } from '../testing/allure-test.js';
import {
  openSession,
  assertSuccess,
  registerCleanup,
  createTrackedTempDir,
  createTestSessionManager,
} from '../testing/session-test-utils.js';

const TEST_FEATURE = 'update-safe-docx-save-defaults-and-stable-node-ids';
interface OpenSaveDefaults {
  save_defaults?: {
    default_variants?: string[];
    default_save_format?: string;
    supports_variant_override?: boolean;
  };
}

const SIMPLE_WORD_CHANGE_FIXTURE = fileURLToPath(
  new URL('../../../docx-core/src/testing/fixtures/simple-word-change/original.docx', import.meta.url),
);

describe('Traceability: Save Defaults and Stable Node IDs', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
  const humanReadableTest = test.allure({
    tags: ['human-readable'],
    parameters: { audience: 'non-technical' },
  });

  registerCleanup();

  humanReadableTest.openspec('Re-opening unchanged document yields same IDs')('Scenario: Re-opening unchanged document yields same IDs', async () => {
    const { idsA, idsB } = await allureStep('Given the same docx opened in two independent sessions', async () => {
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

      return { idsA, idsB };
    });

    await allureStep('Then both sessions report identical paragraph IDs', () => {
      expect(idsA).toEqual(idsB);
    });
  });

  humanReadableTest.openspec('Inserting new paragraph does not renumber unrelated IDs')('Scenario: Inserting new paragraph does not renumber unrelated IDs', async () => {
    const { id1, id2, id3, afterIds, newParaId } = await allureStep('Given a 3-paragraph doc with a new paragraph inserted after the second', async () => {
      const mgr = createTestSessionManager();
      const opened = await openSession(['One', 'Two', 'Three'], { mgr });
      const [id1, id2, id3] = opened.paraIds;

      const inserted = await insertParagraph(mgr, {
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

      return { id1: id1!, id2: id2!, id3: id3!, afterIds, newParaId: inserted.new_paragraph_id as string };
    });

    await allureStep('Then original IDs are preserved and the new paragraph has its own ID', () => {
      expect(afterIds).toContain(id1);
      expect(afterIds).toContain(id2);
      expect(afterIds).toContain(id3);
      expect(afterIds).toContain(newParaId);
      expect(afterIds.indexOf(id1)).toBe(0);
      expect(afterIds.indexOf(id2)).toBe(1);
      expect(afterIds.indexOf(id3)).toBe(3);
    });
  });

  humanReadableTest.openspec('Two identical signature-block paragraphs remain uniquely addressable')('Scenario: Two identical signature-block paragraphs remain uniquely addressable', async () => {
    const { readFirst, readSecond } = await allureStep('Given two identical paragraphs with an edit applied to only the first', async () => {
      const mgr = createTestSessionManager();
      const sig = 'Supplier / By: / Name: / Title:';
      const opened = await openSession([sig, sig], { mgr });
      expect(opened.paraIds.length).toBe(2);
      expect(opened.paraIds[0]).not.toBe(opened.paraIds[1]);

      const edited = await replaceText(mgr, {
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
      return { readFirst, readSecond };
    });

    await allureStep('Then only the targeted paragraph reflects the edit', () => {
      expect(String(readFirst.content)).toContain('Vendor');
      expect(String(readSecond.content)).toContain('Supplier');
    });
  });

  humanReadableTest.openspec('Missing intrinsic IDs are backfilled once')('Scenario: Missing intrinsic IDs are backfilled once', async () => {
    const { ids1, ids2 } = await allureStep('Given a docx with one existing and one missing bookmark ID read twice', async () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>` +
        `<w:bookmarkStart w:id="40" w:name="_bk_existing"/>` +
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
      return { ids1, ids2 };
    });

    await allureStep('Then the existing ID is preserved, the missing one is backfilled, and both reads agree', () => {
      expect(ids1).toContain('_bk_existing');
      expect(ids1.length).toBe(2);
      expect(ids1[1]).toMatch(/^_bk_[0-9a-f]{12}$/);
      expect(ids2).toEqual(ids1);
    });
  });

  humanReadableTest.openspec('Default download returns both variants')('Scenario: Default download returns both variants', async () => {
    const saved = await allureStep('Given an edited document saved with default options', async () => {
      const mgr = createTestSessionManager();
      const fixturePath = SIMPLE_WORD_CHANGE_FIXTURE;
      const tmpDir = await createTrackedTempDir('safe-docx-download-both-');
      const cleanPath = path.join(tmpDir, 'output.clean.docx');

      const opened = await openDocument(mgr, { file_path: fixturePath });
      assertSuccess(opened, 'open');
      const sessionId = opened.session_id as string;

      const read = await readFile(mgr, { session_id: sessionId });
      assertSuccess(read, 'read');
      const paraId = firstParaIdFromToon(String(read.content));
      await replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: paraId,
        old_string: 'The',
        new_string: 'TheX',
        instruction: 'edit before dual download',
      });

      const saved = await save(mgr, {
        session_id: sessionId,
        save_to_local_path: cleanPath,
        clean_bookmarks: true,
      });
      assertSuccess(saved, 'save');
      return saved;
    });

    await allureStep('Then both clean and redline variants are returned', () => {
      expect(saved.save_format).toBe('both');
      expect(saved.returned_variants).toEqual(['clean', 'redline']);
      expect(saved.cache_hit).toBe(false);
    });
  });

  humanReadableTest.openspec('Explicit variant override returns subset')('Scenario: Explicit variant override returns subset', async () => {
    const saved = await allureStep('Given a document saved with explicit clean-only format', async () => {
      const mgr = createTestSessionManager();
      const opened = await openSession(['Hello world'], { mgr, prefix: 'safe-docx-download-clean-only-' });
      const outputPath = path.join(opened.tmpDir, 'out.docx');

      const saved = await save(mgr, {
        session_id: opened.sessionId,
        save_to_local_path: outputPath,
        save_format: 'clean',
        clean_bookmarks: true,
      });
      assertSuccess(saved, 'save');
      return saved;
    });

    await allureStep('Then only the clean variant is returned with no tracked path', () => {
      expect(saved.returned_variants).toEqual(['clean']);
      expect(saved.tracked_saved_to).toBeNull();
    });
  });

  humanReadableTest.openspec('Repeat download reuses cached artifacts')('Scenario: Repeat download reuses cached artifacts', async () => {
    const { first, second } = await allureStep('Given an edited document saved twice without changes in between', async () => {
      const mgr = createTestSessionManager();
      const fixturePath = SIMPLE_WORD_CHANGE_FIXTURE;
      const tmpDir = await createTrackedTempDir('safe-docx-cache-hit-');
      const cleanPath = path.join(tmpDir, 'output.clean.docx');

      const opened = await openDocument(mgr, { file_path: fixturePath });
      assertSuccess(opened, 'open');
      const sessionId = opened.session_id as string;

      const read = await readFile(mgr, { session_id: sessionId });
      assertSuccess(read, 'read');
      const paraId = firstParaIdFromToon(String(read.content));
      await replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: paraId,
        old_string: 'The',
        new_string: 'TheX',
        instruction: 'cache test edit',
      });

      const first = await save(mgr, {
        session_id: sessionId,
        save_to_local_path: cleanPath,
        clean_bookmarks: true,
      });
      const second = await save(mgr, {
        session_id: sessionId,
        save_to_local_path: cleanPath,
        clean_bookmarks: true,
      });
      assertSuccess(first, 'first download');
      assertSuccess(second, 'second download');
      return { first, second };
    });

    await allureStep('Then the first save is a cache miss and the second is a cache hit', () => {
      expect(first.cache_hit).toBe(false);
      expect(second.cache_hit).toBe(true);
    });
  });

  humanReadableTest.openspec('New edit invalidates previous revision cache')('Scenario: New edit invalidates previous revision cache', async () => {
    const { first, second } = await allureStep('Given a document edited and saved twice at different revisions', async () => {
      const mgr = createTestSessionManager();
      const fixturePath = SIMPLE_WORD_CHANGE_FIXTURE;
      const tmpDir = await createTrackedTempDir('safe-docx-cache-invalidate-');
      const cleanPath = path.join(tmpDir, 'output.clean.docx');

      const opened = await openDocument(mgr, { file_path: fixturePath });
      assertSuccess(opened, 'open');
      const sessionId = opened.session_id as string;

      const read = await readFile(mgr, { session_id: sessionId });
      assertSuccess(read, 'read');
      const paraId = firstParaIdFromToon(String(read.content));

      await replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: paraId,
        old_string: 'The',
        new_string: 'TheX',
        instruction: 'first revision',
      });
      const first = await save(mgr, {
        session_id: sessionId,
        save_to_local_path: cleanPath,
        clean_bookmarks: true,
      });
      assertSuccess(first, 'first download');

      await replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: paraId,
        old_string: 'TheX',
        new_string: 'TheXY',
        instruction: 'second revision',
      });
      const second = await save(mgr, {
        session_id: sessionId,
        save_to_local_path: cleanPath,
        clean_bookmarks: true,
      });
      assertSuccess(second, 'second download');
      return { first, second };
    });

    await allureStep('Then each save is a cache miss with an incremented revision number', () => {
      expect(first.edit_revision).toBe(1);
      expect(first.cache_hit).toBe(false);
      expect(second.edit_revision).toBe(2);
      expect(second.cache_hit).toBe(false);
    });
  });

  humanReadableTest.openspec('Anchors unchanged after dual download')('Scenario: Anchors unchanged after dual download', async () => {
    const { beforeIds, afterIds } = await allureStep('Given paragraph IDs read before and after a save', async () => {
      const mgr = createTestSessionManager();
      const fixturePath = SIMPLE_WORD_CHANGE_FIXTURE;
      const tmpDir = await createTrackedTempDir('safe-docx-anchor-stable-');
      const cleanPath = path.join(tmpDir, 'output.clean.docx');

      const opened = await openDocument(mgr, { file_path: fixturePath });
      assertSuccess(opened, 'open');
      const sessionId = opened.session_id as string;
      const readResult = await readFile(mgr, { session_id: sessionId, format: 'simple' });
      assertSuccess(readResult, 'read');
      const beforeIds = extractParaIdsFromToon(String(readResult.content)).slice();
      expect(beforeIds.length).toBeGreaterThan(0);

      const saved = await save(mgr, {
        session_id: sessionId,
        save_to_local_path: cleanPath,
        clean_bookmarks: true,
      });
      assertSuccess(saved, 'save');

      const afterRead = await readFile(mgr, { session_id: sessionId, format: 'simple' });
      assertSuccess(afterRead, 'read after');
      const afterIds = extractParaIdsFromToon(String(afterRead.content));
      return { beforeIds, afterIds };
    });

    await allureStep('Then paragraph IDs are identical before and after the save', () => {
      expect(afterIds).toEqual(beforeIds);
    });
  });

  humanReadableTest.openspec('Generating clean artifact does not invalidate redline anchors')('Scenario: Generating clean artifact does not invalidate redline anchors', async () => {
    const { baselineIds, afterIds } = await allureStep('Given baseline IDs captured, then clean and tracked saves performed', async () => {
      const mgr = createTestSessionManager();
      const fixturePath = SIMPLE_WORD_CHANGE_FIXTURE;
      const tmpDir = await createTrackedTempDir('safe-docx-clean-then-redline-');
      const cleanPath = path.join(tmpDir, 'clean.docx');
      const trackedPath = path.join(tmpDir, 'redline.docx');

      const opened = await openDocument(mgr, { file_path: fixturePath });
      assertSuccess(opened, 'open');
      const sessionId = opened.session_id as string;
      const readResult = await readFile(mgr, { session_id: sessionId, format: 'simple' });
      assertSuccess(readResult, 'read');
      const baselineIds = extractParaIdsFromToon(String(readResult.content)).slice();

      const cleanOnly = await save(mgr, {
        session_id: sessionId,
        save_to_local_path: cleanPath,
        save_format: 'clean',
        clean_bookmarks: true,
      });
      assertSuccess(cleanOnly, 'clean download');

      const trackedOnly = await save(mgr, {
        session_id: sessionId,
        save_to_local_path: trackedPath,
        save_format: 'tracked',
        clean_bookmarks: true,
      });
      assertSuccess(trackedOnly, 'tracked download');

      const afterRead = await readFile(mgr, { session_id: sessionId, format: 'simple' });
      assertSuccess(afterRead, 'read after');
      const afterIds = extractParaIdsFromToon(String(afterRead.content));
      return { baselineIds, afterIds };
    });

    await allureStep('Then paragraph IDs remain unchanged after both saves', () => {
      expect(afterIds).toEqual(baselineIds);
    });
  });

  humanReadableTest.openspec('Open response advertises download defaults')('Scenario: Open response advertises download defaults', async () => {
    const defaultsMeta = await allureStep('Given a document opened to inspect its metadata', async () => {
      const mgr = createTestSessionManager();
      const opened = await openSession(['A'], { mgr, prefix: 'safe-docx-open-metadata-' });

      const openResult = await openDocument(mgr, { file_path: opened.inputPath });
      assertSuccess(openResult, 'open');
      return openResult as typeof openResult & OpenSaveDefaults;
    });

    await allureStep('Then save_defaults advertises both variants with override support', () => {
      expect(defaultsMeta.save_defaults?.default_variants).toEqual(['clean', 'redline']);
      expect(defaultsMeta.save_defaults?.default_save_format).toBe('both');
      expect(defaultsMeta.save_defaults?.supports_variant_override).toBe(true);
    });
  });

  humanReadableTest.openspec('Download response reports variant and cache details')('Scenario: Download response reports variant and cache details', async () => {
    const { first, second } = await allureStep('Given a document saved twice in clean format', async () => {
      const mgr = createTestSessionManager();
      const opened = await openSession(['A'], { mgr, prefix: 'safe-docx-download-metadata-' });
      const outputPath = path.join(opened.tmpDir, 'out.docx');

      const first = await save(mgr, {
        session_id: opened.sessionId,
        save_to_local_path: outputPath,
        save_format: 'clean',
        clean_bookmarks: true,
      });
      const second = await save(mgr, {
        session_id: opened.sessionId,
        save_to_local_path: outputPath,
        save_format: 'clean',
        clean_bookmarks: true,
      });
      assertSuccess(first, 'first download');
      assertSuccess(second, 'second download');
      return { first, second };
    });

    await allureStep('Then both responses report variant and cache metadata correctly', () => {
      expect(first.returned_variants).toEqual(['clean']);
      expect(first.cache_hit).toBe(false);
      expect(typeof first.edit_revision).toBe('number');

      expect(second.returned_variants).toEqual(['clean']);
      expect(second.cache_hit).toBe(true);
      expect(second.edit_revision).toBe(first.edit_revision);
    });
  });
});
