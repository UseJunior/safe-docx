import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { openDocument } from './open_document.js';
import { clearSession } from './clear_session.js';
import { getSessionStatus } from './get_session_status.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Session Management' });

async function createDoc(paragraphs: string[], name: string): Promise<string> {
  const dir = await createTrackedTempDir('safe-docx-clear-session-');
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, new Uint8Array(await makeMinimalDocx(paragraphs)));
  return filePath;
}

describe('clear_session tool', () => {
  registerCleanup();

  test('rejects invalid target combinations and missing targets', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let missing: Awaited<ReturnType<typeof clearSession>>;
    let invalidAll: Awaited<ReturnType<typeof clearSession>>;

    await given('a fresh session manager', () => { mgr = createTestSessionManager(); });
    await when('clearSession is called with no target', async () => {
      missing = await clearSession(mgr, {});
    });
    await then('it fails with INVALID_CLEAR_TARGET', () => {
      expect(missing.success).toBe(false);
      if (!missing.success) expect(missing.error.code).toBe('INVALID_CLEAR_TARGET');
    });
    await when('clearSession is called with both clear_all and session_id', async () => {
      invalidAll = await clearSession(mgr, {
        clear_all: true,
        confirm: true,
        session_id: 'ses_abcdefghijkl',
      });
    });
    await and('it fails with INVALID_CLEAR_TARGET', () => {
      expect(invalidAll.success).toBe(false);
      if (!invalidAll.success) expect(invalidAll.error.code).toBe('INVALID_CLEAR_TARGET');
    });
  });

  test('maps invalid/not-found session_id errors', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let invalidId: Awaited<ReturnType<typeof clearSession>>;
    let missingSession: Awaited<ReturnType<typeof clearSession>>;

    await given('a fresh session manager', () => { mgr = createTestSessionManager(); });
    await when('clearSession is called with a malformed session ID', async () => {
      invalidId = await clearSession(mgr, { session_id: 'bad-id' });
    });
    await then('it fails with INVALID_SESSION_ID', () => {
      expect(invalidId.success).toBe(false);
      if (!invalidId.success) expect(invalidId.error.code).toBe('INVALID_SESSION_ID');
    });
    await when('clearSession is called with a valid-format but non-existent session ID', async () => {
      missingSession = await clearSession(mgr, { session_id: 'ses_aaaaaaaaaaaa' });
    });
    await and('it fails with SESSION_NOT_FOUND', () => {
      expect(missingSession.success).toBe(false);
      if (!missingSession.success) expect(missingSession.error.code).toBe('SESSION_NOT_FOUND');
    });
  });

  test('clears sessions by file_path and via clear_all', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let docA: string;
    let docB: string;
    let a1: Awaited<ReturnType<typeof openDocument>>;
    let a2: Awaited<ReturnType<typeof openDocument>>;
    let b1: Awaited<ReturnType<typeof openDocument>>;

    await given('two documents each opened in sessions', async () => {
      mgr = createTestSessionManager();
      docA = await createDoc(['Alpha'], 'a.docx');
      docB = await createDoc(['Beta'], 'b.docx');

      a1 = await openDocument(mgr, { file_path: docA });
      a2 = await openDocument(mgr, { file_path: docA });
      b1 = await openDocument(mgr, { file_path: docB });
      expect(a1.success && a2.success && b1.success).toBe(true);
      if (!a1.success || !a2.success || !b1.success) return;
    });
    await when('clearSession is called by file_path for docA', async () => {
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
    });
    await then('docB session is still active', async () => {
      if (!b1.success) return;
      const stillThere = await getSessionStatus(mgr, { session_id: String(b1.session_id) });
      expect(stillThere.success).toBe(true);
    });
    await when('clearSession is called with clear_all but without confirm', async () => {
      const clearAllNoConfirm = await clearSession(mgr, { clear_all: true });
      expect(clearAllNoConfirm.success).toBe(false);
      if (!clearAllNoConfirm.success) expect(clearAllNoConfirm.error.code).toBe('CONFIRMATION_REQUIRED');
    });
    await and('clearSession with clear_all and confirm clears all sessions', async () => {
      if (!b1.success) return;
      const clearAll = await clearSession(mgr, { clear_all: true, confirm: true });
      expect(clearAll.success).toBe(true);
      if (clearAll.success) {
        expect(clearAll.clear_mode).toBe('all');
        expect(clearAll.cleared_session_ids).toContain(String(b1.session_id));
      }
    });
  });
});
