import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {
  DocxDocument,
  type NormalizationResult,
  type ParagraphRevision,
  type ReconstructionMode,
  type ReconstructionFallbackReason,
  type ReconstructionFallbackDiagnostics,
} from '@usejunior/docx-core';

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
  trackedEngine: 'auto' | 'atomizer';
  trackedAuthor: string;
  revisedBuffer: Buffer;
  trackedBuffer: Buffer | null;
  trackedStats: TrackedChangesStats | null;
  trackedReconstructionMode?: ReconstructionMode;
  trackedFallbackReason?: ReconstructionFallbackReason;
  trackedFallbackDiagnostics?: ReconstructionFallbackDiagnostics;
  bookmarksRemoved: number;
  exportedAtUtc: string;
  cachedAtIso: string;
};

export type ExtractionCacheEntry = {
  revision: number;
  changes: ParagraphRevision[];
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
  editCount: number;
  editRevision: number;
  saveCache: Map<string, SaveCacheEntry>;
  extractionCache: ExtractionCacheEntry | null;
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

export type Session = DocxSession | GDocsSession;

export function isDocxSession(s: Session): s is DocxSession {
  return s.provider === 'docx';
}

export function isGDocsSession(s: Session): s is GDocsSession {
  return s.provider === 'gdocs';
}

export class SessionManager {
  /** Sessions keyed by canonical file path (realpath). */
  private sessions = new Map<string, Session>();
  private ttlMs: number;

  /** Concurrency guard: prevents double-generation of baselines for the same session. */
  private baselinePromises = new WeakMap<DocxSession, Promise<void>>();

  constructor(opts?: { ttlMs?: number }) {
    this.ttlMs = opts?.ttlMs ?? 60 * 60 * 1000;
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
    const bytes = randomBytes(12);
    let out = '';
    for (let i = 0; i < 12; i++) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    return `ses_${out}`;
  }

  async createSession(documentContent: Buffer, filename: string, originalPath: string): Promise<DocxSession> {
    const canonicalPath = await this.canonicalizePath(originalPath);

    // One-session-per-file: clean up existing session for this path if any
    const existing = this.sessions.get(canonicalPath);
    if (existing) {
      await this.cleanupSessionArtifacts(existing);
    }

    const sessionId = this.newSessionId();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-docx-'));
    const tmpPath = path.join(dir, filename);
    // Ensure we pass an ArrayBufferView to satisfy Node's type signature across TS lib setups.
    await fs.writeFile(tmpPath, new Uint8Array(documentContent));

    const doc = await DocxDocument.load(documentContent);
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
      editCount: 0,
      editRevision: 0,
      saveCache: new Map<string, SaveCacheEntry>(),
      extractionCache: null,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt,
      normalizationStats: null,
    };
    this.sessions.set(canonicalPath, session);
    return session;
  }

  /**
   * Finalize a newly created session by normalizing the document and inserting
   * paragraph bookmarks. Baselines are lazily generated on first save/compare.
   *
   * INVARIANT: All production session creation paths must call
   * `finalizeNewSession` before returning a session. `createSession` alone
   * leaves baselines null and is incomplete for tool use.
   */
  async finalizeNewSession(
    session: DocxSession,
    opts?: { skipNormalization?: boolean },
  ): Promise<{ normalizationStats: NormalizationResult | null; paragraphCount: number }> {
    if (!opts?.skipNormalization) {
      session.normalizationStats = session.doc.normalize();
    }
    const info = session.doc.insertParagraphBookmarks(`mcp_${session.sessionId}`);
    // Baselines are lazily generated — skip the two toBuffer() calls here
    this.touch(session);
    return { normalizationStats: session.normalizationStats, paragraphCount: info.paragraphCount };
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
    const [clean, bookmarked] = await Promise.all([
      doc.toBuffer({ cleanBookmarks: true }),
      doc.toBuffer({ cleanBookmarks: false }),
    ]);
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
      return null;
    }
    return ses;
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
          throw new Error(`SESSION_EXPIRED:${sessionId}`);
        }
        return ses;
      }
    }
    throw new Error(`SESSION_NOT_FOUND:${sessionId}`);
  }

  private async cleanupSessionArtifacts(session: Session): Promise<void> {
    if (isDocxSession(session)) {
      const tmpDir = path.dirname(session.tmpPath);
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
    // GDocs sessions have no tmp dir to clean up
  }

  async clearSessionByPath(filePath: string): Promise<string | null> {
    // GDocs sessions use "gdocs:<docId>" keys — skip filesystem canonicalization
    const sessionKey = filePath.startsWith('gdocs:')
      ? filePath
      : await this.canonicalizePath(filePath);
    const session = this.sessions.get(sessionKey);
    if (!session) return null;
    this.sessions.delete(sessionKey);
    await this.cleanupSessionArtifacts(session);
    return sessionKey;
  }

  async clearAllSessions(): Promise<string[]> {
    const allSessions = [...this.sessions.entries()];
    const clearedPaths = allSessions.map(([key]) => key);
    this.sessions.clear();
    await Promise.all(allSessions.map(([, session]) => this.cleanupSessionArtifacts(session)));
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
  createGDocsSession(docId: string, doc: any): GDocsSession {
    const sessionKey = `gdocs:${docId}`;
    const existing = this.sessions.get(sessionKey);
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
    const { buffer } = await session.doc.toBuffer({ cleanBookmarks: opts?.cleanBookmarks ?? true });
    await fs.writeFile(savePath, new Uint8Array(buffer));
  }
}
