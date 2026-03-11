import { describe, expect, afterEach } from 'vitest';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
import { dispatchToolCall } from './server.js';
import { SessionManager } from './session/manager.js';
import { makeMinimalDocx } from './testing/docx_test_utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Server' });

// ── Helpers ─────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function setupSessionWithFile(): Promise<{
  mgr: SessionManager;
  sessionId: string;
  filePath: string;
}> {
  const mgr = new SessionManager();
  const buf = await makeMinimalDocx(['Hello world']);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'server-test-'));
  tmpDirs.push(tmpDir);
  const filePath = path.join(tmpDir, 'test.docx');
  await fs.writeFile(filePath, new Uint8Array(buf));

  // Open the document through read_file (which creates a session)
  const result = await dispatchToolCall(mgr, 'read_file', { file_path: filePath });
  const sessionId = (result as Record<string, unknown>).session_id as string;

  return { mgr, sessionId, filePath };
}

// ── Unknown tool ────────────────────────────────────────────────────

describe('dispatchToolCall', () => {
  test('returns UNKNOWN_TOOL error for unknown tool name', async ({ given, when, then }: AllureBddContext) => {
    let mgr: SessionManager;
    let result: Awaited<ReturnType<typeof dispatchToolCall>>;

    await given('a fresh session manager', () => { mgr = new SessionManager(); });
    await when('dispatchToolCall is called with an unknown tool name', async () => {
      result = await dispatchToolCall(mgr, 'nonexistent_tool', {});
    });
    await then('it returns an UNKNOWN_TOOL error containing the tool name', () => {
      expect(result.success).toBe(false);
      const error = result.error as { code: string; message: string };
      expect(error.code).toBe('UNKNOWN_TOOL');
      expect(error.message).toContain('nonexistent_tool');
    });
  });

  // ── Known tools route correctly ────────────────────────────────

  test('routes read_file to the correct handler', async ({ given, when, then }: AllureBddContext) => {
    let mgr: SessionManager;
    let filePath: string;
    let result: Awaited<ReturnType<typeof dispatchToolCall>>;

    await given('a session with a file', async () => {
      ({ mgr, filePath } = await setupSessionWithFile());
    });
    await when('dispatchToolCall is called with read_file', async () => {
      result = await dispatchToolCall(mgr, 'read_file', { file_path: filePath });
    });
    await then('it succeeds', () => { expect(result.success).toBe(true); });
  });

  test('routes get_session_status to the correct handler', async ({ given, when, then }: AllureBddContext) => {
    let mgr: SessionManager;
    let sessionId: string;
    let result: Awaited<ReturnType<typeof dispatchToolCall>>;

    await given('an active session', async () => {
      ({ mgr, sessionId } = await setupSessionWithFile());
    });
    await when('dispatchToolCall is called with get_session_status', async () => {
      result = await dispatchToolCall(mgr, 'get_session_status', { session_id: sessionId });
    });
    await then('it succeeds', () => { expect(result.success).toBe(true); });
  });

  test('routes get_comments to the correct handler', async ({ given, when, then }: AllureBddContext) => {
    let mgr: SessionManager;
    let sessionId: string;
    let result: Awaited<ReturnType<typeof dispatchToolCall>>;

    await given('an active session', async () => {
      ({ mgr, sessionId } = await setupSessionWithFile());
    });
    await when('dispatchToolCall is called with get_comments', async () => {
      result = await dispatchToolCall(mgr, 'get_comments', { session_id: sessionId });
    });
    await then('it succeeds', () => { expect(result.success).toBe(true); });
  });

  test('routes get_footnotes to the correct handler', async ({ given, when, then }: AllureBddContext) => {
    let mgr: SessionManager;
    let sessionId: string;
    let result: Awaited<ReturnType<typeof dispatchToolCall>>;

    await given('an active session', async () => {
      ({ mgr, sessionId } = await setupSessionWithFile());
    });
    await when('dispatchToolCall is called with get_footnotes', async () => {
      result = await dispatchToolCall(mgr, 'get_footnotes', { session_id: sessionId });
    });
    await then('it succeeds', () => { expect(result.success).toBe(true); });
  });

  test('routes has_tracked_changes to the correct handler', async ({ given, when, then }: AllureBddContext) => {
    let mgr: SessionManager;
    let sessionId: string;
    let result: Awaited<ReturnType<typeof dispatchToolCall>>;

    await given('an active session', async () => {
      ({ mgr, sessionId } = await setupSessionWithFile());
    });
    await when('dispatchToolCall is called with has_tracked_changes', async () => {
      result = await dispatchToolCall(mgr, 'has_tracked_changes', { session_id: sessionId });
    });
    await then('it succeeds', () => { expect(result.success).toBe(true); });
  });

  // ── Session-based tools fail gracefully ────────────────────────

  test('returns error for session-based tool with non-existent session', async ({ given, when, then }: AllureBddContext) => {
    let mgr: SessionManager;
    let result: Awaited<ReturnType<typeof dispatchToolCall>>;

    await given('a fresh session manager', () => { mgr = new SessionManager(); });
    await when('dispatchToolCall is called with a non-existent session ID', async () => {
      result = await dispatchToolCall(mgr, 'get_session_status', { session_id: 'ses_AAAAAAAAAAAA' });
    });
    await then('it fails', () => { expect(result.success).toBe(false); });
  });

  test('returns error for session-based tool with invalid session ID format', async ({ given, when, then }: AllureBddContext) => {
    let mgr: SessionManager;
    let result: Awaited<ReturnType<typeof dispatchToolCall>>;

    await given('a fresh session manager', () => { mgr = new SessionManager(); });
    await when('dispatchToolCall is called with an invalid session ID format', async () => {
      result = await dispatchToolCall(mgr, 'get_session_status', { session_id: 'invalid' });
    });
    await then('it fails', () => { expect(result.success).toBe(false); });
  });
});
