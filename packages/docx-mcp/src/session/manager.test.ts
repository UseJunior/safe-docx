import { describe, expect, afterEach } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import { SessionManager } from './manager.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ── Helpers ─────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

async function createTestDoc(texts: string[] = ['Hello']): Promise<Buffer> {
  return Buffer.from(await makeMinimalDocx(texts));
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// ── createSession ───────────────────────────────────────────────────

describe('SessionManager.createSession', () => {
  it('returns a session with a valid ID format', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');

    expect(session.sessionId).toMatch(/^ses_[A-Za-z0-9]{12}$/);
    expect(session.filename).toBe('test.docx');
    expect(session.originalPath).toBe('/tmp/test.docx');
    expect(session.editCount).toBe(0);
    expect(session.editRevision).toBe(0);
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.lastAccessedAt).toBeInstanceOf(Date);
    expect(session.expiresAt).toBeInstanceOf(Date);

    // Cleanup
    tmpDirs.push(path.dirname(session.tmpPath));
  });

  it('writes document to temp directory', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');

    const exists = await fs.stat(session.tmpPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    tmpDirs.push(path.dirname(session.tmpPath));
  });

  it('loads a DocxDocument instance', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');

    expect(session.doc).toBeDefined();
    tmpDirs.push(path.dirname(session.tmpPath));
  });
});

// ── getSession ──────────────────────────────────────────────────────

describe('SessionManager.getSession', () => {
  it('retrieves a valid session by ID', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const created = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');

    const retrieved = mgr.getSession(created.sessionId);
    expect(retrieved.sessionId).toBe(created.sessionId);

    tmpDirs.push(path.dirname(created.tmpPath));
  });

  it('throws INVALID_SESSION_ID for malformed ID', () => {
    const mgr = new SessionManager();
    expect(() => mgr.getSession('bad_id')).toThrow('INVALID_SESSION_ID');
  });

  it('throws SESSION_NOT_FOUND for unknown valid ID', () => {
    const mgr = new SessionManager();
    expect(() => mgr.getSession('ses_AAAAAAAAAAAA')).toThrow('SESSION_NOT_FOUND');
  });

  it('throws SESSION_EXPIRED for expired session', async () => {
    const mgr = new SessionManager({ ttlMs: 1 }); // 1ms TTL
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 10));

    expect(() => mgr.getSession(session.sessionId)).toThrow('SESSION_EXPIRED');
    tmpDirs.push(path.dirname(session.tmpPath));
  });
});

// ── getMostRecentlyUsedSessionForPath ───────────────────────────────

describe('SessionManager.getMostRecentlyUsedSessionForPath', () => {
  it('returns null for unknown path', () => {
    const mgr = new SessionManager();
    expect(mgr.getMostRecentlyUsedSessionForPath('/nonexistent')).toBeNull();
  });

  it('returns the session for a matching path', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');
    const normalized = mgr.normalizePath('/tmp/test.docx');

    const found = mgr.getMostRecentlyUsedSessionForPath(normalized);
    expect(found).not.toBeNull();
    expect(found!.sessionId).toBe(session.sessionId);

    tmpDirs.push(path.dirname(session.tmpPath));
  });

  it('selects most recently accessed among multiple sessions', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const s1 = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');
    const s2 = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');

    // Guarantee s2 has a strictly later timestamp (wall clock may not advance between calls)
    s2.lastAccessedAt = new Date(s1.lastAccessedAt.getTime() + 1);

    const normalized = mgr.normalizePath('/tmp/test.docx');
    const found = mgr.getMostRecentlyUsedSessionForPath(normalized);
    expect(found!.sessionId).toBe(s2.sessionId);

    tmpDirs.push(path.dirname(s1.tmpPath));
    tmpDirs.push(path.dirname(s2.tmpPath));
  });

  it('prunes expired sessions', async () => {
    const mgr = new SessionManager({ ttlMs: 1 });
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');
    const normalized = mgr.normalizePath('/tmp/test.docx');

    await new Promise((r) => setTimeout(r, 10));

    expect(mgr.getMostRecentlyUsedSessionForPath(normalized)).toBeNull();
    tmpDirs.push(path.dirname(session.tmpPath));
  });
});

// ── clearSessionById ────────────────────────────────────────────────

describe('SessionManager.clearSessionById', () => {
  it('removes session and returns it', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');

    const cleared = await mgr.clearSessionById(session.sessionId);
    expect(cleared.sessionId).toBe(session.sessionId);

    // Session should no longer exist
    expect(() => mgr.getSession(session.sessionId)).toThrow('SESSION_NOT_FOUND');
  });

  it('cleans up temp directory', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');
    const tmpDir = path.dirname(session.tmpPath);

    await mgr.clearSessionById(session.sessionId);

    const exists = await fs.stat(tmpDir).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });
});

// ── clearAllSessions ────────────────────────────────────────────────

describe('SessionManager.clearAllSessions', () => {
  it('removes all sessions and returns their IDs', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const s1 = await mgr.createSession(buf, 'a.docx', '/tmp/a.docx');
    const s2 = await mgr.createSession(buf, 'b.docx', '/tmp/b.docx');

    const clearedIds = await mgr.clearAllSessions();

    expect(clearedIds).toContain(s1.sessionId);
    expect(clearedIds).toContain(s2.sessionId);
    expect(() => mgr.getSession(s1.sessionId)).toThrow('SESSION_NOT_FOUND');
    expect(() => mgr.getSession(s2.sessionId)).toThrow('SESSION_NOT_FOUND');
  });

  it('returns empty array when no sessions exist', async () => {
    const mgr = new SessionManager();
    const clearedIds = await mgr.clearAllSessions();
    expect(clearedIds).toEqual([]);
  });
});

// ── markEdited ──────────────────────────────────────────────────────

describe('SessionManager.markEdited', () => {
  it('increments editCount and editRevision', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');

    expect(session.editCount).toBe(0);
    expect(session.editRevision).toBe(0);

    mgr.markEdited(session);

    expect(session.editCount).toBe(1);
    expect(session.editRevision).toBe(1);

    mgr.markEdited(session);

    expect(session.editCount).toBe(2);
    expect(session.editRevision).toBe(2);

    tmpDirs.push(path.dirname(session.tmpPath));
  });

  it('clears save cache', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');

    // Simulate a cached save entry
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
      exportedAtUtc: new Date().toISOString(),
      cachedAtIso: new Date().toISOString(),
    });

    expect(session.saveCache.size).toBe(1);
    mgr.markEdited(session);
    expect(session.saveCache.size).toBe(0);

    tmpDirs.push(path.dirname(session.tmpPath));
  });

  it('clears extraction cache', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');

    session.extractionCache = { revision: 0, changes: [] };
    mgr.markEdited(session);
    expect(session.extractionCache).toBeNull();

    tmpDirs.push(path.dirname(session.tmpPath));
  });
});

// ── normalizePath ───────────────────────────────────────────────────

describe('SessionManager.normalizePath', () => {
  it('resolves relative paths', () => {
    const mgr = new SessionManager();
    const result = mgr.normalizePath('relative/path.docx');
    expect(path.isAbsolute(result)).toBe(true);
  });

  it('expands tilde to home directory', () => {
    const mgr = new SessionManager();
    const result = mgr.normalizePath('~/test.docx');
    const home = process.env.HOME || '';
    expect(result).toBe(path.resolve(path.join(home, 'test.docx')));
  });

  it('normalizes trailing slashes', () => {
    const mgr = new SessionManager();
    const withSlash = mgr.normalizePath('/tmp/dir/');
    const withoutSlash = mgr.normalizePath('/tmp/dir');
    expect(withSlash).toBe(withoutSlash);
  });

  it('resolves parent directory references', () => {
    const mgr = new SessionManager();
    const result = mgr.normalizePath('/tmp/foo/../bar');
    expect(result).toBe('/tmp/bar');
  });
});

// ── touch ───────────────────────────────────────────────────────────

describe('SessionManager.touch', () => {
  it('updates lastAccessedAt and resets expiresAt', async () => {
    const mgr = new SessionManager({ ttlMs: 60000 });
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');
    const originalAccess = session.lastAccessedAt.getTime();

    await new Promise((r) => setTimeout(r, 5));
    mgr.touch(session);

    expect(session.lastAccessedAt.getTime()).toBeGreaterThan(originalAccess);
    expect(session.expiresAt.getTime()).toBeGreaterThan(
      session.lastAccessedAt.getTime() + 59000
    );

    tmpDirs.push(path.dirname(session.tmpPath));
  });
});

// ── Cache methods ───────────────────────────────────────────────────

describe('SessionManager save cache', () => {
  it('returns null for missing cache key', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');

    expect(mgr.getSaveCache(session, 'missing')).toBeNull();
    tmpDirs.push(path.dirname(session.tmpPath));
  });

  it('stores and retrieves cache entries', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');

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
      exportedAtUtc: new Date().toISOString(),
      cachedAtIso: new Date().toISOString(),
    };

    mgr.setSaveCache(session, entry);
    const retrieved = mgr.getSaveCache(session, 'key1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.cacheKey).toBe('key1');

    tmpDirs.push(path.dirname(session.tmpPath));
  });
});

describe('SessionManager extraction cache', () => {
  it('returns null when no extraction cache', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');

    expect(mgr.getExtractionCache(session)).toBeNull();
    tmpDirs.push(path.dirname(session.tmpPath));
  });

  it('returns cache when revision matches', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');

    mgr.setExtractionCache(session, []);
    const cached = mgr.getExtractionCache(session);
    expect(cached).not.toBeNull();
    expect(cached!.revision).toBe(session.editRevision);

    tmpDirs.push(path.dirname(session.tmpPath));
  });

  it('returns null and clears when revision is stale', async () => {
    const mgr = new SessionManager();
    const buf = await createTestDoc();
    const session = await mgr.createSession(buf, 'test.docx', '/tmp/test.docx');

    mgr.setExtractionCache(session, []);
    mgr.markEdited(session); // increments revision, clears cache

    // Re-set with old revision (simulate stale cache)
    session.extractionCache = { revision: 0, changes: [] };
    const cached = mgr.getExtractionCache(session);
    expect(cached).toBeNull();
    expect(session.extractionCache).toBeNull();

    tmpDirs.push(path.dirname(session.tmpPath));
  });
});
