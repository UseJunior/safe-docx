/**
 * Lean Spec Bridge — fast-check property tests
 *
 * Empirically exercises the Lean theorems in
 * `verification/lean/LeanSpike/Spec.lean` against the live TypeScript comparison
 * engine, restricted to the inplace reconstruction path.
 *
 * Coverage surfaces in this file:
 *   - Tier 1 plain synthetic paragraph pairs built via `buildSyntheticDocx`.
 *   - Tier 1.5 pre-tracked paragraph-only pairs whose `document.xml` already
 *     carries one focused tracked-change family:
 *       `w:ins`, `w:del`, paragraph-insert, `pPrChange`, comment-anchor,
 *       footnote-anchor.
 *     As of #347 the ORIGINAL side spans every family. The insertion-provenance
 *     fixes in #358 and #359 keep both original-side tracked insertions and
 *     revised-side insertions that collide with settled original text inside
 *     this generated property surface.
 *   - Tier 2 field-bearing clean pairs whose `document.xml` carries a complete
 *     NUMPAGES / PAGE / PAGEREF field and realizes one focused operation:
 *       field-insert, field-delete, field-stable, text-only.
 *   - Tier 2 fragmented-field pairs (`fragmentedFieldPairArb`) whose difference
 *     fragments a field's internal atoms under track changes — a changed result
 *     run and/or a pre-tracked field whose instruction code is already split
 *     into `<w:ins>`/`<w:del>` — over the operations:
 *       result-edit, pretracked-fragmented-to-clean, clean-to-pretracked-fragmented.
 *
 * These are empirical bridge tests, not the proofs themselves. As of the
 * `inv_rt_001` closure both theorems are closed (zero `sorry`) but each rests on a
 * named residual axiom about this repo's inplace `compareDocumentXml` output
 * (`compareDocumentXml_output_preservation_friendly`,
 * `compareDocumentXml_output_text_roundtrip`); this file is the falsifiability
 * layer for those axioms — it fails if either invariant breaks on real engine
 * output.
 *
 * Fallback semantics:
 *
 *   `Spec.lean` models `compareDocumentXml : OoxmlDoc → OoxmlDoc → Option OoxmlDoc`
 *   and both theorems are premised on `compareDocumentXml a b = some combined`,
 *   so doc pairs where inplace mode fails are formally out of the spec's scope.
 *   In the real TS pipeline a rebuild fallback can come from two sources:
 *     (a) `evaluateSafetyChecks` rejecting every inplace pass — i.e. an internal
 *         INV-FIELD-001 / INV-RT-001 falsification on the candidate XML;
 *     (b) `ContainerResolutionError` from container-topology mismatch.
 *   The two original generators (`pairArb`, `trackedPairArb`) are
 *   paragraph-only, table-free, and field-free, so (b) is not expected to fire
 *   there. The whole-field arbitrary (`fieldBearingPairArb`) is narrower
 *   instead: it uses only complete fields at run boundaries and the
 *   inplace-safe operation families already covered by the fixed fixtures. For
 *   all of these — `pairArb`, `trackedPairArb`, `fieldBearingPairArb` — we treat
 *   fallback as falsification and throw with `triage=inplace-fallback`
 *   diagnostics rather than filtering with `fc.pre`.
 *
 *   The fragmented-field arbitrary (`fragmentedFieldPairArb`) is the deliberate
 *   EXCEPTION: on the clean→pretracked-fragmented operation with a result-text
 *   change, the engine's inplace candidate fails the fieldStructure safety
 *   check (it would place a `w:fldChar` in a `<w:del>`-adjacent context / break
 *   per-story field validity), so the engine CORRECTLY falls back to rebuild and
 *   still produces conformant accept/reject output. The residual axioms
 *   constrain the comparison OUTPUT, not the reconstruction strategy, so for
 *   this arbitrary fallback is a LEGITIMATE outcome: its property asserts the
 *   invariants mode-independently (on the resolved accept/reject projections,
 *   never on the raw combined output) and a mode-distribution coverage floor
 *   requires both inplace and fallback outcomes to be observed, so a silent
 *   all-inplace or all-fallback regression fails loudly rather than via `fc.pre`.
 *
 * INV-RT-001 tracked-input triage:
 *   - `triage=engine-bug`: accept/reject of `combined` disagrees with the fully
 *     resolved accept/reject views of the input pair. As of #347 this resolved
 *     projection-vs-projection surface IS the asserted law (engine, Lean axiom,
 *     and this file all state it); the former `theorem-domain` category —
 *     projections agree but the inputs' RAW tracked text does not — collapsed
 *     into the law, because on a pre-tracked input the raw surface (counting
 *     both w:t and w:delText) is neither the accept- nor the reject-projection
 *     and was never a meaningful baseline.
 *   - `triage=inplace-fallback`: the inplace candidate was never emitted.
 *
 * Coverage limitations (intentional for the spike — not bugs):
 *   - Nested fields and fields spanning paragraph boundaries still live outside
 *     this bridge property surface (deferred to a named successor); the
 *     fragmented (single-field, instruction/result fragmentation) surface IS now
 *     covered by `fragmentedFieldPairArb`.
 *   - Small-edit/run-boundary regression coverage still lives in the fixture
 *     tests (`round-trip-inplace.test.ts`, `nvca-coi-regression.test.ts`).
 *   - Comment and footnote coverage here is limited to `document.xml` anchors;
 *     comment-body and footnote-body tracked content remains out of scope.
 */

import fc from 'fast-check';
import { DOMParser } from '@xmldom/xmldom';
import { describe } from 'vitest';
import { compareDocuments, type ReconstructionMode } from '@usejunior/docx-compare';
import { validateFieldStructure } from '@usejunior/docx-compare';
import {
  COMPLETE_PAGE_FIELD,
  COMPLETE_PAGEREF_FIELD,
  COMPLETE_NUMPAGES_FIELD,
  WHOLE_FIELD_IN_INS,
  FIELD_INSTRUCTIONS,
  completeField,
  fragmentedFieldModification,
  buildDocxFromBodyXml,
  paragraphWithField,
  paragraphWithText,
} from '../testing/ooxml-fixtures.js';
import {
  acceptAllChanges,
  rejectAllChanges,
  extractTextWithParagraphs,
  normalizeText,
} from '@usejunior/docx-compare';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { DocxDocument } from '../primitives/document.js';
import { getParagraphBookmarkId } from '../primitives/bookmarks.js';
import { replaceParagraphTextRange } from '../primitives/text.js';
import {
  createRevisionContext,
  createRevisionIdState,
} from '../primitives/track-changes-emitter.js';
import { buildSyntheticDocx } from './synthetic-docx-fixture.js';
import {
  allureJsonAttachment,
  testAllure,
  type AllureBddContext,
} from '../testing/allure-test.js';

// Declared as a named const (not an inline literal) because this file now
// carries OpenSpec `.openspec([LEAN-FBA-*])` traceability tags, which
// `scripts/validate_allure_test_labels.mjs` requires to map deterministically
// to a `TEST_FEATURE`.
const TEST_FEATURE = 'Lean Spec Bridge (fast-check)';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });

const TRACKED_REVISION_AUTHOR = 'Lean Bridge';
const TRACKED_REVISION_DATE = '2026-05-11T00:00:00Z';
const TRACKED_COMMENT_AUTHOR = 'Bridge Reviewer';
const TRACKED_BOOKMARK_ATTACHMENT_ID = 'lean-spec-bridge';

// Synthetic builder already escapes `<>&` (synthetic-docx-fixture.ts:62-65), so
// no input-side filter is needed; we only drop pure-whitespace paragraphs since
// the synthetic builder emits them as effectively empty <w:t/> runs.
const paragraphArb = fc
  .string({ minLength: 1, maxLength: 30, unit: 'grapheme-ascii' })
  .filter((s) => s.trim().length > 0);

const docArb = fc.array(paragraphArb, { minLength: 1, maxLength: 4 });
const pairArb = fc.tuple(docArb, docArb);

const trackedParagraphArb = paragraphArb.filter(
  (s) => !/[\r\n]/.test(s) && s === s.trim(),
);
const trackedDocArb = fc.array(trackedParagraphArb, { minLength: 1, maxLength: 4 });

const TRACKED_SCENARIO_FAMILIES = [
  'w:ins',
  'w:del',
  'paragraph-insert',
  'pPrChange',
  'comment-anchor',
  'footnote-anchor',
] as const;

type TrackedScenarioFamily = (typeof TRACKED_SCENARIO_FAMILIES)[number];

const FIELD_OPERATIONS = [
  'field-insert',
  'field-delete',
  'field-stable',
  'text-only',
] as const;

type FieldOperation = (typeof FIELD_OPERATIONS)[number];

const FIELD_FIXTURES = {
  NUMPAGES: COMPLETE_NUMPAGES_FIELD,
  PAGE: COMPLETE_PAGE_FIELD,
  PAGEREF: COMPLETE_PAGEREF_FIELD,
} as const;

type FieldType = keyof typeof FIELD_FIXTURES;

const FIELD_TYPES = Object.keys(FIELD_FIXTURES) as FieldType[];

interface InsertScenario {
  family: 'w:ins';
  paragraphs: string[];
  paragraphIndex: number;
  offset: number;
  insertedText: string;
}

interface DeleteScenario {
  family: 'w:del';
  paragraphs: string[];
  paragraphIndex: number;
}

interface ParagraphInsertScenario {
  family: 'paragraph-insert';
  paragraphs: string[];
  anchorIndex: number;
  relativePosition: 'BEFORE' | 'AFTER';
  newParagraphText: string;
}

interface ParagraphPropertyScenario {
  family: 'pPrChange';
  paragraphs: string[];
  paragraphIndex: number;
  beforeTwips: number;
}

interface CommentAnchorScenario {
  family: 'comment-anchor';
  paragraphs: string[];
  paragraphIndex: number;
  start: number;
  end: number;
  commentText: string;
}

interface FootnoteAnchorScenario {
  family: 'footnote-anchor';
  paragraphs: string[];
  paragraphIndex: number;
  footnoteText: string;
}

type TrackedScenario =
  | InsertScenario
  | DeleteScenario
  | ParagraphInsertScenario
  | ParagraphPropertyScenario
  | CommentAnchorScenario
  | FootnoteAnchorScenario;

interface TrackedScenarioPair {
  originalScenario: TrackedScenario;
  revisedScenario: TrackedScenario;
}

interface FieldBearingPair {
  operation: FieldOperation;
  fieldType: FieldType;
  originalBodyXml: string;
  revisedBodyXml: string;
}

interface FieldTextShape {
  prefix: string;
  suffix: string;
  revisedSuffix: string;
  originalPlainText: string;
  revisedPlainText: string;
}

interface MaterializedTrackedScenario {
  scenario: TrackedScenario;
  document: Buffer;
  documentXml: string;
}

type TrackedScenarioCoverage = Record<TrackedScenarioFamily, number>;
type FieldBearingCoverage = Record<FieldOperation, Record<FieldType, number>>;

const NUM_RUNS = 100;

function paragraphSelectionArb(
  minLength: number,
): fc.Arbitrary<{ paragraphs: string[]; paragraphIndex: number; paragraphText: string }> {
  return trackedDocArb.chain((paragraphs) => {
    const eligible = paragraphs
      .map((paragraphText, paragraphIndex) => ({ paragraphIndex, paragraphText }))
      .filter(({ paragraphText }) => paragraphText.length >= minLength);
    return fc.constantFrom(...eligible).map(({ paragraphIndex, paragraphText }) => ({
      paragraphs,
      paragraphIndex,
      paragraphText,
    }));
  });
}

const trackedInsertionScenarioArb: fc.Arbitrary<InsertScenario> = paragraphSelectionArb(1).chain(
  ({ paragraphs, paragraphIndex, paragraphText }) =>
    fc.record({
      family: fc.constant('w:ins' as const),
      paragraphs: fc.constant(paragraphs),
      paragraphIndex: fc.constant(paragraphIndex),
      offset: fc.integer({ min: 0, max: paragraphText.length }),
      insertedText: trackedParagraphArb,
    }),
);

const trackedDeletionScenarioArb: fc.Arbitrary<DeleteScenario> = paragraphSelectionArb(1).map(
  ({ paragraphs, paragraphIndex }) => ({
    family: 'w:del' as const,
    paragraphs,
    paragraphIndex,
  }),
);

const trackedParagraphInsertScenarioArb: fc.Arbitrary<ParagraphInsertScenario> = trackedDocArb.chain(
  (paragraphs) =>
    fc.record({
      family: fc.constant('paragraph-insert' as const),
      paragraphs: fc.constant(paragraphs),
      anchorIndex: fc.integer({ min: 0, max: paragraphs.length - 1 }),
      relativePosition: fc.constantFrom('BEFORE' as const, 'AFTER' as const),
      newParagraphText: trackedParagraphArb,
    }),
);

const trackedParagraphPropertyScenarioArb: fc.Arbitrary<ParagraphPropertyScenario> =
  paragraphSelectionArb(1).chain(({ paragraphs, paragraphIndex }) =>
    fc.record({
      family: fc.constant('pPrChange' as const),
      paragraphs: fc.constant(paragraphs),
      paragraphIndex: fc.constant(paragraphIndex),
      beforeTwips: fc.constantFrom(120, 240, 360, 480),
    }),
  );

const trackedCommentAnchorScenarioArb: fc.Arbitrary<CommentAnchorScenario> = paragraphSelectionArb(
  1,
).chain(({ paragraphs, paragraphIndex, paragraphText }) =>
  fc.integer({ min: 0, max: paragraphText.length - 1 }).chain((start) =>
    fc.record({
      family: fc.constant('comment-anchor' as const),
      paragraphs: fc.constant(paragraphs),
      paragraphIndex: fc.constant(paragraphIndex),
      start: fc.constant(start),
      end: fc.integer({ min: start + 1, max: paragraphText.length }),
      commentText: trackedParagraphArb,
    }),
  ),
);

const trackedFootnoteAnchorScenarioArb: fc.Arbitrary<FootnoteAnchorScenario> = paragraphSelectionArb(
  1,
).chain(({ paragraphs, paragraphIndex }) =>
  fc.record({
    family: fc.constant('footnote-anchor' as const),
    paragraphs: fc.constant(paragraphs),
    paragraphIndex: fc.constant(paragraphIndex),
    footnoteText: trackedParagraphArb,
  }),
);

// Issue #347: the original side was relaxed from the historical
// "del-on-a / ins-on-b only" restriction (which kept INV-RT-001 from being
// falsified by construction under the old raw-text oracle) to the full
// tracked-change scope the corrected projection oracle claims — paragraph
// inserts included. The relaxation did its discovery job: it surfaced two
// genuine engine bug classes, now fixed with issue-linked regressions:
//   - Issue #358 (FIXED): inline run-level and paragraph-insert pre-tracked
//     `w:ins` ORIGINALS are back in scope. The engine now threads the
//     original's insertion provenance through both reconstruction paths —
//     matched content keeps its original-author `w:ins` wrapper and
//     comparison-deleted content nests `w:del(Comparison)` INSIDE the
//     restored `w:ins(original-author)` — so reject(combined) drops exactly
//     what reject(original) drops. Dedicated regression coverage lives in
//     pretracked-ins-provenance.test.ts.
//   - Issue #359 (FIXED): a REVISED-side `w:ins` that matches settled original
//     text is promoted to the shared settled lineage. Those collision pairs
//     are no longer filtered and remain inplace while preserving both
//     accept/reject projections.
const trackedOriginalScenarioArb: fc.Arbitrary<TrackedScenario> = fc.oneof(
  trackedInsertionScenarioArb,
  trackedDeletionScenarioArb,
  trackedParagraphInsertScenarioArb,
  trackedParagraphPropertyScenarioArb,
  trackedCommentAnchorScenarioArb,
  trackedFootnoteAnchorScenarioArb,
);

const trackedRevisedScenarioArb: fc.Arbitrary<TrackedScenario> = fc.oneof(
  trackedInsertionScenarioArb,
  trackedParagraphInsertScenarioArb,
  trackedParagraphPropertyScenarioArb,
  trackedCommentAnchorScenarioArb,
  trackedFootnoteAnchorScenarioArb,
);

const trackedPairArb: fc.Arbitrary<TrackedScenarioPair> = fc.record({
  originalScenario: trackedOriginalScenarioArb,
  revisedScenario: trackedRevisedScenarioArb,
});

const fieldTextShapeArb = fc.record({
  prefix: fc.constantFrom('Total pages ', 'Field value ', 'Reference '),
  suffix: fc.constantFrom(' here.', ' done.', ' end.'),
  revisedSuffix: fc.constantFrom(' updated.', ' complete.', ' final.'),
  originalPlainText: fc.constantFrom('Plain edit before field.', 'Separate original text.'),
  revisedPlainText: fc.constantFrom('Plain edit after field.', 'Separate revised text.'),
});

function buildFieldBearingPair(
  operation: FieldOperation,
  fieldType: FieldType,
  shape: FieldTextShape,
): FieldBearingPair {
  const field = FIELD_FIXTURES[fieldType];
  const stableFieldParagraph = paragraphWithField(shape.prefix, field, shape.suffix);

  switch (operation) {
    case 'field-insert':
      return {
        operation,
        fieldType,
        originalBodyXml: paragraphWithText(`${shape.prefix}${shape.suffix}`),
        revisedBodyXml: paragraphWithField(shape.prefix, field, shape.suffix),
      };
    case 'field-delete':
      return {
        operation,
        fieldType,
        originalBodyXml: paragraphWithField(shape.prefix, field, shape.suffix),
        revisedBodyXml: paragraphWithText(`${shape.prefix}${shape.suffix}`),
      };
    case 'field-stable':
      return {
        operation,
        fieldType,
        originalBodyXml: stableFieldParagraph,
        revisedBodyXml: paragraphWithField(shape.prefix, field, shape.revisedSuffix),
      };
    case 'text-only':
      return {
        operation,
        fieldType,
        originalBodyXml: stableFieldParagraph + paragraphWithText(shape.originalPlainText),
        revisedBodyXml: stableFieldParagraph + paragraphWithText(shape.revisedPlainText),
      };
  }
}

// One deterministic example per (operation, fieldType) combo. Seeded via
// fast-check `examples` so the coverage floor (`assertFieldBearingCoverage`) is
// guaranteed to be satisfied every run rather than relying on the random
// generator happening to hit all 12 combos. NOTE: fast-check consumes examples
// from within the `numRuns` budget, so both properties run at
// `NUM_RUNS + fieldBearingExampleArgs.length` to keep NUM_RUNS *random* cases.
const fieldBearingExamples: FieldBearingPair[] = FIELD_OPERATIONS.flatMap((operation) =>
  FIELD_TYPES.map((fieldType) =>
    buildFieldBearingPair(operation, fieldType, {
      prefix: 'Total pages ',
      suffix: ' here.',
      revisedSuffix: ' updated.',
      originalPlainText: 'Plain edit before field.',
      revisedPlainText: 'Plain edit after field.',
    }),
  ),
);
const fieldBearingExampleArgs = fieldBearingExamples.map((pair) => [pair] as [FieldBearingPair]);

const fieldBearingPairArb: fc.Arbitrary<FieldBearingPair> = fc
  .record({
    operation: fc.constantFrom(...FIELD_OPERATIONS),
    fieldType: fc.constantFrom(...FIELD_TYPES),
    shape: fieldTextShapeArb,
  })
  .map(({ operation, fieldType, shape }) => buildFieldBearingPair(operation, fieldType, shape));

// ---------------------------------------------------------------------------
// Fragmented-field arbitrary (sibling of fieldBearingPairArb)
//
// Where fieldBearingPairArb covers WHOLE, self-contained fields at run
// boundaries, this arbitrary covers the harder fragmented surface: a field
// whose result run changes under track changes, and/or a pre-tracked field
// whose instruction code is already split into <w:ins>/<w:del> wrappers.
//
// Its property is MODE-INDEPENDENT: the residual axioms constrain the
// comparison OUTPUT, not the reconstruction strategy. The engine correctly
// falls back from inplace to a rebuild reconstruction for one operation of
// this surface (clean → pretracked-fragmented with a result-text change, which
// fails the inplace fieldStructure safety check), so — unlike the field-free /
// whole-field arbitraries — fallback here is a LEGITIMATE outcome, not
// falsification. The mode-distribution coverage floor (below) requires both an
// inplace and a fallback outcome to be observed, so a silent all-inplace or
// all-fallback regression fails loudly.
// ---------------------------------------------------------------------------

const FRAGMENTED_FIELD_OPERATIONS = [
  'result-edit',
  'pretracked-fragmented-to-clean',
  'clean-to-pretracked-fragmented',
] as const;

type FragmentedFieldOperation = (typeof FRAGMENTED_FIELD_OPERATIONS)[number];

// The instruction code that the pre-tracked fragmented field deletes (the "old"
// code under <w:del>), distinct from the field type's own (the "new" code under
// <w:ins>), so the modification is non-trivial.
const FIELD_ALT_INSTRUCTIONS: Record<FieldType, string> = {
  NUMPAGES: FIELD_INSTRUCTIONS.PAGE,
  PAGE: FIELD_INSTRUCTIONS.NUMPAGES,
  PAGEREF: FIELD_INSTRUCTIONS.PAGE,
};

interface FragmentedFieldPair {
  operation: FragmentedFieldOperation;
  fieldType: FieldType;
  originalBodyXml: string;
  revisedBodyXml: string;
}

interface FragmentedFieldShape {
  prefix: string;
  suffix: string;
  originalResult: string;
  revisedResult: string;
}

// originalResult and revisedResult are drawn from DISJOINT pools so they always
// differ — guaranteeing a tracked result-text change, which (together with the
// clean→pretracked-fragmented direction) is what deterministically drives the
// engine's correct rebuild fallback and thus satisfies the mode floor.
const fragmentedFieldShapeArb: fc.Arbitrary<FragmentedFieldShape> = fc.record({
  prefix: fc.constantFrom('Total pages ', 'Page count ', 'See section '),
  suffix: fc.constantFrom(' total.', ' here.', ' end.'),
  originalResult: fc.constantFrom('1', '2', '3'),
  revisedResult: fc.constantFrom('7', '8', '9'),
});

function buildFragmentedFieldPair(
  operation: FragmentedFieldOperation,
  fieldType: FieldType,
  shape: FragmentedFieldShape,
): FragmentedFieldPair {
  const instruction = FIELD_INSTRUCTIONS[fieldType];
  const altInstruction = FIELD_ALT_INSTRUCTIONS[fieldType];
  const clean = (result: string) =>
    paragraphWithField(shape.prefix, completeField(instruction, result), shape.suffix);
  const fragmented = (result: string) =>
    paragraphWithField(
      shape.prefix,
      fragmentedFieldModification(instruction, altInstruction, result),
      shape.suffix,
    );

  switch (operation) {
    case 'result-edit':
      return {
        operation,
        fieldType,
        originalBodyXml: clean(shape.originalResult),
        revisedBodyXml: clean(shape.revisedResult),
      };
    case 'pretracked-fragmented-to-clean':
      return {
        operation,
        fieldType,
        originalBodyXml: fragmented(shape.originalResult),
        revisedBodyXml: clean(shape.revisedResult),
      };
    case 'clean-to-pretracked-fragmented':
      return {
        operation,
        fieldType,
        originalBodyXml: clean(shape.originalResult),
        revisedBodyXml: fragmented(shape.revisedResult),
      };
  }
}

// One deterministic example per (operation, fieldType). Seeded via fast-check
// `examples` so the coverage floor is guaranteed every run: the
// clean-to-pretracked-fragmented examples (result 3 → 7) deterministically
// produce the fallback outcome and the other operations the inplace outcome.
const fragmentedFieldExamples: FragmentedFieldPair[] = FRAGMENTED_FIELD_OPERATIONS.flatMap(
  (operation) =>
    FIELD_TYPES.map((fieldType) =>
      buildFragmentedFieldPair(operation, fieldType, {
        prefix: 'Total pages ',
        suffix: ' end.',
        originalResult: '3',
        revisedResult: '7',
      }),
    ),
);
const fragmentedFieldExampleArgs = fragmentedFieldExamples.map(
  (pair) => [pair] as [FragmentedFieldPair],
);

const fragmentedFieldPairArb: fc.Arbitrary<FragmentedFieldPair> = fc
  .record({
    operation: fc.constantFrom(...FRAGMENTED_FIELD_OPERATIONS),
    fieldType: fc.constantFrom(...FIELD_TYPES),
    shape: fragmentedFieldShapeArb,
  })
  .map(({ operation, fieldType, shape }) => buildFragmentedFieldPair(operation, fieldType, shape));

async function getDocumentXml(document: Buffer): Promise<string> {
  const archive = await DocxArchive.load(document);
  return await archive.getDocumentXml();
}

function normalizeDocumentXmlText(documentXml: string): string {
  return normalizeText(extractTextWithParagraphs(documentXml));
}

interface CompareBridgeResult {
  original: Buffer;
  revised: Buffer;
  combined: string;
  modeUsed: ReconstructionMode | undefined;
  fallbackReason: string | undefined;
  failedChecks: string[];
}

interface DocumentTextViews {
  rawXml: string;
  rawText: string;
  acceptedText: string;
  rejectedText: string;
}

async function compareDocumentBuffers(
  original: Buffer,
  revised: Buffer,
): Promise<CompareBridgeResult> {
  const result = await compareDocuments(original, revised, {
    engine: 'atomizer',
    reconstructionMode: 'inplace',
  });

  const failedChecks = result.fallbackDiagnostics
    ? Array.from(
        new Set(result.fallbackDiagnostics.attempts.flatMap((attempt) => attempt.failedChecks)),
      ).sort()
    : [];

  return {
    original,
    revised,
    combined: await getDocumentXml(result.document),
    modeUsed: result.reconstructionModeUsed,
    fallbackReason: result.fallbackReason,
    failedChecks,
  };
}

async function compareSyntheticDocuments(
  originalParas: string[],
  revisedParas: string[],
): Promise<CompareBridgeResult> {
  const [original, revised] = await Promise.all([
    buildSyntheticDocx({ paragraphs: originalParas }),
    buildSyntheticDocx({ paragraphs: revisedParas }),
  ]);

  return compareDocumentBuffers(original, revised);
}

async function compareFieldBearingPair(pair: FieldBearingPair): Promise<CompareBridgeResult> {
  const [original, revised] = await Promise.all([
    buildDocxFromBodyXml(pair.originalBodyXml),
    buildDocxFromBodyXml(pair.revisedBodyXml),
  ]);

  return compareDocumentBuffers(original, revised);
}

async function compareFragmentedFieldPair(
  pair: FragmentedFieldPair,
): Promise<CompareBridgeResult> {
  const [original, revised] = await Promise.all([
    buildDocxFromBodyXml(pair.originalBodyXml),
    buildDocxFromBodyXml(pair.revisedBodyXml),
  ]);

  return compareDocumentBuffers(original, revised);
}

async function getDocumentTextViews(document: Buffer): Promise<DocumentTextViews> {
  const rawXml = await getDocumentXml(document);
  return {
    rawXml,
    rawText: normalizeDocumentXmlText(rawXml),
    acceptedText: normalizeDocumentXmlText(acceptAllChanges(rawXml)),
    rejectedText: normalizeDocumentXmlText(rejectAllChanges(rawXml)),
  };
}

function createTrackedCoverage(): TrackedScenarioCoverage {
  return {
    'w:ins': 0,
    'w:del': 0,
    'paragraph-insert': 0,
    pPrChange: 0,
    'comment-anchor': 0,
    'footnote-anchor': 0,
  };
}

function recordTrackedScenarioHit(
  coverage: TrackedScenarioCoverage,
  scenario: TrackedScenario,
): void {
  coverage[scenario.family] += 1;
}

function assertTrackedScenarioCoverage(
  invariant: string,
  coverage: TrackedScenarioCoverage,
): void {
  const missing = TRACKED_SCENARIO_FAMILIES.filter((family) => coverage[family] === 0);
  if (missing.length > 0) {
    throw new Error(
      `${invariant}: tracked-input family coverage incomplete. ` +
        `missing=${missing.join(', ')} hits=${JSON.stringify(coverage)}`,
    );
  }
}

function createFieldBearingCoverage(): FieldBearingCoverage {
  return Object.fromEntries(
    FIELD_OPERATIONS.map((operation) => [
      operation,
      Object.fromEntries(FIELD_TYPES.map((fieldType) => [fieldType, 0])),
    ]),
  ) as FieldBearingCoverage;
}

function recordFieldBearingHit(coverage: FieldBearingCoverage, pair: FieldBearingPair): void {
  coverage[pair.operation][pair.fieldType] += 1;
}

function assertFieldBearingCoverage(invariant: string, coverage: FieldBearingCoverage): void {
  const missing = FIELD_OPERATIONS.flatMap((operation) =>
    FIELD_TYPES.filter((fieldType) => coverage[operation][fieldType] === 0).map(
      (fieldType) => `${operation}/${fieldType}`,
    ),
  );
  if (missing.length > 0) {
    throw new Error(
      `${invariant}: field-bearing operation/type coverage incomplete. ` +
        `missing=${missing.join(', ')} hits=${JSON.stringify(coverage)}`,
    );
  }
}

// Fragmented-field coverage is floored over TWO axes: the operation family, and
// the reconstruction OUTCOME (inplace vs fallback). Recording the outcome — and
// requiring both to appear — is the safety valve for not asserting
// `assertInplaceResult` on this surface: it converts "the engine still both
// stays-inplace and falls-back here" from an unstated assumption into a checked
// invariant, so a regression that makes the surface all-inplace or all-fallback
// fails loudly instead of passing vacuously.
type ReconstructionOutcome = 'inplace' | 'fallback';
const RECONSTRUCTION_OUTCOMES: readonly ReconstructionOutcome[] = ['inplace', 'fallback'];

interface FragmentedFieldCoverage {
  operations: Record<FragmentedFieldOperation, number>;
  outcomes: Record<ReconstructionOutcome, number>;
}

function createFragmentedFieldCoverage(): FragmentedFieldCoverage {
  return {
    operations: Object.fromEntries(
      FRAGMENTED_FIELD_OPERATIONS.map((operation) => [operation, 0]),
    ) as Record<FragmentedFieldOperation, number>,
    outcomes: { inplace: 0, fallback: 0 },
  };
}

function reconstructionOutcome(result: CompareBridgeResult): ReconstructionOutcome {
  // The comparison is always requested in inplace mode, so any non-inplace
  // result is the engine's own fallback to rebuild.
  return result.modeUsed === 'inplace' ? 'inplace' : 'fallback';
}

function recordFragmentedFieldHit(
  coverage: FragmentedFieldCoverage,
  pair: FragmentedFieldPair,
  result: CompareBridgeResult,
): void {
  coverage.operations[pair.operation] += 1;
  coverage.outcomes[reconstructionOutcome(result)] += 1;
}

function assertFragmentedFieldCoverage(
  invariant: string,
  coverage: FragmentedFieldCoverage,
): void {
  const missingOperations = FRAGMENTED_FIELD_OPERATIONS.filter(
    (operation) => coverage.operations[operation] === 0,
  );
  const missingOutcomes = RECONSTRUCTION_OUTCOMES.filter(
    (outcome) => coverage.outcomes[outcome] === 0,
  );
  if (missingOperations.length > 0 || missingOutcomes.length > 0) {
    throw new Error(
      `${invariant}: fragmented-field coverage incomplete. ` +
        `missingOperations=${missingOperations.join(', ') || '(none)'} ` +
        `missingOutcomes=${missingOutcomes.join(', ') || '(none)'} ` +
        `hits=${JSON.stringify(coverage)}`,
    );
  }
}

function countTagMatches(documentXml: string, tagName: string): number {
  return (documentXml.match(new RegExp(`<${tagName}\\b`, 'g')) ?? []).length;
}

function getParagraphIds(document: DocxDocument): string[] {
  return document.getParagraphs().map((paragraph) => {
    const paragraphId = getParagraphBookmarkId(paragraph);
    if (!paragraphId) {
      throw new Error('Paragraph bookmark missing after insertParagraphBookmarks');
    }
    return paragraphId;
  });
}

function createTrackedRevisionCtx() {
  return createRevisionContext({
    author: TRACKED_REVISION_AUTHOR,
    date: TRACKED_REVISION_DATE,
    idState: createRevisionIdState(),
  });
}

function assertTrackedScenarioMarkup(
  scenario: TrackedScenario,
  documentXml: string,
): void {
  switch (scenario.family) {
    case 'w:ins':
      if (
        !documentXml.includes('<w:ins') ||
        !normalizeDocumentXmlText(documentXml).includes(normalizeText(scenario.insertedText))
      ) {
        throw new Error(
          `w:ins scenario failed to emit tracked insertion markup: ${JSON.stringify(scenario)}`,
        );
      }
      return;
    case 'w:del':
      if (!documentXml.includes('<w:del') || !documentXml.includes('<w:delText')) {
        throw new Error(
          `w:del scenario failed to emit deletion markup with delText rewrite: ${JSON.stringify(scenario)}`,
        );
      }
      return;
    case 'paragraph-insert':
      if (
        countTagMatches(documentXml, 'w:ins') < 2 ||
        !normalizeDocumentXmlText(documentXml).includes(normalizeText(scenario.newParagraphText))
      ) {
        throw new Error(
          `paragraph-insert scenario failed to emit paragraph-mark + run-level insertion markup: ${JSON.stringify(scenario)}`,
        );
      }
      return;
    case 'pPrChange':
      if (!documentXml.includes('<w:pPrChange')) {
        throw new Error(
          `pPrChange scenario failed to emit paragraph property snapshot markup: ${JSON.stringify(scenario)}`,
        );
      }
      return;
    case 'comment-anchor':
      if (
        !documentXml.includes('<w:commentRangeStart') ||
        !documentXml.includes('<w:commentRangeEnd') ||
        !documentXml.includes('<w:commentReference') ||
        !insWrapperContains(documentXml, '<w:commentReference')
      ) {
        throw new Error(
          `comment-anchor scenario failed to emit a w:ins-wrapped commentReference run (tracked emission missing): ${JSON.stringify(scenario)}`,
        );
      }
      return;
    case 'footnote-anchor':
      if (
        !documentXml.includes('<w:footnoteReference') ||
        !insWrapperContains(documentXml, '<w:footnoteReference')
      ) {
        throw new Error(
          `footnote-anchor scenario failed to emit a w:ins-wrapped footnoteReference run (tracked emission missing): ${JSON.stringify(scenario)}`,
        );
      }
      return;
  }
}

// Returns true iff documentXml contains a `<w:ins ...>...</w:ins>` block whose
// inner content includes `needle`. Used to assert that tracked-emission
// primitives (addComment, addFootnote) actually wrap their reference run in a
// w:ins envelope, not just emit the anchor element on its own.
function insWrapperContains(documentXml: string, needle: string): boolean {
  const insBlockPattern = /<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g;
  for (const match of documentXml.matchAll(insBlockPattern)) {
    if (match[1]!.includes(needle)) {
      return true;
    }
  }
  return false;
}

async function materializeTrackedScenario(
  scenario: TrackedScenario,
): Promise<MaterializedTrackedScenario> {
  const document = await DocxDocument.load(
    await buildSyntheticDocx({ paragraphs: scenario.paragraphs }),
  );
  document.insertParagraphBookmarks(TRACKED_BOOKMARK_ATTACHMENT_ID);
  const paragraphIds = getParagraphIds(document);
  const revisionCtx = createTrackedRevisionCtx();

  switch (scenario.family) {
    case 'w:ins': {
      const paragraph = document.getParagraphElementById(paragraphIds[scenario.paragraphIndex]!);
      if (!paragraph) {
        throw new Error(`Paragraph not found for tracked insertion: ${scenario.paragraphIndex}`);
      }
      replaceParagraphTextRange(
        paragraph,
        scenario.offset,
        scenario.offset,
        scenario.insertedText,
        revisionCtx,
      );
      break;
    }
    case 'w:del': {
      const paragraph = document.getParagraphElementById(paragraphIds[scenario.paragraphIndex]!);
      if (!paragraph) {
        throw new Error(`Paragraph not found for tracked deletion: ${scenario.paragraphIndex}`);
      }
      const paragraphText = scenario.paragraphs[scenario.paragraphIndex]!;
      replaceParagraphTextRange(paragraph, 0, paragraphText.length, '', revisionCtx);
      break;
    }
    case 'paragraph-insert':
      document.insertParagraph(
        {
          positionalAnchorNodeId: paragraphIds[scenario.anchorIndex]!,
          relativePosition: scenario.relativePosition,
          newText: scenario.newParagraphText,
        },
        revisionCtx,
      );
      break;
    case 'pPrChange':
      document.setParagraphSpacing(
        {
          paragraphIds: [paragraphIds[scenario.paragraphIndex]!],
          beforeTwips: scenario.beforeTwips,
        },
        revisionCtx,
      );
      break;
    case 'comment-anchor':
      await document.addComment(
        {
          paragraphId: paragraphIds[scenario.paragraphIndex]!,
          start: scenario.start,
          end: scenario.end,
          author: TRACKED_COMMENT_AUTHOR,
          text: scenario.commentText,
        },
        revisionCtx,
      );
      break;
    case 'footnote-anchor':
      await document.addFootnote(
        {
          paragraphId: paragraphIds[scenario.paragraphIndex]!,
          text: scenario.footnoteText,
        },
        revisionCtx,
      );
      break;
  }

  const { buffer } = await document.toBuffer({ cleanBookmarks: true });
  const documentXml = await getDocumentXml(buffer);
  assertTrackedScenarioMarkup(scenario, documentXml);

  return {
    scenario,
    document: buffer,
    documentXml,
  };
}

function fallbackError(
  invariant: string,
  context: Record<string, unknown>,
  result: CompareBridgeResult,
): Error {
  return new Error(
    `${invariant}: triage=inplace-fallback inplace mode fell back to ${result.modeUsed ?? 'unknown'} ` +
      `under the bridge generator. ` +
      `fallbackReason=${result.fallbackReason ?? '(none)'} ` +
      `failedChecks=${JSON.stringify(result.failedChecks)} ` +
      `context=${JSON.stringify(context)}`,
  );
}

function assertInplaceResult(
  invariant: string,
  context: Record<string, unknown>,
  result: CompareBridgeResult,
): void {
  if (result.modeUsed !== 'inplace') {
    throw fallbackError(invariant, context, result);
  }
}

function assertFieldInvariant(
  invariant: string,
  context: Record<string, unknown>,
  combinedXml: string,
): void {
  const acceptedOk = validateFieldStructure(acceptAllChanges(combinedXml));
  const rejectedOk = validateFieldStructure(rejectAllChanges(combinedXml));

  if (!acceptedOk || !rejectedOk) {
    throw new Error(
      `${invariant}: triage=engine-bug field structure was not preserved by accept/reject. ` +
        `acceptedOk=${acceptedOk} rejectedOk=${rejectedOk} context=${JSON.stringify(context)}`,
    );
  }
}

function roundTripError(
  invariant: string,
  context: Record<string, unknown>,
  originalViews: DocumentTextViews,
  revisedViews: DocumentTextViews,
  acceptedCombined: string,
  rejectedCombined: string,
): Error {
  // The asserted surface IS the corrected projection law (#347):
  // accept(combined) vs accept(revised), reject(combined) vs reject(original).
  // A mismatch on that surface is an engine bug by definition; the former
  // `theorem-domain` category (projections agree but the inputs' raw tracked
  // text does not) collapsed into the law itself. The raw-text comparisons
  // below survive as diagnostics only.
  const acceptMatchesAcceptedView = acceptedCombined === revisedViews.acceptedText;
  const rejectMatchesRejectedView = rejectedCombined === originalViews.rejectedText;
  const category = 'engine-bug';

  const hints = [
    revisedViews.rawXml.includes('<w:delText') ? 'revised-raw-contains-w:delText' : null,
    originalViews.rawXml.includes('<w:delText') ? 'original-raw-contains-w:delText' : null,
    revisedViews.rawXml.includes('<w:ins') ? 'revised-raw-contains-w:ins' : null,
    originalViews.rawXml.includes('<w:ins') ? 'original-raw-contains-w:ins' : null,
  ].filter((hint): hint is string => hint !== null);

  return new Error(
    `${invariant}: triage=${category} round-trip text mismatch. ` +
      `accept(combined)==raw(b)? ${acceptedCombined === revisedViews.rawText} ` +
      `reject(combined)==raw(a)? ${rejectedCombined === originalViews.rawText} ` +
      `accept(combined)==accept(b)? ${acceptMatchesAcceptedView} ` +
      `reject(combined)==reject(a)? ${rejectMatchesRejectedView} ` +
      `acceptedCombined=${JSON.stringify(acceptedCombined)} ` +
      `rawRevised=${JSON.stringify(revisedViews.rawText)} ` +
      `acceptedRevised=${JSON.stringify(revisedViews.acceptedText)} ` +
      `rejectedCombined=${JSON.stringify(rejectedCombined)} ` +
      `rawOriginal=${JSON.stringify(originalViews.rawText)} ` +
      `rejectedOriginal=${JSON.stringify(originalViews.rejectedText)} ` +
      `hints=${JSON.stringify(hints)} ` +
      `context=${JSON.stringify(context)}`,
  );
}

async function assertRoundTripInvariant(
  invariant: string,
  context: Record<string, unknown>,
  result: CompareBridgeResult,
): Promise<void> {
  const [originalViews, revisedViews] = await Promise.all([
    getDocumentTextViews(result.original),
    getDocumentTextViews(result.revised),
  ]);

  const acceptedCombined = normalizeDocumentXmlText(acceptAllChanges(result.combined));
  const rejectedCombined = normalizeDocumentXmlText(rejectAllChanges(result.combined));

  // The corrected projection law (#347): compare the candidate's accept/reject
  // projections against the inputs' accept/reject projections — NOT their raw
  // extracted text, which counts both w:t and w:delText and is neither
  // projection once an input carries its own tracked changes. For clean inputs
  // the projections equal the raw extraction, so this is a no-op there.
  if (
    acceptedCombined !== revisedViews.acceptedText ||
    rejectedCombined !== originalViews.rejectedText
  ) {
    throw roundTripError(
      invariant,
      context,
      originalViews,
      revisedViews,
      acceptedCombined,
      rejectedCombined,
    );
  }
}

// =============================================================================
// Field-bearing falsifiability layer for the Tier 2 residual axiom
//
// The current (post-PR-B) axiom in `verification/lean/LeanSpike/Spec.lean` is
// `compareDocumentXml_output_preservation_friendly`: it asserts only that the
// inplace combined output is *preservation-friendly* — its document-level walk
// and begin/end balance are unchanged by accept/reject. That weaker shape is
// what `assertFieldInvariant` already checks (via `validateFieldStructure` on
// the accepted and rejected outputs).
//
// `assertRecursivelyWellformed` (below) additionally checks the STRICTER
// `fieldContextNeutral ∀ ctx` property per wrapper subtree. The current engine
// satisfies this stronger property because it emits whole field sequences as
// single track-change wrappers (grep `@lean-segment: field-wrapper-emission`
// in `inPlaceModifier-wrappers.ts`). When ECMA-376 fragmentation conformance lands (#217),
// fragmented wrapper subtrees will NOT satisfy `∀ ctx` neutrality and this
// over-check will need to be removed or relaxed. Until then it serves as an
// audit gate that the engine has not regressed into emitting partial-wrapper
// fragments unexpectedly.
// =============================================================================

/**
 * TS-side analogue of `Tier2.FieldStructure.fieldContextNeutral` for one wrapper
 * subtree. Walks every descendant `w:fldChar` / `w:instrText` / `w:delInstrText`
 * atom in document order over a depth-indexed `pastSeparatorAtDepth` stack —
 * the exact model the Lean walk and `pipeline.ts:374-389` use.
 *
 * Pop-on-empty and separate-on-empty are treated as FAILURE (not the no-op the
 * whole-document walk uses): an inner subtree that pops or flips a separator bit
 * on the empty local stack would disturb an outer field context, so it is not
 * context-neutral under the universal quantifier `∀ ctx`.
 */
function isFieldContextNeutral(wrapper: Element): boolean {
  const descendants = wrapper.getElementsByTagName('*');
  const stack: boolean[] = [];
  for (let i = 0; i < descendants.length; i++) {
    const el = descendants[i];
    if (!el) continue;
    const tag = el.nodeName;
    if (tag === 'w:fldChar') {
      const kind = el.getAttribute('w:fldCharType');
      if (kind === 'begin') {
        stack.push(false);
      } else if (kind === 'separate') {
        if (stack.length === 0) return false;
        stack[stack.length - 1] = true;
      } else if (kind === 'end') {
        if (stack.length === 0) return false;
        stack.pop();
      }
    } else if (tag === 'w:instrText' || tag === 'w:delInstrText') {
      if (stack.length === 0 || stack[stack.length - 1] === true) return false;
    }
  }
  return stack.length === 0;
}

function assertRecursivelyWellformed(
  invariant: string,
  context: Record<string, unknown>,
  combinedXml: string,
): void {
  if (!validateFieldStructure(combinedXml)) {
    throw new Error(
      `${invariant}: triage=engine-bug whole-document validateFieldStructure failed on ` +
        `inplace comparison output. context=${JSON.stringify(context)}`,
    );
  }
  const doc = new DOMParser().parseFromString(combinedXml, 'application/xml');
  for (const tag of ['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo']) {
    const wrappers = doc.getElementsByTagName(tag);
    for (let i = 0; i < wrappers.length; i++) {
      const wrapper = wrappers[i];
      if (!wrapper) continue;
      if (!isFieldContextNeutral(wrapper as unknown as Element)) {
        throw new Error(
          `${invariant}: triage=engine-bug wrapper subtree <${tag}>[${i}] is not ` +
            `field-context-neutral — recursivelyWellformed precondition violated. ` +
            `context=${JSON.stringify(context)}`,
        );
      }
    }
  }
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
            const result = await compareSyntheticDocuments(originalParas, revisedParas);
            const context = { originalParagraphs: originalParas, revisedParagraphs: revisedParas };

            assertInplaceResult('INV-FIELD-001', context, result);
            assertFieldInvariant('INV-FIELD-001', context, result.combined);
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
            const result = await compareSyntheticDocuments(originalParas, revisedParas);
            const context = { originalParagraphs: originalParas, revisedParagraphs: revisedParas };

            assertInplaceResult('INV-RT-001', context, result);
            await assertRoundTripInvariant('INV-RT-001', context, result);
          }),
          { numRuns: NUM_RUNS },
        );
      });
    },
  );

  test(
    'INV-FIELD-001: field structure preserved on pre-tracked paragraph-only inplace comparison output',
    async ({ given, when, then }: AllureBddContext) => {
      const coverage = createTrackedCoverage();

      await given('pre-tracked paragraph-only original and revised scenarios are generated through primitives', async () => {});

      await when('the live inplace comparison output is accepted and rejected across tracked inputs', async () => {});

      await then('field structure remains valid and every tracked scenario family is exercised', async () => {
        try {
          await fc.assert(
            fc.asyncProperty(trackedPairArb, async ({ originalScenario, revisedScenario }) => {
              const [original, revised] = await Promise.all([
                materializeTrackedScenario(originalScenario),
                materializeTrackedScenario(revisedScenario),
              ]);

              recordTrackedScenarioHit(coverage, original.scenario);
              recordTrackedScenarioHit(coverage, revised.scenario);

              const result = await compareDocumentBuffers(original.document, revised.document);
              const context = { originalScenario, revisedScenario };

              assertInplaceResult('INV-FIELD-001 tracked', context, result);
              assertFieldInvariant('INV-FIELD-001 tracked', context, result.combined);
            }),
            { numRuns: NUM_RUNS },
          );
        } finally {
          await allureJsonAttachment('tracked-input-family-hits-inv-field-001', coverage);
        }
        assertTrackedScenarioCoverage('INV-FIELD-001 tracked', coverage);
      });
    },
  );

  test(
    'INV-RT-001: paired round-trip text equality on pre-tracked paragraph-only inplace comparison output',
    async ({ given, when, then }: AllureBddContext) => {
      const coverage = createTrackedCoverage();

      await given('pre-tracked paragraph-only original and revised scenarios are generated through primitives', async () => {});

      await when('the live inplace comparison output is projected through accept-all and reject-all across tracked inputs', async () => {});

      await then('normalized text round-trips and every tracked scenario family is exercised', async () => {
        try {
          await fc.assert(
            fc.asyncProperty(trackedPairArb, async ({ originalScenario, revisedScenario }) => {
              const [original, revised] = await Promise.all([
                materializeTrackedScenario(originalScenario),
                materializeTrackedScenario(revisedScenario),
              ]);

              recordTrackedScenarioHit(coverage, original.scenario);
              recordTrackedScenarioHit(coverage, revised.scenario);

              const result = await compareDocumentBuffers(original.document, revised.document);
              const context = { originalScenario, revisedScenario };

              assertInplaceResult('INV-RT-001 tracked', context, result);
              await assertRoundTripInvariant('INV-RT-001 tracked', context, result);
            }),
            { numRuns: NUM_RUNS },
          );
        } finally {
          await allureJsonAttachment('tracked-input-family-hits-inv-rt-001', coverage);
        }
        assertTrackedScenarioCoverage('INV-RT-001 tracked', coverage);
      });
    },
  );

  test(
    'INV-RT-001: two-author stacked insertion stays inplace and round-trips projection-to-projection (#347)',
    async ({ given, when, then }: AllureBddContext) => {
      // Characterization of the committed multi-author semantics behind the
      // corrected round-trip oracle (#347): accept-all / reject-all are GLOBAL
      // across all authors (no author-scoped variant exists). The original
      // carries its own author's insertion (`TRACKED_REVISION_AUTHOR`); the
      // revised extends that same tracked insertion, so the live comparison
      // stacks `Comparison`-author markup onto the same paragraph. Under the
      // pre-#347 RAW baselines this shape forced a spurious inplace→rebuild
      // fallback (reject projections drop the pre-tracked insertion while the
      // raw original text keeps it); under the projected baselines it must stay
      // inplace and satisfy the projection law.
      let original!: MaterializedTrackedScenario;
      let revised!: MaterializedTrackedScenario;
      let result!: CompareBridgeResult;

      await given(
        'an original pre-tracked with a first-author insertion and a revised that extends the same tracked insertion',
        async () => {
          const baseParagraphs = ['Alpha base text.', 'Beta closing text.'];
          const insertionOffset = 'Alpha base text.'.length;
          [original, revised] = await Promise.all([
            materializeTrackedScenario({
              family: 'w:ins',
              paragraphs: baseParagraphs,
              paragraphIndex: 0,
              offset: insertionOffset,
              insertedText: ' tracked by first author',
            }),
            materializeTrackedScenario({
              family: 'w:ins',
              paragraphs: baseParagraphs,
              paragraphIndex: 0,
              offset: insertionOffset,
              insertedText: ' tracked by first author plus a second-author tail',
            }),
          ]);
        },
      );

      await when(
        'the live inplace comparison stacks Comparison-author changes on top of the pre-tracked insertion',
        async () => {
          result = await compareDocumentBuffers(original.document, revised.document);
        },
      );

      await then(
        'the result stays inplace, carries both authors, and accept/reject projections round-trip',
        async () => {
          const context = { fixture: 'two-author-stacked-insertion' };
          assertInplaceResult('INV-RT-001 two-author stacked insertion', context, result);
          const hasFirstAuthor = result.combined.includes(
            `w:author="${TRACKED_REVISION_AUTHOR}"`,
          );
          const hasComparisonAuthor = result.combined.includes('w:author="Comparison"');
          if (!hasFirstAuthor || !hasComparisonAuthor) {
            throw new Error(
              `INV-RT-001 two-author stacked insertion: combined output must carry revisions ` +
                `from both authors for this characterization to be non-vacuous. ` +
                `hasFirstAuthor=${hasFirstAuthor} hasComparisonAuthor=${hasComparisonAuthor} ` +
                `context=${JSON.stringify(context)}`,
            );
          }
          await assertRoundTripInvariant('INV-RT-001 two-author stacked insertion', context, result);
        },
      );
    },
  );

  test(
    'INV-RT-001: revised-side insertion collisions resolve to settled provenance (#359)',
    async ({ given, when, then }: AllureBddContext) => {
      // When revised calls matched content inserted but original says it is
      // settled, the common lineage is settled: both accept and reject keep it.
      // The physical revised-side insertion wrapper (and paragraph insertion
      // mark, where present) must be removed so the in-place candidate passes
      // the projection checks without rebuild fallback.
      interface ProvenanceCollisionCase {
        name: string;
        build: () => Promise<{ original: Buffer; revised: Buffer }>;
        expectedRejectCombined: string;
        expectedRejectOriginal: string;
      }

      const cases: ProvenanceCollisionCase[] = [
        {
          name: '#359 inline-ins revised colliding with a plain original word',
          build: async () => ({
            original: await buildSyntheticDocx({ paragraphs: ['!', '!', 'I'] }),
            revised: (
              await materializeTrackedScenario({
                family: 'w:ins',
                paragraphs: ['6.'],
                paragraphIndex: 0,
                offset: 2,
                insertedText: 'I',
              })
            ).document,
          }),
          expectedRejectCombined: '!\n!\nI',
          expectedRejectOriginal: '!\n!\nI',
        },
        {
          name: '#359 paragraph-insert revised colliding with a plain original paragraph',
          build: async () => ({
            original: await buildSyntheticDocx({ paragraphs: ['Alpha text.', 'Added para.'] }),
            revised: (
              await materializeTrackedScenario({
                family: 'paragraph-insert',
                paragraphs: ['Alpha text.'],
                anchorIndex: 0,
                relativePosition: 'AFTER',
                newParagraphText: 'Added para.',
              })
            ).document,
          }),
          expectedRejectCombined: 'Alpha text.\nAdded para.',
          expectedRejectOriginal: 'Alpha text.\nAdded para.',
        },
      ];

      await given(
        'minimal collision pairs where revised insertion text is settled in original',
        async () => {},
      );

      await when('each pair runs through the live inplace-requested comparison', async () => {});

      await then(
        'every case remains inplace with settled provenance and exact accept/reject projections',
        async () => {
          for (const collision of cases) {
            const { original, revised } = await collision.build();
            const result = await compareDocumentBuffers(original, revised);

            if (result.modeUsed !== 'inplace') {
              throw new Error(
                `${collision.name}: expected inplace output after resolving the provenance ` +
                  `collision, got mode=${result.modeUsed} ` +
                  `failedChecks=${JSON.stringify(result.failedChecks)} ` +
                  `fallbackReason=${result.fallbackReason ?? '(none)'}`,
              );
            }
            if (result.failedChecks.length > 0) {
              throw new Error(
                `${collision.name}: inplace output retained failed safety checks: ` +
                  JSON.stringify(result.failedChecks),
              );
            }
            if (result.combined.includes(`w:author="${TRACKED_REVISION_AUTHOR}"`)) {
              throw new Error(
                `${collision.name}: combined output retained revised insertion provenance ` +
                  `for text proven settled by the original`,
              );
            }

            const [originalViews, revisedViews] = await Promise.all([
              getDocumentTextViews(original),
              getDocumentTextViews(revised),
            ]);
            const acceptedCombined = normalizeDocumentXmlText(acceptAllChanges(result.combined));
            const rejectedCombined = normalizeDocumentXmlText(rejectAllChanges(result.combined));

            if (acceptedCombined !== revisedViews.acceptedText) {
              throw new Error(
                `${collision.name}: accept projection unexpectedly diverged. ` +
                  `acceptedCombined=${JSON.stringify(acceptedCombined)} ` +
                  `acceptedRevised=${JSON.stringify(revisedViews.acceptedText)}`,
              );
            }
            if (
              rejectedCombined !== collision.expectedRejectCombined ||
              originalViews.rejectedText !== collision.expectedRejectOriginal
            ) {
              throw new Error(
                `${collision.name}: reject projection diverged. ` +
                  `rejectedCombined=${JSON.stringify(rejectedCombined)} (expected ${JSON.stringify(collision.expectedRejectCombined)}) ` +
                  `rejectedOriginal=${JSON.stringify(originalViews.rejectedText)} (expected ${JSON.stringify(collision.expectedRejectOriginal)})`,
              );
            }
          }
        },
      );
    },
  );

  // coverage-rationale: LEAN-FBA-01/02/04/05 are four facets of one field-bearing
  // property run — the shared arbitrary, the per-operation assertion strength, the
  // floored (not filtered) coverage, and the bridge-file self-description are all
  // observed from this single live-engine property and cannot be split without
  // re-running the same property against the same generated pairs.
  test
    .openspec('[LEAN-FBA-01] Field-bearing arbitrary drives INV-FIELD-001 across operations')
    .openspec('[LEAN-FBA-02] Per-operation assertion strength matches the post-#217 engine')
    .openspec('[LEAN-FBA-04] Fallback is falsification and coverage is floored, not silently filtered')
    .openspec('[LEAN-FBA-05] Bridge file self-description stays accurate')(
    'INV-FIELD-001: field structure preserved on field-bearing inplace comparison output',
    async ({ given, when, then }: AllureBddContext) => {
      const coverage = createFieldBearingCoverage();

      await given(
        'clean original and revised document pairs are generated with complete NUMPAGES, PAGE, or PAGEREF fields',
        async () => {},
      );

      await when('the live inplace comparison output is accepted and rejected across field-bearing pairs', async () => {});

      await then(
        'field structure remains valid, delete runs use document-level strength, and every operation/type family is exercised',
        async () => {
          try {
            await fc.assert(
              fc.asyncProperty(fieldBearingPairArb, async (pair) => {
                recordFieldBearingHit(coverage, pair);

                const result = await compareFieldBearingPair(pair);
                const context = {
                  operation: pair.operation,
                  fieldType: pair.fieldType,
                  originalBodyXml: pair.originalBodyXml,
                  revisedBodyXml: pair.revisedBodyXml,
                };

                assertInplaceResult('INV-FIELD-001 field-bearing property', context, result);
                assertFieldInvariant(
                  'INV-FIELD-001 field-bearing property',
                  context,
                  result.combined,
                );
                if (pair.operation !== 'field-delete') {
                  assertRecursivelyWellformed(
                    'INV-FIELD-001 field-bearing property',
                    context,
                    result.combined,
                  );
                }
              }),
              // fast-check runs `examples` from WITHIN the numRuns budget, not in
              // addition to it, so bump the budget by the example count to get the
              // full 12 deterministic operation×type combos AND NUM_RUNS random cases.
              {
                numRuns: NUM_RUNS + fieldBearingExampleArgs.length,
                examples: fieldBearingExampleArgs,
              },
            );
          } finally {
            await allureJsonAttachment('field-bearing-operation-type-hits-inv-field-001', coverage);
          }
          assertFieldBearingCoverage('INV-FIELD-001 field-bearing property', coverage);
        },
      );
    },
  );

  // coverage-rationale: LEAN-RT-01..04 are the round-trip lemma cluster (accept-side
  // and reject-side lemmas, the `inv_rt_001` proof that composes them, and the
  // documented residual obligations); this is the one TS-side bridge test that
  // exercises accept/reject round-trip equality on the live engine, so the cluster
  // discharges here together, alongside the field-bearing arbitrary (FBA-03) and its
  // floored coverage (FBA-04). The single-fixture [LEAN-RT-05] falsifiability case is
  // deliberately NOT here — it lives on its own fixture test (see below) because it
  // requires a single deterministic case, not this 100-run property (cf. #513).
  test
    .openspec('[LEAN-RT-01] Accept-side round-trip lemma is closed')
    .openspec('[LEAN-RT-02] Reject-side round-trip lemma is closed')
    .openspec('[LEAN-RT-03] `inv_rt_001` sorry is replaced by a proof composing the named residual axiom and the lemmas')
    .openspec('[LEAN-RT-04] Residual obligations and the normalizeText modeling gap are documented')
    .openspec('[LEAN-FBA-03] Field-bearing arbitrary drives INV-RT-001 round-trip')
    .openspec('[LEAN-FBA-04] Fallback is falsification and coverage is floored, not silently filtered')(
    'INV-RT-001: paired round-trip text equality on field-bearing inplace comparison output',
    async ({ given, when, then }: AllureBddContext) => {
      const coverage = createFieldBearingCoverage();

      await given(
        'clean original and revised document pairs are generated with complete fields and field result text',
        async () => {},
      );

      await when('the live inplace comparison output is projected through accept-all and reject-all', async () => {});

      await then(
        'normalized text round-trips and every field operation/type family is exercised',
        async () => {
          try {
            await fc.assert(
              fc.asyncProperty(fieldBearingPairArb, async (pair) => {
                recordFieldBearingHit(coverage, pair);

                const result = await compareFieldBearingPair(pair);
                const context = {
                  operation: pair.operation,
                  fieldType: pair.fieldType,
                  originalBodyXml: pair.originalBodyXml,
                  revisedBodyXml: pair.revisedBodyXml,
                };

                assertInplaceResult('INV-RT-001 field-bearing property', context, result);
                await assertRoundTripInvariant(
                  'INV-RT-001 field-bearing property',
                  context,
                  result,
                );
              }),
              // fast-check runs `examples` from WITHIN the numRuns budget, not in
              // addition to it, so bump the budget by the example count to get the
              // full 12 deterministic operation×type combos AND NUM_RUNS random cases.
              {
                numRuns: NUM_RUNS + fieldBearingExampleArgs.length,
                examples: fieldBearingExampleArgs,
              },
            );
          } finally {
            await allureJsonAttachment('field-bearing-operation-type-hits-inv-rt-001', coverage);
          }
          assertFieldBearingCoverage('INV-RT-001 field-bearing property', coverage);
        },
      );
    },
  );

  // coverage-rationale: LEAN-FRAG-01..04 are four facets of one fragmented-field
  // property run — the shared arbitrary that drives both residual axioms, the
  // fallback-is-legitimate (mode-independent) outcome, the floored mode/operation
  // coverage, and the bridge-file self-description — all observed from this single
  // property and inseparable without re-running it.
  test
    .openspec('[LEAN-FRAG-01] Fragmented-field arbitrary drives both residual axioms across operations')
    .openspec('[LEAN-FRAG-02] Inplace fallback is a legitimate, mode-independent outcome, not falsification')
    .openspec('[LEAN-FRAG-03] Mode-distribution and operation coverage are floored, not silently filtered')
    .openspec('[LEAN-FRAG-04] Bridge file self-description distinguishes fallback-is-falsification from fallback-is-legitimate')(
    'INV-FIELD-001 + INV-RT-001: mode-independent invariants on fragmented-field comparison output',
    async ({ given, when, then }: AllureBddContext) => {
      const coverage = createFragmentedFieldCoverage();

      await given(
        'fragmented-field pairs are generated over result-edit, pretracked-fragmented-to-clean, and clean-to-pretracked-fragmented',
        async () => {},
      );

      await when(
        'each pair is compared through the live engine and the combined output is accepted and rejected, regardless of the reconstruction mode the engine selected',
        async () => {},
      );

      await then(
        'field structure holds on accept and reject, text round-trips, and both reconstruction modes plus every operation are exercised',
        async () => {
          try {
            await fc.assert(
              fc.asyncProperty(fragmentedFieldPairArb, async (pair) => {
                const result = await compareFragmentedFieldPair(pair);
                recordFragmentedFieldHit(coverage, pair, result);

                const context = {
                  operation: pair.operation,
                  fieldType: pair.fieldType,
                  modeUsed: result.modeUsed,
                  fallbackReason: result.fallbackReason,
                  originalBodyXml: pair.originalBodyXml,
                  revisedBodyXml: pair.revisedBodyXml,
                };

                // Mode-independent: the residual axioms constrain the OUTPUT,
                // not the reconstruction strategy. The engine correctly rebuilds
                // the clean→pretracked-fragmented + result-change case (its
                // inplace candidate fails the fieldStructure safety check), so we
                // assert the INV-FIELD-001 and INV-RT-001 obligations on whatever
                // output it produced — on the resolved accept/reject projections,
                // NOT on the raw mixed-revision combined output — and we do NOT
                // call assertInplaceResult or assertRecursivelyWellformed here.
                assertFieldInvariant(
                  'INV-FIELD-001 fragmented-field property',
                  context,
                  result.combined,
                );
                await assertRoundTripInvariant(
                  'INV-RT-001 fragmented-field property',
                  context,
                  result,
                );
              }),
              // fast-check runs `examples` from WITHIN the numRuns budget, so bump
              // the budget by the example count to keep NUM_RUNS random cases on
              // top of the deterministic operation×type seeds (which also floor
              // the mode distribution: the clean→pretracked-fragmented seeds force
              // the fallback outcome, the rest force inplace).
              {
                numRuns: NUM_RUNS + fragmentedFieldExampleArgs.length,
                examples: fragmentedFieldExampleArgs,
              },
            );
          } finally {
            await allureJsonAttachment('fragmented-field-operation-and-mode-hits', coverage);
          }
          assertFragmentedFieldCoverage('fragmented-field property', coverage);
        },
      );
    },
  );

  test(
    'INV-FIELD-001: field-bearing inplace comparison output is recursivelyWellformed (axiom falsifiability layer)',
    async ({ given, when, then }: AllureBddContext) => {
      await given('a field-free original and a revised document with a complete NUMPAGES field inserted', async () => {});

      await when('the live inplace comparison output is computed', async () => {});

      await then(
        'the combined document validates and every wrapper subtree is field-context-neutral',
        async () => {
          const field = COMPLETE_NUMPAGES_FIELD;
          const original = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Total pages here.</w:t></w:r></w:p>`,
          );
          const revised = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Total pages </w:t></w:r>${field}<w:r><w:t> here.</w:t></w:r></w:p>`,
          );

          const result = await compareDocumentBuffers(original, revised);
          const context = { fixture: 'numpages-field-insert' };

          assertInplaceResult('INV-FIELD-001 field-bearing', context, result);
          // The new axiom's precondition: recursivelyWellformed on inplace output.
          assertRecursivelyWellformed('INV-FIELD-001 field-bearing', context, result.combined);
          // The axiom's consequence: field structure survives accept/reject.
          assertFieldInvariant('INV-FIELD-001 field-bearing', context, result.combined);
        },
      );
    },
  );

  test(
    'INV-FIELD-001: deleting a complete field produces accept/reject outputs that pass validateFieldStructure (delInstrText axiom coverage)',
    async ({ given, when, then }: AllureBddContext) => {
      await given(
        'an original document containing a complete NUMPAGES field and a revised document with the field deleted',
        async () => {},
      );

      await when('the live inplace comparison output is computed', async () => {});

      await then(
        'the accept and reject outputs both validate, exercising the w:delInstrText atom case post-rename',
        async () => {
          // Post-#217 the inplace atomizer fragments deleted fields per
          // ECMA-376 Part 4: w:fldChar runs are emitted at sibling level
          // (unwrapped) and <w:del> wraps only the w:delInstrText / w:delText
          // payloads. The combined output now satisfies the no-fldChar-in-del
          // rule (gated by `hasFldCharInsideDel` in pipeline.ts).
          //
          // We still do NOT call `assertRecursivelyWellformed` here. The
          // fragmented `<w:del>` subtrees contain w:delInstrText with an empty
          // *local* field stack (the surrounding [begin]/[separate]/[end] are
          // at sibling level, outside the wrapper), so they are not
          // field-context-neutral under ∀ ctx. That is the predicate-strength
          // gap PR #220 weakened the residual axiom to accommodate: the
          // engine output satisfies the document-level `preservationFriendly`
          // property but not per-subtree `recursivelyWellformed`.
          // `assertFieldInvariant` is the right document-level check.
          const field = COMPLETE_NUMPAGES_FIELD;
          const original = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Total pages </w:t></w:r>${field}<w:r><w:t> here.</w:t></w:r></w:p>`,
          );
          const revised = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Total pages here.</w:t></w:r></w:p>`,
          );

          const result = await compareDocumentBuffers(original, revised);
          const context = { fixture: 'numpages-field-delete' };

          assertInplaceResult('INV-FIELD-001 field-bearing delete', context, result);
          // The post-PR-220 axiom's consequence: field structure survives accept/reject.
          assertFieldInvariant('INV-FIELD-001 field-bearing delete', context, result.combined);
        },
      );
    },
  );

  test.openspec('[LEAN-RT-05] Bridge case provides a falsifiability layer for the new axiom')(
    'INV-RT-001: field-bearing inplace comparison output round-trips on accept/reject (axiom falsifiability layer)',
    async ({ given, when, then }: AllureBddContext) => {
      // Falsifiability layer for the residual axiom
      // `compareDocumentXml_output_text_roundtrip` in
      // `verification/lean/LeanSpike/Spec.lean`, on a FIELD-BEARING fixture — the
      // synthetic/tracked INV-RT-001 property tests above are field-free, so this
      // is the only round-trip case that exercises w:fldChar / w:instrText atoms
      // (which contribute no text and must not perturb the recovered paragraph
      // text).
      //
      // What it checks vs. what the axiom states: `assertRoundTripInvariant`
      // asserts `inv_rt_001`'s CONCLUSION against the live engine —
      // accept(combined)==raw(revised) and reject(combined)==raw(original). The
      // axiom is stated over the projections `revisedText combined` /
      // `originalText combined`; the machine-checked lemmas
      // `extractText_accept_normalized` / `extractText_reject` equate the two, so
      // falsifying the conclusion here would falsify the axiom. It does NOT assert
      // the projection equality directly (that would need TS reimplementations of
      // `revisedText` / `originalText`).
      //
      // It exercises the live TS `normalizeText` / `extractTextWithParagraphs` (via
      // `normalizeDocumentXmlText`). NOTE: this fixture's text has no runs of
      // spaces/tabs, so it does NOT specifically target the Lean `normalizeText`
      // intra-line-collapse modeling gap; it guards the round-trip on field-bearing
      // structure. One fixture case, NOT empirical grounding for the universal axiom.
      await given('a field-free original and a revised document with a complete NUMPAGES field inserted', async () => {});

      await when('the live inplace comparison output is projected through accept-all and reject-all', async () => {});

      await then('normalized text round-trips to revised on accept and original on reject', async () => {
        const field = COMPLETE_NUMPAGES_FIELD;
        const original = await buildDocxFromBodyXml(
          `<w:p><w:r><w:t>Total pages here.</w:t></w:r></w:p>`,
        );
        const revised = await buildDocxFromBodyXml(
          `<w:p><w:r><w:t>Total pages </w:t></w:r>${field}<w:r><w:t> here.</w:t></w:r></w:p>`,
        );

        const result = await compareDocumentBuffers(original, revised);
        const context = { fixture: 'numpages-field-insert' };

        assertInplaceResult('INV-RT-001 field-bearing', context, result);
        await assertRoundTripInvariant('INV-RT-001 field-bearing', context, result);
      });
    },
  );

  test(
    'isFieldContextNeutral rejects standalone separator, end, and begin+separate fragments (regression guard)',
    async ({ given, when, then }: AllureBddContext) => {
      const cases: { name: string; xml: string }[] = [];

      await given(
        'three crafted wrapper XML fragments that each disturb the outer field context (standalone separate, standalone end, begin+separate)',
        () => {
          cases.push(
            {
              name: 'standalone separate',
              xml:
                `<w:ins xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
                `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
                `</w:ins>`,
            },
            {
              name: 'standalone end',
              xml:
                `<w:del xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
                `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
                `</w:del>`,
            },
            {
              name: 'begin without matching end',
              xml:
                `<w:ins xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
                `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
                `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
                `</w:ins>`,
            },
          );
        },
      );

      await when('isFieldContextNeutral is applied to each', () => {});

      await then('every fragment is rejected as not context-neutral', () => {
        for (const c of cases) {
          const doc = new DOMParser().parseFromString(c.xml, 'application/xml');
          const wrapper = doc.documentElement as unknown as Element;
          if (!wrapper) throw new Error(`${c.name}: failed to parse wrapper`);
          if (isFieldContextNeutral(wrapper)) {
            throw new Error(
              `isFieldContextNeutral regression: case "${c.name}" should be non-neutral but returned true`,
            );
          }
        }
      });
    },
  );

  test(
    'isFieldContextNeutral accepts a wrapper containing a complete self-contained field (regression guard)',
    async ({ given, when, then }: AllureBddContext) => {
      let wrapper: Element | null = null;
      let result = false;

      await given(
        'a <w:ins> wrapping a complete NUMPAGES begin/instrText/separate/result/end sequence',
        () => {
          const xml = WHOLE_FIELD_IN_INS(COMPLETE_NUMPAGES_FIELD, { standalone: true });
          wrapper = new DOMParser().parseFromString(xml, 'application/xml')
            .documentElement as unknown as Element;
        },
      );

      await when('isFieldContextNeutral is applied', () => {
        if (!wrapper) throw new Error('wrapper failed to parse');
        result = isFieldContextNeutral(wrapper);
      });

      await then('the wrapper is accepted as context-neutral', () => {
        if (!result) {
          throw new Error('isFieldContextNeutral regression: complete-field wrapper should be neutral');
        }
      });
    },
  );
});
