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

  test('handles open/reuse/explicit/conflict session resolution modes', async ({ given, when, then, and }: AllureBddContext) => {
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
      if (!missingContext.ok) expect(getErrorCode(missingContext)).toBe('MISSING_SESSION_CONTEXT');
    });
    await when('resolveSessionForTool is called with a file_path for the first time', async () => {
      opened = await resolveSessionForTool(mgr, { file_path: docPath }, { toolName: 'read_file' });
    });
    await then('it opens a new session', () => {
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(opened.metadata.session_resolution).toBe('opened_new_session');
    });
    await when('resolveSessionForTool is called again with the same file_path', async () => {
      reused = await resolveSessionForTool(mgr, { file_path: docPath }, { toolName: 'read_file' });
    });
    await and('it reuses the existing session with a warning', () => {
      expect(reused.ok).toBe(true);
      if (!reused.ok) return;
      expect(reused.metadata.session_resolution).toBe('reused_existing_session');
      expect(reused.metadata.reused_existing_session).toBe(true);
      expect(typeof reused.metadata.warning).toBe('string');
    });
    await when('resolveSessionForTool is called with an explicit session_id', async () => {
      if (!opened.ok) return;
      const explicit = await resolveSessionForTool(
        mgr,
        { session_id: opened.session.sessionId },
        { toolName: 'read_file' }
      );
      expect(explicit.ok).toBe(true);
      if (explicit.ok) expect(explicit.metadata.session_resolution).toBe('explicit_session');
    });
    await and('it fails with SESSION_FILE_CONFLICT when session_id and a different file_path are both provided', async () => {
      if (!opened.ok) return;
      const otherPath = await createDoc(['Beta'], 'other.docx');
      const conflict = await resolveSessionForTool(
        mgr,
        { session_id: opened.session.sessionId, file_path: otherPath },
        { toolName: 'read_file' }
      );
      expect(conflict.ok).toBe(false);
      if (!conflict.ok) expect(getErrorCode(conflict)).toBe('SESSION_FILE_CONFLICT');
    });
  });

  test('maps explicit invalid session IDs and expired/not-found sessions', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let docPath: string;
    let openedDoc: Awaited<ReturnType<typeof openDocument>>;

    await given('a session manager with a very short TTL and an opened document', async () => {
      mgr = createTestSessionManager({ ttlMs: 5 });
      docPath = await createDoc(['Expirable']);
      openedDoc = await openDocument(mgr, { file_path: docPath });
      expect(openedDoc.success).toBe(true);
      if (!openedDoc.success) return;
    });
    await when('resolveSessionForTool is called with a malformed session ID', async () => {
      const invalid = await resolveSessionForTool(
        mgr,
        { session_id: 'bad-id' },
        { toolName: 'grep' }
      );
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(getErrorCode(invalid)).toBe('INVALID_SESSION_ID');
    });
    await then('after the session expires, it fails with SESSION_EXPIRED or SESSION_NOT_FOUND', async () => {
      if (!openedDoc.success) return;
      // Force expiry path.
      await new Promise((r) => setTimeout(r, 15));
      const expired = await resolveSessionForTool(
        mgr,
        { session_id: String(openedDoc.session_id) },
        { toolName: 'grep' }
      );
      expect(expired.ok).toBe(false);
      if (!expired.ok) expect(['SESSION_EXPIRED', 'SESSION_NOT_FOUND']).toContain(getErrorCode(expired));
    });
  });
});
