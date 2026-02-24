import { describe, expect } from 'vitest';
import { testAllure as test } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { openDocument } from './open_document.js';
import { readFile } from './read_file.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { extractParaIdsFromToon, makeMinimalDocx } from '../testing/docx_test_utils.js';

describe('open_document: paragraph ID collision safety', () => {
  registerCleanup();

  test('large near-duplicate corpus yields unique paragraph IDs', async () => {
    const repeated = 'Signature: ____________________';
    const paragraphs = Array.from({ length: 320 }, () => repeated);

    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('safe-docx-id-collision-');
    const inputPath = path.join(tmpDir, 'input.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(paragraphs)));

    const opened = await openDocument(mgr, { file_path: inputPath });
    expect(opened.success).toBe(true);
    if (!opened.success) return;

    const read = await readFile(mgr, { session_id: String(opened.session_id), format: 'simple' });
    expect(read.success).toBe(true);
    if (!read.success) return;

    const ids = extractParaIdsFromToon(String(read.content));
    expect(ids.length).toBe(paragraphs.length);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^_bk_[0-9a-f]{12}$/);
    }
  });

  test('ID allocation remains deterministic across fresh opens of identical corpus', async () => {
    const repeated = 'Supplier / Name / Title';
    const paragraphs = Array.from({ length: 220 }, () => repeated);
    const tmpDir = await createTrackedTempDir('safe-docx-id-deterministic-');
    const inputPath = path.join(tmpDir, 'input.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(paragraphs)));

    const mgrA = createTestSessionManager();
    const openA = await openDocument(mgrA, { file_path: inputPath });
    expect(openA.success).toBe(true);
    if (!openA.success) return;
    const readA = await readFile(mgrA, { session_id: String(openA.session_id), format: 'simple' });
    expect(readA.success).toBe(true);
    if (!readA.success) return;
    const idsA = extractParaIdsFromToon(String(readA.content));

    const mgrB = createTestSessionManager();
    const openB = await openDocument(mgrB, { file_path: inputPath });
    expect(openB.success).toBe(true);
    if (!openB.success) return;
    const readB = await readFile(mgrB, { session_id: String(openB.session_id), format: 'simple' });
    expect(readB.success).toBe(true);
    if (!readB.success) return;
    const idsB = extractParaIdsFromToon(String(readB.content));

    expect(idsA).toEqual(idsB);
  });
});
