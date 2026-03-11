import { describe, expect } from 'vitest';
import { testAllure as test, type AllureBddContext } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { openDocument } from './open_document.js';
import { save } from './save.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';

describe.sequential('path policy: symlink and root bounds', () => {
  registerCleanup();

  test('read/write paths are constrained to allowed roots and symlink escapes are blocked', async ({ given, when, then, and }: AllureBddContext) => {
    if (process.platform === 'win32') {
      // Symlink creation on Windows often requires extra privileges in CI/developer mode.
      return;
    }

    let allowedRoot: string;
    let outsideRoot: string;
    let previousRoots: string | undefined;
    let mgr: ReturnType<typeof createTestSessionManager>;
    let goodDocPath: string;
    let outsideDocPath: string;
    let allowedOpen: Awaited<ReturnType<typeof openDocument>>;
    let disallowedWrite: Awaited<ReturnType<typeof save>>;
    let blockedOpen: Awaited<ReturnType<typeof openDocument>>;

    await given('an allowed root and an outside root with one document each, and SAFE_DOCX_ALLOWED_ROOTS restricted to the allowed root', async () => {
      previousRoots = process.env.SAFE_DOCX_ALLOWED_ROOTS;
      allowedRoot = await createTrackedTempDir('safe-docx-path-policy-allowed-root-');
      outsideRoot = await createTrackedTempDir('safe-docx-path-policy-outside-root-');
      process.env.SAFE_DOCX_ALLOWED_ROOTS = allowedRoot;

      mgr = createTestSessionManager();
      goodDocPath = path.join(allowedRoot, 'good.docx');
      outsideDocPath = path.join(outsideRoot, 'outside.docx');
      await fs.writeFile(goodDocPath, new Uint8Array(await makeMinimalDocx(['Allowed path content'])));
      await fs.writeFile(outsideDocPath, new Uint8Array(await makeMinimalDocx(['Outside path content'])));
    });

    try {
      await when('a document inside the allowed root is opened, a write outside the root is attempted, and a symlink escaping the root is opened', async () => {
        allowedOpen = await openDocument(mgr, { file_path: goodDocPath });
        expect(allowedOpen.success).toBe(true);
        if (!allowedOpen.success) return;

        disallowedWrite = await save(mgr, {
          session_id: String(allowedOpen.session_id),
          save_to_local_path: path.join(outsideRoot, 'should-block.docx'),
          save_format: 'clean',
          clean_bookmarks: true,
        });

        const symlinkPath = path.join(allowedRoot, 'outside-link.docx');
        await fs.symlink(outsideDocPath, symlinkPath);
        blockedOpen = await openDocument(mgr, { file_path: symlinkPath });
      });

      await then('the document in the allowed root opens successfully', () => {
        expect(allowedOpen.success).toBe(true);
      });
      await and('the write outside the allowed root is rejected with PATH_NOT_ALLOWED', () => {
        expect(disallowedWrite.success).toBe(false);
        if (!disallowedWrite.success) {
          expect(disallowedWrite.error.code).toBe('PATH_NOT_ALLOWED');
        }
      });
      await and('the symlink pointing outside the allowed root is blocked with PATH_NOT_ALLOWED', () => {
        expect(blockedOpen.success).toBe(false);
        if (!blockedOpen.success) {
          expect(blockedOpen.error.code).toBe('PATH_NOT_ALLOWED');
        }
      });
    } finally {
      if (previousRoots === undefined) delete process.env.SAFE_DOCX_ALLOWED_ROOTS;
      else process.env.SAFE_DOCX_ALLOWED_ROOTS = previousRoots;
    }
  });
});
