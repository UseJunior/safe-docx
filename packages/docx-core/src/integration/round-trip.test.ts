/**
 * Round-Trip Tests for Document Comparison
 *
 * These tests verify that the comparison algorithm produces correct results:
 *
 * 1. Accept all changes → should match revised document
 * 2. Reject all changes → should match original document
 *
 * This is the gold standard for comparison correctness.
 */

import { describe, expect, beforeAll } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Round-Trip Correctness' });
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { compareDocuments } from '../index.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
// Use AST-based implementation for better reliability with nested structures
import {
  acceptAllChanges,
  rejectAllChanges,
  extractTextWithParagraphs,
  compareTexts,
} from '../baselines/atomizer/trackChangesAcceptorAst.js';
import {
  FIXTURE_STABLE_DATE,
  getIntegrationOutputModeLabel,
  writeIntegrationArtifact,
} from './output-artifacts.js';

// Path to test documents
const projectRoot = join(dirname(import.meta.url.replace('file://', '')), '../../../..');
const ORIGINAL_DOC = join(
  projectRoot,
  'tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx'
);
const REVISED_DOC = join(
  projectRoot,
  'tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx'
);

// Test fixtures
const fixturesPath = join(dirname(import.meta.url.replace('file://', '')), '../testing/fixtures');

describe('Round-Trip Tests - Accept All Changes', () => {
  describe('Simple Fixtures', () => {
    test('simple-word-change: accept changes should match revised', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('simple-word-change fixture documents are loaded', async () => {
        original = await readFile(join(fixturesPath, 'simple-word-change', 'original.docx'));
        revised = await readFile(join(fixturesPath, 'simple-word-change', 'revised.docx'));
      });
      let acceptedText: string, revisedText: string;
      await when('documents are compared and all changes are accepted', async () => {
        // Compare documents
        const result = await compareDocuments(original, revised, { engine: 'atomizer' });

        // Extract text from comparison result after accepting changes
        const resultArchive = await DocxArchive.load(result.document);
        const resultXml = await resultArchive.getDocumentXml();
        const acceptedXml = acceptAllChanges(resultXml);
        acceptedText = extractTextWithParagraphs(acceptedXml);

        // Extract text from revised document
        const revisedArchive = await DocxArchive.load(revised);
        const revisedXml = await revisedArchive.getDocumentXml();
        revisedText = extractTextWithParagraphs(revisedXml);
      });
      await then('accepted text matches revised text', () => {
        const comparison = compareTexts(revisedText, acceptedText);

        console.log('\n[simple-word-change] Accept changes comparison:');
        console.log(`  Revised text length: ${comparison.expectedLength}`);
        console.log(`  Accepted text length: ${comparison.actualLength}`);
        console.log(`  Identical: ${comparison.identical}`);
        console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

        if (!comparison.normalizedIdentical) {
          console.log('  Differences:', comparison.differences);
        }

        expect(comparison.normalizedIdentical).toBe(true);
      });
    });

    test('paragraph-insert: accept changes should match revised', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('paragraph-insert fixture documents are loaded', async () => {
        original = await readFile(join(fixturesPath, 'paragraph-insert', 'original.docx'));
        revised = await readFile(join(fixturesPath, 'paragraph-insert', 'revised.docx'));
      });
      let acceptedText: string, revisedText: string;
      await when('documents are compared and all changes are accepted', async () => {
        const result = await compareDocuments(original, revised, { engine: 'atomizer' });

        const resultArchive = await DocxArchive.load(result.document);
        const resultXml = await resultArchive.getDocumentXml();
        const acceptedXml = acceptAllChanges(resultXml);
        acceptedText = extractTextWithParagraphs(acceptedXml);

        const revisedArchive = await DocxArchive.load(revised);
        const revisedXml = await revisedArchive.getDocumentXml();
        revisedText = extractTextWithParagraphs(revisedXml);
      });
      await then('accepted text matches revised text', () => {
        const comparison = compareTexts(revisedText, acceptedText);

        console.log('\n[paragraph-insert] Accept changes comparison:');
        console.log(`  Revised text length: ${comparison.expectedLength}`);
        console.log(`  Accepted text length: ${comparison.actualLength}`);
        console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

        expect(comparison.normalizedIdentical).toBe(true);
      });
    });

    test('paragraph-delete: accept changes should match revised', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('paragraph-delete fixture documents are loaded', async () => {
        original = await readFile(join(fixturesPath, 'paragraph-delete', 'original.docx'));
        revised = await readFile(join(fixturesPath, 'paragraph-delete', 'revised.docx'));
      });
      let acceptedText: string, revisedText: string;
      await when('documents are compared and all changes are accepted', async () => {
        const result = await compareDocuments(original, revised, { engine: 'atomizer' });

        const resultArchive = await DocxArchive.load(result.document);
        const resultXml = await resultArchive.getDocumentXml();
        const acceptedXml = acceptAllChanges(resultXml);
        acceptedText = extractTextWithParagraphs(acceptedXml);

        const revisedArchive = await DocxArchive.load(revised);
        const revisedXml = await revisedArchive.getDocumentXml();
        revisedText = extractTextWithParagraphs(revisedXml);
      });
      await then('accepted text matches revised text', () => {
        const comparison = compareTexts(revisedText, acceptedText);

        console.log('\n[paragraph-delete] Accept changes comparison:');
        console.log(`  Revised text length: ${comparison.expectedLength}`);
        console.log(`  Accepted text length: ${comparison.actualLength}`);
        console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

        expect(comparison.normalizedIdentical).toBe(true);
      });
    });

    test('no-change: accept changes should match both original and revised', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('no-change fixture documents are loaded', async () => {
        original = await readFile(join(fixturesPath, 'no-change', 'original.docx'));
        revised = await readFile(join(fixturesPath, 'no-change', 'revised.docx'));
      });
      let acceptedText: string, revisedText: string;
      await when('identical documents are compared and all changes are accepted', async () => {
        const result = await compareDocuments(original, revised, { engine: 'atomizer' });

        const resultArchive = await DocxArchive.load(result.document);
        const resultXml = await resultArchive.getDocumentXml();
        const acceptedXml = acceptAllChanges(resultXml);
        acceptedText = extractTextWithParagraphs(acceptedXml);

        const revisedArchive = await DocxArchive.load(revised);
        const revisedXml = await revisedArchive.getDocumentXml();
        revisedText = extractTextWithParagraphs(revisedXml);
      });
      await then('accepted text matches revised text', () => {
        const comparison = compareTexts(revisedText, acceptedText);

        console.log('\n[no-change] Accept changes comparison:');
        console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

        expect(comparison.normalizedIdentical).toBe(true);
      });
    });
  });

  describe('Large Documents (ILPA)', () => {
    let originalBuffer: Buffer;
    let revisedBuffer: Buffer;
    let comparisonResult: Awaited<ReturnType<typeof compareDocuments>>;

    beforeAll(async () => {
      originalBuffer = await readFile(ORIGINAL_DOC);
      revisedBuffer = await readFile(REVISED_DOC);
      comparisonResult = await compareDocuments(originalBuffer, revisedBuffer, {
        engine: 'atomizer',
        date: FIXTURE_STABLE_DATE,
      });
    }, 120000);

    test('accept all changes should produce text matching revised document', async ({ given, when, then }: AllureBddContext) => {
      await given('ILPA comparison result is pre-computed in beforeAll', () => {});
      let acceptedText: string, revisedText: string;
      await when('all changes are accepted from the comparison result', async () => {
        // Extract text from comparison result after accepting changes
        const resultArchive = await DocxArchive.load(comparisonResult.document);
        const resultXml = await resultArchive.getDocumentXml();
        const acceptedXml = acceptAllChanges(resultXml);
        acceptedText = extractTextWithParagraphs(acceptedXml);

        // Extract text from revised document
        const revisedArchive = await DocxArchive.load(revisedBuffer);
        const revisedXml = await revisedArchive.getDocumentXml();
        revisedText = extractTextWithParagraphs(revisedXml);

        // Save for debugging
        await writeIntegrationArtifact('accepted_text.txt', acceptedText);
        await writeIntegrationArtifact('revised_text.txt', revisedText);
      });
      await then('accepted text matches the revised document text', () => {
        const comparison = compareTexts(revisedText, acceptedText);

        console.log('\n[ILPA Large Doc] Accept changes comparison:');
        console.log(`  Revised text length: ${comparison.expectedLength}`);
        console.log(`  Accepted text length: ${comparison.actualLength}`);
        console.log(`  Identical: ${comparison.identical}`);
        console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

        if (!comparison.normalizedIdentical) {
          console.log('  First differences:', comparison.differences.slice(0, 3));
        }
        console.log(`  Debug output mode: ${getIntegrationOutputModeLabel()}`);

        // This is the critical assertion
        expect(comparison.normalizedIdentical).toBe(true);
      });
    });
  });
});

describe('Round-Trip Tests - Reject All Changes', () => {
  describe('Simple Fixtures', () => {
    test('simple-word-change: reject changes should match original', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('simple-word-change fixture documents are loaded', async () => {
        original = await readFile(join(fixturesPath, 'simple-word-change', 'original.docx'));
        revised = await readFile(join(fixturesPath, 'simple-word-change', 'revised.docx'));
      });
      let rejectedText: string, originalText: string;
      await when('documents are compared and all changes are rejected', async () => {
        const result = await compareDocuments(original, revised, { engine: 'atomizer' });

        const resultArchive = await DocxArchive.load(result.document);
        const resultXml = await resultArchive.getDocumentXml();
        const rejectedXml = rejectAllChanges(resultXml);
        rejectedText = extractTextWithParagraphs(rejectedXml);

        const originalArchive = await DocxArchive.load(original);
        const originalXml = await originalArchive.getDocumentXml();
        originalText = extractTextWithParagraphs(originalXml);
      });
      await then('rejected text matches original text', () => {
        const comparison = compareTexts(originalText, rejectedText);

        console.log('\n[simple-word-change] Reject changes comparison:');
        console.log(`  Original text length: ${comparison.expectedLength}`);
        console.log(`  Rejected text length: ${comparison.actualLength}`);
        console.log(`  Identical: ${comparison.identical}`);
        console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

        if (!comparison.normalizedIdentical) {
          console.log('  Differences:', comparison.differences);
        }

        expect(comparison.normalizedIdentical).toBe(true);
      });
    });

    test('paragraph-insert: reject changes should match original', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('paragraph-insert fixture documents are loaded', async () => {
        original = await readFile(join(fixturesPath, 'paragraph-insert', 'original.docx'));
        revised = await readFile(join(fixturesPath, 'paragraph-insert', 'revised.docx'));
      });
      let rejectedText: string, originalText: string;
      await when('documents are compared and all changes are rejected', async () => {
        const result = await compareDocuments(original, revised, { engine: 'atomizer' });

        const resultArchive = await DocxArchive.load(result.document);
        const resultXml = await resultArchive.getDocumentXml();
        const rejectedXml = rejectAllChanges(resultXml);
        rejectedText = extractTextWithParagraphs(rejectedXml);

        const originalArchive = await DocxArchive.load(original);
        const originalXml = await originalArchive.getDocumentXml();
        originalText = extractTextWithParagraphs(originalXml);
      });
      await then('rejected text matches original text', () => {
        const comparison = compareTexts(originalText, rejectedText);

        console.log('\n[paragraph-insert] Reject changes comparison:');
        console.log(`  Original text length: ${comparison.expectedLength}`);
        console.log(`  Rejected text length: ${comparison.actualLength}`);
        console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

        expect(comparison.normalizedIdentical).toBe(true);
      });
    });

    test('paragraph-delete: reject changes should match original', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('paragraph-delete fixture documents are loaded', async () => {
        original = await readFile(join(fixturesPath, 'paragraph-delete', 'original.docx'));
        revised = await readFile(join(fixturesPath, 'paragraph-delete', 'revised.docx'));
      });
      let rejectedText: string, originalText: string;
      await when('documents are compared and all changes are rejected', async () => {
        const result = await compareDocuments(original, revised, { engine: 'atomizer' });

        const resultArchive = await DocxArchive.load(result.document);
        const resultXml = await resultArchive.getDocumentXml();
        const rejectedXml = rejectAllChanges(resultXml);
        rejectedText = extractTextWithParagraphs(rejectedXml);

        const originalArchive = await DocxArchive.load(original);
        const originalXml = await originalArchive.getDocumentXml();
        originalText = extractTextWithParagraphs(originalXml);
      });
      await then('rejected text matches original text', () => {
        const comparison = compareTexts(originalText, rejectedText);

        console.log('\n[paragraph-delete] Reject changes comparison:');
        console.log(`  Original text length: ${comparison.expectedLength}`);
        console.log(`  Rejected text length: ${comparison.actualLength}`);
        console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

        expect(comparison.normalizedIdentical).toBe(true);
      });
    });

    test('no-change: reject changes should match both original and revised', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('no-change fixture documents are loaded', async () => {
        original = await readFile(join(fixturesPath, 'no-change', 'original.docx'));
        revised = await readFile(join(fixturesPath, 'no-change', 'revised.docx'));
      });
      let rejectedText: string, originalText: string;
      await when('identical documents are compared and all changes are rejected', async () => {
        const result = await compareDocuments(original, revised, { engine: 'atomizer' });

        const resultArchive = await DocxArchive.load(result.document);
        const resultXml = await resultArchive.getDocumentXml();
        const rejectedXml = rejectAllChanges(resultXml);
        rejectedText = extractTextWithParagraphs(rejectedXml);

        const originalArchive = await DocxArchive.load(original);
        const originalXml = await originalArchive.getDocumentXml();
        originalText = extractTextWithParagraphs(originalXml);
      });
      await then('rejected text matches original text', () => {
        const comparison = compareTexts(originalText, rejectedText);

        console.log('\n[no-change] Reject changes comparison:');
        console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

        expect(comparison.normalizedIdentical).toBe(true);
      });
    });
  });

  describe('Large Documents (ILPA)', () => {
    let originalBuffer: Buffer;
    let revisedBuffer: Buffer;
    let comparisonResult: Awaited<ReturnType<typeof compareDocuments>>;

    beforeAll(async () => {
      originalBuffer = await readFile(ORIGINAL_DOC);
      revisedBuffer = await readFile(REVISED_DOC);
      comparisonResult = await compareDocuments(originalBuffer, revisedBuffer, {
        engine: 'atomizer',
        date: FIXTURE_STABLE_DATE,
      });
    }, 120000);

    test('reject all changes should produce text matching original document', async ({ given, when, then }: AllureBddContext) => {
      await given('ILPA comparison result is pre-computed in beforeAll', () => {});
      let rejectedText: string, originalText: string;
      await when('all changes are rejected from the comparison result', async () => {
        // Extract text from comparison result after rejecting changes
        const resultArchive = await DocxArchive.load(comparisonResult.document);
        const resultXml = await resultArchive.getDocumentXml();

        // Save comparison result XML for debugging
        await writeIntegrationArtifact('comparison_result.xml', resultXml);

        const rejectedXml = rejectAllChanges(resultXml);

        // Save rejected XML for debugging
        await writeIntegrationArtifact('rejected.xml', rejectedXml);

        rejectedText = extractTextWithParagraphs(rejectedXml);

        // Extract text from original document
        const originalArchive = await DocxArchive.load(originalBuffer);
        const originalXml = await originalArchive.getDocumentXml();
        originalText = extractTextWithParagraphs(originalXml);

        // Save for debugging
        await writeIntegrationArtifact('rejected_text.txt', rejectedText);
        await writeIntegrationArtifact('original_text.txt', originalText);
      });
      await then('rejected text matches the original document text', () => {
        const comparison = compareTexts(originalText, rejectedText);

        console.log('\n[ILPA Large Doc] Reject changes comparison:');
        console.log(`  Original text length: ${comparison.expectedLength}`);
        console.log(`  Rejected text length: ${comparison.actualLength}`);
        console.log(`  Identical: ${comparison.identical}`);
        console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

        if (!comparison.normalizedIdentical) {
          console.log('  First differences:', comparison.differences.slice(0, 3));
        }
        console.log(`  Debug output mode: ${getIntegrationOutputModeLabel()}`);

        // This is the critical assertion
        expect(comparison.normalizedIdentical).toBe(true);
      });
    });
  });
});
