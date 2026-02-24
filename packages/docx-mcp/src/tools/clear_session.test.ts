import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { openDocument } from './open_document.js';
import { clearSession } from './clear_session.js';
import { getSessionStatus } from './get_session_status.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';

async function createDoc(paragraphs: string[], name: string): Promise<string> {
  const dir = await createTrackedTempDir('safe-docx-clear-session-');
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, new Uint8Array(await makeMinimalDocx(paragraphs)));
  return filePath;
}

describe('clear_session tool', () => {
  registerCleanup();

  it('rejects invalid target combinations and missing targets', async () => {
    const mgr = createTestSessionManager();

    const missing = await clearSession(mgr, {});
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.code).toBe('INVALID_CLEAR_TARGET');

    const invalidAll = await clearSession(mgr, {
      clear_all: true,
      confirm: true,
      session_id: 'ses_abcdefghijkl',
    });
    expect(invalidAll.success).toBe(false);
    if (!invalidAll.success) expect(invalidAll.error.code).toBe('INVALID_CLEAR_TARGET');
  });

  it('maps invalid/not-found session_id errors', async () => {
    const mgr = createTestSessionManager();

    const invalidId = await clearSession(mgr, { session_id: 'bad-id' });
    expect(invalidId.success).toBe(false);
    if (!invalidId.success) expect(invalidId.error.code).toBe('INVALID_SESSION_ID');

    const missing = await clearSession(mgr, { session_id: 'ses_aaaaaaaaaaaa' });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('clears sessions by file_path and via clear_all', async () => {
    const mgr = createTestSessionManager();
    const docA = await createDoc(['Alpha'], 'a.docx');
    const docB = await createDoc(['Beta'], 'b.docx');

    const a1 = await openDocument(mgr, { file_path: docA });
    const a2 = await openDocument(mgr, { file_path: docA });
    const b1 = await openDocument(mgr, { file_path: docB });
    expect(a1.success && a2.success && b1.success).toBe(true);
    if (!a1.success || !a2.success || !b1.success) return;

    const clearedByPath = await clearSession(mgr, { file_path: docA });
    expect(clearedByPath.success).toBe(true);
    if (clearedByPath.success) {
      expect(clearedByPath.clear_mode).toBe('file_path');
      expect(clearedByPath.cleared_count).toBe(2);
      const clearedIds = (clearedByPath.cleared_session_ids as string[]).slice().sort();
      expect(clearedIds).toEqual(
        [String(a1.session_id), String(a2.session_id)].sort()
      );
    }

    const stillThere = await getSessionStatus(mgr, { session_id: String(b1.session_id) });
    expect(stillThere.success).toBe(true);

    const clearAllNoConfirm = await clearSession(mgr, { clear_all: true });
    expect(clearAllNoConfirm.success).toBe(false);
    if (!clearAllNoConfirm.success) expect(clearAllNoConfirm.error.code).toBe('CONFIRMATION_REQUIRED');

    const clearAll = await clearSession(mgr, { clear_all: true, confirm: true });
    expect(clearAll.success).toBe(true);
    if (clearAll.success) {
      expect(clearAll.clear_mode).toBe('all');
      expect(clearAll.cleared_session_ids).toContain(String(b1.session_id));
    }
  });
});
