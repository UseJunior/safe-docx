import fs from 'node:fs/promises';
import { errorCode, errorMessage } from "../error_utils.js";
import path from 'node:path';
import { type DocxSession, type GDocsSession, type OdfSession, type Session, type SessionOpenTicket, SessionClosedDuringOpenError, SessionManager } from '../session/manager.js';
import { err, type ToolResponse } from './types.js';
import { enforceReadPathPolicy } from './path_policy.js';
import { validateDocxArchiveSafety } from './docx_archive_guard.js';
import { loadGDocsCore } from '../gdocs_loader.js';
import { loadOdfCore } from '../odf_loader.js';
import { conformanceRefusalResponse } from './conformance_refusal.js';

const MAX_DOCX_BYTES = 50 * 1024 * 1024;

export type SessionResolutionMode =
  | 'opened'
  | 'reused';

export type ResolvedSession = {
  ok: true;
  session: DocxSession;
  metadata: Record<string, unknown>;
};

export type SessionResolutionOutcome =
  | ResolvedSession
  | {
      ok: false;
      response: ToolResponse;
    };

export type GDocsSessionResolutionOutcome =
  | { ok: true; session: GDocsSession; metadata: Record<string, unknown> }
  | { ok: false; response: ToolResponse };

export type OdfSessionResolutionOutcome =
  | { ok: true; session: OdfSession; metadata: Record<string, unknown> }
  | { ok: false; response: ToolResponse };

// ---------------------------------------------------------------------------
// Concurrent auto-open deduplication
// ---------------------------------------------------------------------------

type ProviderOutcome<T extends Session> =
  | { ok: true; session: T; metadata: Record<string, unknown> }
  | { ok: false; response: ToolResponse };

function closedDuringOpen(): ToolResponse {
  return err('SESSION_CLOSED', 'Session was closed while opening.', 'Re-run the tool to open a new session.');
}

async function coordinateProviderOpen<T extends Session>(
  manager: SessionManager,
  sessionKey: string,
  provider: T['provider'],
  execute: (ticket: SessionOpenTicket) => Promise<ProviderOutcome<T>>,
  suppliedTicket?: SessionOpenTicket,
): Promise<ProviderOutcome<T>> {
  const { outcome, shared } = await manager.coordinateSessionOpen(sessionKey, async (ticket) => {
    try {
      const result = await execute(ticket);
      if (ticket.cancelled) {
        if (result.ok) await manager.discardOpeningSession(result.session);
        return { ok: false as const, response: closedDuringOpen() };
      }
      return result;
    } catch (error) {
      if (ticket.cancelled || error instanceof SessionClosedDuringOpenError) {
        return { ok: false as const, response: closedDuringOpen() };
      }
      throw error;
    }
  }, provider, suppliedTicket);
  if (!outcome.ok) return outcome;
  if (manager.getSessionByPath(sessionKey) !== outcome.session) {
    return { ok: false, response: closedDuringOpen() };
  }
  if (!shared) return outcome;
  manager.touch(outcome.session);
  return {
    ...outcome,
    metadata: {
      ...outcome.metadata,
      session_resolution: 'reused' as SessionResolutionMode,
      session_resolution_detail: 'awaited_concurrent_open',
    },
  };
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

export async function validateAndLoadOdfFromPath(
  manager: SessionManager,
  filePath: string,
): Promise<
  | { ok: true; normalizedPath: string; filename: string; content: Buffer; archive: any; doc: any }
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
  if (path.extname(normalizedPath).toLowerCase() !== '.odt') {
    return {
      ok: false,
      response: err(
        'INVALID_FILE_TYPE',
        `Invalid file type: ${path.extname(normalizedPath)}`,
        'Only .odt files are supported by the ODF provider.',
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
        'Check file type (.odt only) and size (max 50MB).',
      ),
    };
  }
  const odf = await loadOdfCore();
  if (!odf) {
    return {
      ok: false,
      response: err(
        'MISSING_DEPENDENCY',
        'ODF (.odt) support requires @usejunior/odf-core.',
        'Install @usejunior/odf-core to enable ODF editing.',
      ),
    };
  }
  const content = await fs.readFile(safePath);
  const archiveGuard = await odf.validateOdfArchiveSafety(content as Buffer);
  if (!archiveGuard.ok) {
    return {
      ok: false,
      response: err(archiveGuard.code, archiveGuard.message, archiveGuard.hint),
    };
  }
  const archive = await odf.OdfArchive.load(content as Buffer);
  const doc = odf.OdfDocument.fromContentXml(await archive.getContentXml());
  return {
    ok: true,
    normalizedPath: safePath,
    filename: path.basename(safePath),
    content: content as Buffer,
    archive,
    doc,
  };
}

export function mergeSessionResolutionMetadata(
  extra: Record<string, unknown>,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return { ...extra, ...metadata };
}

/**
 * Check if file has been modified externally since the session was opened.
 */
async function checkStaleness(
  session: Session,
  canonicalPath: string,
): Promise<string | undefined> {
  try {
    const stat = await fs.stat(canonicalPath);
    if (stat.mtime > session.createdAt) {
      return `File was modified externally at ${stat.mtime.toISOString()} (session opened at ${session.createdAt.toISOString()}). Consider closing and reopening the file.`;
    }
  } catch {
    // File may have been deleted — we'll let downstream tool handle that
  }
  return undefined;
}

export async function resolveSessionForTool(
  manager: SessionManager,
  params: { file_path?: unknown },
  opts: { toolName: string },
): Promise<SessionResolutionOutcome> {
  const filePath = typeof params.file_path === 'string' ? params.file_path.trim() : '';

  if (!filePath) {
    return {
      ok: false,
      response: err(
        'MISSING_FILE_PATH',
        `Tool '${opts.toolName}' requires file_path.`,
        "Provide the path to a .docx file in ~/Downloads/ or ~/Documents/.",
      ),
    };
  }

  const ticket = await manager.captureOpenTicketForPath(filePath);
  try {
    if (ticket.cancelled) return { ok: false, response: closedDuringOpen() };
    const canonicalPath = ticket.sessionKey;

    // Check for existing session. ODF is path-keyed too, but this resolver must remain DOCX-only.
    const existingSession = manager.getSessionByPath(canonicalPath);
    if (existingSession && existingSession.provider !== 'docx') {
      return {
        ok: false,
        response: err(
          'UNSUPPORTED_FOR_ODF',
          `Tool '${opts.toolName}' is not supported for ODF (.odt) files.`,
          'Use read_file, replace_text, grep, insert_paragraph, add_comment, get_comments, compare_documents, save, get_file_status, or close_file for .odt files.',
        ),
      };
    }
    const existing = existingSession as DocxSession | null;
    if (existing) {
      const reuseLastUsed = existing.lastAccessedAt.toISOString();
      manager.touch(existing);
      const staleWarning = await checkStaleness(existing, canonicalPath);
      return {
        ok: true,
        session: existing,
        metadata: {
          session_resolution: 'reused' as SessionResolutionMode,
          resolved_file_path: canonicalPath,
          ...(staleWarning ? { stale_warning: staleWarning } : {}),
          reused_session_context: {
            edit_revision: existing.editRevision,
            edit_count: existing.editCount,
            created_at: existing.createdAt.toISOString(),
            last_used_at: reuseLastUsed,
          },
        },
      };
    }

    // Fail fast for unsupported tools on a `.odt` path BEFORE touching the pending map.
    // This must be a synchronous early return: registering it as a leader promise would
    // resolve before `pendingMap.set` runs, leaving a stale entry that replays THIS tool's
    // error (and tool name) for the next unsupported tool on the same path.
    if (path.extname(manager.normalizePath(filePath)).toLowerCase() === '.odt') {
      return {
        ok: false,
        response: err(
          'UNSUPPORTED_FOR_ODF',
          `Tool '${opts.toolName}' is not supported for ODF (.odt) files.`,
          'Use read_file, replace_text, grep, insert_paragraph, add_comment, get_comments, compare_documents, save, get_file_status, or close_file for .odt files.',
        ),
      };
    }

    return await coordinateProviderOpen<DocxSession>(manager, canonicalPath, 'docx', async (ticket) => {
      // `.odt` is already handled by the synchronous early return above, so by here
      // the path is a non-`.odt` DOCX candidate.
      const loaded = await validateAndLoadDocxFromPath(manager, filePath);
      if (!loaded.ok) {
        return { ok: false as const, response: loaded.response };
      }

      let session: DocxSession;
      try {
        session = await manager.createSession(
          loaded.content,
          loaded.filename,
          loaded.normalizedPath,
          { openTicket: ticket },
        );
      } catch (e: unknown) {
        // A WML Strict package is refused by DocxDocument.load; return the typed
        // refusal as a structured response (waiters receive the same one).
        const refusal = conformanceRefusalResponse(e);
        if (refusal) return { ok: false as const, response: refusal };
        throw e;
      }
      await manager.finalizeNewSession(session);

      return {
        ok: true as const,
        session,
        metadata: {
          session_resolution: 'opened' as SessionResolutionMode,
          resolved_file_path: canonicalPath,
        },
      };
    }, ticket);
  } finally {
    manager.releaseOpenTicket(ticket);
  }
}

// ---------------------------------------------------------------------------
// ODF session resolution
// ---------------------------------------------------------------------------

export async function resolveOdfSessionForTool(
  manager: SessionManager,
  params: { file_path?: unknown },
  opts: { toolName: string },
): Promise<OdfSessionResolutionOutcome> {
  const filePath = typeof params.file_path === 'string' ? params.file_path.trim() : '';

  if (!filePath) {
    return {
      ok: false,
      response: err(
        'MISSING_FILE_PATH',
        `Tool '${opts.toolName}' requires file_path.`,
        "Provide the path to a .odt file in ~/Downloads/ or ~/Documents/.",
      ),
    };
  }

  const ticket = await manager.captureOpenTicketForPath(filePath);
  try {
    if (ticket.cancelled) return { ok: false, response: closedDuringOpen() };
    const canonicalPath = ticket.sessionKey;

    const existing = manager.getSessionByPath(canonicalPath);
    if (existing && existing.provider === 'odf') {
      const reuseLastUsed = existing.lastAccessedAt.toISOString();
      manager.touch(existing);
      const staleWarning = await checkStaleness(existing, canonicalPath);
      return {
        ok: true,
        session: existing,
        metadata: {
          session_resolution: 'reused' as SessionResolutionMode,
          resolved_file_path: canonicalPath,
          ...(staleWarning ? { stale_warning: staleWarning } : {}),
          reused_session_context: {
            edit_revision: existing.editRevision,
            edit_count: existing.editCount,
            created_at: existing.createdAt.toISOString(),
            last_used_at: reuseLastUsed,
          },
        },
      };
    }

    if (existing) {
      return {
        ok: false,
        response: err(
          'INVALID_FILE_TYPE',
          `Existing session for ${filePath} is provider '${existing.provider}', not ODF.`,
          'Use the matching provider arguments for the active session.',
        ),
      };
    }

    return await coordinateProviderOpen<OdfSession>(manager, canonicalPath, 'odf', async (ticket) => {
      const loaded = await validateAndLoadOdfFromPath(manager, filePath);
      if (!loaded.ok) {
        return { ok: false as const, response: loaded.response };
      }

      const session = await manager.createOdfSession(
        loaded.content,
        loaded.filename,
        loaded.normalizedPath,
        loaded.archive,
        loaded.doc,
        { openTicket: ticket },
      );

      return {
        ok: true as const,
        session,
        metadata: {
          session_resolution: 'opened' as SessionResolutionMode,
          resolved_file_path: canonicalPath,
        },
      };
    }, ticket);
  } finally {
    manager.releaseOpenTicket(ticket);
  }
}

// ---------------------------------------------------------------------------
// Google Docs session resolution
// ---------------------------------------------------------------------------

function extractGoogleDocId(input: string): string {
  const urlMatch = input.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1]!;
  return input.trim();
}

export async function resolveGDocsSessionForTool(
  manager: SessionManager,
  params: { google_doc_id?: unknown },
  opts: { toolName: string },
): Promise<GDocsSessionResolutionOutcome> {
  const rawId = typeof params.google_doc_id === 'string' ? params.google_doc_id.trim() : '';
  if (!rawId) {
    return {
      ok: false,
      response: err('MISSING_GOOGLE_DOC_ID', `Tool '${opts.toolName}' requires google_doc_id.`, 'Provide a Google Doc ID or URL.'),
    };
  }

  const docId = extractGoogleDocId(rawId);
  const sessionKey = `gdocs:${docId}`;

  // Check existing session
  const existing = manager.getSessionByPath(sessionKey);
  if (existing && existing.provider === 'gdocs') {
    manager.touch(existing);
    return {
      ok: true,
      session: existing as GDocsSession,
      metadata: {
        session_resolution: 'reused' as SessionResolutionMode,
        google_doc_id: docId,
        reused_session_context: {
          edit_revision: existing.editRevision,
          edit_count: existing.editCount,
          created_at: existing.createdAt.toISOString(),
          last_used_at: existing.lastAccessedAt.toISOString(),
        },
      },
    };
  }

  return coordinateProviderOpen<GDocsSession>(manager, sessionKey, 'gdocs', async (ticket) => {
    const gdocsCore = await loadGDocsCore();
    if (!gdocsCore) {
      return {
        ok: false as const,
        response: err(
          'MISSING_DEPENDENCY',
          'Google Docs support requires @usejunior/google-docs-core.',
          'Run: npm install @usejunior/google-docs-core',
        ),
      };
    }

    const doc = await gdocsCore.GoogleDocsDocument.load(docId);
    if (ticket.cancelled) return { ok: false, response: closedDuringOpen() };
    await doc.injectAnchors();

    const session = manager.createGDocsSession(docId, doc, { openTicket: ticket });

    return {
      ok: true as const,
      session,
      metadata: {
        session_resolution: 'opened' as SessionResolutionMode,
        google_doc_id: docId,
      },
    };
  });
}
