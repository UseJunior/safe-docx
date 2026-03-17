import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { openDocument } from './open_document.js';
import { closeFile } from './close_file.js';
import { getFileStatus } from './get_file_status.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Session Management' });

async function createDoc(paragraphs: string[], name: string): Promise<string> {
  const dir = await createTrackedTempDir('safe-docx-clear-session-');
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, new Uint8Array(await makeMinimalDocx(paragraphs)));
  return filePath;
}

describe('close_file tool', () => {
  registerCleanup();

  test('rejects invalid target combinations and missing targets', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let missing: Awaited<ReturnType<typeof closeFile>>;
    let invalidAll: Awaited<ReturnType<typeof closeFile>>;

    await given('a fresh session manager', () => { mgr = createTestSessionManager(); });
    await when('closeFile is called with no target', async () => {
      missing = await closeFile(mgr, {});
    });
    await then('it fails with INVALID_CLEAR_TARGET', () => {
      expect(missing.success).toBe(false);
      if (!missing.success) expect(missing.error.code).toBe('INVALID_CLEAR_TARGET');
    });
    await when('closeFile is called with both clear_all and file_path', async () => {
      invalidAll = await closeFile(mgr, {
        clear_all: true,
        confirm: true,
        file_path: '/some/path.docx',
      });
    });
    await and('it fails with INVALID_CLEAR_TARGET', () => {
      expect(invalidAll.success).toBe(false);
      if (!invalidAll.success) expect(invalidAll.error.code).toBe('INVALID_CLEAR_TARGET');
    });
  });

  test('closes sessions by file_path and via clear_all', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let docA: string;
    let docB: string;

    await given('two documents each opened in sessions', async () => {
      mgr = createTestSessionManager();
      docA = await createDoc(['Alpha'], 'a.docx');
      docB = await createDoc(['Beta'], 'b.docx');

      const a1 = await openDocument(mgr, { file_path: docA });
      const b1 = await openDocument(mgr, { file_path: docB });
      expect(a1.success && b1.success).toBe(true);
    });
    await when('closeFile is called by file_path for docA', async () => {
      const clearedByPath = await closeFile(mgr, { file_path: docA });
      expect(clearedByPath.success).toBe(true);
      if (clearedByPath.success) {
        expect(clearedByPath.clear_mode).toBe('file_path');
        expect(clearedByPath.cleared_count).toBe(1);
        expect(clearedByPath.cleared_file_paths).toHaveLength(1);
      }
    });
    await then('docB session is still active', async () => {
      const stillThere = await getFileStatus(mgr, { file_path: docB });
      expect(stillThere.success).toBe(true);
    });
    await when('closeFile is called with clear_all but without confirm', async () => {
      const clearAllNoConfirm = await closeFile(mgr, { clear_all: true });
      expect(clearAllNoConfirm.success).toBe(false);
      if (!clearAllNoConfirm.success) expect(clearAllNoConfirm.error.code).toBe('CONFIRMATION_REQUIRED');
    });
    await and('closeFile with clear_all and confirm clears all sessions', async () => {
      const clearAll = await closeFile(mgr, { clear_all: true, confirm: true });
      expect(clearAll.success).toBe(true);
      if (clearAll.success) {
        expect(clearAll.clear_mode).toBe('all');
      }
    });
  });
});
