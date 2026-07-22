/**
 * Regression test for NVCA COI comparison (Certificate of Incorporation).
 *
 * Validates that the comparison engine correctly handles documents with:
 * - Large paragraph count differences (234 vs 175 paragraphs)
 * - 94 footnote references in source, 0 in revised
 * - Extensive legal boilerplate sharing between paragraphs
 *
 * Root cause (fixed): The similarity fallback in hierarchical paragraph matching
 * used a greedy first-match algorithm that allowed low-similarity matches to
 * consume revised paragraphs intended for higher-similarity matches later in the
 * document. This caused incorrect paragraph alignment, producing garbled text
 * after reject-all and triggering a fallback to the rebuild reconstruction path.
 *
 * Fix: Two-part improvement:
 * 1. Order-constrained gap matching (Option 6): Pass 1 exact-hash anchors divide
 *    documents into gaps. Similarity matching is scoped to each gap via mini-LCS,
 *    guaranteeing document order preservation.
 * 2. TF-IDF cosine similarity (Option 8): Replaces Jaccard, which over-weights
 *    common legal boilerplate. IDF down-weights words like "holders", "Preferred
 *    Stock" that appear in many paragraphs.
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocuments } from '@usejunior/docx-compare';
import {
  acceptAllChanges,
  rejectAllChanges,
  extractTextWithParagraphs,
  compareTexts,
} from '@usejunior/docx-compare';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import fs from 'fs';
import path from 'path';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'NVCA COI Regression' });

describe('NVCA COI Regression', () => {
  const sourcePath = path.resolve(__dirname, '../../../../tests/test_documents/nvca-coi-regression/source.docx');
  const filledPath = path.resolve(__dirname, '../../../../tests/test_documents/nvca-coi-regression/filled.docx');

  test('should compare COI source vs filled in inplace mode without safety fallback', async ({ given, when, then, and }: AllureBddContext) => {
    let sourceBuf: Buffer;
    let filledBuf: Buffer;
    let res: Awaited<ReturnType<typeof compareDocuments>>;

    await given('COI source and filled fixture files exist and are loaded', async () => {
      if (!fs.existsSync(sourcePath) || !fs.existsSync(filledPath)) {
        console.warn('Skipping NVCA COI Regression: fixture files not found');
        return;
      }
      sourceBuf = fs.readFileSync(sourcePath);
      filledBuf = fs.readFileSync(filledPath);
    });

    await when('documents are compared in inplace mode', async () => {
      res = await compareDocuments(sourceBuf, filledBuf, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
        author: 'RegressionTest',
      });
    });

    await then('it used inplace mode without safety fallback', async () => {
      expect(res.reconstructionModeUsed).toBe('inplace');
      expect(res.fallbackReason).toBeUndefined();
    });

    await and('stats are within expected ranges', async () => {
      // Range counts stay bounded for the human-facing summary; atom totals
      // retain the old granular signal for this large legal-document diff.
      expect(res.stats.insertions).toBeLessThan(500);
      expect(res.stats.deletions).toBeLessThan(500);
      expect(res.stats.deletedAtoms).toBeGreaterThan(5000);
    });

    await and('accept-all text matches revised document', async () => {
      const resultArchive = await DocxArchive.load(res.document);
      const resultXml = await resultArchive.getDocumentXml();
      const acceptedXml = acceptAllChanges(resultXml);
      const acceptedText = extractTextWithParagraphs(acceptedXml);

      const revisedArchive = await DocxArchive.load(filledBuf);
      const revisedXml = await revisedArchive.getDocumentXml();
      const revisedText = extractTextWithParagraphs(revisedXml);

      const comparison = compareTexts(revisedText, acceptedText);
      expect(comparison.normalizedIdentical).toBe(true);
    });

    await and('reject-all text matches original document', async () => {
      const resultArchive = await DocxArchive.load(res.document);
      const resultXml = await resultArchive.getDocumentXml();
      const rejectedXml = rejectAllChanges(resultXml);
      const rejectedText = extractTextWithParagraphs(rejectedXml);

      const originalArchive = await DocxArchive.load(sourceBuf);
      const originalXml = await originalArchive.getDocumentXml();
      const originalText = extractTextWithParagraphs(originalXml);

      const comparison = compareTexts(originalText, rejectedText);
      expect(comparison.normalizedIdentical).toBe(true);
    });

    // Note: fieldStructure validation is handled by the inplace safety check.
    // If reconstructionModeUsed === 'inplace', fieldStructure already passed.
  }, 60000);
});
