/**
 * Regression coverage using the checked-in NVCA COI source package.
 *
 * The revised side is derived from that source with a minimal body-text edit,
 * so both packages retain the real relationship-addressed footer and footnote
 * stories while exercising the sole tagged publication path.
 */

import path from 'path';
import fs from 'fs';
import { describe, expect } from 'vitest';
import {
  compareDocumentsAtomizer as compareDocuments,
} from '@usejunior/docx-compare';
import { DocxDocument } from '../primitives/document.js';
import {
  getParagraphText,
  replaceParagraphTextRange,
} from '../primitives/text.js';
import { OOXML } from '../primitives/namespaces.js';
import { testAllure } from '../testing/allure-test.js';

const TEST_FEATURE = 'verify-ancillary-field-stories';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE });

const sourcePath = path.resolve(
  __dirname,
  '../../../../tests/test_documents/nvca-coi-regression/source.docx',
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

describe('NVCA COI ancillary field evidence', () => {
  test
      .openspec('[SDX-ANC-BOUNDARY-01] NVCA COI source-derived pair supplies non-vacuous tagged evidence')(
      '[SDX-ANC-NVCA-TAGGED] real source-derived pair preserves footer PAGE and footnote REF',
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

        expect(result.engine).toBe('tagged-tree');
        expect(evidence).toMatchObject({
          status: 'passed',
        });
        expect(footerPageRanges.length).toBeGreaterThan(0);
        expect(footnoteRefRanges.length).toBeGreaterThan(0);
        expect([...footerPageRanges, ...footnoteRefRanges].every((range) =>
          range.canonicalMatch &&
          range.provenance === 'base' &&
          range.sourceSide === 'revised',
        )).toBe(true);
      },
      60_000,
    );
});
