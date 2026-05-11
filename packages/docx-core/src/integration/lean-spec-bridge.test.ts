/**
 * Lean Spec Bridge — fast-check property tests
 *
 * Empirically exercises the sorry'd Lean theorems in
 * `verification/lean/LeanSpike/Spec.lean` against the live TypeScript comparison
 * engine, restricted to the inplace reconstruction path:
 *
 *   - INV-FIELD-001: field-structure preservation across accept-all/reject-all
 *     on the inplace comparison output (`pipeline.ts:352-402,439-440`).
 *   - INV-RT-001: paired round-trip text equality under `normalizeText` on the
 *     inplace comparison output (`trackChangesAcceptorAst.ts:660-711`,
 *     `round-trip-inplace.test.ts:56-94` for the fixture-based analogue).
 *
 * These are empirical bridge tests, not closed proofs. The Lean theorems stay
 * `sorry`'d; this file falsifies them if either invariant fails on random input.
 */

import fc from 'fast-check';
import { describe } from 'vitest';
import { compareDocuments } from '../index.js';
import { validateFieldStructure } from '../baselines/atomizer/pipeline.js';
import {
  acceptAllChanges,
  rejectAllChanges,
  extractTextWithParagraphs,
  normalizeText,
} from '../baselines/atomizer/trackChangesAcceptorAst.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { buildSyntheticDocx } from './synthetic-docx-fixture.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Lean Spec Bridge (fast-check)',
});

const paragraphArb = fc
  .string({ minLength: 1, maxLength: 30, unit: 'grapheme-ascii' })
  .filter((s) => !/[<>&]/.test(s) && s.trim().length > 0);

const docArb = fc.array(paragraphArb, { minLength: 1, maxLength: 4 });
const pairArb = fc.tuple(docArb, docArb);

async function getDocumentXml(document: Buffer): Promise<string> {
  const archive = await DocxArchive.load(document);
  return await archive.getDocumentXml();
}

async function compareSyntheticDocuments(
  originalParas: string[],
  revisedParas: string[],
): Promise<{ original: Buffer; revised: Buffer; combined: string }> {
  const original = await buildSyntheticDocx({ paragraphs: originalParas });
  const revised = await buildSyntheticDocx({ paragraphs: revisedParas });

  const result = await compareDocuments(original, revised, {
    engine: 'atomizer',
    reconstructionMode: 'inplace',
  });

  return {
    original,
    revised,
    combined: await getDocumentXml(result.document),
  };
}

async function getNormalizedDocumentText(document: Buffer): Promise<string> {
  return normalizeText(extractTextWithParagraphs(await getDocumentXml(document)));
}

describe('Lean Spec Bridge - Inplace Reconstruction', { timeout: 60_000 }, () => {
  test(
    'INV-FIELD-001: field structure preserved after accept-all and reject-all on inplace comparison output',
    async ({ given, when, then }: AllureBddContext) => {
      await given('independent synthetic original and revised paragraph arrays are generated', async () => {});

      await when('the live inplace comparison output is accepted and rejected across random pairs', async () => {
        await fc.assert(
          fc.asyncProperty(pairArb, async ([originalParas, revisedParas]) => {
            const { combined } = await compareSyntheticDocuments(originalParas, revisedParas);

            const acceptedOk = validateFieldStructure(acceptAllChanges(combined));
            const rejectedOk = validateFieldStructure(rejectAllChanges(combined));

            return acceptedOk && rejectedOk;
          }),
          { numRuns: 50 },
        );
      });

      await then('field structure remains valid after both projections', async () => {});
    },
  );

  test(
    'INV-RT-001: paired round-trip text equality under normalization on inplace comparison output',
    async ({ given, when, then }: AllureBddContext) => {
      await given('independent synthetic original and revised paragraph arrays are generated', async () => {});

      await when('the live inplace comparison output is projected through accept-all and reject-all', async () => {
        await fc.assert(
          fc.asyncProperty(pairArb, async ([originalParas, revisedParas]) => {
            const { original, revised, combined } = await compareSyntheticDocuments(
              originalParas,
              revisedParas,
            );

            const acceptedText = normalizeText(
              extractTextWithParagraphs(acceptAllChanges(combined)),
            );
            const rejectedText = normalizeText(
              extractTextWithParagraphs(rejectAllChanges(combined)),
            );
            const revisedText = await getNormalizedDocumentText(revised);
            const originalText = await getNormalizedDocumentText(original);

            return acceptedText === revisedText && rejectedText === originalText;
          }),
          { numRuns: 50 },
        );
      });

      await then('normalized text round-trips to revised on accept and original on reject', async () => {});
    },
  );
});
