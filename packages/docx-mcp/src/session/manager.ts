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
  trackedEngine: 'auto' | 'atomizer' | 'diffmatch';
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

export type Session = {
  sessionId: string;
  filename: string;
  tmpPath: string;
  originalPath: string;
  originalBuffer: Buffer;
  /**
   * Post-normalization + bookmark-cleaned buffer used as comparison baseline for tracked output.
   * Comparing against this instead of originalBuffer prevents normalization artifacts from
   * appearing as false tracked changes. Set during open_document after normalization.
   */
  comparisonBaseline: Buffer | null;
  /**
   * Post-normalization buffer WITH bookmarks, used as comparison baseline for
   * compare_documents tool (which uses cleanBookmarks: false).
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

export class SessionManager {
  private sessions = new Map<string, Session>();
  private ttlMs: number;
  private static readonly SESSION_ID_PATTERN = /^ses_[A-Za-z0-9]{12}$/;

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

  private newSessionId(): string {
    // Format: ses_[12 alphanumeric] (close enough: base64url chars).
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = randomBytes(12);
    let out = '';
    for (let i = 0; i < 12; i++) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    return `ses_${out}`;
  }

  async createSession(documentContent: Buffer, filename: string, originalPath: string): Promise<Session> {
    const sessionId = this.newSessionId();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-docx-'));
    const tmpPath = path.join(dir, filename);
    // Ensure we pass an ArrayBufferView to satisfy Node's type signature across TS lib setups.
    await fs.writeFile(tmpPath, new Uint8Array(documentContent));

    const doc = await DocxDocument.load(documentContent);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const session: Session = {
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
    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string): Session {
    if (!SessionManager.SESSION_ID_PATTERN.test(sessionId)) {
      throw new Error(`INVALID_SESSION_ID:${sessionId}`);
    }
    const ses = this.sessions.get(sessionId);
    if (!ses) throw new Error(`SESSION_NOT_FOUND:${sessionId}`);
    const now = Date.now();
    if (ses.expiresAt.getTime() < now) {
      this.sessions.delete(sessionId);
      throw new Error(`SESSION_EXPIRED:${sessionId}`);
    }
    return ses;
  }

  private listActiveSessionsForPath(normalizedPath: string): Session[] {
    const now = Date.now();
    const out: Session[] = [];
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt.getTime() < now) {
        this.sessions.delete(sessionId);
        continue;
      }
      if (this.normalizePath(session.originalPath) !== normalizedPath) continue;
      out.push(session);
    }
    out.sort((a, b) => b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime());
    return out;
  }

  getMostRecentlyUsedSessionForPath(normalizedPath: string): Session | null {
    const sessionsForPath = this.listActiveSessionsForPath(normalizedPath);
    return sessionsForPath[0] ?? null;
  }

  private async cleanupSessionArtifacts(session: Session): Promise<void> {
    const tmpDir = path.dirname(session.tmpPath);
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }

  async clearSessionById(sessionId: string): Promise<Session> {
    const session = this.getSession(sessionId);
    this.sessions.delete(sessionId);
    await this.cleanupSessionArtifacts(session);
    return session;
  }

  async clearSessionsByPath(normalizedPath: string): Promise<string[]> {
    const sessionsForPath = this.listActiveSessionsForPath(normalizedPath);
    for (const session of sessionsForPath) {
      this.sessions.delete(session.sessionId);
    }
    await Promise.all(sessionsForPath.map((session) => this.cleanupSessionArtifacts(session)));
    return sessionsForPath.map((session) => session.sessionId);
  }

  async clearAllSessions(): Promise<string[]> {
    const allSessions = [...this.sessions.values()];
    const clearedIds = allSessions.map((session) => session.sessionId);
    this.sessions.clear();
    await Promise.all(allSessions.map((session) => this.cleanupSessionArtifacts(session)));
    return clearedIds;
  }

  touch(session: Session): void {
    const now = new Date();
    session.lastAccessedAt = now;
    session.expiresAt = new Date(now.getTime() + this.ttlMs);
  }

  markEdited(session: Session): void {
    session.editCount += 1;
    session.editRevision += 1;
    // Any edit creates a new canonical revision; previously generated artifacts
    // are no longer current and should not be reused by default.
    session.saveCache.clear();
    session.extractionCache = null;
  }

  getSaveCache(session: Session, cacheKey: string): SaveCacheEntry | null {
    return session.saveCache.get(cacheKey) ?? null;
  }

  setSaveCache(session: Session, entry: SaveCacheEntry): void {
    session.saveCache.set(entry.cacheKey, entry);
  }

  getExtractionCache(session: Session): ExtractionCacheEntry | null {
    if (!session.extractionCache) return null;
    if (session.extractionCache.revision !== session.editRevision) {
      session.extractionCache = null;
      return null;
    }
    return session.extractionCache;
  }

  setExtractionCache(session: Session, changes: ParagraphRevision[]): void {
    session.extractionCache = { revision: session.editRevision, changes };
  }

  async saveTo(session: Session, savePath: string, opts?: { cleanBookmarks?: boolean }): Promise<void> {
    const { buffer } = await session.doc.toBuffer({ cleanBookmarks: opts?.cleanBookmarks ?? true });
    await fs.writeFile(savePath, new Uint8Array(buffer));
  }
}
