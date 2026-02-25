/**
 * E2E regression tests for Open Agreements document round-trip fidelity.
 *
 * These tests use real fixtures (Mutual NDA & Letter of Intent) generated
 * from the Open Agreements API to verify that the full pipeline —
 * open → edit → download (clean + tracked) — preserves document structure
 * including tables, XML declarations, and produces correct tracked changes.
 */
import { describe, expect, afterEach } from 'vitest';
import { testAllure as test } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocxZip } from '@usejunior/docx-core';

import { SessionManager } from '../session/manager.js';
import { openDocument } from './open_document.js';
import { readFile } from './read_file.js';
import { grep } from './grep.js';
import { replaceText } from './replace_text.js';
import { download } from './download.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../../tests/test_documents/open-agreements');

function fixtureDocx(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function createMgr(): SessionManager {
  return new SessionManager({ ttlMs: 60 * 60 * 1000 });
}

const tempDirs: string[] = [];

function registerTempCleanup(): void {
  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

async function makeTempDir(prefix = 'safe-docx-e2e-'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function countTables(xml: string): number {
  return (xml.match(/<w:tbl[\s>]/g) || []).length;
}

function hasXmlDeclaration(xml: string): boolean {
  return xml.trimStart().startsWith('<?xml');
}

async function countUnchangedEntries(
  originalPath: string,
  outputPath: string,
): Promise<{ unchanged: number; total: number }> {
  const origZip = await DocxZip.load(await fs.readFile(originalPath) as Buffer);
  const outZip = await DocxZip.load(await fs.readFile(outputPath) as Buffer);
  const origFiles = origZip.listFiles().filter(f => !f.endsWith('/'));
  let unchanged = 0;
  for (const entry of origFiles) {
    if (outZip.hasFile(entry)) {
      const origText = await origZip.readText(entry).catch(() => null);
      const outText = await outZip.readText(entry).catch(() => null);
      if (origText !== null && outText !== null && origText === outText) {
        unchanged++;
      }
    }
  }
  return { unchanged, total: origFiles.length };
}

// ---------------------------------------------------------------------------
// Mutual NDA E2E
// ---------------------------------------------------------------------------

describe('Open Agreements E2E: Mutual NDA', () => {
  registerTempCleanup();

  test('no-edit round-trip produces zero false tracked changes', async () => {
    const mgr = createMgr();
    const docPath = fixtureDocx('mutual-nda.docx');
    const tmpDir = await makeTempDir();

    // Open
    const openRes = await openDocument(mgr, { file_path: docPath });
    expect(openRes.success).toBe(true);
    const sid = openRes.session_id as string;

    // Download both without any edits
    const cleanPath = path.join(tmpDir, 'nda-nochange-clean.docx');
    const trackedPath = path.join(tmpDir, 'nda-nochange-tracked.docx');
    const dlRes = await download(mgr, {
      session_id: sid,
      save_to_local_path: cleanPath,
      download_format: 'both',
      tracked_save_to_local_path: trackedPath,
      tracked_changes_author: 'E2E Test',
      fail_on_rebuild_fallback: true,
    });
    expect(dlRes.success).toBe(true);

    // Verify: zero false tracked changes
    const stats = (dlRes as Record<string, unknown>).tracked_changes_stats as
      { insertions: number; deletions: number; modifications: number } | undefined;
    expect(stats).toBeDefined();
    const totalChanges = (stats!.insertions + stats!.deletions + stats!.modifications);
    expect(totalChanges).toBe(0);

    // Verify: inplace reconstruction (not rebuild)
    expect((dlRes as Record<string, unknown>).tracked_reconstruction_mode).not.toBe('rebuild');

    // Verify: tables preserved in both outputs
    const origZip = await DocxZip.load(await fs.readFile(docPath) as Buffer);
    const origDocXml = await origZip.readText('word/document.xml');
    const origTables = countTables(origDocXml);
    expect(origTables).toBeGreaterThan(0); // NDA has tables

    const cleanZip = await DocxZip.load(await fs.readFile(cleanPath) as Buffer);
    const cleanDocXml = await cleanZip.readText('word/document.xml');
    expect(countTables(cleanDocXml)).toBe(origTables);

    const trackedZip = await DocxZip.load(await fs.readFile(trackedPath) as Buffer);
    const trackedDocXml = await trackedZip.readText('word/document.xml');
    expect(countTables(trackedDocXml)).toBeGreaterThanOrEqual(origTables);

    // Verify: XML declarations preserved
    expect(hasXmlDeclaration(cleanDocXml)).toBe(true);
    expect(hasXmlDeclaration(trackedDocXml)).toBe(true);
  });

  test('single word edit produces correct tracked changes and preserves tables', async () => {
    const mgr = createMgr();
    const docPath = fixtureDocx('mutual-nda.docx');
    const tmpDir = await makeTempDir();

    // Open
    const openRes = await openDocument(mgr, { file_path: docPath });
    expect(openRes.success).toBe(true);
    const sid = openRes.session_id as string;

    // Read to confirm content
    const readRes = await readFile(mgr, { session_id: sid, limit: 20 });
    expect(readRes.success).toBe(true);

    // Grep for a word to edit
    const grepRes = await grep(mgr, {
      session_id: sid,
      patterns: ['partnership'],
      max_results: 3,
    });
    expect(grepRes.success).toBe(true);
    const matches = (grepRes as Record<string, unknown>).matches as Array<{ para_id: string }>;

    // Skip if "partnership" not in this fixture version
    if (matches.length === 0) return;

    const paraId = matches[0]!.para_id;

    // Edit: partnership → collaboration
    const editRes = await replaceText(mgr, {
      session_id: sid,
      target_paragraph_id: paraId,
      old_string: 'partnership',
      new_string: 'collaboration',
      instruction: 'Change partnership to collaboration',
    });
    expect(editRes.success).toBe(true);

    // Download both
    const cleanPath = path.join(tmpDir, 'nda-edited-clean.docx');
    const trackedPath = path.join(tmpDir, 'nda-edited-tracked.docx');
    const dlRes = await download(mgr, {
      session_id: sid,
      save_to_local_path: cleanPath,
      download_format: 'both',
      tracked_save_to_local_path: trackedPath,
      tracked_changes_author: 'E2E Test',
      fail_on_rebuild_fallback: true,
    });
    expect(dlRes.success).toBe(true);

    // Verify: edit present in both outputs
    const cleanZip = await DocxZip.load(await fs.readFile(cleanPath) as Buffer);
    const cleanDocXml = await cleanZip.readText('word/document.xml');
    expect(cleanDocXml).toContain('collaboration');

    const trackedZip = await DocxZip.load(await fs.readFile(trackedPath) as Buffer);
    const trackedDocXml = await trackedZip.readText('word/document.xml');
    expect(trackedDocXml).toContain('collaboration');

    // Verify: tracked changes are small (just the word replacement)
    const stats = (dlRes as Record<string, unknown>).tracked_changes_stats as
      { insertions: number; deletions: number; modifications: number };
    expect(stats).toBeDefined();
    const totalChanges = stats.insertions + stats.deletions + stats.modifications;
    expect(totalChanges).toBeGreaterThan(0);
    expect(totalChanges).toBeLessThan(10);

    // Verify: reconstruction mode is inplace
    expect((dlRes as Record<string, unknown>).tracked_reconstruction_mode).not.toBe('rebuild');

    // Verify: tables preserved
    const origZip = await DocxZip.load(await fs.readFile(docPath) as Buffer);
    const origDocXml = await origZip.readText('word/document.xml');
    const origTables = countTables(origDocXml);
    expect(countTables(cleanDocXml)).toBe(origTables);
    expect(countTables(trackedDocXml)).toBeGreaterThanOrEqual(origTables);

    // Verify: XML declarations preserved
    expect(hasXmlDeclaration(cleanDocXml)).toBe(true);
    expect(hasXmlDeclaration(trackedDocXml)).toBe(true);

    // Verify: most zip entries unchanged (only document.xml should differ)
    const { unchanged, total } = await countUnchangedEntries(docPath, cleanPath);
    expect(unchanged).toBeGreaterThanOrEqual(total - 2);
  });
});

// ---------------------------------------------------------------------------
// Letter of Intent E2E
// ---------------------------------------------------------------------------

describe('Open Agreements E2E: Letter of Intent', () => {
  registerTempCleanup();

  test('no-edit round-trip produces zero false tracked changes', async () => {
    const mgr = createMgr();
    const docPath = fixtureDocx('letter-of-intent.docx');
    const tmpDir = await makeTempDir();

    // Open
    const openRes = await openDocument(mgr, { file_path: docPath });
    expect(openRes.success).toBe(true);
    const sid = openRes.session_id as string;

    // Download both without any edits
    const cleanPath = path.join(tmpDir, 'loi-nochange-clean.docx');
    const trackedPath = path.join(tmpDir, 'loi-nochange-tracked.docx');
    const dlRes = await download(mgr, {
      session_id: sid,
      save_to_local_path: cleanPath,
      download_format: 'both',
      tracked_save_to_local_path: trackedPath,
      tracked_changes_author: 'E2E Test',
      fail_on_rebuild_fallback: true,
    });
    expect(dlRes.success).toBe(true);

    // Verify: zero false tracked changes
    const stats = (dlRes as Record<string, unknown>).tracked_changes_stats as
      { insertions: number; deletions: number; modifications: number } | undefined;
    expect(stats).toBeDefined();
    const totalChanges = (stats!.insertions + stats!.deletions + stats!.modifications);
    expect(totalChanges).toBe(0);

    // Verify: inplace reconstruction
    expect((dlRes as Record<string, unknown>).tracked_reconstruction_mode).not.toBe('rebuild');

    // Verify: XML declaration preserved
    const cleanZip = await DocxZip.load(await fs.readFile(cleanPath) as Buffer);
    const cleanDocXml = await cleanZip.readText('word/document.xml');
    expect(hasXmlDeclaration(cleanDocXml)).toBe(true);

    const trackedZip = await DocxZip.load(await fs.readFile(trackedPath) as Buffer);
    const trackedDocXml = await trackedZip.readText('word/document.xml');
    expect(hasXmlDeclaration(trackedDocXml)).toBe(true);
  });

  test('single word edit produces correct tracked changes', async () => {
    const mgr = createMgr();
    const docPath = fixtureDocx('letter-of-intent.docx');
    const tmpDir = await makeTempDir();

    // Open
    const openRes = await openDocument(mgr, { file_path: docPath });
    expect(openRes.success).toBe(true);
    const sid = openRes.session_id as string;

    // Read content
    const readRes = await readFile(mgr, { session_id: sid, limit: 30 });
    expect(readRes.success).toBe(true);
    const content = String((readRes as Record<string, unknown>).content ?? '');

    // Find a word to edit (use "agreement" which commonly appears in legal docs)
    const grepRes = await grep(mgr, {
      session_id: sid,
      patterns: ['agreement'],
      max_results: 3,
    });
    expect(grepRes.success).toBe(true);
    const matches = (grepRes as Record<string, unknown>).matches as Array<{ para_id: string }>;

    // Skip if word not found in this fixture version
    if (matches.length === 0) return;

    const paraId = matches[0]!.para_id;

    // Edit: first "agreement" → "arrangement"
    const editRes = await replaceText(mgr, {
      session_id: sid,
      target_paragraph_id: paraId,
      old_string: 'agreement',
      new_string: 'arrangement',
      instruction: 'Change agreement to arrangement',
    });
    expect(editRes.success).toBe(true);

    // Download both
    const cleanPath = path.join(tmpDir, 'loi-edited-clean.docx');
    const trackedPath = path.join(tmpDir, 'loi-edited-tracked.docx');
    const dlRes = await download(mgr, {
      session_id: sid,
      save_to_local_path: cleanPath,
      download_format: 'both',
      tracked_save_to_local_path: trackedPath,
      tracked_changes_author: 'E2E Test',
      fail_on_rebuild_fallback: true,
    });
    expect(dlRes.success).toBe(true);

    // Verify: edit present in both outputs
    const cleanZip = await DocxZip.load(await fs.readFile(cleanPath) as Buffer);
    const cleanDocXml = await cleanZip.readText('word/document.xml');
    expect(cleanDocXml).toContain('arrangement');

    const trackedZip = await DocxZip.load(await fs.readFile(trackedPath) as Buffer);
    const trackedDocXml = await trackedZip.readText('word/document.xml');
    expect(trackedDocXml).toContain('arrangement');

    // Verify: tracked changes are small (just the word replacement)
    const stats = (dlRes as Record<string, unknown>).tracked_changes_stats as
      { insertions: number; deletions: number; modifications: number };
    expect(stats).toBeDefined();
    const totalChanges = stats.insertions + stats.deletions + stats.modifications;
    expect(totalChanges).toBeGreaterThan(0);
    expect(totalChanges).toBeLessThan(10);

    // Verify: reconstruction mode is inplace
    expect((dlRes as Record<string, unknown>).tracked_reconstruction_mode).not.toBe('rebuild');

    // Verify: XML declarations preserved
    expect(hasXmlDeclaration(cleanDocXml)).toBe(true);
    expect(hasXmlDeclaration(trackedDocXml)).toBe(true);
  });
});
