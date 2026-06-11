/**
 * Atomizer Pipeline
 *
 * Main orchestration for the atomizer-based document comparison.
 * Integrates atomization, LCS comparison, move detection, format detection,
 * and document reconstruction.
 */

import { XMLSerializer } from '@xmldom/xmldom';
import { parseXml } from '../../primitives/xml.js';
import { DocxArchive } from '../../shared/docx/DocxArchive.js';
import type {
  CompareResult,
  CompareStats,
  ReconstructionAttemptDiagnostics,
  ReconstructionBookmarkMismatchDetails,
  ReconstructionBookmarkMismatchSummary,
  ReconstructionFallbackDiagnostics,
  ReconstructionFallbackReason,
  ReconstructionIdDelta,
  ReconstructionIdDeltaSummary,
  ReconstructionRebuildSafetyDiagnostics,
  ReconstructionSafetyFailureSummary,
  ReconstructionSafetyFailureDetails,
  ReconstructionSafetyCheckName,
  ReconstructionSafetyChecks,
  ReconstructionTextMismatchSummary,
  ReconstructionTextMismatchDetails,
  ReconstructionMode,
} from '../../compare-types.js';
import type {
  ComparisonUnitAtom,
  MoveDetectionSettings,
  FormatDetectionSettings,
  OpcPart,
} from '../../core-types.js';
import {
  DEFAULT_MOVE_DETECTION_SETTINGS,
  DEFAULT_FORMAT_DETECTION_SETTINGS,
  CorrelationStatus,
} from '../../core-types.js';
import { atomizeTree, assignParagraphIndices } from '../../atomizer.js';
import { detectMovesInAtomList } from '../../move-detection.js';
import { detectFormatChangesInAtomList } from '../../format-detection.js';
import {
  parseDocumentXml,
  findBody,
  backfillParentReferences,
} from './xmlToWmlElement.js';
import { findAllByTagName, getLeafText } from '../../primitives/index.js';
import {
  createMergedAtomList,
  assignUnifiedParagraphIndices,
} from './atomLcs.js';
import {
  hierarchicalCompare,
  markHierarchicalCorrelationStatus,
} from './hierarchicalLcs.js';
import {
  reconstructDocument,
  computeReconstructionStats,
} from './documentReconstructor.js';
import { modifyRevisedDocument, ContainerResolutionError } from './inPlaceModifier.js';
import {
  acceptAllChanges,
  rejectAllChanges,
  extractTextWithParagraphs,
  compareTexts,
} from './trackChangesAcceptorAst.js';
import {
  virtualizeNumberingLabels,
  type NumberingIntegrationOptions,
  DEFAULT_NUMBERING_OPTIONS,
} from './numberingIntegration.js';
import { premergeAdjacentRuns } from './premergeRuns.js';
import {
  AUXILIARY_PARTS,
  parseEntries,
  renumberCollidingAuxiliaryIds,
  type AuxiliaryPartDescriptor,
} from './auxiliaryIdCollision.js';

/**
 * Options for the atomizer pipeline.
 */
export interface AtomizerOptions {
  /** Author name for track changes. Default: "Comparison" */
  author?: string;
  /** Timestamp for track changes. Default: current time */
  date?: Date;
  /** Move detection settings */
  moveDetection?: Partial<MoveDetectionSettings>;
  /** Format detection settings */
  formatDetection?: Partial<FormatDetectionSettings>;
  /** Numbering integration settings */
  numbering?: Partial<NumberingIntegrationOptions>;
  /**
   * Pre-compare normalization: merge adjacent <w:r> siblings with identical formatting.
   *
   * This reduces overly-fragmented diffs without relying on atom-level cross-run text merging,
   * and can improve revision grouping in Word.
   *
   * Default: true.
   */
  premergeRuns?: boolean;
  /**
   * How to reconstruct the output:
   * - 'rebuild': rebuild document.xml from atoms (best reject/accept idempotency)
   * - 'inplace': modify the revised document AST in place (experimental)
   *
   * Default: 'rebuild'
   */
  reconstructionMode?: ReconstructionMode;
}

interface BookmarkDiagnostics {
  startIds: string[];
  endIds: string[];
  startNames: string[];
  duplicateStartNames: string[];
  referencedBookmarkNames: string[];
  unresolvedReferenceNames: string[];
  duplicateStartIds: string[];
  duplicateEndIds: string[];
  unmatchedStartIds: string[];
  unmatchedEndIds: string[];
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function collectReferencedBookmarkNames(root: ReturnType<typeof parseDocumentXml>): string[] {
  const refs = new Set<string>();
  const refRegex = /\b(?:PAGEREF|REF)\s+([^\s\\]+)/g;

  for (const node of findAllByTagName(root, 'w:instrText')) {
    const instr = getLeafText(node) ?? '';
    for (const match of instr.matchAll(refRegex)) {
      const name = match[1]?.trim();
      if (name) refs.add(name);
    }
  }

  return Array.from(refs).sort();
}

function collectBookmarkDiagnostics(documentXml: string): BookmarkDiagnostics {
  const root = parseDocumentXml(documentXml);

  const startSet = new Set<string>();
  const endSet = new Set<string>();
  const startNameSet = new Set<string>();
  const duplicateStartSet = new Set<string>();
  const duplicateEndSet = new Set<string>();
  const duplicateStartNameSet = new Set<string>();

  for (const node of findAllByTagName(root, 'w:bookmarkStart')) {
    const id = node.getAttribute('w:id');
    if (!id) continue;
    if (startSet.has(id)) duplicateStartSet.add(id);
    else startSet.add(id);

    const name = node.getAttribute('w:name');
    if (name) {
      if (startNameSet.has(name)) duplicateStartNameSet.add(name);
      else startNameSet.add(name);
    }
  }

  for (const node of findAllByTagName(root, 'w:bookmarkEnd')) {
    const id = node.getAttribute('w:id');
    if (!id) continue;
    if (endSet.has(id)) duplicateEndSet.add(id);
    else endSet.add(id);
  }

  const startIds = Array.from(startSet).sort();
  const endIds = Array.from(endSet).sort();
  const startNames = Array.from(startNameSet).sort();
  const referencedBookmarkNames = collectReferencedBookmarkNames(root);
  const unresolvedReferenceNames = referencedBookmarkNames
    .filter((name) => !startNameSet.has(name))
    .sort();
  const unmatchedStartIds = startIds.filter((id) => !endSet.has(id));
  const unmatchedEndIds = endIds.filter((id) => !startSet.has(id));

  return {
    startIds,
    endIds,
    startNames,
    duplicateStartNames: Array.from(duplicateStartNameSet).sort(),
    referencedBookmarkNames,
    unresolvedReferenceNames,
    duplicateStartIds: Array.from(duplicateStartSet).sort(),
    duplicateEndIds: Array.from(duplicateEndSet).sort(),
    unmatchedStartIds,
    unmatchedEndIds,
  };
}

/**
 * Bookmark round-trip safety is semantic, not byte/ID exact:
 * - Bookmark IDs may be renumbered by reconstruction/Word and still be valid.
 * - Bookmark names and field-reference targets must stay intact.
 * - Structural integrity (balanced, no duplicates) must remain intact.
 */
function bookmarkDiagnosticsSemanticallyEqual(
  expected: BookmarkDiagnostics,
  actual: BookmarkDiagnostics
): boolean {
  return (
    arraysEqual(expected.startNames, actual.startNames) &&
    arraysEqual(expected.duplicateStartNames, actual.duplicateStartNames) &&
    arraysEqual(expected.referencedBookmarkNames, actual.referencedBookmarkNames) &&
    arraysEqual(expected.unresolvedReferenceNames, actual.unresolvedReferenceNames) &&
    arraysEqual(expected.duplicateStartIds, actual.duplicateStartIds) &&
    arraysEqual(expected.duplicateEndIds, actual.duplicateEndIds) &&
    arraysEqual(expected.unmatchedStartIds, actual.unmatchedStartIds) &&
    arraysEqual(expected.unmatchedEndIds, actual.unmatchedEndIds)
  );
}

function diffIds(expected: string[], actual: string[]): { missing: string[]; unexpected: string[] } {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((id) => !actualSet.has(id));
  const unexpected = actual.filter((id) => !expectedSet.has(id));
  return { missing, unexpected };
}

function buildTextMismatchDetails(expectedText: string, actualText: string): ReconstructionTextMismatchDetails {
  const comparison = compareTexts(expectedText, actualText);
  const expectedParas = expectedText.split('\n');
  const actualParas = actualText.split('\n');
  const maxLen = Math.max(expectedParas.length, actualParas.length);

  let firstDifferingParagraphIndex = -1;
  for (let i = 0; i < maxLen; i++) {
    if ((expectedParas[i] ?? '') !== (actualParas[i] ?? '')) {
      firstDifferingParagraphIndex = i;
      break;
    }
  }

  return {
    expectedLength: comparison.expectedLength,
    actualLength: comparison.actualLength,
    firstDifferingParagraphIndex,
    expectedParagraph:
      firstDifferingParagraphIndex >= 0 ? (expectedParas[firstDifferingParagraphIndex] ?? '') : '',
    actualParagraph:
      firstDifferingParagraphIndex >= 0 ? (actualParas[firstDifferingParagraphIndex] ?? '') : '',
    differenceSample: comparison.differences.slice(0, 3),
  };
}

function buildBookmarkMismatchDetails(
  expected: BookmarkDiagnostics,
  actual: BookmarkDiagnostics
): ReconstructionBookmarkMismatchDetails {
  return {
    startNames: diffIds(expected.startNames, actual.startNames),
    referencedBookmarkNames: diffIds(expected.referencedBookmarkNames, actual.referencedBookmarkNames),
    unresolvedReferenceNames: diffIds(expected.unresolvedReferenceNames, actual.unresolvedReferenceNames),
    startIds: diffIds(expected.startIds, actual.startIds),
    endIds: diffIds(expected.endIds, actual.endIds),
    expectedDuplicateStartNames: expected.duplicateStartNames,
    actualDuplicateStartNames: actual.duplicateStartNames,
    expectedDuplicateStartIds: expected.duplicateStartIds,
    actualDuplicateStartIds: actual.duplicateStartIds,
    expectedDuplicateEndIds: expected.duplicateEndIds,
    actualDuplicateEndIds: actual.duplicateEndIds,
    expectedUnmatchedStartIds: expected.unmatchedStartIds,
    actualUnmatchedStartIds: actual.unmatchedStartIds,
    expectedUnmatchedEndIds: expected.unmatchedEndIds,
    actualUnmatchedEndIds: actual.unmatchedEndIds,
  };
}

function summarizeIdDelta(delta: ReconstructionIdDelta): ReconstructionIdDeltaSummary {
  return {
    missingCount: delta.missing.length,
    unexpectedCount: delta.unexpected.length,
    firstMissing: delta.missing[0],
    firstUnexpected: delta.unexpected[0],
  };
}

function truncateForSummary(value: string, maxLength = 160): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function summarizeTextMismatch(
  details: ReconstructionTextMismatchDetails
): ReconstructionTextMismatchSummary {
  return {
    firstDifferingParagraphIndex: details.firstDifferingParagraphIndex,
    expectedParagraph: truncateForSummary(details.expectedParagraph),
    actualParagraph: truncateForSummary(details.actualParagraph),
    firstDifference: details.differenceSample[0] ?? 'No diff sample',
  };
}

function summarizeBookmarkMismatch(
  details: ReconstructionBookmarkMismatchDetails
): ReconstructionBookmarkMismatchSummary {
  return {
    startNames: summarizeIdDelta(details.startNames),
    referencedBookmarkNames: summarizeIdDelta(details.referencedBookmarkNames),
    unresolvedReferenceNames: summarizeIdDelta(details.unresolvedReferenceNames),
    startIds: summarizeIdDelta(details.startIds),
    endIds: summarizeIdDelta(details.endIds),
    unmatchedStartCount: details.actualUnmatchedStartIds.length,
    unmatchedEndCount: details.actualUnmatchedEndIds.length,
    firstUnmatchedStartId: details.actualUnmatchedStartIds[0],
    firstUnmatchedEndId: details.actualUnmatchedEndIds[0],
  };
}

function buildFailureSummary(
  failureDetails: ReconstructionSafetyFailureDetails | undefined
): ReconstructionSafetyFailureSummary | undefined {
  if (!failureDetails) {
    return undefined;
  }

  const summary: ReconstructionSafetyFailureSummary = {};
  if (failureDetails.acceptText) {
    summary.acceptText = summarizeTextMismatch(failureDetails.acceptText);
  }
  if (failureDetails.rejectText) {
    summary.rejectText = summarizeTextMismatch(failureDetails.rejectText);
  }
  if (failureDetails.acceptBookmarks) {
    summary.acceptBookmarks = summarizeBookmarkMismatch(failureDetails.acceptBookmarks);
  }
  if (failureDetails.rejectBookmarks) {
    summary.rejectBookmarks = summarizeBookmarkMismatch(failureDetails.rejectBookmarks);
  }

  return Object.keys(summary).length > 0 ? summary : undefined;
}

// Declared above splitStories so the function body never observes an
// uninitialized binding under circular imports.
const serializer = new XMLSerializer();

/**
 * One story (a self-contained complex-field state machine): the main document
 * body, an individual footnote entry, or an individual endnote entry. `label`
 * is for diagnostics only; `xml` is the serialized fragment that gets parsed
 * and walked.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 17.16.5
 */
export interface FieldStory {
  label: string;
  xml: string;
}

/**
 * Split a docx into per-story XML fragments for field-closure validation.
 *
 * Each footnote/endnote entry is treated as an isolated story: a complex
 * field whose `begin` and `end` markers straddle stories breaks Word's
 * field state machine. We therefore validate each `<w:footnote>` and
 * `<w:endnote>` entry independently rather than treating the whole
 * `footnotes.xml`/`endnotes.xml` as one stream.
 *
 * Accepts arrays of sidecar XMLs (one per source archive) so callers can
 * validate the union of entries from every archive that may contribute to the
 * final result. Step 12 of `compareDocumentsAtomizer` merges entries from a
 * mode-dependent source archive into the base archive; passing both archives'
 * sidecars guarantees that whichever path the merge takes, the entries it
 * could publish have already been screened. Duplicates (same `w:id` in both
 * archives) yield redundant but harmless validation work.
 *
 * Header/footer stories are not yet covered — they require relationship
 * walking to enumerate `headerN.xml`/`footerN.xml`.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 17.16.5
 * @see https://github.com/UseJunior/safe-docx/issues/212
 */
export function splitStories(
  documentXml: string,
  footnotesXmls: ReadonlyArray<string | null>,
  endnotesXmls: ReadonlyArray<string | null>,
): FieldStory[] {
  const stories: FieldStory[] = [{ label: 'document', xml: documentXml }];

  const collectEntries = (
    sidecars: ReadonlyArray<string | null>,
    entryTag: string,
    labelPrefix: string,
  ): void => {
    for (let s = 0; s < sidecars.length; s++) {
      const sidecarXml = sidecars[s];
      if (!sidecarXml) continue;
      const doc = parseXml(sidecarXml);
      const entries = doc.getElementsByTagName(entryTag);
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i] as Element;
        const id = entry.getAttribute('w:id') ?? String(i);
        stories.push({
          label: `${labelPrefix}[${s}]:${id}`,
          xml: serializer.serializeToString(entry),
        });
      }
    }
  };

  collectEntries(footnotesXmls, 'w:footnote', 'footnote');
  collectEntries(endnotesXmls, 'w:endnote', 'endnote');

  return stories;
}

/**
 * Validate field structure integrity across one or more document stories.
 *
 * Enforces three constraints on complex fields **per story**:
 *   1. `w:fldChar` begin/end count balance within the story.
 *   2. Every `w:instrText` AND `w:delInstrText` sits inside an open field body
 *      (between `begin` and `separate`). Orphaned instruction text renders as
 *      literal text in Word.
 *   3. `w:delInstrText` is nested inside a `<w:del>` ancestor (DeletedFieldCode
 *      schema constraint), and conversely `w:fldChar` is NEVER inside `<w:del>`
 *      (Word treats this as fatal and discards the field state machine).
 *
 * Called on both pre-accept/reject combined XML (with track-change wrappers)
 * and on post-accept/reject XML (wrappers removed). Both cases must satisfy the
 * field placement check; constraint (3) is vacuous post-accept/reject.
 *
 * Accepts either a single XML string (legacy single-story call) or an array of
 * `FieldStory` fragments. Stories are validated independently and short-circuit
 * on the first failure.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 17.16.5
 */
/**
 * Targeted check for one of the constraints above: `w:fldChar` MUST NOT appear
 * inside any `<w:del>` element. Word treats this violation as fatal — the
 * field state machine is discarded and the field renders as literal-text
 * fallback.
 *
 * Used as a combined-output safety gate alongside the per-projection
 * `validateFieldStructure` checks. Kept narrower than the full structural
 * validation so that legacy shapes (e.g. `delInstrText` inside `<w:moveFrom>`)
 * don't trigger fallback when the inplace candidate is otherwise sound on its
 * accept/reject projections.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 17.16.5
 * @see https://github.com/UseJunior/safe-docx/issues/217
 */
export function hasFldCharInsideDel(documentXml: string): boolean {
  const root = parseDocumentXml(documentXml);
  let insideDelDepth = 0;
  let violation = false;

  function scan(node: Element): void {
    if (violation) return;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      const tag = el.tagName;
      if (tag === 'w:del') {
        insideDelDepth++;
        scan(el);
        insideDelDepth--;
        if (violation) return;
        continue;
      }
      if (tag === 'w:fldChar' && insideDelDepth > 0) {
        violation = true;
        return;
      }
      scan(el);
      if (violation) return;
    }
  }
  scan(root);
  return violation;
}

export function validateFieldStructure(input: string | FieldStory[]): boolean {
  if (typeof input === 'string') {
    return validateFieldStructureForStory(input);
  }
  for (const story of input) {
    if (!validateFieldStructureForStory(story.xml)) return false;
  }
  return true;
}

function validateFieldStructureForStory(documentXml: string): boolean {
  const root = parseDocumentXml(documentXml);

  const allFldChars = findAllByTagName(root, 'w:fldChar');
  const allInstrTexts = findAllByTagName(root, 'w:instrText');
  const allDelInstrTexts = findAllByTagName(root, 'w:delInstrText');

  // Constraint (1): global fldChar begin/end balance.
  let begins = 0;
  let ends = 0;
  for (const fc of allFldChars) {
    const type = fc.getAttribute('w:fldCharType');
    if (type === 'begin') begins++;
    else if (type === 'end') ends++;
  }
  if (begins !== ends) return false;

  if (
    allFldChars.length === 0 &&
    allInstrTexts.length === 0 &&
    allDelInstrTexts.length === 0
  ) {
    return true;
  }

  // Depth-first scan tracking field nesting (for constraint 2) and <w:del>
  // ancestor nesting (for constraint 3).
  let depth = 0;
  const pastSeparatorAtDepth: number[] = [];
  let insideDelDepth = 0;

  function scan(node: Element): boolean {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      const tag = el.tagName;

      if (tag === 'w:del') {
        insideDelDepth++;
        const ok = scan(el);
        insideDelDepth--;
        if (!ok) return false;
        continue;
      }

      if (tag === 'w:fldChar') {
        if (insideDelDepth > 0) return false;
        const type = el.getAttribute('w:fldCharType');
        if (type === 'begin') {
          depth++;
          pastSeparatorAtDepth[depth] = 0;
        } else if (type === 'separate') {
          if (depth > 0) pastSeparatorAtDepth[depth] = 1;
        } else if (type === 'end') {
          if (depth > 0) depth--;
        }
      } else if (tag === 'w:instrText') {
        if (depth === 0 || pastSeparatorAtDepth[depth]) return false;
      } else if (tag === 'w:delInstrText') {
        if (insideDelDepth === 0) return false;
        if (depth === 0 || pastSeparatorAtDepth[depth]) return false;
      }

      if (!scan(el)) return false;
    }
    return true;
  }

  return scan(root);
}

function evaluateSafetyChecks(
  originalTextForRoundTrip: string,
  revisedTextForRoundTrip: string,
  originalBookmarkDiagnostics: BookmarkDiagnostics,
  revisedBookmarkDiagnostics: BookmarkDiagnostics,
  candidateXml: string,
  auxiliarySidecars: {
    footnotesXmls: ReadonlyArray<string | null>;
    endnotesXmls: ReadonlyArray<string | null>;
  },
): {
  safe: boolean;
  checks: ReconstructionSafetyChecks;
  failedChecks: ReconstructionSafetyCheckName[];
  failureDetails?: ReconstructionSafetyFailureDetails;
  failureSummary?: ReconstructionSafetyFailureSummary;
} {
  const acceptedXml = acceptAllChanges(candidateXml);
  const rejectedXml = rejectAllChanges(candidateXml);
  const acceptedText = extractTextWithParagraphs(acceptedXml);
  const rejectedText = extractTextWithParagraphs(rejectedXml);
  const acceptedBookmarkDiagnostics = collectBookmarkDiagnostics(acceptedXml);
  const rejectedBookmarkDiagnostics = collectBookmarkDiagnostics(rejectedXml);
  const acceptTextComparison = compareTexts(revisedTextForRoundTrip, acceptedText);
  const rejectTextComparison = compareTexts(originalTextForRoundTrip, rejectedText);

  const acceptBookmarksOk = bookmarkDiagnosticsSemanticallyEqual(
    revisedBookmarkDiagnostics,
    acceptedBookmarkDiagnostics
  );
  const rejectBookmarksOk = bookmarkDiagnosticsSemanticallyEqual(
    originalBookmarkDiagnostics,
    rejectedBookmarkDiagnostics
  );

  // Validate field structure per-story. Each footnote/endnote entry is its own
  // ECMA-376 story; a complex field that crosses a story boundary breaks
  // Word's field state machine even when global begin/end counts balance.
  // Sidecars from BOTH archives are validated because Step 12's auxiliary-part
  // merge picks its base and source archives by reconstruction mode (inplace
  // base = revised; rebuild base = original) and validating only one side
  // would miss field issues that would still ship in the merged result.
  // `acceptAllChanges` / `rejectAllChanges` only transform document.xml, so
  // the sidecar set is identical for both transforms.
  const acceptedStories = splitStories(
    acceptedXml,
    auxiliarySidecars.footnotesXmls,
    auxiliarySidecars.endnotesXmls,
  );
  const rejectedStories = splitStories(
    rejectedXml,
    auxiliarySidecars.footnotesXmls,
    auxiliarySidecars.endnotesXmls,
  );
  // Issue #217 conformance gate on the COMBINED output: w:fldChar MUST NOT
  // appear inside <w:del>. ECMA-376 Part 4 § 17.16.5 makes this fatal for
  // Word's field state machine. The full validateFieldStructure check is run
  // on the accept/reject projections (per-story); on the combined view we
  // only gate the strict no-fldChar-in-del rule because some legacy emit
  // paths (e.g. delInstrText inside <w:moveFrom>) are non-conformant in shape
  // but out of scope for #217.
  const combinedNoFldCharInDel = !hasFldCharInsideDel(candidateXml);
  const fieldStructureOk =
    combinedNoFldCharInDel &&
    validateFieldStructure(acceptedStories) &&
    validateFieldStructure(rejectedStories);

  const checks: ReconstructionSafetyChecks = {
    acceptText: acceptTextComparison.normalizedIdentical,
    rejectText: rejectTextComparison.normalizedIdentical,
    // Bookmark checks are soft: consumer compatibility pass legitimately alters
    // bookmarks (deduplication, orphan repair, hoisting out of revision wrappers).
    // Log mismatches in diagnostics but don't trigger fallback to rebuild.
    acceptBookmarks: true,
    rejectBookmarks: true,
    fieldStructure: fieldStructureOk,
  };

  const failedChecks: ReconstructionSafetyCheckName[] = (Object.entries(checks) as Array<
    [ReconstructionSafetyCheckName, boolean]
  >)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  const failureDetails: ReconstructionSafetyFailureDetails = {};
  if (!checks.acceptText) {
    failureDetails.acceptText = buildTextMismatchDetails(revisedTextForRoundTrip, acceptedText);
  }
  if (!checks.rejectText) {
    failureDetails.rejectText = buildTextMismatchDetails(originalTextForRoundTrip, rejectedText);
  }
  // Bookmark mismatches are always collected for diagnostics even though the
  // check itself is soft (doesn't trigger fallback).
  if (!acceptBookmarksOk) {
    failureDetails.acceptBookmarks = buildBookmarkMismatchDetails(
      revisedBookmarkDiagnostics,
      acceptedBookmarkDiagnostics
    );
  }
  if (!rejectBookmarksOk) {
    failureDetails.rejectBookmarks = buildBookmarkMismatchDetails(
      originalBookmarkDiagnostics,
      rejectedBookmarkDiagnostics
    );
  }

  return {
    safe: failedChecks.length === 0,
    checks,
    failedChecks,
    failureDetails: failedChecks.length > 0 ? failureDetails : undefined,
    failureSummary: failedChecks.length > 0 ? buildFailureSummary(failureDetails) : undefined,
  };
}

/**
 * Compare two DOCX documents using the atomizer-based approach.
 *
 * Pipeline steps:
 * 1. Load DOCX archives
 * 2. Extract document.xml
 * 3. Parse to WmlElement trees
 * 4. Atomize both documents
 * 5. (Optional) Apply numbering virtualization
 * 6. Run LCS on atom hashes
 * 7. Mark correlation status
 * 8. Run move detection
 * 9. Run format detection
 * 10. Reconstruct document with track changes
 * 11. Save and return result
 *
 * @param original - Original document as Buffer
 * @param revised - Revised document as Buffer
 * @param options - Pipeline options
 * @returns Comparison result with track changes document
 */
export async function compareDocumentsAtomizer(
  original: Buffer,
  revised: Buffer,
  options: AtomizerOptions = {}
): Promise<CompareResult> {
  const {
    author = 'Comparison',
    date = new Date(),
    moveDetection = {},
    formatDetection = {},
    numbering = {},
    premergeRuns = true,
    reconstructionMode = 'rebuild',
  } = options;

  // Merge settings with defaults
  const moveSettings: MoveDetectionSettings = {
    ...DEFAULT_MOVE_DETECTION_SETTINGS,
    ...moveDetection,
  };

  const formatSettings: FormatDetectionSettings = {
    ...DEFAULT_FORMAT_DETECTION_SETTINGS,
    ...formatDetection,
  };

  const numberingSettings: NumberingIntegrationOptions = {
    ...DEFAULT_NUMBERING_OPTIONS,
    ...numbering,
  };

  // Step 1: Load DOCX archives
  const originalArchive = await DocxArchive.load(original);
  const revisedArchive = await DocxArchive.load(revised);

  // Step 1b: Resolve auxiliary ID collisions (issue #107). When both sides
  // define different content under the same comment/footnote/endnote w:id,
  // renumber the revised side so no anchor in the merged output can bind to
  // the other document's definition. Must run before any document.xml
  // extraction so every downstream step sees the renumbered archive.
  await renumberCollidingAuxiliaryIds(originalArchive, revisedArchive);

  // Step 2: Extract document.xml
  const originalXml = await originalArchive.getDocumentXml();
  const revisedXml = await revisedArchive.getDocumentXml();

  // Extract numbering.xml if available
  const originalNumberingXml = await originalArchive.getNumberingXml() ?? undefined;
  const revisedNumberingXml = await revisedArchive.getNumberingXml() ?? undefined;

  // Extract footnote/endnote sidecars from BOTH archives for per-story
  // field-closure validation (issue #212). Step 12 picks the base archive by
  // reconstruction mode (inplace = revised, rebuild = original) and merges
  // missing referenced entries from the opposite archive. Validating both
  // archives' sidecars covers the union of entries that could ship without
  // having to duplicate the merge logic at safety-check time.
  const [
    originalFootnotesXml,
    originalEndnotesXml,
    revisedFootnotesXml,
    revisedEndnotesXml,
  ] = await Promise.all([
    originalArchive.getFile('word/footnotes.xml'),
    originalArchive.getFile('word/endnotes.xml'),
    revisedArchive.getFile('word/footnotes.xml'),
    revisedArchive.getFile('word/endnotes.xml'),
  ]);
  const auxiliarySidecars = {
    footnotesXmls: [originalFootnotesXml, revisedFootnotesXml] as const,
    endnotesXmls: [originalEndnotesXml, revisedEndnotesXml] as const,
  };

  const originalPart: OpcPart = {
    uri: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  };

  const revisedPart: OpcPart = {
    uri: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  };

  // Project each input through the SAME accept/reject operation the candidate is
  // checked under, so the round-trip comparison is like-for-like even when an
  // input already carries its own tracked changes (pre-tracked w:ins / w:del,
  // comment anchors, multi-author stacks). For a clean input these equal the raw
  // extraction, so behavior on the common case is unchanged. (#347)
  const originalTextForRoundTrip = extractTextWithParagraphs(rejectAllChanges(originalXml));
  const revisedTextForRoundTrip = extractTextWithParagraphs(acceptAllChanges(revisedXml));
  const originalBookmarkDiagnostics = collectBookmarkDiagnostics(originalXml);
  const revisedBookmarkDiagnostics = collectBookmarkDiagnostics(revisedXml);

  const runComparisonPass = (
    atomizeOptions: Parameters<typeof atomizeTree>[3] | undefined,
    outputMode: ReconstructionMode
  ): {
    mergedAtoms: ComparisonUnitAtom[];
    newDocumentXml: string;
    outputMode: ReconstructionMode;
  } => {
    // Parse fresh trees for each pass because inplace reconstruction mutates revised AST.
    const originalTree = parseDocumentXml(originalXml);
    const revisedTree = parseDocumentXml(revisedXml);
    backfillParentReferences(originalTree);
    backfillParentReferences(revisedTree);

    const originalBody = findBody(originalTree);
    const revisedBody = findBody(revisedTree);
    if (!originalBody || !revisedBody) {
      throw new Error('Could not find w:body in one or both documents');
    }

    if (premergeRuns) {
      premergeAdjacentRuns(originalBody);
      premergeAdjacentRuns(revisedBody);
    }

    const { atoms: originalAtoms } = atomizeTree(originalBody, [], originalPart, atomizeOptions);
    const { atoms: revisedAtoms } = atomizeTree(revisedBody, [], revisedPart, atomizeOptions);

    // Assign paragraph indices for proper grouping during reconstruction
    assignParagraphIndices(originalAtoms);
    assignParagraphIndices(revisedAtoms);

    // Step 5: Apply numbering virtualization (optional)
    if (numberingSettings.enabled) {
      virtualizeNumberingLabels(originalAtoms, originalNumberingXml, numberingSettings);
      virtualizeNumberingLabels(revisedAtoms, revisedNumberingXml, numberingSettings);
    }

    // Step 6: Run hierarchical LCS (paragraph-level first, then atom-level within)
    const lcsResult = hierarchicalCompare(originalAtoms, revisedAtoms);

    // Step 7: Mark correlation status using hierarchical result
    markHierarchicalCorrelationStatus(originalAtoms, revisedAtoms, lcsResult);

    // Step 8: Run move detection
    if (moveSettings.detectMoves) {
      // Create a combined list for move detection
      // Move detection looks at the revised atoms with Inserted status
      // and original atoms with Deleted status
      const allAtoms = [...originalAtoms, ...revisedAtoms];
      detectMovesInAtomList(allAtoms, moveSettings);
    }

    // Step 9: Run format detection
    if (formatSettings.detectFormatChanges) {
      // Format detection operates on the revised atoms that are Equal
      detectFormatChangesInAtomList(revisedAtoms, formatSettings);
    }

    // Step 10: Create merged atom list for reconstruction
    const mergedAtoms = createMergedAtomList(originalAtoms, revisedAtoms, lcsResult);

    // Step 10b: Assign unified paragraph indices to handle atoms from different trees
    assignUnifiedParagraphIndices(originalAtoms, revisedAtoms, mergedAtoms, lcsResult);

    // Step 11: Reconstruct document with track changes
    let newDocumentXml: string;
    if (outputMode === 'inplace') {
      // In-place mode: modify the revised AST directly, producing revised-based output.
      newDocumentXml = modifyRevisedDocument(
        revisedTree,
        originalAtoms,
        revisedAtoms,
        mergedAtoms,
        { author, date }
      );
    } else {
      // Rebuild mode: reconstruct from atoms using original as the structural base.
      newDocumentXml = reconstructDocument(mergedAtoms, originalXml, { author, date });
    }

    return { mergedAtoms, newDocumentXml, outputMode };
  };

  const evaluateRoundTripSafety = (candidateXml: string) =>
    evaluateSafetyChecks(
      originalTextForRoundTrip,
      revisedTextForRoundTrip,
      originalBookmarkDiagnostics,
      revisedBookmarkDiagnostics,
      candidateXml,
      auxiliarySidecars,
    );

  let comparisonResult: {
    mergedAtoms: ComparisonUnitAtom[];
    newDocumentXml: string;
    outputMode: ReconstructionMode;
  };
  let fallbackReason: ReconstructionFallbackReason | undefined;
  let fallbackDiagnostics: ReconstructionFallbackDiagnostics | undefined;
  if (reconstructionMode === 'inplace') {
    // Adaptive strategy:
    // 1) Try no-cross-run passes first (higher run anchoring fidelity).
    // 2) If safety fails, retry with cross-run merging to handle run-fragmented docs.
    // 3) If still unsafe, reuse rebuild reconstruction as a hard safety fallback.
    const inplacePasses: Array<{
      pass: ReconstructionAttemptDiagnostics['pass'];
      atomizeOptions: Parameters<typeof atomizeTree>[3];
    }> = [
      {
        pass: 'inplace_word_split',
        atomizeOptions: {
          cloneLeafNodes: true,
          mergeAcrossRuns: false,
          mergePunctuationAcrossRuns: false,
          splitTextIntoWords: true,
        },
      },
      {
        pass: 'inplace_run_level',
        atomizeOptions: {
          cloneLeafNodes: true,
          mergeAcrossRuns: false,
          mergePunctuationAcrossRuns: false,
          splitTextIntoWords: false,
        },
      },
      {
        pass: 'inplace_word_split_cross_run',
        atomizeOptions: {
          cloneLeafNodes: true,
          mergeAcrossRuns: true,
          mergePunctuationAcrossRuns: true,
          splitTextIntoWords: true,
        },
      },
      {
        pass: 'inplace_run_level_cross_run',
        atomizeOptions: {
          cloneLeafNodes: true,
          mergeAcrossRuns: true,
          mergePunctuationAcrossRuns: true,
          splitTextIntoWords: false,
        },
      },
    ];

    const failedAttempts: ReconstructionAttemptDiagnostics[] = [];
    let selected: typeof comparisonResult | undefined;
    for (const { pass, atomizeOptions } of inplacePasses) {
      let candidate: typeof comparisonResult;
      try {
        candidate = runComparisonPass(atomizeOptions, 'inplace');
      } catch (e) {
        if (e instanceof ContainerResolutionError) {
          // Container topology mismatch — treat as failed pass (issue #65)
          failedAttempts.push({
            pass,
            checks: { acceptText: false, rejectText: false, acceptBookmarks: true, rejectBookmarks: true, fieldStructure: false },
            failedChecks: ['rejectText' as ReconstructionSafetyCheckName],
            failureDetails: undefined,
            firstDiffSummary: undefined,
          });
          continue;
        }
        throw e;
      }
      const safety = evaluateRoundTripSafety(candidate.newDocumentXml);

      if (safety.safe) {
        selected = candidate;
        break;
      }

      failedAttempts.push({
        pass,
        checks: safety.checks,
        failedChecks: safety.failedChecks,
        failureDetails: safety.failureDetails,
        firstDiffSummary: safety.failureSummary,
      });
    }

    if (selected) {
      comparisonResult = selected;
    } else {
      comparisonResult = runComparisonPass(
        { atomizeParagraphLevelMarkers: true },
        'rebuild'
      );
      fallbackReason = 'round_trip_safety_check_failed';
      fallbackDiagnostics = {
        attempts: failedAttempts,
      };
    }
  } else {
    comparisonResult = runComparisonPass(
      { atomizeParagraphLevelMarkers: true },
      'rebuild'
    );
  }

  // Rebuild output gets the same safety screening as inplace attempts, whether
  // rebuild was requested directly or reached via inplace fallback. Rebuild is
  // the terminal strategy, so failures are surfaced in diagnostics rather than
  // blocking the output.
  // @see https://github.com/UseJunior/safe-docx/issues/226
  let rebuildSafetyDiagnostics: ReconstructionRebuildSafetyDiagnostics | undefined;
  if (comparisonResult.outputMode === 'rebuild') {
    const safety = evaluateRoundTripSafety(comparisonResult.newDocumentXml);
    if (!safety.safe) {
      rebuildSafetyDiagnostics = {
        checks: safety.checks,
        failedChecks: safety.failedChecks,
        failureDetails: safety.failureDetails,
        firstDiffSummary: safety.failureSummary,
      };
    }
  }

  const { mergedAtoms, newDocumentXml } = comparisonResult;

  // Step 12: Clone appropriate archive and update document.xml.
  // Use the revised archive only for true inplace output.
  const baseArchive = comparisonResult.outputMode === 'inplace' ? revisedArchive : originalArchive;
  // The merge source is the *opposite* archive from the base: inplace pulls
  // deleted-but-still-referenced definitions from the original, rebuild pulls
  // added-but-still-referenced definitions from the revised. Without this,
  // rebuild output ships dangling references when the original lacks an
  // auxiliary part that the revised side introduced (issue #94).
  const mergeSourceArchive = comparisonResult.outputMode === 'inplace' ? originalArchive : revisedArchive;
  const resultArchive = await baseArchive.clone();
  resultArchive.setDocumentXml(newDocumentXml);

  // Step 12b: Merge auxiliary part definitions (footnotes, endnotes, comments).
  // Reconstruction may insert content (deleted in inplace, added in rebuild)
  // whose definitions are missing from the base archive.
  for (const descriptor of AUXILIARY_PARTS) {
    await mergeAuxiliaryPartDefinitions(
      mergeSourceArchive, resultArchive, newDocumentXml, descriptor
    );
  }
  // Comment-specific post-pass: walk reply threads via commentsExtended.xml.
  // Gated on root comment IDs in the *result* document (not on what the
  // generic merge appended), so the pass runs even when the original already
  // contains the root and revised only adds replies under it (issue #108).
  // Comments anchored on footnote/endnote text count as roots too.
  const rootCommentIds = await collectStoryReferenceIds(
    resultArchive, newDocumentXml, 'w:commentReference', null
  );
  if (rootCommentIds.size > 0) {
    await mergeCommentAncillaryParts(mergeSourceArchive, resultArchive, rootCommentIds);
  }

  // Step 13: Save result and compute stats
  const resultBuffer = await resultArchive.save();
  const stats = computeAtomizerStats(mergedAtoms);

  return {
    document: resultBuffer,
    stats,
    engine: 'atomizer' as const,
    reconstructionModeRequested: reconstructionMode,
    reconstructionModeUsed: comparisonResult.outputMode,
    fallbackReason,
    fallbackDiagnostics,
    rebuildSafetyDiagnostics,
  };
}

// =============================================================================
// Auxiliary Part Merging (footnotes, endnotes, comments)
//
// Reconstruction may insert content whose auxiliary definitions are absent
// from the base archive. The "source" archive is the one we pull definitions
// from: in inplace mode that is `originalArchive` (deleted-but-referenced
// definitions); in rebuild mode it is `revisedArchive` (added-but-referenced
// definitions). Step 12 in the pipeline picks the correct source per mode.
// =============================================================================

export interface AuxiliaryMergeResult {
  mergedIds: Set<string>;
  createdPart: boolean;
}

/**
 * Collect reference IDs across every result story that can host anchors: the
 * merged document.xml plus the result archive's footnote/endnote parts (Word
 * allows comments anchored on note text). `excludePartPath` skips the part
 * whose own definitions are being merged — entries can't reference
 * themselves.
 */
async function collectStoryReferenceIds(
  resultArchive: DocxArchive,
  documentXml: string,
  referenceTag: string,
  excludePartPath: string | null,
): Promise<Set<string>> {
  const ids = collectReferenceIds(documentXml, referenceTag);
  for (const storyPath of ['word/footnotes.xml', 'word/endnotes.xml']) {
    if (storyPath === excludePartPath) continue;
    const storyXml = await resultArchive.getFile(storyPath);
    if (!storyXml) continue;
    for (const id of collectReferenceIds(storyXml, referenceTag)) ids.add(id);
  }
  return ids;
}

/**
 * Collect reference IDs from document.xml using DOM parsing.
 */
function collectReferenceIds(documentXml: string, referenceTag: string): Set<string> {
  const ids = new Set<string>();
  const doc = parseXml(documentXml);
  const refs = doc.getElementsByTagName(referenceTag);
  for (let i = 0; i < refs.length; i++) {
    const id = (refs[i] as Element).getAttribute('w:id');
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Merge auxiliary part definitions (footnotes, endnotes, comments) from the
 * source archive into the result archive. The source archive is whichever
 * side reconstruction may have introduced references to: original in inplace
 * mode (deleted-but-referenced definitions), revised in rebuild mode
 * (added-but-referenced definitions).
 */
async function mergeAuxiliaryPartDefinitions(
  sourceArchive: DocxArchive,
  resultArchive: DocxArchive,
  documentXml: string,
  descriptor: AuxiliaryPartDescriptor,
): Promise<AuxiliaryMergeResult> {
  const result: AuxiliaryMergeResult = { mergedIds: new Set(), createdPart: false };

  // Anchors may live in the merged body or on note text in the result's
  // footnote/endnote stories. AUXILIARY_PARTS merges notes before comments,
  // so by the comment pass the note stories already carry any merged-in
  // comment anchors.
  const referencedIds = await collectStoryReferenceIds(
    resultArchive, documentXml, descriptor.referenceTag, descriptor.partPath
  );
  if (referencedIds.size === 0) return result;

  const sourcePartXml = await sourceArchive.getFile(descriptor.partPath);
  if (!sourcePartXml) return result;

  const resultPartXml = await resultArchive.getFile(descriptor.partPath);

  const sourceParsed = parseEntries(sourcePartXml, descriptor.entryTag);
  const resultParsed = resultPartXml ? parseEntries(resultPartXml, descriptor.entryTag) : null;

  // Find missing entries: referenced in document.xml but not in result
  const missingElements: Element[] = [];
  for (const id of referencedIds) {
    if (!(resultParsed?.entries.has(id)) && sourceParsed.entries.has(id)) {
      missingElements.push(sourceParsed.entries.get(id)!);
      result.mergedIds.add(id);
    }
  }

  if (missingElements.length === 0) return result;

  if (resultPartXml && resultParsed) {
    // Insert missing entries into existing result part
    const rootEl = resultParsed.doc.getElementsByTagName(descriptor.rootTag)[0] as Element;
    if (rootEl) {
      for (const el of missingElements) {
        const imported = resultParsed.doc.importNode(el, true);
        rootEl.appendChild(imported);
      }
      resultArchive.setFile(descriptor.partPath, serializer.serializeToString(resultParsed.doc));
    }
  } else {
    // Create part from scratch: clone root from merge source, drop every
    // non-reserved entry, then append the missing referenced ones.
    // Reserved entries are footnote/endnote separators identified by
    // w:type="separator" / w:type="continuationSeparator" — Word expects
    // them to exist and they don't carry user content. Filtering by w:type
    // (not by magic w:id values) keeps this robust across authoring tools.
    const newDoc = parseXml(sourcePartXml);
    const rootEl = newDoc.getElementsByTagName(descriptor.rootTag)[0] as Element;
    if (rootEl) {
      const existingEntries = rootEl.getElementsByTagName(descriptor.entryTag);
      const toRemove: Element[] = [];
      for (let i = 0; i < existingEntries.length; i++) {
        const el = existingEntries[i] as Element;
        const type = el.getAttribute('w:type');
        if (type !== 'separator' && type !== 'continuationSeparator') {
          toRemove.push(el);
        }
      }
      for (const el of toRemove) {
        rootEl.removeChild(el);
      }
      for (const el of missingElements) {
        const imported = newDoc.importNode(el, true);
        rootEl.appendChild(imported);
      }
      resultArchive.setFile(descriptor.partPath, serializer.serializeToString(newDoc));
      result.createdPart = true;

      await ensureOpcMetadata(resultArchive, descriptor);
    }
  }

  return result;
}

// =============================================================================
// OPC Metadata Bootstrapping
// =============================================================================

const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/**
 * Ensure [Content_Types].xml and document.xml.rels have entries for a
 * newly-created auxiliary part.
 */
async function ensureOpcMetadata(
  archive: DocxArchive,
  descriptor: AuxiliaryPartDescriptor,
): Promise<void> {
  // 1. Update [Content_Types].xml
  const ctXml = await archive.getFile('[Content_Types].xml');
  if (ctXml) {
    const ctDoc = parseXml(ctXml);
    const typesEl = ctDoc.documentElement;
    const overrides = typesEl.getElementsByTagNameNS(CT_NS, 'Override');
    const partName = `/${descriptor.partPath}`;

    let found = false;
    for (let i = 0; i < overrides.length; i++) {
      if ((overrides[i] as Element).getAttribute('PartName') === partName) {
        found = true;
        break;
      }
    }

    if (!found) {
      const override = ctDoc.createElementNS(CT_NS, 'Override');
      override.setAttribute('PartName', partName);
      override.setAttribute('ContentType', descriptor.contentType);
      typesEl.appendChild(override);
      archive.setFile('[Content_Types].xml', serializer.serializeToString(ctDoc));
    }
  }

  // 2. Update word/_rels/document.xml.rels
  const relsPath = 'word/_rels/document.xml.rels';
  const relsXml = await archive.getFile(relsPath);
  if (relsXml) {
    const relsDoc = parseXml(relsXml);
    const relsEl = relsDoc.documentElement;
    const existingRels = relsEl.getElementsByTagNameNS(REL_NS, 'Relationship');

    let found = false;
    let maxId = 0;
    for (let i = 0; i < existingRels.length; i++) {
      const rel = existingRels[i] as Element;
      if (rel.getAttribute('Type') === descriptor.relationshipType) {
        found = true;
      }
      const id = rel.getAttribute('Id') ?? '';
      const idMatch = /^rId(\d+)$/.exec(id);
      if (idMatch) maxId = Math.max(maxId, parseInt(idMatch[1]!, 10));
    }

    if (!found) {
      maxId++;
      const rel = relsDoc.createElementNS(REL_NS, 'Relationship');
      rel.setAttribute('Id', `rId${maxId}`);
      rel.setAttribute('Type', descriptor.relationshipType);
      rel.setAttribute('Target', descriptor.partPath.replace('word/', ''));
      relsEl.appendChild(rel);
      archive.setFile(relsPath, serializer.serializeToString(relsDoc));
    }
  }
}

// =============================================================================
// Comment Ancillary Parts Merging
// =============================================================================

/**
 * Walk the comment reply graph from each root referenced in the result
 * document, merging reply <w:comment> entries, their commentsExtended.xml
 * threading entries, and people.xml authors. Replies have no
 * <w:commentReference> in document.xml — they're discoverable only via
 * w15:paraIdParent in commentsExtended.xml. Without this expansion, rebuild
 * mode silently drops reply threads (issue #108).
 */
async function mergeCommentAncillaryParts(
  sourceArchive: DocxArchive,
  resultArchive: DocxArchive,
  rootCommentIds: Set<string>,
): Promise<void> {
  const sourceCommentsXml = await sourceArchive.getFile('word/comments.xml');
  if (!sourceCommentsXml) return;

  const sourceDoc = parseXml(sourceCommentsXml);

  // Build full source comment maps. Canonical paraId is the first <w:p>
  // child's w14:paraId, matching getCommentElParaId() in primitives/comments.ts.
  const commentById = new Map<string, Element>();
  const paraIdByCommentId = new Map<string, string>();
  const commentIdByParaId = new Map<string, string>();
  const authorByCommentId = new Map<string, string>();
  const allCommentEls = sourceDoc.getElementsByTagName('w:comment');
  for (let i = 0; i < allCommentEls.length; i++) {
    const el = allCommentEls[i] as Element;
    const id = el.getAttribute('w:id');
    if (!id) continue;
    commentById.set(id, el);
    const author = el.getAttribute('w:author');
    if (author) authorByCommentId.set(id, author);
    const firstP = el.getElementsByTagName('w:p')[0] as Element | undefined;
    const paraId = firstP?.getAttribute('w14:paraId');
    if (paraId) {
      paraIdByCommentId.set(id, paraId);
      commentIdByParaId.set(paraId, id);
    }
  }

  // Seed inclusion sets from the root IDs that appear in the result document.
  const includedCommentIds = new Set<string>();
  const includedParaIds = new Set<string>();
  const includedAuthors = new Set<string>();
  for (const id of rootCommentIds) {
    if (!commentById.has(id)) continue;
    includedCommentIds.add(id);
    const pid = paraIdByCommentId.get(id);
    if (pid) includedParaIds.add(pid);
    const author = authorByCommentId.get(id);
    if (author) includedAuthors.add(author);
  }

  // BFS over commentsExtended.xml's paraIdParent graph from each included
  // root paraId. Skip entries that don't resolve to a real source comment so
  // we never pull in dangling commentEx/people without a backing definition.
  const sourceExtendedXml = await sourceArchive.getFile('word/commentsExtended.xml');
  if (sourceExtendedXml) {
    const exDoc = parseXml(sourceExtendedXml);
    const exEls = exDoc.getElementsByTagName('w15:commentEx');
    const childrenOf = new Map<string, string[]>();
    for (let i = 0; i < exEls.length; i++) {
      const ex = exEls[i] as Element;
      const childPid = ex.getAttribute('w15:paraId');
      const parentPid = ex.getAttribute('w15:paraIdParent');
      if (!childPid || !parentPid) continue;
      const arr = childrenOf.get(parentPid);
      if (arr) arr.push(childPid);
      else childrenOf.set(parentPid, [childPid]);
    }

    const queue: string[] = [...includedParaIds];
    while (queue.length > 0) {
      const pid = queue.shift()!;
      const children = childrenOf.get(pid);
      if (!children) continue;
      for (const childPid of children) {
        if (includedParaIds.has(childPid)) continue;
        const childCommentId = commentIdByParaId.get(childPid);
        if (!childCommentId) continue;
        includedParaIds.add(childPid);
        includedCommentIds.add(childCommentId);
        const author = authorByCommentId.get(childCommentId);
        if (author) includedAuthors.add(author);
        queue.push(childPid);
      }
    }
  }

  // Append any reply <w:comment> definitions still missing from result.
  // The generic merge already added roots when needed; we add the replies
  // (and any roots not yet present in the result, defensively).
  await mergeMissingCommentDefinitions(resultArchive, commentById, includedCommentIds);

  // Merge commentsExtended and people for the expanded set.
  await mergeCommentsExtended(sourceArchive, resultArchive, includedParaIds);
  await mergePeople(sourceArchive, resultArchive, includedAuthors);
}

/**
 * Append any source <w:comment> definitions in `includedCommentIds` that
 * aren't already in result/word/comments.xml. Mirrors the append-with-importNode
 * pattern used by mergeCommentsExtended below.
 */
async function mergeMissingCommentDefinitions(
  resultArchive: DocxArchive,
  commentById: Map<string, Element>,
  includedCommentIds: Set<string>,
): Promise<void> {
  if (includedCommentIds.size === 0) return;
  const resultXml = await resultArchive.getFile('word/comments.xml');
  if (!resultXml) {
    // If result has no comments.xml at all, the generic merge would have
    // bootstrapped it for any included root. Nothing to do here.
    return;
  }
  const resultDoc = parseXml(resultXml);
  const rootEl = resultDoc.documentElement;

  const existingIds = new Set<string>();
  const existing = rootEl.getElementsByTagName('w:comment');
  for (let i = 0; i < existing.length; i++) {
    const id = (existing[i] as Element).getAttribute('w:id');
    if (id) existingIds.add(id);
  }

  let appended = false;
  for (const id of includedCommentIds) {
    if (existingIds.has(id)) continue;
    const sourceEl = commentById.get(id);
    if (!sourceEl) continue;
    rootEl.appendChild(resultDoc.importNode(sourceEl, true));
    appended = true;
  }

  if (appended) {
    resultArchive.setFile('word/comments.xml', serializer.serializeToString(resultDoc));
  }
}

async function mergeCommentsExtended(
  sourceArchive: DocxArchive,
  resultArchive: DocxArchive,
  mergedParaIds: Set<string>,
): Promise<void> {
  if (mergedParaIds.size === 0) return;

  const sourceXml = await sourceArchive.getFile('word/commentsExtended.xml');
  if (!sourceXml) return;

  const sourceDoc = parseXml(sourceXml);
  const sourceEntries = sourceDoc.getElementsByTagName('w15:commentEx');

  // Collect entries whose paraId matches a merged comment's paragraph
  const entriesToMerge: Element[] = [];
  for (let i = 0; i < sourceEntries.length; i++) {
    const el = sourceEntries[i] as Element;
    const paraId = el.getAttribute('w15:paraId');
    if (paraId && mergedParaIds.has(paraId)) {
      entriesToMerge.push(el);
    }
  }

  if (entriesToMerge.length === 0) return;

  const resultXml = await resultArchive.getFile('word/commentsExtended.xml');

  if (resultXml) {
    const resultDoc = parseXml(resultXml);
    const rootEl = resultDoc.documentElement;

    const existingParaIds = new Set<string>();
    const existing = rootEl.getElementsByTagName('w15:commentEx');
    for (let i = 0; i < existing.length; i++) {
      const pid = (existing[i] as Element).getAttribute('w15:paraId');
      if (pid) existingParaIds.add(pid);
    }

    for (const el of entriesToMerge) {
      const pid = el.getAttribute('w15:paraId');
      if (pid && !existingParaIds.has(pid)) {
        rootEl.appendChild(resultDoc.importNode(el, true));
      }
    }

    resultArchive.setFile('word/commentsExtended.xml', serializer.serializeToString(resultDoc));
    return;
  }

  // Bootstrap: result lacks commentsExtended.xml but the merged comments
  // depend on it for reply threading / done state. Clone the source's root
  // (preserves namespaces), drop non-matching entries, then add OPC metadata.
  const newDoc = parseXml(sourceXml);
  const newRoot = newDoc.documentElement;
  const allEntries = newRoot.getElementsByTagName('w15:commentEx');
  const toRemove: Element[] = [];
  for (let i = 0; i < allEntries.length; i++) {
    const el = allEntries[i] as Element;
    const paraId = el.getAttribute('w15:paraId');
    if (!paraId || !mergedParaIds.has(paraId)) toRemove.push(el);
  }
  for (const el of toRemove) newRoot.removeChild(el);
  resultArchive.setFile('word/commentsExtended.xml', serializer.serializeToString(newDoc));
  await ensureOpcMetadata(resultArchive, COMMENTS_EXTENDED_DESCRIPTOR);
}

const COMMENTS_EXTENDED_DESCRIPTOR: AuxiliaryPartDescriptor = {
  label: 'commentsExtended',
  partPath: 'word/commentsExtended.xml',
  referenceTag: '',
  entryTag: 'w15:commentEx',
  rootTag: 'w15:commentsEx',
  contentType: 'application/vnd.ms-word.commentsExtended+xml',
  relationshipType: 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended',
  idBearingTags: [], // keyed by w15:paraId, not w:id
};

const PEOPLE_DESCRIPTOR: AuxiliaryPartDescriptor = {
  label: 'people',
  partPath: 'word/people.xml',
  referenceTag: '',
  entryTag: 'w15:person',
  rootTag: 'w15:people',
  contentType: 'application/vnd.ms-word.people+xml',
  relationshipType: 'http://schemas.microsoft.com/office/2011/relationships/people',
  idBearingTags: [], // keyed by w15:author, not w:id
};

async function mergePeople(
  sourceArchive: DocxArchive,
  resultArchive: DocxArchive,
  mergedAuthors: Set<string>,
): Promise<void> {
  if (mergedAuthors.size === 0) return;

  const sourceXml = await sourceArchive.getFile('word/people.xml');
  if (!sourceXml) return;

  const sourceDoc = parseXml(sourceXml);
  const sourcePersons = sourceDoc.getElementsByTagName('w15:person');

  const personsToMerge: Element[] = [];
  for (let i = 0; i < sourcePersons.length; i++) {
    const el = sourcePersons[i] as Element;
    const author = el.getAttribute('w15:author');
    if (author && mergedAuthors.has(author)) {
      personsToMerge.push(el);
    }
  }

  if (personsToMerge.length === 0) return;

  const resultXml = await resultArchive.getFile('word/people.xml');

  if (resultXml) {
    const resultDoc = parseXml(resultXml);
    const rootEl = resultDoc.documentElement;

    const existingAuthors = new Set<string>();
    const existing = rootEl.getElementsByTagName('w15:person');
    for (let i = 0; i < existing.length; i++) {
      const a = (existing[i] as Element).getAttribute('w15:author');
      if (a) existingAuthors.add(a);
    }

    for (const el of personsToMerge) {
      const a = el.getAttribute('w15:author');
      if (a && !existingAuthors.has(a)) {
        rootEl.appendChild(resultDoc.importNode(el, true));
      }
    }

    resultArchive.setFile('word/people.xml', serializer.serializeToString(resultDoc));
    return;
  }

  // Bootstrap: result lacks people.xml. Clone source root (preserves
  // namespaces), remove non-matching authors, then add OPC metadata.
  const newDoc = parseXml(sourceXml);
  const newRoot = newDoc.documentElement;
  const allPersons = newRoot.getElementsByTagName('w15:person');
  const toRemove: Element[] = [];
  for (let i = 0; i < allPersons.length; i++) {
    const el = allPersons[i] as Element;
    const author = el.getAttribute('w15:author');
    if (!author || !mergedAuthors.has(author)) toRemove.push(el);
  }
  for (const el of toRemove) newRoot.removeChild(el);
  resultArchive.setFile('word/people.xml', serializer.serializeToString(newDoc));
  await ensureOpcMetadata(resultArchive, PEOPLE_DESCRIPTOR);
}

interface ParagraphChangeFlags {
  hasDeleted: boolean;
  hasInserted: boolean;
}

const fallbackParagraphStatsKeys = new WeakMap<Element, string>();
let nextFallbackParagraphStatsKey = 0;

function paragraphStatsKey(atom: ComparisonUnitAtom): string | undefined {
  if (atom.paragraphIndex !== undefined) {
    return `${atom.part.uri}:${atom.paragraphIndex}`;
  }

  const pAncestor = atom.ancestorElements.find((a) => a.tagName === 'w:p');
  if (!pAncestor) return undefined;

  let key = fallbackParagraphStatsKeys.get(pAncestor);
  if (!key) {
    key = `${atom.part.uri}:paragraph-ref:${nextFallbackParagraphStatsKey++}`;
    fallbackParagraphStatsKeys.set(pAncestor, key);
  }
  return key;
}

/**
 * Compute comparison statistics from merged atoms.
 *
 * Range counts are contiguous same-status runs in the merged atom stream, scoped
 * to a paragraph. Atom counts remain available under explicit names for callers
 * that need the old granular benchmark signal.
 */
export function computeAtomizerStats(mergedAtoms: ComparisonUnitAtom[]): CompareStats {
  const reconstructionStats = computeReconstructionStats(mergedAtoms);

  let insertedRanges = 0;
  let deletedRanges = 0;
  let formatChanges = 0;
  let previousRangeStatus: CorrelationStatus.Inserted | CorrelationStatus.Deleted | CorrelationStatus.FormatChanged | null = null;
  let previousRangeParagraph: string | undefined;
  const paragraphs = new Map<string, ParagraphChangeFlags>();

  for (const atom of mergedAtoms) {
    const paragraphKey = paragraphStatsKey(atom);
    const status = atom.correlationStatus;
    const rangeStatus =
      status === CorrelationStatus.Inserted ||
      status === CorrelationStatus.Deleted ||
      status === CorrelationStatus.FormatChanged
        ? status
        : null;

    if (rangeStatus) {
      if (rangeStatus !== previousRangeStatus || paragraphKey !== previousRangeParagraph) {
        if (rangeStatus === CorrelationStatus.Inserted) insertedRanges++;
        if (rangeStatus === CorrelationStatus.Deleted) deletedRanges++;
        if (rangeStatus === CorrelationStatus.FormatChanged) formatChanges++;
      }
      previousRangeStatus = rangeStatus;
      previousRangeParagraph = paragraphKey;
    } else {
      previousRangeStatus = null;
      previousRangeParagraph = undefined;
    }

    if (paragraphKey && (status === CorrelationStatus.Deleted || status === CorrelationStatus.Inserted)) {
      const flags = paragraphs.get(paragraphKey) ?? { hasDeleted: false, hasInserted: false };
      if (status === CorrelationStatus.Deleted) flags.hasDeleted = true;
      if (status === CorrelationStatus.Inserted) flags.hasInserted = true;
      paragraphs.set(paragraphKey, flags);
    }
  }

  const modifiedParagraphs = Array.from(paragraphs.values()).filter(
    (flags) => flags.hasDeleted && flags.hasInserted
  ).length;

  return {
    insertions: insertedRanges,
    deletions: deletedRanges,
    modifications: modifiedParagraphs,
    insertedRanges,
    deletedRanges,
    insertedAtoms: reconstructionStats.insertions,
    deletedAtoms: reconstructionStats.deletions,
    modifiedParagraphs,
    formatChanges,
    formatChangeAtoms: reconstructionStats.formatChanges,
  };
}
