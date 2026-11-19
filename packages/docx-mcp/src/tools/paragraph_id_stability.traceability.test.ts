import { describe, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';

import { openDocument } from './open_document.js';
import { readFile } from './read_file.js';
import { insertParagraph } from './insert_paragraph.js';
import { extractParaIdsFromToon, makeMinimalDocx } from '../testing/docx_test_utils.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  openSession,
  assertSuccess,
  registerCleanup,
  createTrackedTempDir,
  createTestSessionManager,
} from '../testing/session-test-utils.js';

const TEST_FEATURE = 'document-paragraph-id-stability-and-fingerprint';

describe('Traceability: Persisted Intrinsic Node IDs (under document-paragraph-id-stability-and-fingerprint)', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

  registerCleanup();

  test.openspec('Re-opening unchanged document yields same IDs')(
    'Re-opening unchanged document yields same IDs',
    async () => {
      const tmpDir = await createTrackedTempDir('id-reopen-');
      const inputPath = path.join(tmpDir, 'input.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['A', 'B', 'C'])));

      const mgr1 = createTestSessionManager();
      const openedA = await openDocument(mgr1, { file_path: inputPath });
      assertSuccess(openedA, 'open A');
      const readA = await readFile(mgr1, { file_path: inputPath, format: 'simple' });
      assertSuccess(readA, 'read A');
      const idsA = extractParaIdsFromToon(String(readA.content));

      const mgr2 = createTestSessionManager();
      const openedB = await openDocument(mgr2, { file_path: inputPath });
      assertSuccess(openedB, 'open B');
      const readB = await readFile(mgr2, { file_path: inputPath, format: 'simple' });
      assertSuccess(readB, 'read B');
      const idsB = extractParaIdsFromToon(String(readB.content));

      expect(idsA).toEqual(idsB);
    },
  );

  test.openspec('Inserting new paragraph does not renumber unrelated IDs')(
    'Inserting new paragraph does not renumber unrelated IDs',
    async () => {
      const mgr = createTestSessionManager();
      const opened = await openSession(['One', 'Two', 'Three'], { mgr });
      const [id1, id2, id3] = opened.paraIds;

      const inserted = await insertParagraph(mgr, {
        file_path: opened.filePath,
        positional_anchor_node_id: id2!,
        new_string: 'Two and a half',
        instruction: 'insert without renumber',
        position: 'AFTER',
      });
      assertSuccess(inserted, 'insert');

      const after = await readFile(mgr, { file_path: opened.filePath, format: 'simple' });
      assertSuccess(after, 'read after');
      const afterIds = extractParaIdsFromToon(String(after.content));

      expect(afterIds).toContain(id1!);
      expect(afterIds).toContain(id2!);
      expect(afterIds).toContain(id3!);
    },
  );

  test.openspec('Two identical signature-block paragraphs remain uniquely addressable')(
    'Two identical signature-block paragraphs remain uniquely addressable',
    async () => {
      const mgr = createTestSessionManager();
      const sig = 'Supplier / By: / Name: / Title:';
      const opened = await openSession([sig, sig], { mgr });
      expect(opened.paraIds.length).toBe(2);
      expect(opened.paraIds[0]).not.toBe(opened.paraIds[1]);
    },
  );

  test.openspec('Missing intrinsic IDs are backfilled once')(
    'Missing intrinsic IDs are backfilled once',
    async () => {
      const mgr = createTestSessionManager();
      const opened = await openSession(['Alpha.', 'Beta.'], { mgr });
      for (const id of opened.paraIds) {
        expect(id).toMatch(/^_bk_[0-9a-f]{10}$/);
      }
    },
  );

  test.openspec('Identifiers are byte-identical across machines for identical stored bytes')(
    'Identifiers are byte-identical across machines for identical stored bytes',
    async () => {
      // Determinism check: opening the same byte content twice in two independent
      // SessionManagers (proxy for "different machines") yields identical IDs.
      // Combined with the existing reopen-stability tests, this asserts the IDs
      // are a pure function of document bytes — not of process/session state.
      const tmpDir = await createTrackedTempDir('id-cross-machine-');
      const inputPath = path.join(tmpDir, 'input.docx');
      await fs.writeFile(
        inputPath,
        new Uint8Array(await makeMinimalDocx(['Cross-machine paragraph one.', 'Paragraph two.'])),
      );

      const machineA = createTestSessionManager();
      const openedA = await openDocument(machineA, { file_path: inputPath });
      assertSuccess(openedA, 'open A');
      const viewA = await readFile(machineA, { file_path: inputPath, format: 'simple' });
      assertSuccess(viewA, 'read A');
      const idsA = extractParaIdsFromToon(String(viewA.content));

      const machineB = createTestSessionManager();
      const openedB = await openDocument(machineB, { file_path: inputPath });
      assertSuccess(openedB, 'open B');
      const viewB = await readFile(machineB, { file_path: inputPath, format: 'simple' });
      assertSuccess(viewB, 'read B');
      const idsB = extractParaIdsFromToon(String(viewB.content));

      expect(idsA.length).toBe(2);
      expect(idsB).toEqual(idsA);
    },
  );
});

/**
 * A `w:sym` glyph (a Wingdings checkbox) is one character of the paragraph
 * text since issue #1046, and that text seeds the `_bk_*` anchor of a
 * paragraph without `w14:paraId`, together with its neighbours' text. These
 * tests pin both halves of that contract: the anchor is stable across reopen,
 * and it is seeded from text that includes the glyph, so it differs from the
 * anchor the same paragraph had while the glyph was invisible.
 */
describe('Paragraph IDs for symbol-bearing paragraphs (under document-paragraph-id-stability-and-fingerprint)', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

  registerCleanup();

  const SYMBOL_RUN = '<w:r><w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/></w:rPr><w:sym w:font="Wingdings" w:char="F0A8"/></w:r>';
  const documentXml = (symbolRun: string): string =>
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:r><w:t>Please indicate your election:</w:t></w:r></w:p>' +
    `<w:p><w:r><w:t xml:space="preserve">Alpha </w:t></w:r>${symbolRun}<w:r><w:t xml:space="preserve"> Bravo</w:t></w:r></w:p>` +
    '<w:p><w:r><w:t>Middle paragraph.</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Closing paragraph.</w:t></w:r></w:p>' +
    '</w:body></w:document>';

  test('a symbol-bearing paragraph keeps the same ID across reopen', async ({ given, then }: AllureBddContext) => {
    const [first, second] = await given('the same symbol-bearing document opened in two sessions', async () => [
      await openSession([], { mgr: createTestSessionManager(), xml: documentXml(SYMBOL_RUN) }),
      await openSession([], { mgr: createTestSessionManager(), xml: documentXml(SYMBOL_RUN) }),
    ]);
    await then('both sessions report identical paragraph IDs', () => {
      expect(first.paraIds).toHaveLength(4);
      expect(second.paraIds).toEqual(first.paraIds);
    });
  });

  test('the ID is seeded from paragraph text that includes the glyph', async ({ given, then }: AllureBddContext) => {
    const [withSymbol, withoutSymbol] = await given('the document, and its twin with the checkbox run left empty', async () => [
      await openSession([], { mgr: createTestSessionManager(), xml: documentXml(SYMBOL_RUN) }),
      await openSession([], { mgr: createTestSessionManager(), xml: documentXml('<w:r><w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/></w:rPr></w:r>') }),
    ]);
    await then('the symbol paragraph and its two neighbours get different IDs; the paragraph two away does not', () => {
      expect(withSymbol.content).toContain('Alpha \uF0A8 Bravo');
      expect(withSymbol.paraIds[0]).not.toBe(withoutSymbol.paraIds[0]);
      expect(withSymbol.paraIds[1]).not.toBe(withoutSymbol.paraIds[1]);
      expect(withSymbol.paraIds[2]).not.toBe(withoutSymbol.paraIds[2]);
      expect(withSymbol.paraIds[3]).toBe(withoutSymbol.paraIds[3]);
    });
  });
});
