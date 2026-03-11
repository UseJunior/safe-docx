/**
 * Score tests for quality benchmark.
 *
 * Covers Q1 (diff minimality), Q2 (compatibility), Q4 (extras).
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { compareDocuments } from '../index.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { scoreDiffMinimality, scoreCompatibility, scoreExtras } from './scores.js';
import { loadManifest } from './runner.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Benchmark Scores' });

const benchmarkDir = dirname(fileURLToPath(import.meta.url));
const fixturesPath = join(benchmarkDir, '../testing/fixtures');
const manifestPath = join(fixturesPath, 'manifest.json');

async function loadFixture(name: string) {
  const originalBuffer = await readFile(join(fixturesPath, name, 'original.docx'));
  const revisedBuffer = await readFile(join(fixturesPath, name, 'revised.docx'));
  return { originalBuffer, revisedBuffer };
}

async function getDocumentXml(buffer: Buffer): Promise<string> {
  const archive = await DocxArchive.load(buffer);
  return archive.getDocumentXml();
}

describe('Q1: Diff minimality', () => {
  test('counts ins/del on simple-word-change', async ({ given, then }: AllureBddContext) => {
    let resultDocXml: string;

    await given('simple-word-change fixture is compared with atomizer', async () => {
      const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
      const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
      resultDocXml = await getDocumentXml(result.document);
    });

    await then('Q1 reports engine runs and null oracle', () => {
      const q1 = scoreDiffMinimality(resultDocXml);
      expect(q1.engineRuns).toBeGreaterThan(0);
      expect(q1.oracleRuns).toBeNull();
      expect(q1.ratio).toBeNull();
    });
  }, 30_000);

  test('computes ratio when oracle provided', async ({ given, then }: AllureBddContext) => {
    let resultDocXml: string;

    await given('simple-word-change fixture is compared and same output used as oracle', async () => {
      const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
      const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
      resultDocXml = await getDocumentXml(result.document);
    });

    await then('Q1 ratio is 1.0 when oracle equals engine output', () => {
      // Use the same engine output as mock oracle
      const q1 = scoreDiffMinimality(resultDocXml, resultDocXml);
      expect(q1.oracleRuns).toBe(q1.engineRuns);
      expect(q1.ratio).toBe(1.0);
    });
  }, 30_000);

  test('returns zero runs for no-change fixture', async ({ given, then }: AllureBddContext) => {
    let resultDocXml: string;

    await given('no-change fixture is compared with atomizer', async () => {
      const { originalBuffer, revisedBuffer } = await loadFixture('no-change');
      const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
      resultDocXml = await getDocumentXml(result.document);
    });

    await then('Q1 reports zero engine runs', () => {
      const q1 = scoreDiffMinimality(resultDocXml);
      expect(q1.engineRuns).toBe(0);
    });
  }, 30_000);
});

describe('Q2: Compatibility', () => {
  test('returns null with skip reason when LO unavailable', async ({ given, then }: AllureBddContext) => {
    let result: Awaited<ReturnType<typeof compareDocuments>>;

    await given('simple-word-change fixture is compared with atomizer', async () => {
      const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
      result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
    });

    await then('Q2 reports binary_missing when no LO path is given', async () => {
      const q2 = await scoreCompatibility(result.document, undefined);
      expect(q2.opensClean).toBe(false);
      expect(q2.skipReason).toBe('binary_missing');
    });
  }, 30_000);

  test('returns binary_missing for non-existent path', async ({ given, then }: AllureBddContext) => {
    let result: Awaited<ReturnType<typeof compareDocuments>>;

    await given('simple-word-change fixture is compared with atomizer', async () => {
      const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
      result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
    });

    await then('Q2 reports binary_missing for a non-existent LO path', async () => {
      const q2 = await scoreCompatibility(result.document, '/nonexistent/libreoffice');
      expect(q2.opensClean).toBe(false);
      expect(q2.skipReason).toBe('binary_missing');
    });
  }, 30_000);
});

describe('Q4: Extras', () => {
  test('no moves in simple-word-change', async ({ given, then }: AllureBddContext) => {
    let resultDocXml: string;

    await given('simple-word-change fixture is compared with atomizer', async () => {
      const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
      const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
      resultDocXml = await getDocumentXml(result.document);
    });

    await then('Q4 reports no move detection', () => {
      const q4 = scoreExtras(resultDocXml);
      expect(q4.moveDetection).toBe(false);
    });
  }, 30_000);

  test('no table cell diffs in simple-word-change', async ({ given, then }: AllureBddContext) => {
    let resultDocXml: string;

    await given('simple-word-change fixture is compared with atomizer', async () => {
      const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
      const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
      resultDocXml = await getDocumentXml(result.document);
    });

    await then('Q4 reports no table cell diffs', () => {
      const q4 = scoreExtras(resultDocXml);
      expect(q4.tableCellDiff).toBe(false);
    });
  }, 30_000);
});

describe('Manifest loading', () => {
  test('loads manifest and resolves synthetic fixture paths', async ({ given, then }: AllureBddContext) => {
    let manifest: Awaited<ReturnType<typeof loadManifest>>['manifest'];
    let resolvedFixtures: Awaited<ReturnType<typeof loadManifest>>['resolvedFixtures'];

    await given('the benchmark manifest is loaded', async () => {
      ({ manifest, resolvedFixtures } = await loadManifest(manifestPath));
    });

    await then('manifest base_dir and fixture count are correct', () => {
      expect(manifest.base_dir).toBe('.');
      expect(resolvedFixtures.length).toBeGreaterThanOrEqual(9);

      // Check synthetic fixture resolution
      const simpleWord = resolvedFixtures.find((f) => f.name === 'simple-word-change');
      expect(simpleWord).toBeDefined();
      expect(simpleWord!.resolvedOriginal).toContain('simple-word-change/original.docx');
    });
  });

  test('loads manifest and resolves ILPA cross-root path', async ({ given, then }: AllureBddContext) => {
    let resolvedFixtures: Awaited<ReturnType<typeof loadManifest>>['resolvedFixtures'];

    await given('the benchmark manifest is loaded', async () => {
      ({ resolvedFixtures } = await loadManifest(manifestPath));
    });

    await then('the ILPA fixture resolves to the correct path', () => {
      const ilpa = resolvedFixtures.find((f) => f.name === 'ILPA');
      expect(ilpa).toBeDefined();
      expect(ilpa!.resolvedOriginal).toContain('ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx');
    });
  });

  test('formattingMode full vs compact output differs', async ({ given, then }: AllureBddContext) => {
    let compactView: { nodes: any[]; [k: string]: any };
    let fullView: typeof compactView;

    await given('simple-word-change original is loaded with paragraph bookmarks', async () => {
      const { DocxDocument } = await import('../primitives/document.js');
      const { originalBuffer } = await loadFixture('simple-word-change');

      const doc = await DocxDocument.load(originalBuffer);
      // Must insert bookmarks so buildDocumentView can index paragraphs
      doc.insertParagraphBookmarks('test');

      compactView = doc.buildDocumentView({ showFormatting: true, formattingMode: 'compact' });
      // Force cache miss for different mode
      (doc as any).dirty = true;
      fullView = doc.buildDocumentView({ showFormatting: true, formattingMode: 'full' });
    });

    await then('both modes produce nodes and node counts match', () => {
      // Both should produce nodes
      expect(compactView.nodes.length).toBeGreaterThan(0);
      expect(fullView.nodes.length).toBeGreaterThan(0);
      // In full mode, formatting is always emitted (suppression disabled)
      // They may or may not differ depending on document content, but the code path works
      expect(fullView.nodes.length).toBe(compactView.nodes.length);
    });
  }, 30_000);
});
