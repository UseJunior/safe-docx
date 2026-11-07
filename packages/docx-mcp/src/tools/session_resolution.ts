import fs from 'node:fs/promises';
import { errorCode, errorMessage } from "../error_utils.js";
import path from 'node:path';
import {
  type DocxSession,
  type GDocsSession,
  type OdfSession,
  type Session,
  type SessionOpenGeneration,
  SessionManager,
} from '../session/manager.js';
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
// Centralized provider single-flight coordination & close-generation guard
// ---------------------------------------------------------------------------

type ProviderResolutionOutcome<TSession extends Session> =
  | { ok: true; session: TSession; metadata: Record<string, unknown> }
  | { ok: false; response: ToolResponse };

interface PendingOpenEntry<TSession extends Session = Session> {
  readonly pendingKey: string;
  readonly sessionKey: string;
  readonly generation: SessionOpenGeneration;
  readonly promise: Promise<ProviderResolutionOutcome<TSession>>;
}

interface ManagerSingleFlightState {
  readonly pendingByKey: Map<string, PendingOpenEntry<any>>;
}

const singleFlightByManager = new WeakMap<SessionManager, ManagerSingleFlightState>();

function getSingleFlightState(manager: SessionManager): ManagerSingleFlightState {
  let state = singleFlightByManager.get(manager);
  if (!state) {
    const pendingByKey = new Map<string, PendingOpenEntry<any>>();
    manager.onCloseInvalidation((closedSessionKey) => {
      if (closedSessionKey === null) {
        pendingByKey.clear();
        return;
      }
      for (const [pendingKey, entry] of pendingByKey.entries()) {
        if (entry.sessionKey === closedSessionKey) {
          pendingByKey.delete(pendingKey);
        }
      }
    });
    state = { pendingByKey };
    singleFlightByManager.set(manager, state);
  }
  return state;
}

function closedDuringOpenResponse(target: string): ToolResponse {
  return err(
    'SESSION_CLOSED',
    `Session for '${target}' was closed while opening.`,
    'Re-run the tool call to open a new session.',
  );
}

async function coordinateSingleFlightOpen<TSession extends Session>(opts: {
  manager: SessionManager;
  provider: TSession['provider'];
  sessionKey: string;
  targetLabel: string;
  waiterMetadata?: Record<string, unknown>;
  executeOpen: (generation: SessionOpenGeneration) => Promise<ProviderResolutionOutcome<TSession>>;
}): Promise<ProviderResolutionOutcome<TSession>> {
  const { manager, provider, sessionKey, targetLabel, waiterMetadata, executeOpen } = opts;
  const pendingKey = `${provider}:${sessionKey}`;
  const { pendingByKey } = getSingleFlightState(manager);

  const existing = pendingByKey.get(pendingKey) as PendingOpenEntry<TSession> | undefined;
  if (existing) {
    if (manager.isOpenGenerationValid(existing.generation)) {
      const outcome = await existing.promise;
      if (outcome.ok) {
        if (
          !manager.isOpenGenerationValid(existing.generation)
          || manager.getSessionByPath(sessionKey) !== outcome.session
        ) {
          await manager.discardInvalidatedSession(sessionKey, outcome.session);
          return { ok: false, response: closedDuringOpenResponse(targetLabel) };
        }
        manager.touch(outcome.session);
        return {
          ok: true,
          session: outcome.session,
          metadata: {
            ...outcome.metadata,
            session_resolution: 'reused' as SessionResolutionMode,
            session_resolution_detail: 'awaited_concurrent_open',
            ...(waiterMetadata ?? {}),
          },
        };
      }
      return outcome;
    }
    if (pendingByKey.get(pendingKey) === existing) {
      pendingByKey.delete(pendingKey);
    }
  }

  const generation = manager.captureOpenGeneration(sessionKey);
  let releaseStart!: () => void;
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });

  let registeredEntry!: PendingOpenEntry<TSession>;
  const outcomePromise: Promise<ProviderResolutionOutcome<TSession>> = (async () => {
    await startGate;
    try {
      if (!manager.isOpenGenerationValid(generation)) {
        return { ok: false, response: closedDuringOpenResponse(targetLabel) };
      }
      const outcome = await executeOpen(generation);
      if (outcome.ok) {
        if (
          !manager.isOpenGenerationValid(generation)
          || manager.getSessionByPath(sessionKey) !== outcome.session
        ) {
          await manager.discardInvalidatedSession(sessionKey, outcome.session);
          return { ok: false, response: closedDuringOpenResponse(targetLabel) };
        }
      }
      return outcome;
    } finally {
      if (pendingByKey.get(pendingKey) === registeredEntry) {
        pendingByKey.delete(pendingKey);
      }
    }
  })();

  // Prevent unhandled rejection warnings for exceptional throws
  outcomePromise.catch(() => {});

  // Register pending entry before releasing execution gate so synchronous/fast
  // settlement cannot run its finally cleanup before registration.
  registeredEntry = {
    pendingKey,
    sessionKey,
    generation,
    promise: outcomePromise,
  };
  pendingByKey.set(pendingKey, registeredEntry);
  releaseStart();

  return await outcomePromise;
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

  const canonicalPath = await manager.canonicalizePath(filePath);

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

  // --- Concurrent auto-open deduplication ---
  return await coordinateSingleFlightOpen<DocxSession>({
    manager,
    provider: 'docx',
    sessionKey: canonicalPath,
    targetLabel: filePath,
    waiterMetadata: { resolved_file_path: canonicalPath },
    executeOpen: async (generation) => {
      // `.odt` is already handled by the synchronous early return above, so by here
      // the path is a non-`.odt` DOCX candidate.
      const loaded = await validateAndLoadDocxFromPath(manager, filePath);
      if (!loaded.ok) {
        return { ok: false as const, response: loaded.response };
      }
      if (!manager.isOpenGenerationValid(generation)) {
        return { ok: false as const, response: closedDuringOpenResponse(filePath) };
      }

      let session: DocxSession;
      try {
        session = await manager.createSession(
          loaded.content,
          loaded.filename,
          loaded.normalizedPath,
          { openGeneration: generation },
        );
      } catch (e: unknown) {
        // A WML Strict package is refused by DocxDocument.load; return the typed
        // refusal as a structured response (waiters receive the same one).
        const refusal = conformanceRefusalResponse(e);
        if (refusal) return { ok: false as const, response: refusal };
        throw e;
      }

      if (!manager.isOpenGenerationValid(generation)) {
        await manager.discardInvalidatedSession(canonicalPath, session);
        return { ok: false as const, response: closedDuringOpenResponse(filePath) };
      }

      await manager.finalizeNewSession(session);

      if (!manager.isOpenGenerationValid(generation)) {
        await manager.discardInvalidatedSession(canonicalPath, session);
        return { ok: false as const, response: closedDuringOpenResponse(filePath) };
      }

      return {
        ok: true as const,
        session,
        metadata: {
          session_resolution: 'opened' as SessionResolutionMode,
          resolved_file_path: canonicalPath,
        },
      };
    },
  });
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

  const canonicalPath = await manager.canonicalizePath(filePath);

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

  return await coordinateSingleFlightOpen<OdfSession>({
    manager,
    provider: 'odf',
    sessionKey: canonicalPath,
    targetLabel: filePath,
    waiterMetadata: { resolved_file_path: canonicalPath },
    executeOpen: async (generation) => {
      const loaded = await validateAndLoadOdfFromPath(manager, filePath);
      if (!loaded.ok) {
        return { ok: false as const, response: loaded.response };
      }
      if (!manager.isOpenGenerationValid(generation)) {
        return { ok: false as const, response: closedDuringOpenResponse(filePath) };
      }

      const session = await manager.createOdfSession(
        loaded.content,
        loaded.filename,
        loaded.normalizedPath,
        loaded.archive,
        loaded.doc,
        { openGeneration: generation },
      );

      if (!manager.isOpenGenerationValid(generation)) {
        await manager.discardInvalidatedSession(canonicalPath, session);
        return { ok: false as const, response: closedDuringOpenResponse(filePath) };
      }

      return {
        ok: true as const,
        session,
        metadata: {
          session_resolution: 'opened' as SessionResolutionMode,
          resolved_file_path: canonicalPath,
        },
      };
    },
  });
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

  return await coordinateSingleFlightOpen<GDocsSession>({
    manager,
    provider: 'gdocs',
    sessionKey,
    targetLabel: docId,
    executeOpen: async (generation) => {
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
      await doc.injectAnchors();

      if (!manager.isOpenGenerationValid(generation)) {
        return { ok: false as const, response: closedDuringOpenResponse(docId) };
      }

      const session = manager.createGDocsSession(docId, doc, { openGeneration: generation });
      if (!manager.isOpenGenerationValid(generation)) {
        await manager.discardInvalidatedSession(sessionKey, session);
        return { ok: false as const, response: closedDuringOpenResponse(docId) };
      }

      return {
        ok: true as const,
        session,
        metadata: {
          session_resolution: 'opened' as SessionResolutionMode,
          google_doc_id: docId,
        },
      };
    },
  });
}
