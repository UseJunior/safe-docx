import { describe, expect } from 'vitest';
import { testAllure as test } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { clearSession } from '../tools/clear_session.js';
import { openDocument } from '../tools/open_document.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';

async function pathExists(inputPath: string): Promise<boolean> {
  try {
    await fs.stat(inputPath);
    return true;
  } catch {
    return false;
  }
}

describe('session lifecycle: cleanup bounds', () => {
  registerCleanup();

  test('clear_session by session_id removes tmp artifacts for that session', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('safe-docx-session-cleanup-single-');
    const inputPath = path.join(tmpDir, 'input.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['cleanup single'])));

    const opened = await openDocument(mgr, { file_path: inputPath });
    expect(opened.success).toBe(true);
    if (!opened.success) return;
    const sessionId = String(opened.session_id);
    const session = mgr.getSession(sessionId);
    const sessionTmpDir = path.dirname(session.tmpPath);
    expect(await pathExists(sessionTmpDir)).toBe(true);

    const cleared = await clearSession(mgr, { session_id: sessionId });
    expect(cleared.success).toBe(true);
    if (!cleared.success) return;
    expect(cleared.cleared_count).toBe(1);
    expect(await pathExists(sessionTmpDir)).toBe(false);
    expect(() => mgr.getSession(sessionId)).toThrowError();
  });

  test('clear_all with confirm removes tmp artifacts for all active sessions', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('safe-docx-session-cleanup-all-');
    const inputA = path.join(tmpDir, 'a.docx');
    const inputB = path.join(tmpDir, 'b.docx');
    await fs.writeFile(inputA, new Uint8Array(await makeMinimalDocx(['cleanup A'])));
    await fs.writeFile(inputB, new Uint8Array(await makeMinimalDocx(['cleanup B'])));

    const openA = await openDocument(mgr, { file_path: inputA });
    const openB = await openDocument(mgr, { file_path: inputB });
    expect(openA.success).toBe(true);
    expect(openB.success).toBe(true);
    if (!openA.success || !openB.success) return;

    const sessionA = mgr.getSession(String(openA.session_id));
    const sessionB = mgr.getSession(String(openB.session_id));
    const sessionATmpDir = path.dirname(sessionA.tmpPath);
    const sessionBTmpDir = path.dirname(sessionB.tmpPath);
    expect(await pathExists(sessionATmpDir)).toBe(true);
    expect(await pathExists(sessionBTmpDir)).toBe(true);

    const clearAttempt = await clearSession(mgr, { clear_all: true });
    expect(clearAttempt.success).toBe(false);

    const cleared = await clearSession(mgr, { clear_all: true, confirm: true });
    expect(cleared.success).toBe(true);
    if (!cleared.success) return;
    expect(cleared.cleared_count).toBeGreaterThanOrEqual(2);
    expect(await pathExists(sessionATmpDir)).toBe(false);
    expect(await pathExists(sessionBTmpDir)).toBe(false);
  });
});
