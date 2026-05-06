import { describe, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';

import { openDocument } from './open_document.js';
import { readFile } from './read_file.js';
import { insertParagraph } from './insert_paragraph.js';
import { extractParaIdsFromToon, makeMinimalDocx } from '../testing/docx_test_utils.js';
import { testAllure } from '../testing/allure-test.js';
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
        expect(id).toMatch(/^_bk_[0-9a-f]{12}$/);
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
