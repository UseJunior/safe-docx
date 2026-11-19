import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { buildDocxWithTitlePage } from '../testing/footer-story-fixture.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { DocxArchive, parseXml } from '@usejunior/docx-core';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'CLI Bin Symlink Entrypoint' });

const CLI_SOURCE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'index.ts');
const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const BUILT_CLI_PATH = join(PACKAGE_DIR, 'dist', 'cli', 'index.js');
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const tempDirs: string[] = [];

function runCliEntry(entryPath: string, args: string[]) {
  // --import tsx lets the spawned node execute the TypeScript source directly,
  // so the test exercises the entry guard without depending on a prior build.
  return spawnSync(process.execPath, ['--import', 'tsx', entryPath, ...args], {
    cwd: PACKAGE_DIR,
    encoding: 'utf8',
  });
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('docx-comparison bin entry guard', () => {
  test('executes the CLI when invoked through a node_modules/.bin-style symlink', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let symlinkPath!: string;
    let result!: ReturnType<typeof runCliEntry>;

    await given('a symlink to the CLI entrypoint, as npm creates in node_modules/.bin', () => {
      const binDir = mkdtempSync(join(tmpdir(), 'docx-comparison-bin-'));
      tempDirs.push(binDir);
      symlinkPath = join(binDir, 'docx-comparison');
      symlinkSync(CLI_SOURCE_PATH, symlinkPath);
    });

    await when('the bin is invoked through the symlink with --help', () => {
      result = runCliEntry(symlinkPath, ['--help']);
    });

    await then('the CLI runs and prints usage instead of silently exiting 0', () => {
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('Usage: docx-comparison');
    });
  });

  test('still executes the CLI when invoked by direct file path', async ({ when, then }: AllureBddContext) => {
    let result!: ReturnType<typeof runCliEntry>;

    await when('the entrypoint is invoked by its real path with --help', () => {
      result = runCliEntry(CLI_SOURCE_PATH, ['--help']);
    });

    await then('the CLI prints usage', () => {
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('Usage: docx-comparison');
    });
  });

  test('prints unrepresented-change warnings to stderr and keeps stdout a single JSON line (#1029)', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let dir!: string;
    let result!: ReturnType<typeof runCliEntry>;

    await given('an original without a distinct first page and a revision with one', async () => {
      dir = mkdtempSync(join(tmpdir(), 'docx-comparison-entry-unrepresented-'));
      tempDirs.push(dir);
      writeFileSync(join(dir, 'original.docx'), await buildDocxWithTitlePage('Body text', false));
      writeFileSync(join(dir, 'revised.docx'), await buildDocxWithTitlePage('Body text, revised', true));
    });

    await when('the entrypoint compares the pair by its real path', () => {
      result = runCliEntry(CLI_SOURCE_PATH, [join(dir, 'original.docx'), join(dir, 'revised.docx')]);
    });

    await then('stderr carries the warning and stdout is one JSON line with both fields', () => {
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain('changed section properties in section 1');
      const lines = result.stdout.trim().split('\n');
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(parsed.unrepresented_changes).toEqual([
        { scope: 'section', kind: 'changed', sectionIndex: 0 },
      ]);
      expect(parsed.warnings).toHaveLength(1);
    });
  });
  test('the built bin defaults to readable-semantic grouping when --grouping is omitted (#1526)', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let dir!: string;
    const runBuilt = (output: string, extra: string[]) =>
      spawnSync(process.execPath, [
        BUILT_CLI_PATH, join(dir, 'original.docx'), join(dir, 'revised.docx'), join(dir, output), '--no-date', ...extra,
      ], { cwd: PACKAGE_DIR, encoding: 'utf8' });
    const bodyParagraphChildren = async (output: string) => {
      const xml = await (await DocxArchive.load(readFileSync(join(dir, output)))).getDocumentXml();
      const paragraph = parseXml(xml).getElementsByTagNameNS(W_NS, 'body')[0]!.getElementsByTagNameNS(W_NS, 'p')[0]!;
      return { xml, names: Array.from(paragraph.childNodes)
        .filter((node): node is Element => node.nodeType === 1)
        .map((node) => node.localName)
        .filter((name) => name !== 'pPr') };
    };

    await given('the built CLI and a rewritten one-paragraph pair', async () => {
      expect(existsSync(BUILT_CLI_PATH), `run npm run build first: ${BUILT_CLI_PATH}`).toBe(true);
      dir = mkdtempSync(join(tmpdir(), 'docx-comparison-built-default-'));
      tempDirs.push(dir);
      writeFileSync(join(dir, 'original.docx'), await buildDocxFromBodyXml(
        '<w:p><w:r><w:t xml:space="preserve">This Agreement is made by Alpha Holdings LLC, a Texas limited liability company located at 1 Main Street, and Beta Fund, LP, a Texas limited partnership.</w:t></w:r></w:p>'));
      writeFileSync(join(dir, 'revised.docx'), await buildDocxFromBodyXml(
        '<w:p><w:r><w:t xml:space="preserve">This Agreement is made by Gamma Fund LP, a Delaware limited partnership, [NAME OF GENERAL PARTNER], a Delaware limited liability company, and Alpha Holdings LLC, a Delaware limited liability company located at 1 Main Street.</w:t></w:r></w:p>'));
    });

    const runs = await when('the built bin runs without --grouping, and with each explicit grouping', () => ({
      defaulted: runBuilt('default.docx', []),
      readable: runBuilt('readable.docx', ['--grouping', 'readable-semantic']),
      minimal: runBuilt('minimal.docx', ['--grouping', 'token-minimal']),
    }));

    await then('every run succeeds', () => {
      for (const result of Object.values(runs)) {
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
      }
    });
    await and('the default redline is the readable-semantic one: anchor, one deletion, one insertion, anchor', async () => {
      const defaulted = await bodyParagraphChildren('default.docx');
      const readable = await bodyParagraphChildren('readable.docx');
      const minimal = await bodyParagraphChildren('minimal.docx');
      expect(defaulted.names).toEqual(['r', 'del', 'ins', 'r']);
      expect(defaulted.xml).toBe(readable.xml);
      expect(minimal.names.length).toBeGreaterThan(defaulted.names.length);
    });
  });
});
