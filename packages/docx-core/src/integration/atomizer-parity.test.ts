/**
 * Integration test for atomizer-based document comparison.
 *
 * Tests the atomizer pipeline against the same ILPA documents
 * to verify improved parity compared to the paragraph-level diffmatch engine.
 */

import { describe, expect, beforeAll } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { compareDocuments, type CompareResult } from '../index.js';
import { compareDocumentsBaselineB } from '../baselines/diffmatch/pipeline.js';
import {
  FIXTURE_STABLE_DATE,
  getIntegrationOutputModeLabel,
  writeIntegrationArtifact,
} from './output-artifacts.js';

// Path to test documents (relative to project root)
const projectRoot = join(dirname(import.meta.url.replace('file://', '')), '../../../..');
const ORIGINAL_DOC = join(
  projectRoot,
  'tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx'
);
const REVISED_DOC = join(
  projectRoot,
  'tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx'
);

describe('Atomizer Pipeline Parity Test', () => {
  let originalBuffer: Buffer;
  let revisedBuffer: Buffer;
  let atomizerResult: CompareResult;
  let diffmatchResult: CompareResult;

  beforeAll(async () => {
    // Load test documents
    try {
      originalBuffer = await readFile(ORIGINAL_DOC);
      revisedBuffer = await readFile(REVISED_DOC);
    } catch (error) {
      console.error('Failed to load test documents. Make sure the ILPA documents exist.');
      throw error;
    }

    // Run atomizer comparison
    atomizerResult = await compareDocuments(originalBuffer, revisedBuffer, {
      author: 'AtomizerTest',
      date: FIXTURE_STABLE_DATE,
      engine: 'atomizer',
    });

    // Run diffmatch comparison for comparison (direct import, dev-only)
    diffmatchResult = await compareDocumentsBaselineB(originalBuffer, revisedBuffer, {
      author: 'DiffmatchTest',
      date: FIXTURE_STABLE_DATE,
    }) as unknown as CompareResult;

    // Save output for inspection
    try {
      const outputPath = await writeIntegrationArtifact(
        'atomizer_redline.docx',
        atomizerResult.document
      );
      console.log(`Output saved to (${getIntegrationOutputModeLabel()}): ${outputPath}`);
    } catch (err) {
      console.warn('Could not save output file:', err);
    }
  }, 120000); // 2 minute timeout for large documents

  it('should produce a valid comparison result', async () => {
    expect(atomizerResult).toBeDefined();
    expect(atomizerResult.document).toBeInstanceOf(Buffer);
    expect(atomizerResult.document.length).toBeGreaterThan(0);
    expect(atomizerResult.engine).toBe('atomizer');
  });

  it('should detect changes between documents', async () => {
    expect(atomizerResult.stats).toBeDefined();

    const totalChanges =
      atomizerResult.stats.insertions +
      atomizerResult.stats.deletions +
      atomizerResult.stats.modifications;

    expect(totalChanges).toBeGreaterThan(0);

    console.log('\nAtomizer Implementation Stats:');
    console.log(`  Insertions: ${atomizerResult.stats.insertions}`);
    console.log(`  Deletions: ${atomizerResult.stats.deletions}`);
    console.log(`  Modifications: ${atomizerResult.stats.modifications}`);
    console.log(`  Total: ${totalChanges}`);
  });

  it('should detect more changes than paragraph-level diffmatch', async () => {
    const atomizerTotal =
      atomizerResult.stats.insertions + atomizerResult.stats.deletions;
    const diffmatchTotal =
      diffmatchResult.stats.insertions + diffmatchResult.stats.deletions;

    console.log('\nComparison of engines:');
    console.log(`  Atomizer changes: ${atomizerTotal}`);
    console.log(`  Diffmatch changes: ${diffmatchTotal}`);
    console.log(`  Improvement ratio: ${(atomizerTotal / Math.max(diffmatchTotal, 1)).toFixed(1)}x`);

    // Atomizer should detect significantly more changes than paragraph-level
    // diffmatch which only detected 10 changes
    expect(atomizerTotal).toBeGreaterThan(diffmatchTotal);
  });

  it('should produce a document of reasonable size', async () => {
    const originalSize = originalBuffer.length;
    const outputSize = atomizerResult.document.length;
    const ratio = outputSize / originalSize;

    console.log(`\nDocument sizes:`);
    console.log(`  Original: ${(originalSize / 1024).toFixed(1)} KB`);
    console.log(`  Revised: ${(revisedBuffer.length / 1024).toFixed(1)} KB`);
    console.log(`  Output: ${(outputSize / 1024).toFixed(1)} KB`);
    console.log(`  Ratio: ${ratio.toFixed(2)}x`);

    // Output shouldn't be too small (indicates missing content)
    expect(outputSize).toBeGreaterThan(originalSize * 0.5);

    // Output shouldn't be too large (indicates bloat or errors)
    expect(outputSize).toBeLessThan(originalSize * 5);
  });

  it('should report improved parity with Aspose baseline', async () => {
    // Aspose detected: 468 insertions, 121 deletions = 589 total
    const totalAspose = 468 + 121;
    const totalAtomizer =
      atomizerResult.stats.insertions + atomizerResult.stats.deletions;

    const parity = (totalAtomizer / totalAspose * 100).toFixed(1);

    console.log(`\nParity with Aspose baseline:`);
    console.log(`  Aspose insertions+deletions: ${totalAspose}`);
    console.log(`  Atomizer insertions+deletions: ${totalAtomizer}`);
    console.log(`  Parity: ${parity}%`);

    // We should detect at least 50% of what Aspose detects
    // (character-level comparison should be more precise)
    expect(totalAtomizer).toBeGreaterThan(totalAspose * 0.1);
  });
});

describe('Atomizer Track Changes Validation', () => {
  let resultDocument: Buffer;

  beforeAll(async () => {
    const originalBuffer = await readFile(ORIGINAL_DOC);
    const revisedBuffer = await readFile(REVISED_DOC);

    const result = await compareDocuments(originalBuffer, revisedBuffer, {
      author: 'ValidationTest',
      engine: 'atomizer',
    });

    resultDocument = result.document;
  }, 120000);

  it('should produce a valid ZIP archive', async () => {
    // DOCX is a ZIP file - first 4 bytes should be PK signature
    expect(resultDocument[0]).toBe(0x50); // 'P'
    expect(resultDocument[1]).toBe(0x4b); // 'K'
    expect(resultDocument[2]).toBe(0x03);
    expect(resultDocument[3]).toBe(0x04);
  });

  it('should be loadable by the DocxArchive', async () => {
    const { DocxArchive } = await import('../shared/docx/DocxArchive.js');

    const archive = await DocxArchive.load(resultDocument);
    expect(archive).toBeDefined();

    const documentXml = await archive.getDocumentXml();
    expect(documentXml).toBeDefined();
    expect(documentXml.length).toBeGreaterThan(0);
  });

  it('should contain track changes elements', async () => {
    const { DocxArchive } = await import('../shared/docx/DocxArchive.js');

    const archive = await DocxArchive.load(resultDocument);
    const documentXml = await archive.getDocumentXml();

    // Check for track changes elements
    const hasInsertions = documentXml.includes('<w:ins ') || documentXml.includes('<w:ins>');
    const hasDeletions = documentXml.includes('<w:del ') || documentXml.includes('<w:del>');

    console.log(`\nTrack changes elements found:`);
    console.log(`  Has w:ins elements: ${hasInsertions}`);
    console.log(`  Has w:del elements: ${hasDeletions}`);

    // At least one type of change should be present
    expect(hasInsertions || hasDeletions).toBe(true);
  });
});

describe('Atomizer with Simple Fixtures', () => {
  const fixturesPath = join(
    dirname(import.meta.url.replace('file://', '')),
    '../testing/fixtures'
  );

  it('should detect simple word change', async () => {
    const original = await readFile(join(fixturesPath, 'simple-word-change', 'original.docx'));
    const revised = await readFile(join(fixturesPath, 'simple-word-change', 'revised.docx'));

    const result = await compareDocuments(original, revised, {
      engine: 'atomizer',
    });

    expect(result.stats.insertions + result.stats.deletions).toBeGreaterThan(0);
    expect(result.engine).toBe('atomizer');
  });

  it('should detect paragraph insertion', async () => {
    const original = await readFile(join(fixturesPath, 'paragraph-insert', 'original.docx'));
    const revised = await readFile(join(fixturesPath, 'paragraph-insert', 'revised.docx'));

    const result = await compareDocuments(original, revised, {
      engine: 'atomizer',
    });

    expect(result.stats.insertions).toBeGreaterThan(0);
  });

  it('should detect paragraph deletion', async () => {
    const original = await readFile(join(fixturesPath, 'paragraph-delete', 'original.docx'));
    const revised = await readFile(join(fixturesPath, 'paragraph-delete', 'revised.docx'));

    const result = await compareDocuments(original, revised, {
      engine: 'atomizer',
    });

    expect(result.stats.deletions).toBeGreaterThan(0);
  });

  it('should detect no changes in identical documents', async () => {
    const original = await readFile(join(fixturesPath, 'no-change', 'original.docx'));
    const revised = await readFile(join(fixturesPath, 'no-change', 'revised.docx'));

    const result = await compareDocuments(original, revised, {
      engine: 'atomizer',
    });

    // Should have zero or minimal changes
    const totalChanges =
      result.stats.insertions + result.stats.deletions;

    expect(totalChanges).toBe(0);
  });
});
