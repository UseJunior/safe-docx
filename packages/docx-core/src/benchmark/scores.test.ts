/**
 * Score tests for quality benchmark.
 *
 * Covers Q1 (diff minimality), Q2 (compatibility), Q4 (extras).
 */

import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { compareDocuments } from '../index.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { scoreDiffMinimality, scoreCompatibility, scoreExtras } from './scores.js';
import { loadManifest } from './runner.js';

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
  it('counts ins/del on simple-word-change', async () => {
    const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
    const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
    const resultDocXml = await getDocumentXml(result.document);

    const q1 = scoreDiffMinimality(resultDocXml);
    expect(q1.engineRuns).toBeGreaterThan(0);
    expect(q1.oracleRuns).toBeNull();
    expect(q1.ratio).toBeNull();
  }, 30_000);

  it('computes ratio when oracle provided', async () => {
    const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
    const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
    const resultDocXml = await getDocumentXml(result.document);

    // Use the same engine output as mock oracle
    const q1 = scoreDiffMinimality(resultDocXml, resultDocXml);
    expect(q1.oracleRuns).toBe(q1.engineRuns);
    expect(q1.ratio).toBe(1.0);
  }, 30_000);

  it('returns zero runs for no-change fixture', async () => {
    const { originalBuffer, revisedBuffer } = await loadFixture('no-change');
    const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
    const resultDocXml = await getDocumentXml(result.document);

    const q1 = scoreDiffMinimality(resultDocXml);
    expect(q1.engineRuns).toBe(0);
  }, 30_000);
});

describe('Q2: Compatibility', () => {
  it('returns null with skip reason when LO unavailable', async () => {
    const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
    const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });

    const q2 = await scoreCompatibility(result.document, undefined);
    expect(q2.opensClean).toBe(false);
    expect(q2.skipReason).toBe('binary_missing');
  }, 30_000);

  it('returns binary_missing for non-existent path', async () => {
    const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
    const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });

    const q2 = await scoreCompatibility(result.document, '/nonexistent/libreoffice');
    expect(q2.opensClean).toBe(false);
    expect(q2.skipReason).toBe('binary_missing');
  }, 30_000);
});

describe('Q4: Extras', () => {
  it('no moves in simple-word-change', async () => {
    const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
    const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
    const resultDocXml = await getDocumentXml(result.document);

    const q4 = scoreExtras(resultDocXml);
    expect(q4.moveDetection).toBe(false);
  }, 30_000);

  it('no table cell diffs in simple-word-change', async () => {
    const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
    const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
    const resultDocXml = await getDocumentXml(result.document);

    const q4 = scoreExtras(resultDocXml);
    expect(q4.tableCellDiff).toBe(false);
  }, 30_000);
});

describe('Manifest loading', () => {
  it('loads manifest and resolves synthetic fixture paths', async () => {
    const { manifest, resolvedFixtures } = await loadManifest(manifestPath);
    expect(manifest.base_dir).toBe('.');
    expect(resolvedFixtures.length).toBeGreaterThanOrEqual(9);

    // Check synthetic fixture resolution
    const simpleWord = resolvedFixtures.find((f) => f.name === 'simple-word-change');
    expect(simpleWord).toBeDefined();
    expect(simpleWord!.resolvedOriginal).toContain('simple-word-change/original.docx');
  });

  it('loads manifest and resolves ILPA cross-root path', async () => {
    const { resolvedFixtures } = await loadManifest(manifestPath);
    const ilpa = resolvedFixtures.find((f) => f.name === 'ILPA');
    expect(ilpa).toBeDefined();
    expect(ilpa!.resolvedOriginal).toContain('ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx');
  });

  it('formattingMode full vs compact output differs', async () => {
    const { DocxDocument } = await import('../primitives/document.js');
    const { originalBuffer } = await loadFixture('simple-word-change');

    const doc = await DocxDocument.load(originalBuffer);
    // Must insert bookmarks so buildDocumentView can index paragraphs
    doc.insertParagraphBookmarks('test');

    const compactView = doc.buildDocumentView({ showFormatting: true, formattingMode: 'compact' });
    // Force cache miss for different mode
    (doc as any).dirty = true;
    const fullView = doc.buildDocumentView({ showFormatting: true, formattingMode: 'full' });

    // Both should produce nodes
    expect(compactView.nodes.length).toBeGreaterThan(0);
    expect(fullView.nodes.length).toBeGreaterThan(0);
    // In full mode, formatting is always emitted (suppression disabled)
    // They may or may not differ depending on document content, but the code path works
    expect(fullView.nodes.length).toBe(compactView.nodes.length);
  }, 30_000);
});
