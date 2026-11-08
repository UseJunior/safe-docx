import { randomInt } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { err, type ToolResponse } from '../tools/types.js';
import {
  DocxDocument,
  createRevisionContext,
  RevisionIdAllocator,
  inferStartingRevisionIdState,
  getSidePartRevisionSeedDocs,
  type NormalizationResult,
  type ParagraphRevision,
  type RevisionContext,
  type RevisionIdState,
} from '@usejunior/docx-core';
// NOTE: @usejunior/odf-core is an OPTIONAL provider (private/unpublished, like
// @usejunior/google-docs-core) and is intentionally NOT imported here. A static
// import in this always-loaded module would make a production install of the
// published package — which never fetches the private odf-core — crash at load.
// The ODF archive/document are loaded by the lazily-reached resolver/open path
// (see odf_loader.ts) and injected into createOdfSession; this module stores and
// operates on them structurally (typed `any`, mirroring GDocsSession.doc).

export type SaveFormat = 'clean' | 'tracked' | 'both';

export type TrackedChangesStats = {
  insertions: number;
  deletions: number;
  modifications: number;
};

export type SaveCacheEntry = {
  cacheKey: string;
  revision: number;
  format: SaveFormat;
  cleanBookmarks: boolean;
  trackedAuthor: string;
  revisedBuffer: Buffer;
  trackedBuffer: Buffer | null;
  trackedStats: TrackedChangesStats | null;
  bookmarksRemoved: number;
  blocksRestored: number;
  exportedAtUtc: string;
  cachedAtIso: string;
};

export type ExtractionCacheEntry = {
  revision: number;
  changes: ParagraphRevision[];
};

export type SelectiveRevisionAction = {
  tool: 'accept_ai_edits' | 'reject_ai_edits';
  selector: 'revision_ids' | 'author';
  selectedRevisionIds: string[];
  editRevision: number;
};

/**
 * A package-level (non-revision) mutation recorded during a session.
 *
 * Per #122, AI-attributed writes in the *revisionable* surface must land as
 * native OOXML tracked-change markup. Writes in the *package-mutation* surface
 * (side-story parts, relationships, content types — things OOXML has no native
 * revision wrapper for) cannot be tracked, so instead of being emitted silently
 * they are recorded here and surfaced in the save report. This keeps the
 * "every AI mutation is accounted for" invariant honest even where the mutation
 * is not, and cannot be, a tracked change.
 *
 * @see packages/docx-core/SUPPORT.md (Table B) for the ratified classification.
 */
export type NonRevisionChange = {
  /** MCP tool that produced the change (e.g. `add_comment`). */
  tool: string;
  /** Session edit revision at which the change was recorded. */
  editRevision: number;
  /** Package parts mutated without tracked-change markup. */
  parts: string[];
  /** Human-readable summary of what was mutated and why it is untracked. */
  description: string;
};

export type DocxSession = {
  provider: 'docx';
  sessionId: string;
  filename: string;
  tmpPath: string;
  originalPath: string;
  originalBuffer: Buffer;
  /**
   * Post-normalization + bookmark-cleaned buffer used as comparison baseline for tracked output.
   * Comparing against this instead of originalBuffer prevents normalization artifacts from
   * appearing as false tracked changes. Lazily generated on first save/compare via ensureBaselines().
   */
  comparisonBaseline: Buffer | null;
  /**
   * Post-normalization buffer WITH bookmarks, used as comparison baseline for
   * compare_documents tool (which uses cleanBookmarks: false).
   * Lazily generated on first save/compare via ensureBaselines().
   */
  comparisonBaselineWithBookmarks: Buffer | null;
  doc: DocxDocument;
  aiAuthor: string | null;
  revisionIdState: RevisionIdState | null;
  editCount: number;
  editRevision: number;
  saveCache: Map<string, SaveCacheEntry>;
  extractionCache: ExtractionCacheEntry | null;
  /**
   * Non-revision (package-mutation) changes recorded this session, in order.
   * Surfaced in the save report so package-level mutations that have no native
   * OOXML revision wrapper are still accounted for (#122).
   */
  nonRevisionManifest: NonRevisionChange[];
  /**
   * Most recent selective revision disposition in this in-memory session.
   * A later clean save uses this marker to prevent automatically accepting
   * remaining revisions that the caller deliberately left unresolved.
   */
  selectiveRevisionAction: SelectiveRevisionAction | null;
  createdAt: Date;
  lastAccessedAt: Date;
  expiresAt: Date;
  normalizationStats: NormalizationResult | null;
};

export type GDocsSession = {
  provider: 'gdocs';
  sessionId: string;
  docId: string;
  doc: any; // GoogleDocsDocument — typed via dynamic import in handlers
  editCount: number;
  editRevision: number;
  createdAt: Date;
  lastAccessedAt: Date;
  expiresAt: Date;
};

export type OdfSession = {
  provider: 'odf';
  sessionId: string;
  filename: string;
  tmpPath: string;
  originalPath: string;
  originalBuffer: Buffer;
  archive: any; // OdfArchive — loaded via the optional odf-core provider (see note above)
  doc: any; // OdfDocument — loaded via the optional odf-core provider
  editCount: number;
  editRevision: number;
  createdAt: Date;
  lastAccessedAt: Date;
  expiresAt: Date;
};

export type Session = DocxSession | GDocsSession | OdfSession;

function normalizeAiAuthor(author: string | null | undefined): string | null {
  if (typeof author !== 'string') return null;
  const trimmed = author.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Preserve the existing internal import path while moving the scan to core.
export { inferStartingRevisionIdState, getSidePartRevisionSeedDocs };

// Controllers stay outside cloneable session data. A candidate receives an
// explicit fork, never a shallow copy of readiness or its in-flight promise.
const revisionIdAllocators = new WeakMap<DocxSession, RevisionIdAllocator>();

function revisionAllocator(session: DocxSession): RevisionIdAllocator {
  let allocator = revisionIdAllocators.get(session);
  if (!allocator) {
    allocator = new RevisionIdAllocator(
      async () => inferStartingRevisionIdState(...await session.doc.getRevisionSeedDocuments()),
      session.revisionIdState ?? undefined,
    );
    revisionIdAllocators.set(session, allocator);
  }
  return allocator;
}

export async function getRevisionContextForSession(
  session: DocxSession,
  template?: RevisionContext,
): Promise<RevisionContext | undefined> {
  if (!session.aiAuthor && !template) return undefined;
  const state = await revisionAllocator(session).ensureReady();
  // Internal batch contexts may supply a higher caller-owned starting point.
  // They never replace the managed state or introduce a controller into it.
  if (!session.revisionIdState && template) state.nextId = Math.max(state.nextId, template.idState.nextId);
  session.revisionIdState = state;

  return createRevisionContext({
    author: template?.author ?? session.aiAuthor!,
    date: template?.date ?? new Date(),
    idState: state,
  });
}

export function isDocxSession(s: Session): s is DocxSession {
  return s.provider === 'docx';
}

export function isGDocsSession(s: Session): s is GDocsSession {
  return s.provider === 'gdocs';
}

export function isOdfSession(s: Session): s is OdfSession {
  return s.provider === 'odf';
}

/** A unique opening ticket; a close permanently cancels it, including across reopen. */
export interface SessionOpenTicket {
  readonly sessionKey: string;
  cancelled: boolean;
}

export class SessionClosedDuringOpenError extends Error {
  constructor() {
    super('Session was closed while opening. Re-run the tool to open a new session.');
    this.name = 'SessionClosedDuringOpenError';
  }
}

export class SessionManager {
  private mutationQueues = new WeakMap<Session, Promise<void>>();

  /**
   * Serialize local mutations on unpublished candidates. No await separates
   * generation validation from publication of the document and its bookkeeping.
   * The active session continues owning its identity and temporary resources.
   */
  async mutateSession<S extends DocxSession | OdfSession>(
    active: S,
    execute: (candidate: S) => Promise<ToolResponse>,
  ): Promise<ToolResponse> {
    return this.serializeMutation(active, async () => {
      if (!this.isActiveSession(active)) return err('SESSION_CLOSED', 'Session was closed or replaced during mutation.');
      const candidate = { ...active, doc: active.doc.fork() } as S;
      if (isDocxSession(active) && isDocxSession(candidate)) {
        candidate.saveCache = new Map(active.saveCache);
        candidate.nonRevisionManifest = structuredClone(active.nonRevisionManifest);
        candidate.selectiveRevisionAction = structuredClone(active.selectiveRevisionAction);
        const allocator = revisionAllocator(active).fork();
        revisionIdAllocators.set(candidate, allocator);
        candidate.revisionIdState = allocator.readyState;
      } else if (isOdfSession(active) && isOdfSession(candidate)) {
        candidate.archive = active.archive.fork();
      }
      const before = await this.mutationContents(candidate);
      const response = await execute(candidate);
      if (!response.success) return response;
      const after = await this.mutationContents(candidate);
      if (!this.isActiveSession(active)) return err('SESSION_CLOSED', 'Session was closed or replaced during mutation.');
      if (!before.equals(after)) {
        if (isDocxSession(active) && isDocxSession(candidate)) {
          const allocator = revisionAllocator(active);
          if (!allocator.publish(revisionAllocator(candidate))) {
            return err('REVISION_ID_CONFLICT', 'Revision IDs advanced during mutation. Retry the edit.');
          }
          // Publishing advances the existing object so outstanding direct
          // contexts cannot issue IDs already published by this mutation.
          if (candidate.revisionIdState) active.revisionIdState = allocator.readyState;
        }
        // Direct-DOM handlers must invalidate the candidate's view too.
        if (isDocxSession(candidate)) candidate.doc.markMutated();
        active.doc = candidate.doc;
        active.editCount += 1;
        active.editRevision += 1;
        if (isDocxSession(active) && isDocxSession(candidate)) {
          active.nonRevisionManifest = candidate.nonRevisionManifest;
          active.selectiveRevisionAction = candidate.selectiveRevisionAction;
          active.saveCache.clear();
          active.extractionCache = null;
        } else if (isOdfSession(active) && isOdfSession(candidate)) {
          active.archive = candidate.archive;
        }
      } else if ('persistence_required' in response) {
        response.persistence_required = false;
        response.selected_revision_ids = [];
        delete response.next_step;
      }
      if ('edit_count' in response) response.edit_count = active.editCount;
      return response;
    });
  }

  private async mutationContents(session: DocxSession | OdfSession): Promise<Buffer> {
    if (isDocxSession(session)) {
      // Ignore ZIP timestamps. No-op detection includes every package part,
      // rather than trusting selected revision IDs or handler edit counters.
      return session.doc.getMutationSnapshot();
    }
    // ODF handlers mutate content.xml; the archive is staged separately.
    return Buffer.from(session.doc.toXml());
  }

  private isActiveSession(session: Session): boolean {
    return [...this.sessions.values()].includes(session) && session.expiresAt.getTime() >= Date.now();
  }

  private async serializeMutation<T>(session: Session, execute: () => Promise<T>): Promise<T> {
    const preceding = this.mutationQueues.get(session) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>(resolve => { release = resolve; });
    this.mutationQueues.set(session, tail);
    await preceding;
    try {
      return await execute();
    } finally {
      release();
      if (this.mutationQueues.get(session) === tail) this.mutationQueues.delete(session);
    }
  }

  /** Remote writes cannot be rolled back by discarding a local snapshot. */
  async mutateRemoteSession(active: GDocsSession, execute: (candidate: GDocsSession) => Promise<ToolResponse>): Promise<ToolResponse> {
    return this.serializeMutation(active, async () => {
      if (!this.isActiveSession(active)) return err('SESSION_CLOSED', 'Session was closed or replaced during mutation.');
      const candidate = { ...active };
      const before = active.doc.getConfirmedWriteVersion();
      try {
        const response = await execute(candidate);
        return response;
      } finally {
        // Record confirmed remote success even when refresh or response shaping
        // fails, or the session retires while the request is in flight. Never
        // publish this old state into a replacement session.
        if (active.doc.getConfirmedWriteVersion() !== before) this.markEdited(active);
      }
    });
  }
  /** Sessions keyed by canonical file path (realpath). */
  private sessions = new Map<string, Session>();
  private ttlMs: number;
  private defaultAiAuthor: string | null;

  /** Concurrency guard: prevents double-generation of baselines for the same session. */
  private baselinePromises = new WeakMap<DocxSession, Promise<void>>();
  private finalized = new WeakMap<DocxSession, { normalizationStats: NormalizationResult | null; paragraphCount: number }>();
  /** Retain failed removals for a later clearAllSessions retry, without retaining documents. */
  private pendingArtifactDirectories = new Set<string>();
  private artifactCleanupPromises = new Map<string, Promise<void>>();
  private openingTickets = new Map<string, Set<SessionOpenTicket>>();
  private resolvingOpens = new Set<{ closedKeys: Set<string>; cancelled: boolean }>();
  private pendingOpens = new Map<string, { sessionKey: string; promise: Promise<unknown> }>();

  captureOpenTicket(sessionKey: string): SessionOpenTicket {
    const ticket = { sessionKey, cancelled: false };
    let tickets = this.openingTickets.get(sessionKey);
    if (!tickets) this.openingTickets.set(sessionKey, tickets = new Set());
    tickets.add(ticket);
    return ticket;
  }

  /** Keep close events only while a local opener is resolving its canonical key. */
  async captureOpenTicketForPath(filePath: string): Promise<SessionOpenTicket> {
    const resolving = { closedKeys: new Set<string>(), cancelled: false };
    this.resolvingOpens.add(resolving);
    try {
      const key = await this.canonicalizePath(filePath);
      const ticket = this.captureOpenTicket(key);
      ticket.cancelled = resolving.cancelled || resolving.closedKeys.has(key);
      return ticket;
    } finally {
      this.resolvingOpens.delete(resolving);
    }
  }

  releaseOpenTicket(ticket: SessionOpenTicket): void {
    const tickets = this.openingTickets.get(ticket.sessionKey);
    tickets?.delete(ticket);
    if (tickets?.size === 0) this.openingTickets.delete(ticket.sessionKey);
  }

  private invalidateOpening(sessionKey: string): void {
    for (const resolving of this.resolvingOpens) resolving.closedKeys.add(sessionKey);
    for (const ticket of this.openingTickets.get(sessionKey) ?? []) ticket.cancelled = true;
    this.openingTickets.delete(sessionKey);
    for (const [key, entry] of this.pendingOpens) {
      if (entry.sessionKey === sessionKey) this.pendingOpens.delete(key);
    }
  }

  private assertOpenTicket(ticket: SessionOpenTicket): void {
    if (ticket.cancelled) throw new SessionClosedDuringOpenError();
  }

  private async withOpenTicket<T>(
    filePath: string,
    supplied: SessionOpenTicket | undefined,
    execute: (ticket: SessionOpenTicket) => Promise<T>,
  ): Promise<T> {
    const ticket = supplied ?? await this.captureOpenTicketForPath(filePath);
    try {
      this.assertOpenTicket(ticket);
      return await execute(ticket);
    } finally {
      if (!supplied) this.releaseOpenTicket(ticket);
    }
  }

  /** Register before execution, and let only the same promise remove its slot. */
  async coordinateSessionOpen<T>(
    sessionKey: string,
    execute: (ticket: SessionOpenTicket) => Promise<T>,
    provider: Session['provider'] = 'docx',
    suppliedTicket?: SessionOpenTicket,
  ): Promise<{ outcome: T; shared: boolean }> {
    const pendingKey = `${provider}:${sessionKey}`;
    const pending = this.pendingOpens.get(pendingKey);
    if (pending) return { outcome: await pending.promise as T, shared: true };
    const ticket = suppliedTicket ?? this.captureOpenTicket(sessionKey);
    const promise = Promise.resolve().then(() => execute(ticket)).finally(() => {
      if (!suppliedTicket) this.releaseOpenTicket(ticket);
      if (this.pendingOpens.get(pendingKey)?.promise === promise) this.pendingOpens.delete(pendingKey);
    });
    this.pendingOpens.set(pendingKey, { sessionKey, promise });
    return { outcome: await promise, shared: false };
  }

  async discardOpeningSession(session: Session): Promise<void> {
    // A late candidate must never remove a newer session for the same path.
    for (const [key, active] of this.sessions) {
      if (active === session) this.sessions.delete(key);
    }
    await this.cleanupSessionArtifacts(session);
  }

  constructor(opts?: { ttlMs?: number; defaultAiAuthor?: string | null }) {
    this.ttlMs = opts?.ttlMs ?? 60 * 60 * 1000;
    this.defaultAiAuthor = normalizeAiAuthor(opts?.defaultAiAuthor);
  }

  private expandPath(inputPath: string): string {
    return inputPath.startsWith('~')
      ? path.join(process.env.HOME || '', inputPath.slice(1))
      : inputPath;
  }

  normalizePath(inputPath: string): string {
    return path.resolve(this.expandPath(inputPath));
  }

  /** Canonicalize path using realpath (resolves symlinks, case). */
  async canonicalizePath(inputPath: string): Promise<string> {
    const normalized = this.normalizePath(inputPath);
    try {
      return await fs.realpath(normalized);
    } catch {
      return normalized;
    }
  }

  private newSessionId(): string {
    // Format: ses_[12 alphanumeric] — kept for temp dir naming only.
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = '';
    for (let i = 0; i < 12; i++) {
      // randomInt gives a uniform value in [0, alphabet.length); avoids the
      // modulo bias of randomBytes()[i] % alphabet.length (256 % 62 != 0).
      out += alphabet[randomInt(alphabet.length)];
    }
    return `ses_${out}`;
  }

  async createSession(
    documentContent: Buffer,
    filename: string,
    originalPath: string,
    opts?: { skipNormalization?: boolean; openTicket?: SessionOpenTicket },
  ): Promise<DocxSession> {
    return this.withOpenTicket(originalPath, opts?.openTicket, async (ticket) => {
      const canonicalPath = ticket.sessionKey;
      // Loading can fail; retain the active session until its replacement is ready.
      const doc = await DocxDocument.load(documentContent);
      const sessionId = this.newSessionId();
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-docx-'));
      const tmpPath = path.join(dir, filename);
      // Ensure we pass an ArrayBufferView to satisfy Node's type signature across TS lib setups.
      try {
        await fs.writeFile(tmpPath, new Uint8Array(documentContent));
      } catch (error) {
        await this.releaseArtifactDirectory(dir);
        throw error;
      }
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.ttlMs);
      const session: DocxSession = {
        provider: 'docx',
        sessionId,
        filename,
        tmpPath,
        originalPath,
        originalBuffer: Buffer.from(documentContent),
        comparisonBaseline: null,
        comparisonBaselineWithBookmarks: null,
        doc,
        aiAuthor: this.defaultAiAuthor,
        revisionIdState: null,
        editCount: 0,
        editRevision: 0,
        saveCache: new Map<string, SaveCacheEntry>(),
        extractionCache: null,
        nonRevisionManifest: [],
        selectiveRevisionAction: null,
        createdAt: now,
        lastAccessedAt: now,
        expiresAt,
        normalizationStats: null,
      };
      try {
        await this.finalizeNewSession(session, opts);
        this.assertOpenTicket(ticket);
      } catch (error) {
        await this.cleanupSessionArtifacts(session);
        throw error;
      }
      const existing = this.sessions.get(canonicalPath);
      // Commit point: candidate failures above preserve the old session. Retirement
      // below is best-effort and cannot invalidate or fail the published candidate.
      this.sessions.set(canonicalPath, session);
      if (existing) await this.cleanupSessionArtifacts(existing);
      return session;
    });
  }

  /**
   * Create an ODF session from an already-loaded `archive` + `doc`. The caller (the
   * lazily-reached ODF resolver / open path) loads these via the optional odf-core
   * provider — this method does NOT import odf-core, keeping the always-loaded
   * SessionManager free of a hard dependency on the private package.
   */
  async createOdfSession(
    documentContent: Buffer,
    filename: string,
    originalPath: string,
    archive: any,
    doc: any,
    opts?: { openTicket?: SessionOpenTicket },
  ): Promise<OdfSession> {
    return this.withOpenTicket(originalPath, opts?.openTicket, async (ticket) => {
      const canonicalPath = ticket.sessionKey;
      const sessionId = this.newSessionId();
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-odf-'));
      const tmpPath = path.join(dir, filename);
      try {
        await fs.writeFile(tmpPath, new Uint8Array(documentContent));
      } catch (error) {
        await this.releaseArtifactDirectory(dir);
        throw error;
      }

      const now = new Date();
      const session: OdfSession = {
        provider: 'odf',
        sessionId,
        filename,
        tmpPath,
        originalPath,
        originalBuffer: Buffer.from(documentContent),
        archive,
        doc,
        editCount: 0,
        editRevision: 0,
        createdAt: now,
        lastAccessedAt: now,
        expiresAt: new Date(now.getTime() + this.ttlMs),
      };
      if (ticket.cancelled) {
        await this.cleanupSessionArtifacts(session);
        throw new SessionClosedDuringOpenError();
      }
      const existing = this.sessions.get(canonicalPath);
      // Same commit boundary as DOCX: only retire the old resource after publication.
      this.sessions.set(canonicalPath, session);
      if (existing) await this.cleanupSessionArtifacts(existing);
      return session;
    });
  }

  /**
   * Finalize a newly created session by normalizing the document and inserting
   * paragraph bookmarks. Baselines are lazily generated on first save/compare.
   *
   * Creation finalizes before publication. Kept idempotent for legacy callers
   * that explicitly finalize after creation. Comparison baselines stay lazy.
   */
  async finalizeNewSession(
    session: DocxSession,
    opts?: { skipNormalization?: boolean },
  ): Promise<{ normalizationStats: NormalizationResult | null; paragraphCount: number }> {
    const finalized = this.finalized.get(session);
    if (finalized) return finalized;
    if (!opts?.skipNormalization) {
      session.normalizationStats = session.doc.normalize();
    }
    const info = session.doc.insertParagraphBookmarks(`mcp_${session.sessionId}`);
    // Baselines are lazily generated — skip the two toBuffer() calls here
    this.touch(session);
    const result = { normalizationStats: session.normalizationStats, paragraphCount: info.paragraphCount };
    this.finalized.set(session, result);
    return result;
  }

  /**
   * Lazily generate comparison baselines from the immutable originalBuffer.
   * Safe to call multiple times — returns immediately if baselines already exist.
   * Uses a concurrency guard to prevent double-generation from parallel calls.
   */
  async ensureBaselines(session: DocxSession): Promise<void> {
    if (session.comparisonBaseline !== null) return;
    const existing = this.baselinePromises.get(session);
    if (existing) return existing;
    const promise = this._generateBaselines(session);
    this.baselinePromises.set(session, promise);
    try {
      await promise;
    } finally {
      this.baselinePromises.delete(session);
    }
  }

  private async _generateBaselines(session: DocxSession): Promise<void> {
    // Reconstruct from immutable open-time source, NOT from the live session.doc
    // which may have been edited.
    const doc = await DocxDocument.load(session.originalBuffer);
    doc.normalize();
    doc.insertParagraphBookmarks('_baseline');
    // Sequential on purpose: toBuffer() temporarily swaps document.xml inside
    // the shared zip, so concurrent calls on one document race on that state.
    // Baselines stay fully normalized (no minimalReserialization) — the
    // comparison pipeline expects normalized-vs-normalized inputs.
    const clean = await doc.toBuffer({ cleanBookmarks: true });
    const bookmarked = await doc.toBuffer({ cleanBookmarks: false });
    session.comparisonBaseline = clean.buffer;
    session.comparisonBaselineWithBookmarks = bookmarked.buffer;
  }

  /** Get session by file path (auto-canonicalizes). */
  async getSessionByFilePath(filePath: string): Promise<Session | null> {
    const canonical = await this.canonicalizePath(filePath);
    return this.getSessionByPath(canonical);
  }

  /** Get session by canonical file path. Returns null if not found or expired. */
  getSessionByPath(canonicalPath: string): Session | null {
    const ses = this.sessions.get(canonicalPath);
    if (!ses) return null;
    const now = Date.now();
    if (ses.expiresAt.getTime() < now) {
      this.sessions.delete(canonicalPath);
      void this.cleanupSessionArtifacts(ses);
      return null;
    }
    return ses;
  }

  /**
   * Every live session. The CLI uses this after a one-shot tool call to find
   * edits it would otherwise discard when the process exits (#1048).
   */
  listSessions(): Session[] {
    return [...this.sessions.keys()].flatMap(key => {
      const session = this.getSessionByPath(key);
      return session ? [session] : [];
    });
  }

  /**
   * @deprecated Use getSessionByPath instead. Kept only for backward compatibility during migration.
   */
  getSession(sessionId: string): Session {
    // Linear scan by sessionId — only used by legacy code paths
    for (const [key, ses] of this.sessions.entries()) {
      if (ses.sessionId === sessionId) {
        const now = Date.now();
        if (ses.expiresAt.getTime() < now) {
          this.sessions.delete(key);
          void this.cleanupSessionArtifacts(ses);
          throw new Error(`SESSION_EXPIRED:${sessionId}`);
        }
        return ses;
      }
    }
    throw new Error(`SESSION_NOT_FOUND:${sessionId}`);
  }

  private async cleanupSessionArtifacts(session: Session): Promise<void> {
    if (isDocxSession(session) || isOdfSession(session)) {
      await this.releaseArtifactDirectory(path.dirname(session.tmpPath));
    }
    // GDocs sessions have no tmp dir to clean up
  }

  /** Non-throwing retirement; concurrent requests share one removal attempt. */
  private async releaseArtifactDirectory(dir: string): Promise<void> {
    const existing = this.artifactCleanupPromises.get(dir);
    if (existing) return existing;
    this.pendingArtifactDirectories.add(dir);
    const cleanup = (async () => {
      try {
        await fs.rm(dir, { recursive: true, force: true });
        this.pendingArtifactDirectories.delete(dir);
      } catch {
        // Keep the path for retry. In particular, post-publication cleanup must
        // not report creation failure or delete the active replacement's files.
      }
    })();
    this.artifactCleanupPromises.set(dir, cleanup);
    try {
      await cleanup;
    } finally {
      this.artifactCleanupPromises.delete(dir);
    }
  }

  async clearSessionByPath(filePath: string): Promise<string | null> {
    // GDocs sessions use "gdocs:<docId>" keys — skip filesystem canonicalization
    const sessionKey = filePath.startsWith('gdocs:')
      ? filePath
      : await this.canonicalizePath(filePath);
    this.invalidateOpening(sessionKey);
    const session = this.sessions.get(sessionKey);
    if (!session) return null;
    this.sessions.delete(sessionKey);
    await this.cleanupSessionArtifacts(session);
    return sessionKey;
  }

  async clearAllSessions(): Promise<string[]> {
    for (const resolving of this.resolvingOpens) resolving.cancelled = true;
    for (const key of this.openingTickets.keys()) this.invalidateOpening(key);
    const allSessions = [...this.sessions.entries()];
    const clearedPaths = allSessions.map(([key]) => key);
    this.sessions.clear();
    await Promise.all(allSessions.map(([, session]) => this.cleanupSessionArtifacts(session)));
    // Also drain expiry cleanups and retry failed candidate/retirement removals.
    await Promise.all(this.artifactCleanupPromises.values());
    await Promise.all([...this.pendingArtifactDirectories].map(dir => this.releaseArtifactDirectory(dir)));
    return clearedPaths;
  }

  touch(session: Session): void {
    const now = new Date();
    session.lastAccessedAt = now;
    session.expiresAt = new Date(now.getTime() + this.ttlMs);
  }

  markEdited(session: Session): void {
    session.editCount += 1;
    session.editRevision += 1;
    if (isDocxSession(session)) {
      // Any edit creates a new canonical revision; previously generated artifacts
      // are no longer current and should not be reused by default.
      session.saveCache.clear();
      session.extractionCache = null;
    }
  }

  /**
   * Record a package-level (non-revision) mutation for later surfacing in the
   * save report (#122). Call this after a successful mutation whose effect is
   * not, and cannot be, captured by OOXML tracked-change markup — e.g. creating
   * `word/comments.xml`, rewriting relationships, or editing side-story parts.
   */
  recordNonRevisionChange(
    session: DocxSession,
    change: Omit<NonRevisionChange, 'editRevision'>,
  ): void {
    session.nonRevisionManifest.push({ ...change, editRevision: session.editRevision });
  }

  recordSelectiveRevisionAction(
    session: DocxSession,
    action: Omit<SelectiveRevisionAction, 'editRevision'>,
  ): void {
    session.selectiveRevisionAction = {
      ...action,
      editRevision: session.editRevision,
    };
  }

  getSaveCache(session: DocxSession, cacheKey: string): SaveCacheEntry | null {
    return session.saveCache.get(cacheKey) ?? null;
  }

  setSaveCache(session: DocxSession, entry: SaveCacheEntry): void {
    session.saveCache.set(entry.cacheKey, entry);
  }

  getExtractionCache(session: DocxSession): ExtractionCacheEntry | null {
    if (!session.extractionCache) return null;
    if (session.extractionCache.revision !== session.editRevision) {
      session.extractionCache = null;
      return null;
    }
    return session.extractionCache;
  }

  setExtractionCache(session: DocxSession, changes: ParagraphRevision[]): void {
    session.extractionCache = { revision: session.editRevision, changes };
  }

  /**
   * Create a Google Docs session. The `doc` is an already-loaded
   * GoogleDocsDocument instance (created via dynamic import in the handler layer).
   */
  createGDocsSession(docId: string, doc: any, opts?: { openTicket?: SessionOpenTicket }): GDocsSession {
    const sessionKey = `gdocs:${docId}`;
    if (opts?.openTicket) this.assertOpenTicket(opts.openTicket);
    const existing = this.getSessionByPath(sessionKey);
    if (existing) {
      this.touch(existing);
      return existing as GDocsSession;
    }

    const sessionId = this.newSessionId();
    const now = new Date();
    const session: GDocsSession = {
      provider: 'gdocs',
      sessionId,
      docId,
      doc,
      editCount: 0,
      editRevision: 0,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt: new Date(now.getTime() + this.ttlMs),
    };
    this.sessions.set(sessionKey, session);
    return session;
  }

  async saveTo(session: DocxSession, savePath: string, opts?: { cleanBookmarks?: boolean }): Promise<void> {
    const cleanBookmarks = opts?.cleanBookmarks ?? true;
    const { buffer } = await session.doc.toBuffer({ cleanBookmarks, minimalReserialization: cleanBookmarks });
    await fs.writeFile(savePath, new Uint8Array(buffer));
  }

  async saveOdfTo(session: OdfSession, savePath: string): Promise<Buffer> {
    session.archive.setContentXml(session.doc.toXml());
    const buffer = await session.archive.save();
    await fs.writeFile(savePath, new Uint8Array(buffer));
    return buffer;
  }
}
