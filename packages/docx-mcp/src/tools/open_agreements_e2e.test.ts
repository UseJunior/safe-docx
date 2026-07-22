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
import { DocxZip, parseXml } from '@usejunior/docx-core';

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

// Production MCP sessions always carry an AI author, so edits emit write-time
// tracked markup that the tracked artifact serializes directly (#126). The
// author matches `tracked_changes_author` below so the save report's stats
// count these revisions.
const E2E_AUTHOR = 'E2E Test';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function createMgr(): SessionManager {
  return new SessionManager({ ttlMs: 60 * 60 * 1000, defaultAiAuthor: E2E_AUTHOR });
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

// Concatenate the text of every <w:t> run, ignoring run boundaries and the
// pretty-print whitespace between them. Write-time redlines split edited words
// across runs (char-level minimal diff), so a raw-XML substring check is
// unreliable; the concatenated run text is the reading a user actually sees
// (kept + inserted text; deleted <w:delText> is excluded).
function concatRunText(documentXml: string): string {
  const dom = parseXml(documentXml);
  const runs = Array.from(dom.getElementsByTagNameNS(W_NS, 't')) as Element[];
  return runs.map((run) => run.textContent ?? '').join('');
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
  inputPath: string,
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
      file_path: inputPath,
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
        file_path: inputPath,
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
    let filePath: string;
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
      filePath = openRes.file_path as string;
      cleanPath = path.join(tmpDir, 'nda-nochange-clean.docx');
      trackedPath = path.join(tmpDir, 'nda-nochange-tracked.docx');
    });

    await when('both clean and tracked outputs are saved without any edits', async () => {
      dlRes = await save(mgr, {
        file_path: filePath,
        save_to_local_path: cleanPath,
        save_format: 'both',
        tracked_save_to_local_path: trackedPath,
        tracked_changes_author: E2E_AUTHOR,
      });
      expect(dlRes.success).toBe(true);
    });

    await then('the save produces zero false tracked changes from write-time markup', () => {
      const stats = (dlRes as Record<string, unknown>).tracked_changes_stats as
        { insertions: number; deletions: number; modifications: number } | undefined;
      expect(stats).toBeDefined();
      const totalChanges = (stats!.insertions + stats!.deletions + stats!.modifications);
      expect(totalChanges).toBe(0);
      expect((dlRes as Record<string, unknown>).tracked_changes_source).toBe('write-time');
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
    let filePath: string;
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
      filePath = openRes.file_path as string;

      const readRes = await readFile(mgr, { file_path: filePath, limit: 20 });
      expect(readRes.success).toBe(true);

      const grepRes = await grep(mgr, {
        file_path: filePath,
        patterns: ['partnership'],
        max_results: 3,
      });
      expect(grepRes.success).toBe(true);
      const matches = (grepRes as Record<string, unknown>).matches as Array<{ para_id: string }>;
      if (matches.length === 0) return;

      const paraId = matches[0]!.para_id;
      const editRes = await replaceText(mgr, {
        file_path: filePath,
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
        file_path: filePath,
        save_to_local_path: cleanPath,
        save_format: 'both',
        tracked_save_to_local_path: trackedPath,
        tracked_changes_author: E2E_AUTHOR,
      });
      expect(dlRes.success).toBe(true);

      const cleanZip = await DocxZip.load(await fs.readFile(cleanPath) as Buffer);
      cleanDocXml = await cleanZip.readText('word/document.xml');
      const trackedZip = await DocxZip.load(await fs.readFile(trackedPath) as Buffer);
      trackedDocXml = await trackedZip.readText('word/document.xml');
    });

    await then('both outputs contain the replacement word and tracked changes are minimal', () => {
      expect(concatRunText(cleanDocXml)).toContain('collaboration');
      expect(concatRunText(trackedDocXml)).toContain('collaboration');

      const stats = (dlRes as Record<string, unknown>).tracked_changes_stats as
        { insertions: number; deletions: number; modifications: number };
      expect(stats).toBeDefined();
      const totalChanges = stats.insertions + stats.deletions + stats.modifications;
      expect(totalChanges).toBeGreaterThan(0);
      expect(totalChanges).toBeLessThan(10);
      expect((dlRes as Record<string, unknown>).tracked_changes_source).toBe('write-time');
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
    let filePath: string;
    let cleanPath: string;
    let trackedPath: string;
    let dlRes: Awaited<ReturnType<typeof save>>;

    await given('the Letter of Intent fixture is open with no edits applied', async () => {
      mgr = createMgr();
      const docPath = fixtureDocx('letter-of-intent.docx');
      const tmpDir = await makeTempDir();
      const openRes = await openDocument(mgr, { file_path: docPath });
      expect(openRes.success).toBe(true);
      filePath = openRes.file_path as string;
      cleanPath = path.join(tmpDir, 'loi-nochange-clean.docx');
      trackedPath = path.join(tmpDir, 'loi-nochange-tracked.docx');
    });

    await when('both clean and tracked outputs are saved without any edits', async () => {
      dlRes = await save(mgr, {
        file_path: filePath,
        save_to_local_path: cleanPath,
        save_format: 'both',
        tracked_save_to_local_path: trackedPath,
        tracked_changes_author: E2E_AUTHOR,
      });
      expect(dlRes.success).toBe(true);
    });

    await then('zero false tracked changes are produced from write-time markup', () => {
      const stats = (dlRes as Record<string, unknown>).tracked_changes_stats as
        { insertions: number; deletions: number; modifications: number } | undefined;
      expect(stats).toBeDefined();
      const totalChanges = (stats!.insertions + stats!.deletions + stats!.modifications);
      expect(totalChanges).toBe(0);
      expect((dlRes as Record<string, unknown>).tracked_changes_source).toBe('write-time');
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
    let filePath: string;
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
      filePath = openRes.file_path as string;

      const readRes = await readFile(mgr, { file_path: filePath, limit: 30 });
      expect(readRes.success).toBe(true);

      const grepRes = await grep(mgr, {
        file_path: filePath,
        patterns: ['agreement'],
        max_results: 3,
      });
      expect(grepRes.success).toBe(true);
      const matches = (grepRes as Record<string, unknown>).matches as Array<{ para_id: string }>;

      if (matches.length === 0) return;

      const paraId = matches[0]!.para_id;
      const editRes = await replaceText(mgr, {
        file_path: filePath,
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
        file_path: filePath,
        save_to_local_path: cleanPath,
        save_format: 'both',
        tracked_save_to_local_path: trackedPath,
        tracked_changes_author: E2E_AUTHOR,
      });
      expect(dlRes.success).toBe(true);

      const cleanZip = await DocxZip.load(await fs.readFile(cleanPath) as Buffer);
      cleanDocXml = await cleanZip.readText('word/document.xml');
      const trackedZip = await DocxZip.load(await fs.readFile(trackedPath) as Buffer);
      trackedDocXml = await trackedZip.readText('word/document.xml');
    });

    await then('both outputs contain the replacement word and tracked changes are minimal', () => {
      // Write-time redlines are char-level minimal diffs, so the new word can
      // span multiple runs (e.g. "a" + "rrang" + "ement"). Assert on the
      // concatenated run text, which is robust to run boundaries and the
      // pretty-print whitespace between them; a raw-XML substring is not.
      expect(concatRunText(cleanDocXml)).toContain('arrangement');
      expect(concatRunText(trackedDocXml)).toContain('arrangement');

      const stats = (dlRes as Record<string, unknown>).tracked_changes_stats as
        { insertions: number; deletions: number; modifications: number };
      expect(stats).toBeDefined();
      const totalChanges = stats.insertions + stats.deletions + stats.modifications;
      expect(totalChanges).toBeGreaterThan(0);
      expect(totalChanges).toBeLessThan(10);
      expect((dlRes as Record<string, unknown>).tracked_changes_source).toBe('write-time');
    });
    await and('XML declarations are preserved in both outputs', () => {
      expect(hasXmlDeclaration(cleanDocXml)).toBe(true);
      expect(hasXmlDeclaration(trackedDocXml)).toBe(true);
    });
  });
});

describe('Open Agreements E2E: Run-fragmented templates preserve table structure', () => {
  registerTempCleanup();

  const fixtures = [
    'bonterms-mutual-nda.docx',
    'common-paper-mutual-nda.docx',
  ] as const;

  for (const fixture of fixtures) {
    test(`${fixture} preserves table structure through a write-time tracked save`, async ({ given, when, then, and }: AllureBddContext) => {
      let mgr: ReturnType<typeof createMgr>;
      let filePath: string;
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
        filePath = openRes.file_path as string;

        const replacement = await applyFirstUniqueReplacement(mgr, filePath);
        expect(replacement).not.toBeNull();
        newText = replacement!.newText;

        cleanPath = path.join(tmpDir, `${fixture}.edited.clean.docx`);
        trackedPath = path.join(tmpDir, `${fixture}.edited.tracked.docx`);
      });

      await when('both clean and tracked outputs are saved', async () => {
        dlRes = await save(mgr, {
          file_path: filePath,
          save_to_local_path: cleanPath,
          save_format: 'both',
          tracked_save_to_local_path: trackedPath,
          tracked_changes_author: E2E_AUTHOR,
        });
        expect(dlRes.success).toBe(true);

        const origZip = await DocxZip.load(await fs.readFile(docPath) as Buffer);
        const cleanZip = await DocxZip.load(await fs.readFile(cleanPath) as Buffer);
        const trackedZip = await DocxZip.load(await fs.readFile(trackedPath) as Buffer);
        origDocXml = await origZip.readText('word/document.xml');
        cleanDocXml = await cleanZip.readText('word/document.xml');
        trackedDocXml = await trackedZip.readText('word/document.xml');
      });

      await then('the redline is write-time markup and table counts are preserved', () => {
        expect((dlRes as Record<string, unknown>).tracked_changes_source).toBe('write-time');

        const origTables = countTables(origDocXml);
        expect(origTables).toBeGreaterThan(0);
        expect(countTables(cleanDocXml)).toBe(origTables);
        expect(countTables(trackedDocXml)).toBeGreaterThanOrEqual(origTables);
      });
      await and('the replacement text appears in both outputs and tracked changes are minimal', () => {
        expect(concatRunText(cleanDocXml)).toContain(newText);
        expect(concatRunText(trackedDocXml)).toContain(newText);

        const stats = (dlRes as Record<string, unknown>).tracked_changes_stats as
          { insertions: number; deletions: number; modifications: number };
        const totalChanges = stats.insertions + stats.deletions + stats.modifications;
        expect(totalChanges).toBeGreaterThan(0);
        expect(totalChanges).toBeLessThan(20);
      });
    });
  }
});
