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
 *
 * Coverage limitations (intentional for the spike — not bugs):
 *   - The arbitrary produces field-free `buildSyntheticDocx` paragraphs only.
 *     INV-FIELD-001 here catches regressions where accept/reject would emit
 *     malformed `w:fldChar` / `w:instrText` markup on field-free input; it does
 *     NOT exercise field-bearing input families. Field-bearing coverage lives
 *     in `collapsed-field-inplace.test.ts`.
 *   - Pairs are sampled independently, so the bridge predominantly tests the
 *     wholesale-insert/wholesale-delete regime, not the small-edit/run-boundary
 *     regime where the diff algorithm is most brittle. Small-edit coverage
 *     lives in the fixture-based tests (`round-trip-inplace.test.ts`,
 *     `nvca-coi-regression.test.ts`).
 *   - The engine may request inplace and fall back to rebuild after the
 *     safety-check at `pipeline.ts:404-440`. Each property explicitly rejects
 *     any pair where `reconstructionModeUsed !== 'inplace'`, since a fallback
 *     means the inplace candidate failed INV-FIELD-001 or INV-RT-001 internally
 *     — i.e. a falsification of the Lean spec on that input.
 */

import fc from 'fast-check';
import { describe } from 'vitest';
import { compareDocuments, type ReconstructionMode } from '../index.js';
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

// Synthetic builder already escapes `<>&` (synthetic-docx-fixture.ts:62-65), so
// no input-side filter is needed; we only drop pure-whitespace paragraphs since
// the synthetic builder emits them as effectively empty <w:t/> runs.
const paragraphArb = fc
  .string({ minLength: 1, maxLength: 30, unit: 'grapheme-ascii' })
  .filter((s) => s.trim().length > 0);

const docArb = fc.array(paragraphArb, { minLength: 1, maxLength: 4 });
const pairArb = fc.tuple(docArb, docArb);

const NUM_RUNS = 100;

async function getDocumentXml(document: Buffer): Promise<string> {
  const archive = await DocxArchive.load(document);
  return await archive.getDocumentXml();
}

interface CompareSyntheticResult {
  original: Buffer;
  revised: Buffer;
  combined: string;
  modeUsed: ReconstructionMode | undefined;
}

async function compareSyntheticDocuments(
  originalParas: string[],
  revisedParas: string[],
): Promise<CompareSyntheticResult> {
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
    modeUsed: result.reconstructionModeUsed,
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

      await when('the live inplace comparison output is accepted and rejected across random pairs', async () => {});

      await then('field structure remains valid after both projections', async () => {
        await fc.assert(
          fc.asyncProperty(pairArb, async ([originalParas, revisedParas]) => {
            const { combined, modeUsed } = await compareSyntheticDocuments(
              originalParas,
              revisedParas,
            );

            // Fallback to rebuild means the inplace candidate failed the
            // pipeline safety check at pipeline.ts:404-440 — i.e. INV-FIELD-001
            // or INV-RT-001 was internally falsified. Surface that as a property
            // failure rather than silently passing on the rebuild candidate
            // (which is outside Spec.lean's scope).
            if (modeUsed !== 'inplace') return false;

            const acceptedOk = validateFieldStructure(acceptAllChanges(combined));
            const rejectedOk = validateFieldStructure(rejectAllChanges(combined));

            return acceptedOk && rejectedOk;
          }),
          { numRuns: NUM_RUNS },
        );
      });
    },
  );

  test(
    'INV-RT-001: paired round-trip text equality under normalization on inplace comparison output',
    async ({ given, when, then }: AllureBddContext) => {
      await given('independent synthetic original and revised paragraph arrays are generated', async () => {});

      await when('the live inplace comparison output is projected through accept-all and reject-all', async () => {});

      await then('normalized text round-trips to revised on accept and original on reject', async () => {
        await fc.assert(
          fc.asyncProperty(pairArb, async ([originalParas, revisedParas]) => {
            const { original, revised, combined, modeUsed } = await compareSyntheticDocuments(
              originalParas,
              revisedParas,
            );

            if (modeUsed !== 'inplace') return false;

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
          { numRuns: NUM_RUNS },
        );
      });
    },
  );
});
