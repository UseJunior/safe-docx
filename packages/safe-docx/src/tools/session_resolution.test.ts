import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { openDocument } from './open_document.js';
import { resolveSessionForTool, validateAndLoadDocxFromPath } from './session_resolution.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';

async function createDoc(paragraphs: string[], name = 'input.docx'): Promise<string> {
  const dir = await createTrackedTempDir('safe-docx-session-resolution-');
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, new Uint8Array(await makeMinimalDocx(paragraphs)));
  return filePath;
}

describe('session resolution helpers', () => {
  registerCleanup();

  it('validates loading errors for missing file, invalid type, and oversized docx', async () => {
    const mgr = createTestSessionManager();
    const missing = await validateAndLoadDocxFromPath(mgr, '/definitely/missing/file.docx');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.response.error.code).toBe('FILE_NOT_FOUND');

    const dir = await createTrackedTempDir('safe-docx-session-resolution-');
    const txtPath = path.join(dir, 'bad.txt');
    await fs.writeFile(txtPath, 'not a docx');
    const invalidType = await validateAndLoadDocxFromPath(mgr, txtPath);
    expect(invalidType.ok).toBe(false);
    if (!invalidType.ok) expect(invalidType.response.error.code).toBe('INVALID_FILE_TYPE');

    const largePath = path.join(dir, 'large.docx');
    const fd = await fs.open(largePath, 'w');
    await fd.truncate(51 * 1024 * 1024);
    await fd.close();
    const tooLarge = await validateAndLoadDocxFromPath(mgr, largePath);
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) expect(tooLarge.response.error.code).toBe('VALIDATION_ERROR');
  });

  it('handles open/reuse/explicit/conflict session resolution modes', async () => {
    const mgr = createTestSessionManager();
    const docPath = await createDoc(['Alpha']);

    const missingContext = await resolveSessionForTool(mgr, {}, { toolName: 'read_file' });
    expect(missingContext.ok).toBe(false);
    if (!missingContext.ok) expect(missingContext.response.error.code).toBe('MISSING_SESSION_CONTEXT');

    const opened = await resolveSessionForTool(mgr, { file_path: docPath }, { toolName: 'read_file' });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.metadata.session_resolution).toBe('opened_new_session');

    const reused = await resolveSessionForTool(mgr, { file_path: docPath }, { toolName: 'read_file' });
    expect(reused.ok).toBe(true);
    if (!reused.ok) return;
    expect(reused.metadata.session_resolution).toBe('reused_existing_session');
    expect(reused.metadata.reused_existing_session).toBe(true);
    expect(typeof reused.metadata.warning).toBe('string');

    const explicit = await resolveSessionForTool(
      mgr,
      { session_id: opened.session.sessionId },
      { toolName: 'read_file' }
    );
    expect(explicit.ok).toBe(true);
    if (explicit.ok) expect(explicit.metadata.session_resolution).toBe('explicit_session');

    const otherPath = await createDoc(['Beta'], 'other.docx');
    const conflict = await resolveSessionForTool(
      mgr,
      { session_id: opened.session.sessionId, file_path: otherPath },
      { toolName: 'read_file' }
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.response.error.code).toBe('SESSION_FILE_CONFLICT');
  });

  it('maps explicit invalid session IDs and expired/not-found sessions', async () => {
    const mgr = createTestSessionManager({ ttlMs: 5 });
    const docPath = await createDoc(['Expirable']);
    const opened = await openDocument(mgr, { file_path: docPath });
    expect(opened.success).toBe(true);
    if (!opened.success) return;

    const invalid = await resolveSessionForTool(
      mgr,
      { session_id: 'bad-id' },
      { toolName: 'grep' }
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.response.error.code).toBe('INVALID_SESSION_ID');

    // Force expiry path.
    await new Promise((r) => setTimeout(r, 15));
    const expired = await resolveSessionForTool(
      mgr,
      { session_id: String(opened.session_id) },
      { toolName: 'grep' }
    );
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(['SESSION_EXPIRED', 'SESSION_NOT_FOUND']).toContain(expired.response.error.code);
  });
});
