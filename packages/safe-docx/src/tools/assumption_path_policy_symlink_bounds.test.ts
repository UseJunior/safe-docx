import { describe, expect } from 'vitest';
import { testAllure as test } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { openDocument } from './open_document.js';
import { download } from './download.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';

describe.sequential('assumption: path/symlink policy bounds (A20)', () => {
  registerCleanup();

  test('read/write paths are constrained to allowed roots and symlink escapes are blocked', async () => {
    if (process.platform === 'win32') {
      // Symlink creation on Windows often requires extra privileges in CI/developer mode.
      return;
    }

    const previousRoots = process.env.SAFE_DOCX_ALLOWED_ROOTS;
    const allowedRoot = await createTrackedTempDir('safe-docx-assumption-allowed-root-');
    const outsideRoot = await createTrackedTempDir('safe-docx-assumption-outside-root-');
    process.env.SAFE_DOCX_ALLOWED_ROOTS = allowedRoot;

    try {
      const mgr = createTestSessionManager();
      const goodDocPath = path.join(allowedRoot, 'good.docx');
      const outsideDocPath = path.join(outsideRoot, 'outside.docx');
      await fs.writeFile(goodDocPath, new Uint8Array(await makeMinimalDocx(['Allowed path content'])));
      await fs.writeFile(outsideDocPath, new Uint8Array(await makeMinimalDocx(['Outside path content'])));

      const allowedOpen = await openDocument(mgr, { file_path: goodDocPath });
      expect(allowedOpen.success).toBe(true);
      if (!allowedOpen.success) return;

      const disallowedWrite = await download(mgr, {
        session_id: String(allowedOpen.session_id),
        save_to_local_path: path.join(outsideRoot, 'should-block.docx'),
        download_format: 'clean',
        clean_bookmarks: true,
      });
      expect(disallowedWrite.success).toBe(false);
      if (!disallowedWrite.success) {
        expect(disallowedWrite.error.code).toBe('PATH_NOT_ALLOWED');
      }

      const symlinkPath = path.join(allowedRoot, 'outside-link.docx');
      await fs.symlink(outsideDocPath, symlinkPath);
      const blockedOpen = await openDocument(mgr, { file_path: symlinkPath });
      expect(blockedOpen.success).toBe(false);
      if (!blockedOpen.success) {
        expect(blockedOpen.error.code).toBe('PATH_NOT_ALLOWED');
      }
    } finally {
      if (previousRoots === undefined) delete process.env.SAFE_DOCX_ALLOWED_ROOTS;
      else process.env.SAFE_DOCX_ALLOWED_ROOTS = previousRoots;
    }
  });
});
