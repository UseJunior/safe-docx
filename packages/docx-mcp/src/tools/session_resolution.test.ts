import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { openDocument } from './open_document.js';
import { resolveSessionForTool, validateAndLoadDocxFromPath } from './session_resolution.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Session Resolution' });

async function createDoc(paragraphs: string[], name = 'input.docx'): Promise<string> {
  const dir = await createTrackedTempDir('safe-docx-session-resolution-');
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, new Uint8Array(await makeMinimalDocx(paragraphs)));
  return filePath;
}

function getErrorCode(value: { response?: unknown }): string | undefined {
  const payload = value.response as { error?: { code?: string } } | undefined;
  return payload?.error?.code;
}

describe('session resolution helpers', () => {
  registerCleanup();

  test('validates loading errors for missing file, invalid type, and oversized docx', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let missing: Awaited<ReturnType<typeof validateAndLoadDocxFromPath>>;
    let invalidType: Awaited<ReturnType<typeof validateAndLoadDocxFromPath>>;
    let tooLarge: Awaited<ReturnType<typeof validateAndLoadDocxFromPath>>;
    let dir: string;

    await given('a session manager and a temp directory', async () => {
      mgr = createTestSessionManager();
      dir = await createTrackedTempDir('safe-docx-session-resolution-');
    });
    await when('validateAndLoadDocxFromPath is called with a missing file', async () => {
      missing = await validateAndLoadDocxFromPath(mgr, '/definitely/missing/file.docx');
    });
    await then('it fails with FILE_NOT_FOUND', () => {
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(getErrorCode(missing)).toBe('FILE_NOT_FOUND');
    });
    await when('validateAndLoadDocxFromPath is called with a .txt file', async () => {
      const txtPath = path.join(dir, 'bad.txt');
      await fs.writeFile(txtPath, 'not a docx');
      invalidType = await validateAndLoadDocxFromPath(mgr, txtPath);
    });
    await and('it fails with INVALID_FILE_TYPE', () => {
      expect(invalidType.ok).toBe(false);
      if (!invalidType.ok) expect(getErrorCode(invalidType)).toBe('INVALID_FILE_TYPE');
    });
    await when('validateAndLoadDocxFromPath is called with an oversized file', async () => {
      const largePath = path.join(dir, 'large.docx');
      const fd = await fs.open(largePath, 'w');
      await fd.truncate(51 * 1024 * 1024);
      await fd.close();
      tooLarge = await validateAndLoadDocxFromPath(mgr, largePath);
    });
    await and('it fails with VALIDATION_ERROR', () => {
      expect(tooLarge.ok).toBe(false);
      if (!tooLarge.ok) expect(getErrorCode(tooLarge)).toBe('VALIDATION_ERROR');
    });
  });

  test('handles open/reuse session resolution modes', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let docPath: string;
    let opened: Awaited<ReturnType<typeof resolveSessionForTool>>;
    let reused: Awaited<ReturnType<typeof resolveSessionForTool>>;

    await given('a session manager and a document', async () => {
      mgr = createTestSessionManager();
      docPath = await createDoc(['Alpha']);
    });
    await when('resolveSessionForTool is called with no context', async () => {
      const missingContext = await resolveSessionForTool(mgr, {}, { toolName: 'read_file' });
      expect(missingContext.ok).toBe(false);
      if (!missingContext.ok) expect(getErrorCode(missingContext)).toBe('MISSING_FILE_PATH');
    });
    await when('resolveSessionForTool is called with a file_path for the first time', async () => {
      opened = await resolveSessionForTool(mgr, { file_path: docPath }, { toolName: 'read_file' });
    });
    await then('it opens a new session', () => {
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(opened.metadata.session_resolution).toBe('opened');
    });
    await when('resolveSessionForTool is called again with the same file_path', async () => {
      reused = await resolveSessionForTool(mgr, { file_path: docPath }, { toolName: 'read_file' });
    });
    await and('it reuses the existing session', () => {
      expect(reused.ok).toBe(true);
      if (!reused.ok) return;
      expect(reused.metadata.session_resolution).toBe('reused');
    });
  });
});
