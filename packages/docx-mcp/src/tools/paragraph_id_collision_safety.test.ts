import { describe, expect } from 'vitest';
import { testAllure as test, type AllureBddContext } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { openDocument } from './open_document.js';
import { readFile } from './read_file.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { extractParaIdsFromToon, makeMinimalDocx } from '../testing/docx_test_utils.js';

describe('open_document: paragraph ID collision safety', () => {
  registerCleanup();

  test('large near-duplicate corpus yields unique paragraph IDs', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let inputPath: string;
    let opened: Awaited<ReturnType<typeof openDocument>>;
    let read: Awaited<ReturnType<typeof readFile>>;
    let paragraphs: string[];

    await given('a document with 320 identical "Signature" lines opened', async () => {
      const repeated = 'Signature: ____________________';
      paragraphs = Array.from({ length: 320 }, () => repeated);
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-id-collision-');
      inputPath = path.join(tmpDir, 'input.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(paragraphs)));
      opened = await openDocument(mgr, { file_path: inputPath });
      expect(opened.success).toBe(true);
    });

    await when('the document is read in simple format', async () => {
      if (!opened.success) return;
      read = await readFile(mgr, { session_id: String(opened.session_id), format: 'simple' });
      expect(read.success).toBe(true);
    });

    await then('all paragraph IDs are unique and match the _bk_ pattern', () => {
      if (!read.success) return;
      const ids = extractParaIdsFromToon(String(read.content));
      expect(ids.length).toBe(paragraphs.length);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(id).toMatch(/^_bk_[0-9a-f]{12}$/);
      }
    });
  });

  test('ID allocation remains deterministic across fresh opens of identical corpus', async ({ given, when, then }: AllureBddContext) => {
    let inputPath: string;
    let idsA: string[];
    let idsB: string[];

    await given('a document with 220 identical "Supplier / Name / Title" lines on disk', async () => {
      const repeated = 'Supplier / Name / Title';
      const paragraphs = Array.from({ length: 220 }, () => repeated);
      const tmpDir = await createTrackedTempDir('safe-docx-id-deterministic-');
      inputPath = path.join(tmpDir, 'input.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(paragraphs)));
    });

    await when('two independent session managers open the same file and read paragraph IDs', async () => {
      const mgrA = createTestSessionManager();
      const openA = await openDocument(mgrA, { file_path: inputPath });
      expect(openA.success).toBe(true);
      if (!openA.success) return;
      const readA = await readFile(mgrA, { session_id: String(openA.session_id), format: 'simple' });
      expect(readA.success).toBe(true);
      if (!readA.success) return;
      idsA = extractParaIdsFromToon(String(readA.content));

      const mgrB = createTestSessionManager();
      const openB = await openDocument(mgrB, { file_path: inputPath });
      expect(openB.success).toBe(true);
      if (!openB.success) return;
      const readB = await readFile(mgrB, { session_id: String(openB.session_id), format: 'simple' });
      expect(readB.success).toBe(true);
      if (!readB.success) return;
      idsB = extractParaIdsFromToon(String(readB.content));
    });

    await then('both sessions produce identical paragraph ID lists', () => {
      expect(idsA).toEqual(idsB);
    });
  });
});
