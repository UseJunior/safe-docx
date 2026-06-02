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
 *
 * These are empirical bridge tests, not the proofs themselves. As of the
 * `inv_rt_001` closure both theorems are closed (zero `sorry`) but each rests on a
 * named residual axiom about this repo's inplace `compareDocumentXml` output
 * (`compareDocumentXml_output_preservation_friendly`,
 * `compareDocumentXml_output_text_roundtrip`); this file is the falsifiability
 * layer for those axioms — it fails if either invariant breaks on real engine
 * output.
 *
 * Fallback semantics — scoped to both bridge generators in this file:
 *
 *   `Spec.lean` models `compareDocumentXml : OoxmlDoc → OoxmlDoc → Option OoxmlDoc`
 *   and both theorems are premised on `compareDocumentXml a b = some combined`,
 *   so doc pairs where inplace mode fails are formally out of the spec's scope.
 *   In the real TS pipeline a rebuild fallback can come from two sources:
 *     (a) `evaluateSafetyChecks` rejecting every inplace pass — i.e. an internal
 *         INV-FIELD-001 / INV-RT-001 falsification on the candidate XML;
 *     (b) `ContainerResolutionError` from container-topology mismatch.
 *   Every generator here is paragraph-only, table-free, and field-free, so (b)
 *   is not expected to fire. We therefore treat fallback as falsification and
 *   throw with `triage=inplace-fallback` diagnostics rather than filtering with
 *   `fc.pre`.
 *
 * INV-RT-001 tracked-input triage:
 *   - `triage=engine-bug`: accept/reject of `combined` disagrees with the fully
 *     resolved accept/reject views of the input pair.
 *   - `triage=theorem-domain`: accept/reject of `combined` matches the resolved
 *     input views, but not the raw tracked input text surface; this suggests the
 *     Lean theorem may target the wrong observational surface for pre-tracked
 *     documents.
 *   - `triage=inplace-fallback`: the inplace candidate was never emitted.
 *
 * Coverage limitations (intentional for the spike — not bugs):
 *   - Field-bearing input families still live in `collapsed-field-inplace.test.ts`.
 *   - Small-edit/run-boundary regression coverage still lives in the fixture
 *     tests (`round-trip-inplace.test.ts`, `nvca-coi-regression.test.ts`).
 *   - Comment and footnote coverage here is limited to `document.xml` anchors;
 *     comment-body and footnote-body tracked content remains out of scope.
 */

import fc from 'fast-check';
import { DOMParser } from '@xmldom/xmldom';
import { describe } from 'vitest';
import { compareDocuments, type ReconstructionMode } from '../index.js';
import { validateFieldStructure } from '../baselines/atomizer/pipeline.js';
import {
  COMPLETE_NUMPAGES_FIELD,
  WHOLE_FIELD_IN_INS,
  buildDocxFromBodyXml,
} from '../testing/ooxml-fixtures.js';
import {
  acceptAllChanges,
  rejectAllChanges,
  extractTextWithParagraphs,
  normalizeText,
} from '../baselines/atomizer/trackChangesAcceptorAst.js';
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

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Lean Spec Bridge (fast-check)' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 4, section: '17.16.5' });

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

interface MaterializedTrackedScenario {
  scenario: TrackedScenario;
  document: Buffer;
  documentXml: string;
}

type TrackedScenarioCoverage = Record<TrackedScenarioFamily, number>;

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

// Keep `w:del` on the `a` side and `w:ins` / paragraph-insert on the `b` side
// so tracked-input INV-RT-001 is not falsified by construction.
const trackedOriginalScenarioArb: fc.Arbitrary<TrackedScenario> = fc.oneof(
  trackedDeletionScenarioArb,
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
      `under the paragraph-only, table-free bridge generator. ` +
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
  const acceptMatchesAcceptedView = acceptedCombined === revisedViews.acceptedText;
  const rejectMatchesRejectedView = rejectedCombined === originalViews.rejectedText;
  const category =
    acceptMatchesAcceptedView && rejectMatchesRejectedView
      ? 'theorem-domain'
      : 'engine-bug';

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

  if (
    acceptedCombined !== revisedViews.rawText ||
    rejectedCombined !== originalViews.rawText
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
// single track-change wrappers (`inPlaceModifier.ts:717, 938, 1505, 1671,
// 1957, 2300`). When ECMA-376 fragmentation conformance lands (#217),
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

  test(
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
