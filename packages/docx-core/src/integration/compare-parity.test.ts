/**
 * Integration test for document comparison parity.
 *
 * Compares two ILPA LPA documents using:
 * 1. Custom TypeScript implementation (Baseline B)
 *
 * Verifies:
 * - Comparison produces valid track changes markup
 * - Stats are reasonable (insertions, deletions, modifications)
 */

import { describe, expect, beforeAll } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { type CompareResult } from '../index.js';
import { compareDocumentsBaselineB } from '../baselines/diffmatch/pipeline.js';
import {
  FIXTURE_STABLE_DATE,
  getIntegrationOutputModeLabel,
  writeIntegrationArtifact,
} from './output-artifacts.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Compare Parity' });

// Path to test documents (relative to project root)
// The test file is at packages/docx-comparison/src/integration/
// Project root is 4 levels up: ../../../..
const projectRoot = join(dirname(import.meta.url.replace('file://', '')), '../../../..');
const ORIGINAL_DOC = join(
  projectRoot,
  'tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx'
);
const REVISED_DOC = join(
  projectRoot,
  'tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx'
);

describe('Document Comparison Parity Test', () => {
  let originalBuffer: Buffer;
  let revisedBuffer: Buffer;
  let result: CompareResult;

  beforeAll(async () => {
    // Load test documents
    try {
      originalBuffer = await readFile(ORIGINAL_DOC);
      revisedBuffer = await readFile(REVISED_DOC);
    } catch (error) {
      console.error('Failed to load test documents. Make sure the ILPA documents exist.');
      throw error;
    }

    // Run comparison using direct import (diffmatch is dev-only)
    result = await compareDocumentsBaselineB(originalBuffer, revisedBuffer, {
      author: 'IntegrationTest',
      date: FIXTURE_STABLE_DATE,
    }) as unknown as CompareResult;

    // Save output for inspection (optional)
    try {
      const outputPath = await writeIntegrationArtifact('typescript_redline.docx', result.document);
      console.log(`Output saved to (${getIntegrationOutputModeLabel()}): ${outputPath}`);
    } catch (err) {
      console.warn('Could not save output file:', err);
    }
  }, 60000); // 60 second timeout for large documents

  test('should produce a valid comparison result', async ({ given, when, then }: AllureBddContext) => {
    await given('original and revised ILPA documents are loaded and compared', async () => {
      // documents loaded and result computed in beforeAll
    });

    await when('the comparison result is inspected', async () => {
      // result already computed in beforeAll
    });

    await then('result is a valid buffer from the diffmatch engine', async () => {
      expect(result).toBeDefined();
      expect(result.document).toBeInstanceOf(Buffer);
      expect(result.document.length).toBeGreaterThan(0);
      expect(result.engine).toBe('diffmatch');
    });
  });

  test('should detect changes between documents', async ({ given, when, then }: AllureBddContext) => {
    await given('original and revised ILPA documents are loaded and compared', async () => {
      // documents loaded and result computed in beforeAll
    });

    await when('change stats are inspected', async () => {
      // result already computed in beforeAll
    });

    await then('total changes are greater than zero', async () => {
      expect(result.stats).toBeDefined();

      // The documents are different, so we should have some changes
      const totalChanges =
        result.stats.insertions +
        result.stats.deletions +
        result.stats.modifications;

      expect(totalChanges).toBeGreaterThan(0);

      console.log('\nTypeScript Implementation Stats:');
      console.log(`  Insertions: ${result.stats.insertions}`);
      console.log(`  Deletions: ${result.stats.deletions}`);
      console.log(`  Modifications: ${result.stats.modifications}`);
      console.log(`  Total: ${totalChanges}`);
    });
  });

  test('should produce a document of reasonable size', async ({ given, when, then }: AllureBddContext) => {
    await given('original and revised ILPA documents are loaded and compared', async () => {
      // documents loaded and result computed in beforeAll
    });

    await when('document sizes are inspected', async () => {
      // result already computed in beforeAll
    });

    await then('output document size is within acceptable ratio of original', async () => {
      // The output should be similar in size to the original (within 5x)
      const originalSize = originalBuffer.length;
      const outputSize = result.document.length;
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
  });

  test('should report stats for comparison with Aspose baseline', async ({ given, when, then }: AllureBddContext) => {
    await given('original and revised ILPA documents are loaded and compared', async () => {
      // documents loaded and result computed in beforeAll
    });

    await when('TypeScript stats are compared against Aspose baseline', async () => {
      // result already computed in beforeAll
    });

    await then('TypeScript implementation detected at least some changes', async () => {
      // These are the stats from running the Python/Aspose test:
      // Aspose detected: 468 insertions, 121 deletions, 47 format changes, 15 moves
      // Total: 651 revisions (not counting moves)

      // NOTE: The TypeScript implementation operates at paragraph level,
      // while Aspose operates at character/run level. This explains the
      // significant difference in change counts.
      const totalAspose = 468 + 121; // insertions + deletions
      const totalTypeScript =
        result.stats.insertions + result.stats.deletions;

      console.log(`\nComparison with Aspose baseline:`);
      console.log(`  Aspose insertions+deletions: ${totalAspose}`);
      console.log(`  TypeScript insertions+deletions: ${totalTypeScript}`);
      console.log(`  Note: TypeScript operates at paragraph level; Aspose at character level`);

      // Should have detected at least some changes
      expect(totalTypeScript).toBeGreaterThan(0);

      // Log the disparity for future improvement tracking
      const parity = (totalTypeScript / totalAspose * 100).toFixed(1);
      console.log(`  Parity: ${parity}% of Aspose changes detected`);
    });
  });
});

/**
 * Test for validating track changes structure.
 */
describe('Track Changes Validation', () => {
  let resultDocument: Buffer;

  beforeAll(async () => {
    const originalBuffer = await readFile(ORIGINAL_DOC);
    const revisedBuffer = await readFile(REVISED_DOC);

    const result = await compareDocumentsBaselineB(originalBuffer, revisedBuffer, {
      author: 'ValidationTest',
    });

    resultDocument = result.document;
  }, 60000);

  test('should produce a valid ZIP archive', async ({ given, when, then }: AllureBddContext) => {
    await given('ILPA documents are loaded and compared', async () => {
      // resultDocument computed in beforeAll
    });

    await when('the result document ZIP signature is inspected', async () => {
      // resultDocument already computed in beforeAll
    });

    await then('document has a valid DOCX ZIP signature', async () => {
      // DOCX is a ZIP file - first 4 bytes should be PK signature
      expect(resultDocument[0]).toBe(0x50); // 'P'
      expect(resultDocument[1]).toBe(0x4b); // 'K'
      expect(resultDocument[2]).toBe(0x03);
      expect(resultDocument[3]).toBe(0x04);
    });
  });

  test('should be loadable by the DocxArchive', async ({ given, when, then }: AllureBddContext) => {
    let archive: Awaited<ReturnType<typeof import('../shared/docx/DocxArchive.js').DocxArchive.load>>;
    let documentXml: string;

    await given('ILPA documents are loaded and compared', async () => {
      // resultDocument computed in beforeAll
    });

    await when('the result document is loaded into DocxArchive', async () => {
      const { DocxArchive } = await import('../shared/docx/DocxArchive.js');

      archive = await DocxArchive.load(resultDocument);
      documentXml = await archive.getDocumentXml();
    });

    await then('archive is defined and document XML is non-empty', async () => {
      expect(archive).toBeDefined();

      expect(documentXml).toBeDefined();
      expect(documentXml.length).toBeGreaterThan(0);
    });
  });

  test('should contain track changes elements', async ({ given, when, then }: AllureBddContext) => {
    let hasInsertions: boolean;
    let hasDeletions: boolean;

    await given('ILPA documents are loaded and compared', async () => {
      // resultDocument computed in beforeAll
    });

    await when('the document XML is inspected for track changes elements', async () => {
      const { DocxArchive } = await import('../shared/docx/DocxArchive.js');

      const archive = await DocxArchive.load(resultDocument);
      const documentXml = await archive.getDocumentXml();

      // Check for track changes elements
      hasInsertions = documentXml.includes('<w:ins ') || documentXml.includes('<w:ins>');
      hasDeletions = documentXml.includes('<w:del ') || documentXml.includes('<w:del>');

      console.log(`\nTrack changes elements found:`);
      console.log(`  Has w:ins elements: ${hasInsertions}`);
      console.log(`  Has w:del elements: ${hasDeletions}`);
    });

    await then('at least one type of track change is present', async () => {
      // At least one type of change should be present
      expect(hasInsertions || hasDeletions).toBe(true);
    });
  });
});
