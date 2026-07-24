/**
 * Regression coverage using the checked-in NVCA COI source package.
 *
 * The revised side is derived from that source with a minimal body-text edit,
 * so both packages retain the real relationship-addressed footer and footnote
 * stories while exercising the two publication modes.
 */

import fs from 'fs';
import path from 'path';
import { describe, expect } from 'vitest';
import {
  acceptAllChanges,
  compareDocuments,
  compareTexts,
  extractTextWithParagraphs,
  rejectAllChanges,
  type ReconstructionMode,
} from '@usejunior/docx-compare';
import { DocxDocument } from '../primitives/document.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import {
  getParagraphText,
  replaceParagraphTextRange,
} from '../primitives/text.js';
import { OOXML } from '../primitives/namespaces.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

const TEST_FEATURE = 'verify-ancillary-field-stories';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE });

const sourcePath = path.resolve(
  __dirname,
  '../../../../tests/test_documents/nvca-coi-regression/source.docx',
);
const filledPath = path.resolve(
  __dirname,
  '../../../../tests/test_documents/nvca-coi-regression/filled.docx',
);

async function deriveMinimallyEditedRevision(source: Buffer): Promise<Buffer> {
  const document = await DocxDocument.load(source);
  const paragraph = document.getParagraphs().find((candidate) => {
    const text = getParagraphText(candidate);
    return text.length >= 20 &&
      candidate.getElementsByTagNameNS(OOXML.W_NS, 'fldChar').length === 0;
  });
  if (!paragraph) {
    throw new Error('NVCA source has no suitable body paragraph for a minimal text edit');
  }
  const text = getParagraphText(paragraph);
  const replacement = text[0] === 'A' ? 'B' : 'A';
  replaceParagraphTextRange(paragraph, 0, 1, replacement);
  return (await document.toBuffer({ cleanBookmarks: false })).buffer;
}

describe('NVCA COI Regression', () => {
  test('should compare COI source vs filled in inplace mode without safety fallback', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
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
  }, 60_000);
});

describe('NVCA COI ancillary field evidence', () => {
  for (const reconstructionMode of ['inplace', 'rebuild'] as const satisfies readonly ReconstructionMode[]) {
    test
      .openspec('[SDX-ANC-BOUNDARY-01] NVCA COI source-derived pair supplies non-vacuous evidence in both modes')(
      `[SDX-ANC-NVCA-${reconstructionMode}] real source-derived pair preserves footer PAGE and footnote REF in ${reconstructionMode}`,
      async () => {
        testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' });
        testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' });
        testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });
        testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.44' });
        testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.51' });

        if (!fs.existsSync(sourcePath)) {
          throw new Error(`NVCA COI source fixture not found: ${sourcePath}`);
        }
        const source = fs.readFileSync(sourcePath);
        const revised = await deriveMinimallyEditedRevision(source);

        const result = await compareDocuments(source, revised, {
          engine: 'atomizer',
          reconstructionMode,
          author: 'RegressionTest',
        });
        const evidence = result.ancillaryFieldEvidence;
        const footerPageRanges = evidence?.ranges.filter((range) =>
          range.instructionKind === 'PAGE' &&
          /^word\/footer[^/]*\.xml$/u.test(range.locator.normalizedPartPath),
        ) ?? [];
        const footnoteRefRanges = evidence?.ranges.filter((range) =>
          range.instructionKind === 'REF' &&
          range.locator.normalizedPartPath === 'word/footnotes.xml' &&
          range.locator.entryId !== undefined,
        ) ?? [];

        expect(result.reconstructionModeUsed).toBe(reconstructionMode);
        expect(result.fallbackReason).toBeUndefined();
        expect(evidence).toMatchObject({
          status: 'passed',
          reconstructionMode,
        });
        expect(footerPageRanges.length).toBeGreaterThan(0);
        expect(footnoteRefRanges.length).toBeGreaterThan(0);
        expect([...footerPageRanges, ...footnoteRefRanges].every((range) =>
          range.canonicalMatch &&
          range.provenance === 'base' &&
          range.sourceSide === (reconstructionMode === 'inplace' ? 'revised' : 'original'),
        )).toBe(true);
      },
      60_000,
    );
  }
});
