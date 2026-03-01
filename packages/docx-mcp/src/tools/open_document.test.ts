import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import { openDocument } from './open_document.js';
import {
  assertSuccess,
  assertFailure,
  registerCleanup,
  createTestSessionManager,
  createTrackedTempDir,
} from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('open_document', () => {
  registerCleanup();

  it('opens a valid .docx file successfully', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('open-test-');
    const buf = await makeMinimalDocx(['Hello World']);
    const filePath = path.join(tmpDir, 'test.docx');
    await fs.writeFile(filePath, new Uint8Array(buf));

    const result = await openDocument(mgr, { file_path: filePath });
    assertSuccess(result, 'open_document');

    expect(result.session_id).toMatch(/^ses_[A-Za-z0-9]{12}$/);
    expect((result.document as Record<string, unknown>).filename).toBe('test.docx');
    expect((result.document as Record<string, unknown>).paragraphs).toBeGreaterThan(0);
  });

  it('returns session_id and expiration info', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('open-test-');
    const buf = await makeMinimalDocx(['Test content']);
    const filePath = path.join(tmpDir, 'doc.docx');
    await fs.writeFile(filePath, new Uint8Array(buf));

    const result = await openDocument(mgr, { file_path: filePath });
    assertSuccess(result, 'open_document');

    expect(result.session_id).toBeTruthy();
    expect(result.expires_at).toBeTruthy();
  });

  it('rejects non-.docx file with INVALID_FILE_TYPE', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('open-test-');
    const filePath = path.join(tmpDir, 'test.txt');
    await fs.writeFile(filePath, 'not a docx');

    const result = await openDocument(mgr, { file_path: filePath });
    assertFailure(result, 'INVALID_FILE_TYPE', 'non-docx file');
  });

  it('rejects non-existent path with FILE_NOT_FOUND', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('open-test-');
    const filePath = path.join(tmpDir, 'nonexistent.docx');

    const result = await openDocument(mgr, { file_path: filePath });
    assertFailure(result, 'FILE_NOT_FOUND', 'missing file');
  });

  it('creates separate sessions for same file opened twice', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('open-test-');
    const buf = await makeMinimalDocx(['Hello']);
    const filePath = path.join(tmpDir, 'shared.docx');
    await fs.writeFile(filePath, new Uint8Array(buf));

    const r1 = await openDocument(mgr, { file_path: filePath });
    assertSuccess(r1, 'first open');

    const r2 = await openDocument(mgr, { file_path: filePath });
    assertSuccess(r2, 'second open');

    expect(r1.session_id).not.toBe(r2.session_id);
  });

  it('includes normalization stats when normalization is not skipped', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('open-test-');
    const buf = await makeMinimalDocx(['Hello World']);
    const filePath = path.join(tmpDir, 'test.docx');
    await fs.writeFile(filePath, new Uint8Array(buf));

    const result = await openDocument(mgr, { file_path: filePath });
    assertSuccess(result, 'open_document');

    const norm = result.normalization as Record<string, unknown>;
    expect(norm.normalization_skipped).toBe(false);
    expect(typeof norm.runs_merged).toBe('number');
  });

  it('skips normalization when skip_normalization is true', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('open-test-');
    const buf = await makeMinimalDocx(['Hello World']);
    const filePath = path.join(tmpDir, 'test.docx');
    await fs.writeFile(filePath, new Uint8Array(buf));

    const result = await openDocument(mgr, {
      file_path: filePath,
      skip_normalization: true,
    });
    assertSuccess(result, 'open_document');

    const norm = result.normalization as Record<string, unknown>;
    expect(norm.normalization_skipped).toBe(true);
  });

  it('includes tools schema in response', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('open-test-');
    const buf = await makeMinimalDocx(['Hello']);
    const filePath = path.join(tmpDir, 'test.docx');
    await fs.writeFile(filePath, new Uint8Array(buf));

    const result = await openDocument(mgr, { file_path: filePath });
    assertSuccess(result, 'open_document');

    const tools = result.tools as Array<{ name: string }>;
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((t) => t.name === 'read_file')).toBe(true);
  });

  it('rejects directory path with FILE_NOT_FOUND', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('open-test-');

    // tmpDir itself is a directory, not a file
    const result = await openDocument(mgr, { file_path: tmpDir });
    assertFailure(result, 'FILE_NOT_FOUND', 'directory path');
  });
});
