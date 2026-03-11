/**
 * E2E regression tests for Open Agreements document round-trip fidelity.
 *
 * These tests use real fixtures (Mutual NDA & Letter of Intent) generated
 * from the Open Agreements API to verify that the full pipeline —
 * open → edit → download (clean + tracked) — preserves document structure
 * including tables, XML declarations, and produces correct tracked changes.
 */
import { describe, expect, afterEach } from 'vitest';
import { testAllure as test, type AllureBddContext } from '../testing/allure-test.js';
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
import { save } from './save.js';

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

async function applyFirstUniqueReplacement(
  mgr: SessionManager,
  sessionId: string,
): Promise<{ pattern: string; paraId: string; oldText: string; newText: string } | null> {
  const patterns = [
    'agreement',
    'partnership',
    'expires',
    'confidential',
    'service',
    'term',
    'date',
  ];

  for (const pattern of patterns) {
    const grepRes = await grep(mgr, {
      session_id: sessionId,
      patterns: [pattern],
      max_results: 10,
      dedupe_by_paragraph: true,
    });
    if (!grepRes.success) continue;
    const matches = (grepRes as Record<string, unknown>).matches as Array<{
      para_id: string;
      match_text: string;
    }>;
    for (const match of matches) {
      const oldText = String(match.match_text ?? '').trim();
      if (!oldText || oldText.length < 3) continue;
      const newText = `${oldText}_E2E`;
      const editRes = await replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: match.para_id,
        old_string: oldText,
        new_string: newText,
        instruction: `Replace ${oldText} with ${newText}`,
      });

      if (editRes.success) {
        return { pattern, paraId: match.para_id, oldText, newText };
      }

      const errorCode = (editRes as Record<string, unknown>)?.error
        ? String(((editRes as Record<string, unknown>).error as Record<string, unknown>).code ?? '')
        : '';
      if (errorCode === 'MULTIPLE_MATCHES' || errorCode === 'NOT_FOUND') {
        continue;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Mutual NDA E2E
// ---------------------------------------------------------------------------

describe('Open Agreements E2E: Mutual NDA', () => {
  registerTempCleanup();

  test('no-edit round-trip produces zero false tracked changes', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createMgr>;
    let sid: string;
    let docPath: string;
    let cleanPath: string;
    let trackedPath: string;
    let dlRes: Awaited<ReturnType<typeof save>>;

    await given('the Mutual NDA fixture is open with no edits applied', async () => {
      mgr = createMgr();
      docPath = fixtureDocx('mutual-nda.docx');
      const tmpDir = await makeTempDir();
      const openRes = await openDocument(mgr, { file_path: docPath });
      expect(openRes.success).toBe(true);
      sid = openRes.session_id as string;
      cleanPath = path.join(tmpDir, 'nda-nochange-clean.docx');
      trackedPath = path.join(tmpDir, 'nda-nochange-tracked.docx');
    });

    await when('both clean and tracked outputs are saved without any edits', async () => {
      dlRes = await save(mgr, {
        session_id: sid,
        save_to_local_path: cleanPath,
        save_format: 'both',
        tracked_save_to_local_path: trackedPath,
        tracked_changes_author: 'E2E Test',
        fail_on_rebuild_fallback: true,
      });
      expect(dlRes.success).toBe(true);
    });

    await then('the save produces zero false tracked changes using inplace mode', () => {
      const stats = (dlRes as Record<string, unknown>).tracked_changes_stats as
        { insertions: number; deletions: number; modifications: number } | undefined;
      expect(stats).toBeDefined();
      const totalChanges = (stats!.insertions + stats!.deletions + stats!.modifications);
      expect(totalChanges).toBe(0);
      expect((dlRes as Record<string, unknown>).tracked_reconstruction_mode).not.toBe('rebuild');
    });
    await and('tables and XML declarations are preserved in both output variants', async () => {
      const origZip = await DocxZip.load(await fs.readFile(docPath) as Buffer);
      const origDocXml = await origZip.readText('word/document.xml');
      const origTables = countTables(origDocXml);
      expect(origTables).toBeGreaterThan(0);

      const cleanZip = await DocxZip.load(await fs.readFile(cleanPath) as Buffer);
      const cleanDocXml = await cleanZip.readText('word/document.xml');
      expect(countTables(cleanDocXml)).toBe(origTables);

      const trackedZip = await DocxZip.load(await fs.readFile(trackedPath) as Buffer);
      const trackedDocXml = await trackedZip.readText('word/document.xml');
      expect(countTables(trackedDocXml)).toBeGreaterThanOrEqual(origTables);
      expect(hasXmlDeclaration(cleanDocXml)).toBe(true);
      expect(hasXmlDeclaration(trackedDocXml)).toBe(true);
    });
  });

  test('single word edit produces correct tracked changes and preserves tables', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createMgr>;
    let sid: string;
    let docPath: string;
    let cleanPath: string;
    let trackedPath: string;
    let dlRes: Awaited<ReturnType<typeof save>>;
    let cleanDocXml: string;
    let trackedDocXml: string;

    await given('the Mutual NDA fixture is open with "partnership" replaced by "collaboration"', async () => {
      mgr = createMgr();
      docPath = fixtureDocx('mutual-nda.docx');
      const tmpDir = await makeTempDir();
      const openRes = await openDocument(mgr, { file_path: docPath });
      expect(openRes.success).toBe(true);
      sid = openRes.session_id as string;

      const readRes = await readFile(mgr, { session_id: sid, limit: 20 });
      expect(readRes.success).toBe(true);

      const grepRes = await grep(mgr, {
        session_id: sid,
        patterns: ['partnership'],
        max_results: 3,
      });
      expect(grepRes.success).toBe(true);
      const matches = (grepRes as Record<string, unknown>).matches as Array<{ para_id: string }>;
      if (matches.length === 0) return;

      const paraId = matches[0]!.para_id;
      const editRes = await replaceText(mgr, {
        session_id: sid,
        target_paragraph_id: paraId,
        old_string: 'partnership',
        new_string: 'collaboration',
        instruction: 'Change partnership to collaboration',
      });
      expect(editRes.success).toBe(true);

      cleanPath = path.join(tmpDir, 'nda-edited-clean.docx');
      trackedPath = path.join(tmpDir, 'nda-edited-tracked.docx');
    });

    await when('both clean and tracked outputs are saved', async () => {
      dlRes = await save(mgr, {
        session_id: sid,
        save_to_local_path: cleanPath,
        save_format: 'both',
        tracked_save_to_local_path: trackedPath,
        tracked_changes_author: 'E2E Test',
        fail_on_rebuild_fallback: true,
      });
      expect(dlRes.success).toBe(true);

      const cleanZip = await DocxZip.load(await fs.readFile(cleanPath) as Buffer);
      cleanDocXml = await cleanZip.readText('word/document.xml');
      const trackedZip = await DocxZip.load(await fs.readFile(trackedPath) as Buffer);
      trackedDocXml = await trackedZip.readText('word/document.xml');
    });

    await then('both outputs contain the replacement word and tracked changes are minimal', () => {
      expect(cleanDocXml).toContain('collaboration');
      expect(trackedDocXml).toContain('collaboration');

      const stats = (dlRes as Record<string, unknown>).tracked_changes_stats as
        { insertions: number; deletions: number; modifications: number };
      expect(stats).toBeDefined();
      const totalChanges = stats.insertions + stats.deletions + stats.modifications;
      expect(totalChanges).toBeGreaterThan(0);
      expect(totalChanges).toBeLessThan(10);
      expect((dlRes as Record<string, unknown>).tracked_reconstruction_mode).not.toBe('rebuild');
    });
    await and('tables, XML declarations, and most zip entries are unchanged', async () => {
      const origZip = await DocxZip.load(await fs.readFile(docPath) as Buffer);
      const origDocXml = await origZip.readText('word/document.xml');
      const origTables = countTables(origDocXml);
      expect(countTables(cleanDocXml)).toBe(origTables);
      expect(countTables(trackedDocXml)).toBeGreaterThanOrEqual(origTables);
      expect(hasXmlDeclaration(cleanDocXml)).toBe(true);
      expect(hasXmlDeclaration(trackedDocXml)).toBe(true);

      const { unchanged, total } = await countUnchangedEntries(docPath, cleanPath);
      expect(unchanged).toBeGreaterThanOrEqual(total - 2);
    });
  });
});

// ---------------------------------------------------------------------------
// Letter of Intent E2E
// ---------------------------------------------------------------------------

describe('Open Agreements E2E: Letter of Intent', () => {
  registerTempCleanup();

  test('no-edit round-trip produces zero false tracked changes', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createMgr>;
    let sid: string;
    let cleanPath: string;
    let trackedPath: string;
    let dlRes: Awaited<ReturnType<typeof save>>;

    await given('the Letter of Intent fixture is open with no edits applied', async () => {
      mgr = createMgr();
      const docPath = fixtureDocx('letter-of-intent.docx');
      const tmpDir = await makeTempDir();
      const openRes = await openDocument(mgr, { file_path: docPath });
      expect(openRes.success).toBe(true);
      sid = openRes.session_id as string;
      cleanPath = path.join(tmpDir, 'loi-nochange-clean.docx');
      trackedPath = path.join(tmpDir, 'loi-nochange-tracked.docx');
    });

    await when('both clean and tracked outputs are saved without any edits', async () => {
      dlRes = await save(mgr, {
        session_id: sid,
        save_to_local_path: cleanPath,
        save_format: 'both',
        tracked_save_to_local_path: trackedPath,
        tracked_changes_author: 'E2E Test',
        fail_on_rebuild_fallback: true,
      });
      expect(dlRes.success).toBe(true);
    });

    await then('zero false tracked changes are produced using inplace reconstruction', () => {
      const stats = (dlRes as Record<string, unknown>).tracked_changes_stats as
        { insertions: number; deletions: number; modifications: number } | undefined;
      expect(stats).toBeDefined();
      const totalChanges = (stats!.insertions + stats!.deletions + stats!.modifications);
      expect(totalChanges).toBe(0);
      expect((dlRes as Record<string, unknown>).tracked_reconstruction_mode).not.toBe('rebuild');
    });
    await and('XML declarations are preserved in both outputs', async () => {
      const cleanZip = await DocxZip.load(await fs.readFile(cleanPath) as Buffer);
      const cleanDocXml = await cleanZip.readText('word/document.xml');
      expect(hasXmlDeclaration(cleanDocXml)).toBe(true);

      const trackedZip = await DocxZip.load(await fs.readFile(trackedPath) as Buffer);
      const trackedDocXml = await trackedZip.readText('word/document.xml');
      expect(hasXmlDeclaration(trackedDocXml)).toBe(true);
    });
  });

  test('single word edit produces correct tracked changes', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createMgr>;
    let sid: string;
    let docPath: string;
    let cleanPath: string;
    let trackedPath: string;
    let dlRes: Awaited<ReturnType<typeof save>>;
    let cleanDocXml: string;
    let trackedDocXml: string;

    await given('the Letter of Intent fixture is open with "agreement" replaced by "arrangement"', async () => {
      mgr = createMgr();
      docPath = fixtureDocx('letter-of-intent.docx');
      const tmpDir = await makeTempDir();

      const openRes = await openDocument(mgr, { file_path: docPath });
      expect(openRes.success).toBe(true);
      sid = openRes.session_id as string;

      const readRes = await readFile(mgr, { session_id: sid, limit: 30 });
      expect(readRes.success).toBe(true);

      const grepRes = await grep(mgr, {
        session_id: sid,
        patterns: ['agreement'],
        max_results: 3,
      });
      expect(grepRes.success).toBe(true);
      const matches = (grepRes as Record<string, unknown>).matches as Array<{ para_id: string }>;

      if (matches.length === 0) return;

      const paraId = matches[0]!.para_id;
      const editRes = await replaceText(mgr, {
        session_id: sid,
        target_paragraph_id: paraId,
        old_string: 'agreement',
        new_string: 'arrangement',
        instruction: 'Change agreement to arrangement',
      });
      expect(editRes.success).toBe(true);

      cleanPath = path.join(tmpDir, 'loi-edited-clean.docx');
      trackedPath = path.join(tmpDir, 'loi-edited-tracked.docx');
    });

    await when('both clean and tracked outputs are saved', async () => {
      dlRes = await save(mgr, {
        session_id: sid,
        save_to_local_path: cleanPath,
        save_format: 'both',
        tracked_save_to_local_path: trackedPath,
        tracked_changes_author: 'E2E Test',
        fail_on_rebuild_fallback: true,
      });
      expect(dlRes.success).toBe(true);

      const cleanZip = await DocxZip.load(await fs.readFile(cleanPath) as Buffer);
      cleanDocXml = await cleanZip.readText('word/document.xml');
      const trackedZip = await DocxZip.load(await fs.readFile(trackedPath) as Buffer);
      trackedDocXml = await trackedZip.readText('word/document.xml');
    });

    await then('both outputs contain the replacement word and tracked changes are minimal', () => {
      expect(cleanDocXml).toContain('arrangement');
      expect(trackedDocXml).toContain('arrangement');

      const stats = (dlRes as Record<string, unknown>).tracked_changes_stats as
        { insertions: number; deletions: number; modifications: number };
      expect(stats).toBeDefined();
      const totalChanges = stats.insertions + stats.deletions + stats.modifications;
      expect(totalChanges).toBeGreaterThan(0);
      expect(totalChanges).toBeLessThan(10);
      expect((dlRes as Record<string, unknown>).tracked_reconstruction_mode).not.toBe('rebuild');
    });
    await and('XML declarations are preserved in both outputs', () => {
      expect(hasXmlDeclaration(cleanDocXml)).toBe(true);
      expect(hasXmlDeclaration(trackedDocXml)).toBe(true);
    });
  });
});

describe('Open Agreements E2E: Run-fragmented templates remain inplace', () => {
  registerTempCleanup();

  const fixtures = [
    'bonterms-mutual-nda.docx',
    'common-paper-mutual-nda.docx',
  ] as const;

  for (const fixture of fixtures) {
    test(`${fixture} stays inplace with table structure preserved`, async ({ given, when, then, and }: AllureBddContext) => {
      let mgr: ReturnType<typeof createMgr>;
      let sid: string;
      let docPath: string;
      let cleanPath: string;
      let trackedPath: string;
      let dlRes: Awaited<ReturnType<typeof save>>;
      let newText: string;
      let origDocXml: string;
      let cleanDocXml: string;
      let trackedDocXml: string;

      await given(`the ${fixture} fixture is open with a unique replacement applied`, async () => {
        mgr = createMgr();
        docPath = fixtureDocx(fixture);
        const tmpDir = await makeTempDir();

        const openRes = await openDocument(mgr, { file_path: docPath });
        expect(openRes.success).toBe(true);
        sid = openRes.session_id as string;

        const replacement = await applyFirstUniqueReplacement(mgr, sid);
        expect(replacement).not.toBeNull();
        newText = replacement!.newText;

        cleanPath = path.join(tmpDir, `${fixture}.edited.clean.docx`);
        trackedPath = path.join(tmpDir, `${fixture}.edited.tracked.docx`);
      });

      await when('both clean and tracked outputs are saved', async () => {
        dlRes = await save(mgr, {
          session_id: sid,
          save_to_local_path: cleanPath,
          save_format: 'both',
          tracked_save_to_local_path: trackedPath,
          tracked_changes_author: 'E2E Test',
          fail_on_rebuild_fallback: true,
        });
        expect(dlRes.success).toBe(true);

        const origZip = await DocxZip.load(await fs.readFile(docPath) as Buffer);
        const cleanZip = await DocxZip.load(await fs.readFile(cleanPath) as Buffer);
        const trackedZip = await DocxZip.load(await fs.readFile(trackedPath) as Buffer);
        origDocXml = await origZip.readText('word/document.xml');
        cleanDocXml = await cleanZip.readText('word/document.xml');
        trackedDocXml = await trackedZip.readText('word/document.xml');
      });

      await then('reconstruction mode is inplace and table counts are preserved', () => {
        expect((dlRes as Record<string, unknown>).tracked_reconstruction_mode).toBe('inplace');

        const origTables = countTables(origDocXml);
        expect(origTables).toBeGreaterThan(0);
        expect(countTables(cleanDocXml)).toBe(origTables);
        expect(countTables(trackedDocXml)).toBeGreaterThanOrEqual(origTables);
      });
      await and('the replacement text appears in both outputs and tracked changes are minimal', () => {
        expect(cleanDocXml).toContain(newText);
        expect(trackedDocXml).toContain(newText);

        const stats = (dlRes as Record<string, unknown>).tracked_changes_stats as
          { insertions: number; deletions: number; modifications: number };
        const totalChanges = stats.insertions + stats.deletions + stats.modifications;
        expect(totalChanges).toBeGreaterThan(0);
        expect(totalChanges).toBeLessThan(20);
      });
    });
  }
});
