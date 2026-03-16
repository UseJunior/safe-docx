import { describe, expect } from 'vitest';
import { testAllure as test, type AllureBddContext } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { closeFile } from '../tools/close_file.js';
import { openDocument } from '../tools/open_document.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';
import { type DocxSession } from './manager.js';

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

  test('close_file by file_path removes tmp artifacts for that session', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let inputPath: string;
    let sessionTmpDir: string;
    let cleared: Awaited<ReturnType<typeof closeFile>>;

    await given('a session with a minimal document open and tmp directory present', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-session-cleanup-single-');
      inputPath = path.join(tmpDir, 'input.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['cleanup single'])));

      const opened = await openDocument(mgr, { file_path: inputPath });
      expect(opened.success).toBe(true);
      if (!opened.success) return;
      const canonicalPath = await mgr.canonicalizePath(inputPath);
      const session = mgr.getSessionByPath(canonicalPath);
      expect(session).not.toBeNull();
      sessionTmpDir = path.dirname((session as DocxSession).tmpPath);
      expect(await pathExists(sessionTmpDir)).toBe(true);
    });

    await when('close_file is called with that file_path', async () => {
      cleared = await closeFile(mgr, { file_path: inputPath });
    });

    await then('the session is removed and cleared_count is 1', () => {
      expect(cleared.success).toBe(true);
      if (!cleared.success) return;
      expect(cleared.cleared_count).toBe(1);
    });
    await and('the tmp directory no longer exists and the session is gone', async () => {
      expect(await pathExists(sessionTmpDir)).toBe(false);
      const canonicalPath = await mgr.canonicalizePath(inputPath);
      expect(mgr.getSessionByPath(canonicalPath)).toBeNull();
    });
  });

  test('clear_all with confirm removes tmp artifacts for all active sessions', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionATmpDir: string;
    let sessionBTmpDir: string;
    let cleared: Awaited<ReturnType<typeof closeFile>>;

    await given('two open sessions with distinct tmp directories', async () => {
      mgr = createTestSessionManager();
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

      const canonA = await mgr.canonicalizePath(inputA);
      const canonB = await mgr.canonicalizePath(inputB);
      const sessionA = mgr.getSessionByPath(canonA);
      const sessionB = mgr.getSessionByPath(canonB);
      expect(sessionA).not.toBeNull();
      expect(sessionB).not.toBeNull();
      sessionATmpDir = path.dirname((sessionA as DocxSession).tmpPath);
      sessionBTmpDir = path.dirname((sessionB as DocxSession).tmpPath);
      expect(await pathExists(sessionATmpDir)).toBe(true);
      expect(await pathExists(sessionBTmpDir)).toBe(true);
    });

    await when('clear_all without confirm is rejected, then clear_all with confirm succeeds', async () => {
      const clearAttempt = await closeFile(mgr, { clear_all: true });
      expect(clearAttempt.success).toBe(false);

      cleared = await closeFile(mgr, { clear_all: true, confirm: true });
    });

    await then('all sessions are cleared and cleared_count >= 2', () => {
      expect(cleared.success).toBe(true);
      if (!cleared.success) return;
      expect(cleared.cleared_count).toBeGreaterThanOrEqual(2);
    });
    await and('both session tmp directories are removed', async () => {
      expect(await pathExists(sessionATmpDir)).toBe(false);
      expect(await pathExists(sessionBTmpDir)).toBe(false);
    });
  });
});
