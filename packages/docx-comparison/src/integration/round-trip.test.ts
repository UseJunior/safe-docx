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
import { itAllure as it } from '../testing/allure-test.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
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

// Output directory for debugging
const OUTPUT_DIR = join(dirname(import.meta.url.replace('file://', '')), '../testing/outputs');

describe('Round-Trip Tests - Accept All Changes', () => {
  describe('Simple Fixtures', () => {
    it('simple-word-change: accept changes should match revised', async () => {
      const original = await readFile(join(fixturesPath, 'simple-word-change', 'original.docx'));
      const revised = await readFile(join(fixturesPath, 'simple-word-change', 'revised.docx'));

      // Compare documents
      const result = await compareDocuments(original, revised, { engine: 'atomizer' });

      // Extract text from comparison result after accepting changes
      const resultArchive = await DocxArchive.load(result.document);
      const resultXml = await resultArchive.getDocumentXml();
      const acceptedXml = acceptAllChanges(resultXml);
      const acceptedText = extractTextWithParagraphs(acceptedXml);

      // Extract text from revised document
      const revisedArchive = await DocxArchive.load(revised);
      const revisedXml = await revisedArchive.getDocumentXml();
      const revisedText = extractTextWithParagraphs(revisedXml);

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

    it('paragraph-insert: accept changes should match revised', async () => {
      const original = await readFile(join(fixturesPath, 'paragraph-insert', 'original.docx'));
      const revised = await readFile(join(fixturesPath, 'paragraph-insert', 'revised.docx'));

      const result = await compareDocuments(original, revised, { engine: 'atomizer' });

      const resultArchive = await DocxArchive.load(result.document);
      const resultXml = await resultArchive.getDocumentXml();
      const acceptedXml = acceptAllChanges(resultXml);
      const acceptedText = extractTextWithParagraphs(acceptedXml);

      const revisedArchive = await DocxArchive.load(revised);
      const revisedXml = await revisedArchive.getDocumentXml();
      const revisedText = extractTextWithParagraphs(revisedXml);

      const comparison = compareTexts(revisedText, acceptedText);

      console.log('\n[paragraph-insert] Accept changes comparison:');
      console.log(`  Revised text length: ${comparison.expectedLength}`);
      console.log(`  Accepted text length: ${comparison.actualLength}`);
      console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

      expect(comparison.normalizedIdentical).toBe(true);
    });

    it('paragraph-delete: accept changes should match revised', async () => {
      const original = await readFile(join(fixturesPath, 'paragraph-delete', 'original.docx'));
      const revised = await readFile(join(fixturesPath, 'paragraph-delete', 'revised.docx'));

      const result = await compareDocuments(original, revised, { engine: 'atomizer' });

      const resultArchive = await DocxArchive.load(result.document);
      const resultXml = await resultArchive.getDocumentXml();
      const acceptedXml = acceptAllChanges(resultXml);
      const acceptedText = extractTextWithParagraphs(acceptedXml);

      const revisedArchive = await DocxArchive.load(revised);
      const revisedXml = await revisedArchive.getDocumentXml();
      const revisedText = extractTextWithParagraphs(revisedXml);

      const comparison = compareTexts(revisedText, acceptedText);

      console.log('\n[paragraph-delete] Accept changes comparison:');
      console.log(`  Revised text length: ${comparison.expectedLength}`);
      console.log(`  Accepted text length: ${comparison.actualLength}`);
      console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

      expect(comparison.normalizedIdentical).toBe(true);
    });

    it('no-change: accept changes should match both original and revised', async () => {
      const original = await readFile(join(fixturesPath, 'no-change', 'original.docx'));
      const revised = await readFile(join(fixturesPath, 'no-change', 'revised.docx'));

      const result = await compareDocuments(original, revised, { engine: 'atomizer' });

      const resultArchive = await DocxArchive.load(result.document);
      const resultXml = await resultArchive.getDocumentXml();
      const acceptedXml = acceptAllChanges(resultXml);
      const acceptedText = extractTextWithParagraphs(acceptedXml);

      const revisedArchive = await DocxArchive.load(revised);
      const revisedXml = await revisedArchive.getDocumentXml();
      const revisedText = extractTextWithParagraphs(revisedXml);

      const comparison = compareTexts(revisedText, acceptedText);

      console.log('\n[no-change] Accept changes comparison:');
      console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

      expect(comparison.normalizedIdentical).toBe(true);
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
      });

      // Save for debugging
      await mkdir(OUTPUT_DIR, { recursive: true });
    }, 120000);

    it('accept all changes should produce text matching revised document', async () => {
      // Extract text from comparison result after accepting changes
      const resultArchive = await DocxArchive.load(comparisonResult.document);
      const resultXml = await resultArchive.getDocumentXml();
      const acceptedXml = acceptAllChanges(resultXml);
      const acceptedText = extractTextWithParagraphs(acceptedXml);

      // Extract text from revised document
      const revisedArchive = await DocxArchive.load(revisedBuffer);
      const revisedXml = await revisedArchive.getDocumentXml();
      const revisedText = extractTextWithParagraphs(revisedXml);

      // Save for debugging
      await writeFile(join(OUTPUT_DIR, 'accepted_text.txt'), acceptedText);
      await writeFile(join(OUTPUT_DIR, 'revised_text.txt'), revisedText);

      const comparison = compareTexts(revisedText, acceptedText);

      console.log('\n[ILPA Large Doc] Accept changes comparison:');
      console.log(`  Revised text length: ${comparison.expectedLength}`);
      console.log(`  Accepted text length: ${comparison.actualLength}`);
      console.log(`  Identical: ${comparison.identical}`);
      console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

      if (!comparison.normalizedIdentical) {
        console.log('  First differences:', comparison.differences.slice(0, 3));
      }

      // This is the critical assertion
      expect(comparison.normalizedIdentical).toBe(true);
    });
  });
});

describe('Round-Trip Tests - Reject All Changes', () => {
  describe('Simple Fixtures', () => {
    it('simple-word-change: reject changes should match original', async () => {
      const original = await readFile(join(fixturesPath, 'simple-word-change', 'original.docx'));
      const revised = await readFile(join(fixturesPath, 'simple-word-change', 'revised.docx'));

      const result = await compareDocuments(original, revised, { engine: 'atomizer' });

      const resultArchive = await DocxArchive.load(result.document);
      const resultXml = await resultArchive.getDocumentXml();
      const rejectedXml = rejectAllChanges(resultXml);
      const rejectedText = extractTextWithParagraphs(rejectedXml);

      const originalArchive = await DocxArchive.load(original);
      const originalXml = await originalArchive.getDocumentXml();
      const originalText = extractTextWithParagraphs(originalXml);

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

    it('paragraph-insert: reject changes should match original', async () => {
      const original = await readFile(join(fixturesPath, 'paragraph-insert', 'original.docx'));
      const revised = await readFile(join(fixturesPath, 'paragraph-insert', 'revised.docx'));

      const result = await compareDocuments(original, revised, { engine: 'atomizer' });

      const resultArchive = await DocxArchive.load(result.document);
      const resultXml = await resultArchive.getDocumentXml();
      const rejectedXml = rejectAllChanges(resultXml);
      const rejectedText = extractTextWithParagraphs(rejectedXml);

      const originalArchive = await DocxArchive.load(original);
      const originalXml = await originalArchive.getDocumentXml();
      const originalText = extractTextWithParagraphs(originalXml);

      const comparison = compareTexts(originalText, rejectedText);

      console.log('\n[paragraph-insert] Reject changes comparison:');
      console.log(`  Original text length: ${comparison.expectedLength}`);
      console.log(`  Rejected text length: ${comparison.actualLength}`);
      console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

      expect(comparison.normalizedIdentical).toBe(true);
    });

    it('paragraph-delete: reject changes should match original', async () => {
      const original = await readFile(join(fixturesPath, 'paragraph-delete', 'original.docx'));
      const revised = await readFile(join(fixturesPath, 'paragraph-delete', 'revised.docx'));

      const result = await compareDocuments(original, revised, { engine: 'atomizer' });

      const resultArchive = await DocxArchive.load(result.document);
      const resultXml = await resultArchive.getDocumentXml();
      const rejectedXml = rejectAllChanges(resultXml);
      const rejectedText = extractTextWithParagraphs(rejectedXml);

      const originalArchive = await DocxArchive.load(original);
      const originalXml = await originalArchive.getDocumentXml();
      const originalText = extractTextWithParagraphs(originalXml);

      const comparison = compareTexts(originalText, rejectedText);

      console.log('\n[paragraph-delete] Reject changes comparison:');
      console.log(`  Original text length: ${comparison.expectedLength}`);
      console.log(`  Rejected text length: ${comparison.actualLength}`);
      console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

      expect(comparison.normalizedIdentical).toBe(true);
    });

    it('no-change: reject changes should match both original and revised', async () => {
      const original = await readFile(join(fixturesPath, 'no-change', 'original.docx'));
      const revised = await readFile(join(fixturesPath, 'no-change', 'revised.docx'));

      const result = await compareDocuments(original, revised, { engine: 'atomizer' });

      const resultArchive = await DocxArchive.load(result.document);
      const resultXml = await resultArchive.getDocumentXml();
      const rejectedXml = rejectAllChanges(resultXml);
      const rejectedText = extractTextWithParagraphs(rejectedXml);

      const originalArchive = await DocxArchive.load(original);
      const originalXml = await originalArchive.getDocumentXml();
      const originalText = extractTextWithParagraphs(originalXml);

      const comparison = compareTexts(originalText, rejectedText);

      console.log('\n[no-change] Reject changes comparison:');
      console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

      expect(comparison.normalizedIdentical).toBe(true);
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
      });

      await mkdir(OUTPUT_DIR, { recursive: true });
    }, 120000);

    it('reject all changes should produce text matching original document', async () => {
      // Extract text from comparison result after rejecting changes
      const resultArchive = await DocxArchive.load(comparisonResult.document);
      const resultXml = await resultArchive.getDocumentXml();

      // Save comparison result XML for debugging
      await writeFile(join(OUTPUT_DIR, 'comparison_result.xml'), resultXml);

      const rejectedXml = rejectAllChanges(resultXml);

      // Save rejected XML for debugging
      await writeFile(join(OUTPUT_DIR, 'rejected.xml'), rejectedXml);

      const rejectedText = extractTextWithParagraphs(rejectedXml);

      // Extract text from original document
      const originalArchive = await DocxArchive.load(originalBuffer);
      const originalXml = await originalArchive.getDocumentXml();
      const originalText = extractTextWithParagraphs(originalXml);

      // Save for debugging
      await writeFile(join(OUTPUT_DIR, 'rejected_text.txt'), rejectedText);
      await writeFile(join(OUTPUT_DIR, 'original_text.txt'), originalText);

      const comparison = compareTexts(originalText, rejectedText);

      console.log('\n[ILPA Large Doc] Reject changes comparison:');
      console.log(`  Original text length: ${comparison.expectedLength}`);
      console.log(`  Rejected text length: ${comparison.actualLength}`);
      console.log(`  Identical: ${comparison.identical}`);
      console.log(`  Normalized identical: ${comparison.normalizedIdentical}`);

      if (!comparison.normalizedIdentical) {
        console.log('  First differences:', comparison.differences.slice(0, 3));
      }

      // This is the critical assertion
      expect(comparison.normalizedIdentical).toBe(true);
    });
  });
});
