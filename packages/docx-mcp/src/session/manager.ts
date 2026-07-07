import { randomInt } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {
  DocxDocument,
  DocxZip,
  REVISION_ID_ELEMENT_NAME_SET,
  enumerateRevisionStoryPartPaths,
  createRevisionContext,
  createRevisionIdState,
  parseXml,
  type NormalizationResult,
  type ParagraphRevision,
  type RevisionContext,
  type RevisionIdState,
} from '@usejunior/docx-core';
import type {
  ReconstructionMode,
  ReconstructionFallbackReason,
  ReconstructionFallbackDiagnostics,
} from '@usejunior/docx-compare';
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

const WORDPROCESSING_ML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * WordprocessingML elements that carry package-wide revision `w:id` attributes.
 * Limiting the seed scan to these elements prevents non-revision IDs (e.g.,
 * `<w:comment w:id>`, `<w:footnote w:id>`, `<w:bookmarkStart w:id>`) from
 * spuriously inflating the starting revision-id counter.
 */
function normalizeAiAuthor(author: string | null | undefined): string | null {
  if (typeof author !== 'string') return null;
  const trimmed = author.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getWordIdValue(element: Element): number | null {
  const raw =
    element.getAttributeNS(WORDPROCESSING_ML_NS, 'id')
    ?? element.getAttribute('w:id')
    ?? element.getAttribute('id');
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Compute a starting `RevisionIdState` whose first allocated `w:id` is
 * higher than any existing revision id found in the supplied documents.
 *
 * Only `w:id` attributes on revision-bearing elements
 * (`REVISION_ID_ELEMENT_LOCAL_NAMES`) are considered. Non-revision IDs such
 * as `<w:comment w:id>` or `<w:footnote w:id>` share the attribute name but
 * occupy a different ID space and must not influence the counter.
 *
 * Callers should pass every available story/metadata part that can contain
 * package-wide revision attributes, not just `document.xml`.
 */
export function inferStartingRevisionIdState(...docs: Document[]): RevisionIdState {
  let maxId = 0;

  for (const doc of docs) {
    for (const node of Array.from(doc.getElementsByTagName('*'))) {
      const localName = node.localName ?? '';
      if (!REVISION_ID_ELEMENT_NAME_SET.has(localName)) continue;
      if (node.namespaceURI && node.namespaceURI !== WORDPROCESSING_ML_NS) continue;
      const value = getWordIdValue(node);
      if (value !== null && value > maxId) {
        maxId = value;
      }
    }
  }

  return createRevisionIdState(maxId + 1);
}

export async function getSidePartRevisionSeedDocs(buffer: Buffer): Promise<Document[]> {
  const docs: Document[] = [];

  let zip: DocxZip;
  try {
    zip = await DocxZip.load(buffer);
  } catch {
    return docs;
  }

  for (const partPath of enumerateRevisionStoryPartPaths(zip)) {
    if (!zip.hasFile(partPath)) continue;
    let xml: string | null;
    try {
      xml = await zip.readTextOrNull(partPath);
    } catch {
      continue;
    }
    if (!xml) continue;
    try {
      docs.push(parseXml(xml));
    } catch {
      // Malformed optional side part — skip so an unrelated parse failure
      // does not block every tracked edit on the session.
    }
  }

  return docs;
}

/**
 * Single-flight guard around the first revision-id seed scan per session.
 * Concurrent first callers await the same in-flight scan and assign the same
 * result, preventing a slower scan from clobbering a counter that a faster
 * caller has already advanced via emitted revisions.
 */
const revisionIdSeedPromises = new WeakMap<DocxSession, Promise<RevisionIdState>>();

export async function getRevisionContextForSession(session: DocxSession): Promise<RevisionContext | undefined> {
  if (!session.aiAuthor) return undefined;

  if (!session.revisionIdState) {
    let pending = revisionIdSeedPromises.get(session);
    if (!pending) {
      pending = (async () => {
        const sideDocs = await getSidePartRevisionSeedDocs(session.originalBuffer);
        return inferStartingRevisionIdState(session.doc.getDocumentXmlClone(), ...sideDocs);
      })();
      revisionIdSeedPromises.set(session, pending);
    }
    try {
      const seeded = await pending;
      if (!session.revisionIdState) {
        session.revisionIdState = seeded;
      }
    } finally {
      revisionIdSeedPromises.delete(session);
    }
  }

  return createRevisionContext({
    author: session.aiAuthor,
    date: new Date(),
    idState: session.revisionIdState,
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

export class SessionManager {
  /** Sessions keyed by canonical file path (realpath). */
  private sessions = new Map<string, Session>();
  private ttlMs: number;
  private defaultAiAuthor: string | null;

  /** Concurrency guard: prevents double-generation of baselines for the same session. */
  private baselinePromises = new WeakMap<DocxSession, Promise<void>>();

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
      aiAuthor: this.defaultAiAuthor,
      revisionIdState: null,
      editCount: 0,
      editRevision: 0,
      saveCache: new Map<string, SaveCacheEntry>(),
      extractionCache: null,
      nonRevisionManifest: [],
      createdAt: now,
      lastAccessedAt: now,
      expiresAt,
      normalizationStats: null,
    };
    this.sessions.set(canonicalPath, session);
    return session;
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
  ): Promise<OdfSession> {
    const canonicalPath = await this.canonicalizePath(originalPath);

    const existing = this.sessions.get(canonicalPath);
    if (existing) {
      await this.cleanupSessionArtifacts(existing);
    }

    const sessionId = this.newSessionId();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-odf-'));
    const tmpPath = path.join(dir, filename);
    await fs.writeFile(tmpPath, new Uint8Array(documentContent));

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
    if (isDocxSession(session) || isOdfSession(session)) {
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
