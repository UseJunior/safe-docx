import { describe, expect, afterEach } from 'vitest';
import { itAllure as it } from './testing/allure-test.js';
import { dispatchToolCall } from './server.js';
import { SessionManager } from './session/manager.js';
import { makeMinimalDocx } from './testing/docx_test_utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

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
  it('returns UNKNOWN_TOOL error for unknown tool name', async () => {
    const mgr = new SessionManager();
    const result = await dispatchToolCall(mgr, 'nonexistent_tool', {});

    expect(result.success).toBe(false);
    const error = result.error as { code: string; message: string };
    expect(error.code).toBe('UNKNOWN_TOOL');
    expect(error.message).toContain('nonexistent_tool');
  });

  // ── Known tools route correctly ────────────────────────────────

  it('routes read_file to the correct handler', async () => {
    const { mgr, filePath } = await setupSessionWithFile();

    const result = await dispatchToolCall(mgr, 'read_file', { file_path: filePath });
    expect(result.success).toBe(true);
  });

  it('routes get_session_status to the correct handler', async () => {
    const { mgr, sessionId } = await setupSessionWithFile();

    const result = await dispatchToolCall(mgr, 'get_session_status', {
      session_id: sessionId,
    });
    expect(result.success).toBe(true);
  });

  it('routes get_comments to the correct handler', async () => {
    const { mgr, sessionId } = await setupSessionWithFile();

    const result = await dispatchToolCall(mgr, 'get_comments', {
      session_id: sessionId,
    });
    expect(result.success).toBe(true);
  });

  it('routes get_footnotes to the correct handler', async () => {
    const { mgr, sessionId } = await setupSessionWithFile();

    const result = await dispatchToolCall(mgr, 'get_footnotes', {
      session_id: sessionId,
    });
    expect(result.success).toBe(true);
  });

  it('routes has_tracked_changes to the correct handler', async () => {
    const { mgr, sessionId } = await setupSessionWithFile();

    const result = await dispatchToolCall(mgr, 'has_tracked_changes', {
      session_id: sessionId,
    });
    expect(result.success).toBe(true);
  });

  // ── Session-based tools fail gracefully ────────────────────────

  it('returns error for session-based tool with non-existent session', async () => {
    const mgr = new SessionManager();

    const result = await dispatchToolCall(mgr, 'get_session_status', {
      session_id: 'ses_AAAAAAAAAAAA',
    });
    expect(result.success).toBe(false);
  });

  it('returns error for session-based tool with invalid session ID format', async () => {
    const mgr = new SessionManager();

    const result = await dispatchToolCall(mgr, 'get_session_status', {
      session_id: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});
