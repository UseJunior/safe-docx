import fs from 'node:fs/promises';
import { errorCode, errorMessage } from "../error_utils.js";
import path from 'node:path';
import { type Session, SessionManager } from '../session/manager.js';
import { err, type ToolResponse } from './types.js';
import { enforceReadPathPolicy } from './path_policy.js';
import { validateDocxArchiveSafety } from './docx_archive_guard.js';

const MAX_DOCX_BYTES = 50 * 1024 * 1024;

export type SessionResolutionMode =
  | 'opened_new_session'
  | 'reused_existing_session'
  | 'explicit_session';

export type ResolvedSession = {
  ok: true;
  session: Session;
  metadata: Record<string, unknown>;
};

export type SessionResolutionOutcome =
  | ResolvedSession
  | {
      ok: false;
      response: ToolResponse;
    };

// ---------------------------------------------------------------------------
// Concurrent auto-open deduplication
// ---------------------------------------------------------------------------

const pendingByManager = new WeakMap<SessionManager, Map<string, Promise<SessionResolutionOutcome>>>();

function getPendingMap(manager: SessionManager): Map<string, Promise<SessionResolutionOutcome>> {
  let map = pendingByManager.get(manager);
  if (!map) {
    map = new Map();
    pendingByManager.set(manager, map);
  }
  return map;
}

function mapSessionLookupError(message: string, sessionId: string): ToolResponse {
  if (message.startsWith('INVALID_SESSION_ID:')) {
    return err(
      'INVALID_SESSION_ID',
      message.replace(/^INVALID_SESSION_ID:/, 'Invalid session id: '),
      'Session IDs must match format: ses_[12 alphanumeric chars]',
    );
  }
  if (message.startsWith('SESSION_NOT_FOUND:')) {
    return err('SESSION_NOT_FOUND', `Session not found: ${sessionId}`);
  }
  if (message.startsWith('SESSION_EXPIRED:')) {
    return err('SESSION_EXPIRED', `Session expired: ${sessionId}`);
  }
  return err('SESSION_RESOLUTION_ERROR', `Failed to resolve session: ${message}`);
}

export async function validateAndLoadDocxFromPath(
  manager: SessionManager,
  filePath: string,
): Promise<
  | { ok: true; normalizedPath: string; filename: string; content: Buffer }
  | { ok: false; response: ToolResponse }
> {
  const normalizedPath = manager.normalizePath(filePath);
  const stat = await fs.stat(normalizedPath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return {
      ok: false,
      response: err(
        'FILE_NOT_FOUND',
        `File not found: ${filePath}`,
        'Copy the file to ~/Downloads/ or ~/Documents/ first, then pass that path.',
      ),
    };
  }
  if (path.extname(normalizedPath).toLowerCase() !== '.docx') {
    return {
      ok: false,
      response: err(
        'INVALID_FILE_TYPE',
        `Invalid file type: ${path.extname(normalizedPath)}`,
        'Only .docx files are supported.',
      ),
    };
  }
  const policy = await enforceReadPathPolicy(filePath);
  if (!policy.ok) {
    return {
      ok: false,
      response: policy.response,
    };
  }
  const safePath = policy.normalizedPath;
  const safeStat = await fs.stat(safePath).catch(() => null);
  if (!safeStat || !safeStat.isFile()) {
    return {
      ok: false,
      response: err(
        'FILE_NOT_FOUND',
        `File not found: ${filePath}`,
        'Copy the file to ~/Downloads/ or ~/Documents/ first, then pass that path.',
      ),
    };
  }
  if (safeStat.size > MAX_DOCX_BYTES) {
    return {
      ok: false,
      response: err(
        'VALIDATION_ERROR',
        'File too large',
        'Check file type (.docx only) and size (max 50MB).',
      ),
    };
  }
  const content = await fs.readFile(safePath);
  const archiveGuard = await validateDocxArchiveSafety(content as Buffer);
  if (!archiveGuard.ok) {
    return {
      ok: false,
      response: archiveGuard.response,
    };
  }
  return {
    ok: true,
    normalizedPath: safePath,
    filename: path.basename(safePath),
    content: content as Buffer,
  };
}

export function mergeSessionResolutionMetadata(
  extra: Record<string, unknown>,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return { ...extra, ...metadata };
}

export async function resolveSessionForTool(
  manager: SessionManager,
  params: { session_id?: unknown; file_path?: unknown },
  opts: { toolName: string },
): Promise<SessionResolutionOutcome> {
  const sessionId = typeof params.session_id === 'string' ? params.session_id.trim() : '';
  const filePath = typeof params.file_path === 'string' ? params.file_path.trim() : '';

  if (!sessionId && !filePath) {
    return {
      ok: false,
      response: err(
        'MISSING_SESSION_CONTEXT',
        `Tool '${opts.toolName}' requires session_id or file_path.`,
        "Provide an existing session_id, or pass file_path to auto-open/reuse an editing session.",
      ),
    };
  }

  if (sessionId) {
    let session: Session;
    try {
      session = manager.getSession(sessionId);
    } catch (e: unknown) {
      return {
        ok: false,
        response: mapSessionLookupError(errorMessage(e), sessionId),
      };
    }

    if (filePath) {
      const requestedPath = manager.normalizePath(filePath);
      const sessionPath = manager.normalizePath(session.originalPath);
      if (requestedPath !== sessionPath) {
        return {
          ok: false,
          response: err(
            'SESSION_FILE_CONFLICT',
            `session_id '${sessionId}' is bound to '${sessionPath}', but file_path resolves to '${requestedPath}'.`,
            'Use either session_id alone, or provide a file_path that matches the same session document.',
          ),
        };
      }
    }

    manager.touch(session);
    return {
      ok: true,
      session,
      metadata: {
        session_resolution: 'explicit_session' as SessionResolutionMode,
        resolved_session_id: session.sessionId,
        resolved_file_path: manager.normalizePath(session.originalPath),
      },
    };
  }

  const normalizedPath = manager.normalizePath(filePath);
  const existing = manager.getMostRecentlyUsedSessionForPath(normalizedPath);
  if (existing) {
    const reuseLastUsed = existing.lastAccessedAt.toISOString();
    manager.touch(existing);
    return {
      ok: true,
      session: existing,
      metadata: {
        session_resolution: 'reused_existing_session' as SessionResolutionMode,
        reused_existing_session: true,
        warning: `Using existing editing session ${existing.sessionId} for ${normalizedPath}.`,
        resolved_session_id: existing.sessionId,
        resolved_file_path: normalizedPath,
        reused_session_context: {
          edit_revision: existing.editRevision,
          edit_count: existing.editCount,
          created_at: existing.createdAt.toISOString(),
          last_used_at: reuseLastUsed,
        },
      },
    };
  }

  // --- Concurrent auto-open deduplication ---
  const pendingMap = getPendingMap(manager);
  const pending = pendingMap.get(normalizedPath);

  if (pending) {
    // Waiter: another request is already creating a session for this path
    const outcome = await pending;
    if (outcome.ok) {
      manager.touch(outcome.session);
      return {
        ok: true,
        session: outcome.session,
        metadata: {
          ...outcome.metadata,
          session_resolution: 'reused_existing_session' as SessionResolutionMode,
          reused_existing_session: true,
          session_resolution_detail: 'awaited_concurrent_open',
          warning: `Using existing editing session ${outcome.session.sessionId} for ${normalizedPath}.`,
          resolved_session_id: outcome.session.sessionId,
          resolved_file_path: normalizedPath,
        },
      };
    }
    // Leader failed — return the same structured error to the waiter
    return outcome;
  }

  // Leader: first concurrent request for this path
  let storedPromise!: Promise<SessionResolutionOutcome>;

  const outcomePromise: Promise<SessionResolutionOutcome> = (async () => {
    try {
      const loaded = await validateAndLoadDocxFromPath(manager, filePath);
      if (!loaded.ok) {
        return { ok: false as const, response: loaded.response };
      }

      const session = await manager.createSession(
        loaded.content,
        loaded.filename,
        loaded.normalizedPath,
      );
      await manager.finalizeNewSession(session);

      return {
        ok: true as const,
        session,
        metadata: {
          session_resolution: 'opened_new_session' as SessionResolutionMode,
          resolved_session_id: session.sessionId,
          resolved_file_path: loaded.normalizedPath,
        },
      };
    } finally {
      // Identity-guarded cleanup
      if (pendingMap.get(normalizedPath) === storedPromise) {
        pendingMap.delete(normalizedPath);
      }
    }
  })();

  storedPromise = outcomePromise;

  // Prevent unhandled rejection warnings for exceptional throws
  outcomePromise.catch(() => {});

  pendingMap.set(normalizedPath, outcomePromise);
  return await outcomePromise;
}
