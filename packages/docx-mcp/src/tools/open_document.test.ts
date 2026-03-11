import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
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

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Open Document' });

describe('open_document', () => {
  registerCleanup();

  test('opens a valid .docx file successfully', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let filePath: string;
    let result: Awaited<ReturnType<typeof openDocument>>;

    await given('a valid .docx file', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('open-test-');
      const buf = await makeMinimalDocx(['Hello World']);
      filePath = path.join(tmpDir, 'test.docx');
      await fs.writeFile(filePath, new Uint8Array(buf));
    });
    await when('openDocument is called', async () => {
      result = await openDocument(mgr, { file_path: filePath });
    });
    await then('it succeeds with a valid session_id', () => {
      assertSuccess(result, 'open_document');
      expect(result.session_id).toMatch(/^ses_[A-Za-z0-9]{12}$/);
    });
    await and('the document info contains the filename and paragraph count', () => {
      expect((result.document as Record<string, unknown>).filename).toBe('test.docx');
      expect((result.document as Record<string, unknown>).paragraphs).toBeGreaterThan(0);
    });
  });

  test('returns session_id and expiration info', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let filePath: string;
    let result: Awaited<ReturnType<typeof openDocument>>;

    await given('a valid .docx file', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('open-test-');
      const buf = await makeMinimalDocx(['Test content']);
      filePath = path.join(tmpDir, 'doc.docx');
      await fs.writeFile(filePath, new Uint8Array(buf));
    });
    await when('openDocument is called', async () => {
      result = await openDocument(mgr, { file_path: filePath });
    });
    await then('the response includes session_id and expires_at', () => {
      assertSuccess(result, 'open_document');
      expect(result.session_id).toBeTruthy();
      expect(result.expires_at).toBeTruthy();
    });
  });

  test('rejects non-.docx file with INVALID_FILE_TYPE', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let filePath: string;
    let result: Awaited<ReturnType<typeof openDocument>>;

    await given('a .txt file', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('open-test-');
      filePath = path.join(tmpDir, 'test.txt');
      await fs.writeFile(filePath, 'not a docx');
    });
    await when('openDocument is called', async () => {
      result = await openDocument(mgr, { file_path: filePath });
    });
    await then('it fails with INVALID_FILE_TYPE', () => { assertFailure(result, 'INVALID_FILE_TYPE', 'non-docx file'); });
  });

  test('rejects non-existent path with FILE_NOT_FOUND', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let filePath: string;
    let result: Awaited<ReturnType<typeof openDocument>>;

    await given('a path to a non-existent file', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('open-test-');
      filePath = path.join(tmpDir, 'nonexistent.docx');
    });
    await when('openDocument is called', async () => {
      result = await openDocument(mgr, { file_path: filePath });
    });
    await then('it fails with FILE_NOT_FOUND', () => { assertFailure(result, 'FILE_NOT_FOUND', 'missing file'); });
  });

  test('creates separate sessions for same file opened twice', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let filePath: string;
    let r1: Awaited<ReturnType<typeof openDocument>>;
    let r2: Awaited<ReturnType<typeof openDocument>>;

    await given('the same .docx file', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('open-test-');
      const buf = await makeMinimalDocx(['Hello']);
      filePath = path.join(tmpDir, 'shared.docx');
      await fs.writeFile(filePath, new Uint8Array(buf));
    });
    await when('openDocument is called twice', async () => {
      r1 = await openDocument(mgr, { file_path: filePath });
      r2 = await openDocument(mgr, { file_path: filePath });
    });
    await then('two distinct session IDs are returned', () => {
      assertSuccess(r1, 'first open');
      assertSuccess(r2, 'second open');
      expect(r1.session_id).not.toBe(r2.session_id);
    });
  });

  test('includes normalization stats when normalization is not skipped', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let filePath: string;
    let result: Awaited<ReturnType<typeof openDocument>>;

    await given('a valid .docx file', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('open-test-');
      const buf = await makeMinimalDocx(['Hello World']);
      filePath = path.join(tmpDir, 'test.docx');
      await fs.writeFile(filePath, new Uint8Array(buf));
    });
    await when('openDocument is called without skip_normalization', async () => {
      result = await openDocument(mgr, { file_path: filePath });
    });
    await then('the response includes normalization stats with normalization_skipped=false', () => {
      assertSuccess(result, 'open_document');
      const norm = result.normalization as Record<string, unknown>;
      expect(norm.normalization_skipped).toBe(false);
      expect(typeof norm.runs_merged).toBe('number');
    });
  });

  test('skips normalization when skip_normalization is true', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let filePath: string;
    let result: Awaited<ReturnType<typeof openDocument>>;

    await given('a valid .docx file', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('open-test-');
      const buf = await makeMinimalDocx(['Hello World']);
      filePath = path.join(tmpDir, 'test.docx');
      await fs.writeFile(filePath, new Uint8Array(buf));
    });
    await when('openDocument is called with skip_normalization=true', async () => {
      result = await openDocument(mgr, { file_path: filePath, skip_normalization: true });
    });
    await then('normalization_skipped is true in the response', () => {
      assertSuccess(result, 'open_document');
      const norm = result.normalization as Record<string, unknown>;
      expect(norm.normalization_skipped).toBe(true);
    });
  });

  test('includes tools schema in response', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let filePath: string;
    let result: Awaited<ReturnType<typeof openDocument>>;

    await given('a valid .docx file', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('open-test-');
      const buf = await makeMinimalDocx(['Hello']);
      filePath = path.join(tmpDir, 'test.docx');
      await fs.writeFile(filePath, new Uint8Array(buf));
    });
    await when('openDocument is called', async () => {
      result = await openDocument(mgr, { file_path: filePath });
    });
    await then('the response includes a tools array containing read_file', () => {
      assertSuccess(result, 'open_document');
      const tools = result.tools as Array<{ name: string }>;
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.name === 'read_file')).toBe(true);
    });
  });

  test('rejects directory path with FILE_NOT_FOUND', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let tmpDir: string;
    let result: Awaited<ReturnType<typeof openDocument>>;

    await given('a path pointing to a directory', async () => {
      mgr = createTestSessionManager();
      tmpDir = await createTrackedTempDir('open-test-');
    });
    await when('openDocument is called with the directory path', async () => {
      // tmpDir itself is a directory, not a file
      result = await openDocument(mgr, { file_path: tmpDir });
    });
    await then('it fails with FILE_NOT_FOUND', () => { assertFailure(result, 'FILE_NOT_FOUND', 'directory path'); });
  });
});
