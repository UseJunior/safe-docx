import { describe, expect, afterEach } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { SessionManager, getRevisionContextForSession } from './manager.js';
import { makeDocxWithDocumentXml, makeMinimalDocx } from '../testing/docx_test_utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Session Manager' });

// ── Helpers ─────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

async function createTestDoc(texts: string[] = ['Hello']): Promise<Buffer> {
  return Buffer.from(await makeMinimalDocx(texts));
}

async function createTestFile(texts: string[] = ['Hello']): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mgr-test-'));
  tmpDirs.push(dir);
  const filePath = path.join(dir, 'test.docx');
  const buf = await createTestDoc(texts);
  await fs.writeFile(filePath, new Uint8Array(buf));
  return filePath;
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// ── createSession ───────────────────────────────────────────────────

describe('SessionManager.createSession', () => {
  test('returns a session with a valid ID format', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);

    expect(session.sessionId).toMatch(/^ses_[A-Za-z0-9]{12}$/);
    expect(session.filename).toBe('test.docx');
    expect(session.originalPath).toBe(filePath);
    expect(session.editCount).toBe(0);
    expect(session.editRevision).toBe(0);
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.lastAccessedAt).toBeInstanceOf(Date);
    expect(session.expiresAt).toBeInstanceOf(Date);
  });

  test('writes document to temp directory', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);

    const exists = await fs.stat(session.tmpPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
    tmpDirs.push(path.dirname(session.tmpPath));
  });

  test('loads a DocxDocument instance', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);

    expect(session.doc).toBeDefined();
    tmpDirs.push(path.dirname(session.tmpPath));
  });

  test('seeds aiAuthor from the manager default and leaves revisionIdState unset', async () => {
    const mgr = new SessionManager({ defaultAiAuthor: 'SafeDocX' });
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);

    expect(session.aiAuthor).toBe('SafeDocX');
    expect(session.revisionIdState).toBeNull();
    tmpDirs.push(path.dirname(session.tmpPath));
  });

  test('replaces existing session for same file path', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const s1 = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);
    const s1TmpDir = path.dirname(s1.tmpPath);

    const s2 = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);
    expect(s2.sessionId).not.toBe(s1.sessionId);

    // Old session's tmp should be cleaned up
    const exists = await fs.stat(s1TmpDir).then(() => true).catch(() => false);
    expect(exists).toBe(false);

    tmpDirs.push(path.dirname(s2.tmpPath));
  });
});

describe('revision context helpers', () => {
  test('initializes revision ids above the highest pre-existing w:id value', async () => {
    const mgr = new SessionManager({ defaultAiAuthor: 'SafeDocX' });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mgr-revision-test-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, 'tracked.docx');
    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>` +
      `<w:p><w:ins w:id="42" w:author="Existing" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Prior</w:t></w:r></w:ins></w:p>` +
      `</w:body></w:document>`;
    const buf = await makeDocxWithDocumentXml(documentXml);
    await fs.writeFile(filePath, new Uint8Array(buf));

    const session = await mgr.createSession(buf, 'tracked.docx', filePath);
    const ctx = await getRevisionContextForSession(session);

    expect(ctx).toBeDefined();
    expect(session.revisionIdState?.nextId).toBe(43);
  });

  test('initializes revision ids above pre-existing side-part w:id values', async () => {
    const mgr = new SessionManager({ defaultAiAuthor: 'SafeDocX' });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mgr-revision-sidepart-test-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, 'tracked-sidepart.docx');
    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p><w:ins w:id="42" w:author="Existing" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Prior</w:t></w:r></w:ins></w:p>` +
      `</w:body></w:document>`;
    const commentsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:comment w:id="0" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">` +
      `<w:p><w:ins w:id="500" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Side part</w:t></w:r></w:ins></w:p>` +
      `</w:comment>` +
      `</w:comments>`;
    const buf = await makeDocxWithDocumentXml(documentXml, { 'word/comments.xml': commentsXml });
    await fs.writeFile(filePath, new Uint8Array(buf));

    const session = await mgr.createSession(buf, 'tracked-sidepart.docx', filePath);
    const ctx = await getRevisionContextForSession(session);

    expect(ctx).toBeDefined();
    expect(session.revisionIdState?.nextId).toBe(501);
  });

  test('ignores non-revision w:id attributes (e.g., <w:comment w:id>) in side parts', async () => {
    // Comment IDs and revision IDs share an attribute name but occupy
    // separate ID spaces — only revision-bearing elements should seed.
    const mgr = new SessionManager({ defaultAiAuthor: 'SafeDocX' });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mgr-revision-nonrevid-test-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, 'nonrev.docx');
    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:r><w:t>Plain</w:t></w:r></w:p></w:body></w:document>`;
    const commentsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:comment w:id="500" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">` +
      `<w:p><w:r><w:t>Comment body</w:t></w:r></w:p>` +
      `</w:comment></w:comments>`;
    const buf = await makeDocxWithDocumentXml(documentXml, { 'word/comments.xml': commentsXml });
    await fs.writeFile(filePath, new Uint8Array(buf));

    const session = await mgr.createSession(buf, 'nonrev.docx', filePath);
    const ctx = await getRevisionContextForSession(session);

    expect(ctx).toBeDefined();
    expect(session.revisionIdState?.nextId).toBe(1);
  });

  test('initializes revision ids above pre-existing header w:id values', async () => {
    const mgr = new SessionManager({ defaultAiAuthor: 'SafeDocX' });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mgr-revision-header-test-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, 'tracked-header.docx');
    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>`;
    const headerXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:p><w:ins w:id="900" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Header</w:t></w:r></w:ins></w:p>` +
      `</w:hdr>`;
    const buf = await makeDocxWithDocumentXml(documentXml, { 'word/header1.xml': headerXml });
    await fs.writeFile(filePath, new Uint8Array(buf));

    const session = await mgr.createSession(buf, 'tracked-header.docx', filePath);
    const ctx = await getRevisionContextForSession(session);

    expect(ctx).toBeDefined();
    expect(session.revisionIdState?.nextId).toBe(901);
  });

  test('initializes revision ids above pre-existing footer w:id values', async () => {
    const mgr = new SessionManager({ defaultAiAuthor: 'SafeDocX' });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mgr-revision-footer-test-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, 'tracked-footer.docx');
    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>`;
    const footerXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:p><w:ins w:id="1234" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Footer</w:t></w:r></w:ins></w:p>` +
      `</w:ftr>`;
    const buf = await makeDocxWithDocumentXml(documentXml, { 'word/footer2.xml': footerXml });
    await fs.writeFile(filePath, new Uint8Array(buf));

    const session = await mgr.createSession(buf, 'tracked-footer.docx', filePath);
    const ctx = await getRevisionContextForSession(session);

    expect(ctx).toBeDefined();
    expect(session.revisionIdState?.nextId).toBe(1235);
  });

  test('skips malformed optional side parts and continues seeding from document.xml', async () => {
    const mgr = new SessionManager({ defaultAiAuthor: 'SafeDocX' });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mgr-revision-malformed-test-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, 'malformed.docx');
    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:ins w:id="77" w:author="Existing" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Body</w:t></w:r></w:ins></w:p></w:body></w:document>`;
    // Truncated/unterminated comments.xml — parseXml must throw, but the
    // session must remain editable rather than crashing the first tool call.
    const commentsXml =
      `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment`;
    const buf = await makeDocxWithDocumentXml(documentXml, { 'word/comments.xml': commentsXml });
    await fs.writeFile(filePath, new Uint8Array(buf));

    const session = await mgr.createSession(buf, 'malformed.docx', filePath);
    const ctx = await getRevisionContextForSession(session);

    expect(ctx).toBeDefined();
    expect(session.revisionIdState?.nextId).toBe(78);
  });

  test('concurrent first callers resolve to a single seeded RevisionIdState', async () => {
    const mgr = new SessionManager({ defaultAiAuthor: 'SafeDocX' });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mgr-revision-race-test-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, 'race.docx');
    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:ins w:id="10" w:author="x" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Hi</w:t></w:r></w:ins></w:p></w:body></w:document>`;
    const buf = await makeDocxWithDocumentXml(documentXml);
    await fs.writeFile(filePath, new Uint8Array(buf));

    const session = await mgr.createSession(buf, 'race.docx', filePath);
    const [a, b, c] = await Promise.all([
      getRevisionContextForSession(session),
      getRevisionContextForSession(session),
      getRevisionContextForSession(session),
    ]);

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(c).toBeDefined();
    expect(session.revisionIdState?.nextId).toBe(11);
  });
});

// ── getSessionByPath ────────────────────────────────────────────────

describe('SessionManager.getSessionByPath', () => {
  test('returns null for unknown path', async () => {
    const mgr = new SessionManager();
    expect(mgr.getSessionByPath('/nonexistent')).toBeNull();
  });

  test('returns the session for a matching canonical path', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);
    const canonical = await mgr.canonicalizePath(filePath);

    const found = mgr.getSessionByPath(canonical);
    expect(found).not.toBeNull();
    expect(found!.sessionId).toBe(session.sessionId);

    tmpDirs.push(path.dirname(session.tmpPath));
  });

  test('returns null for expired session', async () => {
    const mgr = new SessionManager({ ttlMs: 1 });
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);
    const canonical = await mgr.canonicalizePath(filePath);

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 10));

    expect(mgr.getSessionByPath(canonical)).toBeNull();
    tmpDirs.push(path.dirname(session.tmpPath));
  });
});

// ── clearSessionByPath ──────────────────────────────────────────────

describe('SessionManager.clearSessionByPath', () => {
  test('removes session and returns its path', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);

    const cleared = await mgr.clearSessionByPath(filePath);
    expect(cleared).not.toBeNull();

    // Session should no longer exist
    const canonical = await mgr.canonicalizePath(filePath);
    expect(mgr.getSessionByPath(canonical)).toBeNull();
    tmpDirs.push(path.dirname(session.tmpPath));
  });

  test('cleans up temp directory', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);
    const sessionTmpDir = path.dirname(session.tmpPath);

    await mgr.clearSessionByPath(filePath);

    const exists = await fs.stat(sessionTmpDir).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  test('returns null for unknown path', async () => {
    const mgr = new SessionManager();
    const cleared = await mgr.clearSessionByPath('/tmp/nonexistent.docx');
    expect(cleared).toBeNull();
  });
});

// ── clearAllSessions ────────────────────────────────────────────────

describe('SessionManager.clearAllSessions', () => {
  test('removes all sessions and returns their paths', async () => {
    const mgr = new SessionManager();
    const fileA = await createTestFile(['A']);
    const fileB = await createTestFile(['B']);
    const bufA = await fs.readFile(fileA);
    const bufB = await fs.readFile(fileB);
    await mgr.createSession(Buffer.from(bufA), 'a.docx', fileA);
    await mgr.createSession(Buffer.from(bufB), 'b.docx', fileB);

    const clearedPaths = await mgr.clearAllSessions();

    expect(clearedPaths.length).toBe(2);
    const canonA = await mgr.canonicalizePath(fileA);
    const canonB = await mgr.canonicalizePath(fileB);
    expect(mgr.getSessionByPath(canonA)).toBeNull();
    expect(mgr.getSessionByPath(canonB)).toBeNull();
  });

  test('returns empty array when no sessions exist', async () => {
    const mgr = new SessionManager();
    const clearedPaths = await mgr.clearAllSessions();
    expect(clearedPaths).toEqual([]);
  });
});

// ── ensureBaselines ────────────────────────────────────────────────

describe('SessionManager.ensureBaselines', () => {
  test('baselines are null after createSession + finalizeNewSession', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile(['test baseline']);
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);
    await mgr.finalizeNewSession(session);

    expect(session.comparisonBaseline).toBeNull();
    expect(session.comparisonBaselineWithBookmarks).toBeNull();
    tmpDirs.push(path.dirname(session.tmpPath));
  });

  test('ensureBaselines generates baselines from originalBuffer', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile(['test baseline']);
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);
    await mgr.finalizeNewSession(session);

    await mgr.ensureBaselines(session);

    expect(session.comparisonBaseline).not.toBeNull();
    expect(session.comparisonBaselineWithBookmarks).not.toBeNull();
    expect(session.comparisonBaseline!.length).toBeGreaterThan(0);
    expect(session.comparisonBaselineWithBookmarks!.length).toBeGreaterThan(0);
    tmpDirs.push(path.dirname(session.tmpPath));
  });

  test('ensureBaselines is idempotent', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile(['test baseline']);
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);
    await mgr.finalizeNewSession(session);

    await mgr.ensureBaselines(session);
    const first = session.comparisonBaseline;

    await mgr.ensureBaselines(session);
    expect(session.comparisonBaseline).toBe(first); // Same reference
    tmpDirs.push(path.dirname(session.tmpPath));
  });
});

// ── markEdited ──────────────────────────────────────────────────────

describe('SessionManager.markEdited', () => {
  test('increments editCount and editRevision', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);

    expect(session.editCount).toBe(0);
    expect(session.editRevision).toBe(0);

    mgr.markEdited(session);

    expect(session.editCount).toBe(1);
    expect(session.editRevision).toBe(1);

    mgr.markEdited(session);

    expect(session.editCount).toBe(2);
    expect(session.editRevision).toBe(2);
  });

  test('clears save cache', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);

    session.saveCache.set('test-key', {
      cacheKey: 'test-key',
      revision: 0,
      format: 'clean',
      cleanBookmarks: true,
      trackedEngine: 'auto',
      trackedAuthor: '',
      revisedBuffer: Buffer.from(''),
      trackedBuffer: null,
      trackedStats: null,
      bookmarksRemoved: 0,
      blocksRestored: 0,
      trackedBlocksRestored: 0,
      exportedAtUtc: new Date().toISOString(),
      cachedAtIso: new Date().toISOString(),
    });

    expect(session.saveCache.size).toBe(1);
    mgr.markEdited(session);
    expect(session.saveCache.size).toBe(0);
  });

  test('clears extraction cache', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);

    session.extractionCache = { revision: 0, changes: [] };
    mgr.markEdited(session);
    expect(session.extractionCache).toBeNull();
  });
});

// ── normalizePath ───────────────────────────────────────────────────

describe('SessionManager.normalizePath', () => {
  test('resolves relative paths', () => {
    const mgr = new SessionManager();
    const result = mgr.normalizePath('relative/path.docx');
    expect(path.isAbsolute(result)).toBe(true);
  });

  test('expands tilde to home directory', () => {
    const mgr = new SessionManager();
    const result = mgr.normalizePath('~/test.docx');
    const home = process.env.HOME || '';
    expect(result).toBe(path.resolve(path.join(home, 'test.docx')));
  });

  test('normalizes trailing slashes', () => {
    const mgr = new SessionManager();
    const withSlash = mgr.normalizePath('/tmp/dir/');
    const withoutSlash = mgr.normalizePath('/tmp/dir');
    expect(withSlash).toBe(withoutSlash);
  });

  test('resolves parent directory references', () => {
    const mgr = new SessionManager();
    const result = mgr.normalizePath('/tmp/foo/../bar');
    expect(result).toBe('/tmp/bar');
  });
});

// ── touch ───────────────────────────────────────────────────────────

describe('SessionManager.touch', () => {
  test('updates lastAccessedAt and resets expiresAt', async () => {
    const mgr = new SessionManager({ ttlMs: 60000 });
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);
    const originalAccess = session.lastAccessedAt.getTime();

    await new Promise((r) => setTimeout(r, 5));
    mgr.touch(session);

    expect(session.lastAccessedAt.getTime()).toBeGreaterThan(originalAccess);
    expect(session.expiresAt.getTime()).toBeGreaterThan(
      session.lastAccessedAt.getTime() + 59000
    );
  });
});

// ── Cache methods ───────────────────────────────────────────────────

describe('SessionManager save cache', () => {
  test('returns null for missing cache key', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);

    expect(mgr.getSaveCache(session, 'missing')).toBeNull();
  });

  test('stores and retrieves cache entries', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);

    const entry = {
      cacheKey: 'key1',
      revision: 0,
      format: 'clean' as const,
      cleanBookmarks: true,
      trackedEngine: 'auto' as const,
      trackedAuthor: '',
      revisedBuffer: Buffer.from('data'),
      trackedBuffer: null,
      trackedStats: null,
      bookmarksRemoved: 0,
      blocksRestored: 0,
      trackedBlocksRestored: 0,
      exportedAtUtc: new Date().toISOString(),
      cachedAtIso: new Date().toISOString(),
    };

    mgr.setSaveCache(session, entry);
    const retrieved = mgr.getSaveCache(session, 'key1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.cacheKey).toBe('key1');
  });
});

describe('SessionManager extraction cache', () => {
  test('returns null when no extraction cache', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);

    expect(mgr.getExtractionCache(session)).toBeNull();
  });

  test('returns cache when revision matches', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);

    mgr.setExtractionCache(session, []);
    const cached = mgr.getExtractionCache(session);
    expect(cached).not.toBeNull();
    expect(cached!.revision).toBe(session.editRevision);
  });

  test('returns null and clears when revision is stale', async () => {
    const mgr = new SessionManager();
    const filePath = await createTestFile();
    const buf = await fs.readFile(filePath);
    const session = await mgr.createSession(Buffer.from(buf), 'test.docx', filePath);

    mgr.setExtractionCache(session, []);
    mgr.markEdited(session);

    session.extractionCache = { revision: 0, changes: [] };
    const cached = mgr.getExtractionCache(session);
    expect(cached).toBeNull();
    expect(session.extractionCache).toBeNull();
  });
});
