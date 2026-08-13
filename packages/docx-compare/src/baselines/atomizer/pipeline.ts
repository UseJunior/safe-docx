/**
 * Atomizer Pipeline
 *
 * Main orchestration for the atomizer-based document comparison.
 * Integrates atomization, LCS comparison, move detection, format detection,
 * and document reconstruction.
 */

import { XMLSerializer } from '@xmldom/xmldom';
import { parseXml } from '@usejunior/docx-core';
import { DocxArchive } from '@usejunior/docx-core';
import type {
  CompareResult,
  CompareStats,
  AncillaryFallbackDiagnostics,
  AncillaryFieldEvidence,
  ReconstructionAttemptDiagnostics,
  ReconstructionBookmarkMismatchDetails,
  ReconstructionBookmarkMismatchSummary,
  ReconstructionFallbackDiagnostics,
  ReconstructionFallbackReason,
  ReconstructionIdDelta,
  ReconstructionIdDeltaSummary,
  ReconstructionInplaceSuccessDiagnostics,
  ReconstructionRebuildSafetyDiagnostics,
  ReconstructionSafetyFailureSummary,
  ReconstructionSafetyFailureDetails,
  ReconstructionSafetyCheckName,
  ReconstructionSafetyChecks,
  ReconstructionTextMismatchSummary,
  ReconstructionTextMismatchDetails,
  ReconstructionMode,
} from '../../compare-types.js';
import { DEFAULT_RECONSTRUCTION_MODE } from '../../comparison-defaults.js';
import type {
  ComparisonUnitAtom,
  MoveDetectionSettings,
  FormatDetectionSettings,
  OpcPart,
} from '@usejunior/docx-core';
import {
  DEFAULT_MOVE_DETECTION_SETTINGS,
  DEFAULT_FORMAT_DETECTION_SETTINGS,
  CorrelationStatus,
} from '@usejunior/docx-core';
import {
  atomizeTree,
  assignParagraphIndices,
  applyHyperlinkDestinationSalt,
  assignIdentityIds,
  IdentityInterner,
} from '../../atomizer.js';
import {
  parseHyperlinkRelTargets,
  parseHyperlinkRelEntries,
  listRelationshipIds,
  type HyperlinkRelEntry,
} from '@usejunior/docx-core';
import { OOXML } from '@usejunior/docx-core';
import {
  collectPreservedMoveNames,
  detectMovesInAtomList,
} from '../../move-detection.js';
import { detectFormatChangesInAtomList } from '../../format-detection.js';
import { detectParagraphStyleChanges } from '../../paragraph-style-detection.js';
import {
  parseDocumentXml,
  findBody,
  backfillParentReferences,
  canonicalizeWordprocessingPrefixes,
} from './xmlToWmlElement.js';
import { findAllByTagName, getLeafText } from '@usejunior/docx-core';
import {
  createMergedAtomList,
  assignUnifiedParagraphIndices,
} from './atomLcs.js';
import {
  hierarchicalCompare,
  markHierarchicalCorrelationStatus,
} from './hierarchicalLcs.js';
import { refineFuzzyRunsWithinAlignedParagraphs } from './selectiveWordRefinement.js';
import {
  reconstructDocument,
  type HyperlinkRelResolver,
  computeReconstructionStats,
} from './documentReconstructor.js';
import {
  bindOpaquePassthroughCounterparts,
  OpaqueRelationshipClosureResolver,
  validateOpaquePassthroughCorrelation,
} from './opaquePassthrough.js';
import { modifyRevisedDocument, ContainerResolutionError } from './inPlaceModifier.js';
import {
  acceptAllChanges,
  rejectAllChanges,
  compareTexts,
} from './trackChangesAcceptorAst.js';
import { detectUnrepresentedChanges } from './unrepresentedChanges.js';
import {
  virtualizeNumberingLabels,
  type NumberingIntegrationOptions,
  DEFAULT_NUMBERING_OPTIONS,
} from './numberingIntegration.js';
import { premergeAdjacentRuns } from './premergeRuns.js';
export {
  hasFldCharInsideDel,
  validateFieldStructure,
  type FieldStory,
} from '@usejunior/docx-core';
import {
  hasFldCharInsideDel,
  validateFieldStructure,
  type FieldStory,
} from '@usejunior/docx-core';
import {
  AUXILIARY_PARTS,
  parseEntries,
  renumberCollidingAuxiliaryIds,
  restampCollidingCommentParaIds,
  type AuxiliaryPartDescriptor,
} from './auxiliaryIdCollision.js';
import { maybeCaptureEmittedDocumentXml } from '@usejunior/docx-core';
import {
  AncillaryStorySafetyError,
  evaluateAncillaryFieldSafety,
} from './ancillaryFieldSafety.js';
import { extractRoundTripComparisonText } from '../../fieldComparisonSemantics.js';
import { suppressVolatileTocPagerefCacheRevisions } from './tocPagerefCache.js';
import {
  assembleTextBoxStoryComparison,
  assertAncillaryTextBoxStoryProjection,
  markInsertedAncillaryStoryParagraphs,
  prepareTextBoxStoryComparison,
  rejectedSelectedAncillaryStoryPaths,
  UnsupportedTextBoxRevisionError,
} from './textBoxRevisionSafety.js';

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
  /** Decline one candidate run's word refinement when it would create more revision ranges. */
  maxWordRefinementChangeRanges?: number;
  /**
   * How to reconstruct the output:
   * - 'rebuild': rebuild document.xml from atoms (best reject/accept idempotency)
   * - 'inplace': modify the revised document AST in place (experimental)
   *
   * Default: {@link DEFAULT_RECONSTRUCTION_MODE}.
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
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.13
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
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
  const acceptedText = extractRoundTripComparisonText(acceptedXml);
  const rejectedText = extractRoundTripComparisonText(rejectedXml);
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

  // Validate field structure for the main-story round-trip projection. Final
  // note entries are validated after mode-specific assembly, where the gate
  // knows which base and merge-source definitions actually contributed.
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
  // Issue #217 conformance gate on the COMBINED output: keep w:fldChar outside
  // <w:del>, matching the Part 1 complex-field and deleted-field-code syntax.
  // The full validateFieldStructure check is run
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
/**
 * Compare supported VML text-box content as independent nested stories.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.22
 * @see https://github.com/UseJunior/safe-docx/issues/713
 */
export async function compareDocumentsAtomizer(
  original: Buffer,
  revised: Buffer,
  options: AtomizerOptions = {},
): Promise<CompareResult> {
  const textBoxPlan = await prepareTextBoxStoryComparison(original, revised);
  if (!textBoxPlan) {
    return compareDocumentsAtomizerCore(original, revised, options);
  }
  if (options.reconstructionMode !== 'inplace') {
    throw new UnsupportedTextBoxRevisionError([{
      index: textBoxPlan.stories[0]?.visualIndex ?? 0,
      partPath: textBoxPlan.stories[0]?.partPath ?? 'word/document.xml',
      reason: 'changed text-box stories currently require reconstructionMode=inplace',
    }]);
  }

  const nestedOptions: AtomizerOptions = {
    ...options,
    reconstructionMode: 'inplace',
  };
  const outerResult = await compareDocumentsAtomizerCore(
    textBoxPlan.outerOriginal,
    textBoxPlan.outerRevised,
    nestedOptions,
  );
  if (outerResult.reconstructionModeUsed !== 'inplace') {
    throw new UnsupportedTextBoxRevisionError([{
      index: textBoxPlan.stories[0]?.visualIndex ?? 0,
      partPath: textBoxPlan.stories[0]?.partPath ?? 'word/document.xml',
      reason: 'the outer document required rebuild fallback',
    }]);
  }

  const storyResults: Array<{
    index: number;
    visualIndex: number;
    partPath: string;
    container: 'textBox' | 'ancillaryPart';
    result: CompareResult;
  }> = [];
  const rejectedSelectedStoryPaths =
    await rejectedSelectedAncillaryStoryPaths(outerResult.document);
  const representedPartPaths = new Set<string>();
  for (const story of textBoxPlan.stories) {
    if (
      story.container === 'ancillaryPart' &&
      rejectedSelectedStoryPaths.has(story.partPath)
    ) {
      continue;
    }
    let result = await compareDocumentsAtomizerCore(
      story.original,
      story.container === 'ancillaryPart' ? story.original : story.revised,
      nestedOptions,
    );
    if (result.reconstructionModeUsed !== 'inplace') {
      throw new UnsupportedTextBoxRevisionError([{
        index: story.visualIndex,
        partPath: story.partPath,
        reason: 'the nested story required rebuild fallback',
      }]);
    }
    if (story.container === 'ancillaryPart') {
      const marked = await markInsertedAncillaryStoryParagraphs(
        story.revised,
        outerResult.document,
        options.author ?? 'Comparison',
        options.date ?? new Date(),
      );
      const insertionRanges = marked.directParagraphs;
      result = {
        ...result,
        document: marked.document,
        stats: {
          ...result.stats,
          insertions: insertionRanges,
          insertedRanges: insertionRanges,
          insertedAtoms: Math.max(
            result.stats.insertedAtoms,
            marked.directParagraphs,
          ),
        },
      };
      representedPartPaths.add(story.partPath);
    }
    storyResults.push({
      index: story.index,
      visualIndex: story.visualIndex,
      partPath: story.partPath,
      container: story.container,
      result,
    });
  }

  const document = await assembleTextBoxStoryComparison(
    outerResult.document,
    storyResults.map(({ index, visualIndex, partPath, container, result }) => ({
      index,
      visualIndex,
      partPath,
      container,
      document: result.document,
    })),
  );
  const comparedArchive = await DocxArchive.load(document);
  const comparedDocumentXml = await comparedArchive.getDocumentXml();
  const acceptedComparison = compareTexts(
    extractRoundTripComparisonText(textBoxPlan.revisedDocumentXml),
    extractRoundTripComparisonText(acceptAllChanges(comparedDocumentXml)),
  );
  const rejectedComparison = compareTexts(
    extractRoundTripComparisonText(textBoxPlan.originalDocumentXml),
    extractRoundTripComparisonText(rejectAllChanges(comparedDocumentXml)),
  );
  if (
    !acceptedComparison.normalizedIdentical ||
    !rejectedComparison.normalizedIdentical
  ) {
    throw new UnsupportedTextBoxRevisionError([{
      index: textBoxPlan.stories[0]?.visualIndex ?? 0,
      partPath: textBoxPlan.stories[0]?.partPath ?? 'word/document.xml',
      reason: 'assembled nested stories failed accept/reject round-trip validation',
    }]);
  }
  if (
    textBoxPlan.hasAncillaryTextBoxStories ||
    representedPartPaths.size > 0
  ) {
    await assertAncillaryTextBoxStoryProjection(original, revised, document);
  }

  const results = [outerResult, ...storyResults.map(({ result }) => result)];
  const stats = results.reduce<CompareStats>(
    (combined, result) => ({
      insertions: combined.insertions + result.stats.insertions,
      deletions: combined.deletions + result.stats.deletions,
      modifications: combined.modifications + result.stats.modifications,
      insertedRanges: combined.insertedRanges + result.stats.insertedRanges,
      deletedRanges: combined.deletedRanges + result.stats.deletedRanges,
      insertedAtoms: combined.insertedAtoms + result.stats.insertedAtoms,
      deletedAtoms: combined.deletedAtoms + result.stats.deletedAtoms,
      modifiedParagraphs:
        combined.modifiedParagraphs + result.stats.modifiedParagraphs,
      formatChanges: combined.formatChanges + result.stats.formatChanges,
      formatChangeAtoms:
        combined.formatChangeAtoms + result.stats.formatChangeAtoms,
    }),
    {
      insertions: 0,
      deletions: 0,
      modifications: 0,
      insertedRanges: 0,
      deletedRanges: 0,
      insertedAtoms: 0,
      deletedAtoms: 0,
      modifiedParagraphs: 0,
      formatChanges: 0,
      formatChangeAtoms: 0,
    },
  );
  const unrepresentedChanges = outerResult.unrepresentedChanges?.filter(
    (change) => !textBoxPlan.representedAncillaryChanges.some(
      (represented) =>
        representedPartPaths.has(represented.partPath) &&
        change.scope === represented.scope &&
        change.kind === represented.kind &&
        change.sectionIndex === represented.sectionIndex &&
        change.role === represented.role,
    ),
  );

  return {
    ...outerResult,
    document,
    stats,
    unrepresentedChanges:
      unrepresentedChanges && unrepresentedChanges.length > 0
        ? unrepresentedChanges
        : undefined,
  };
}

async function compareDocumentsAtomizerCore(
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
    maxWordRefinementChangeRanges,
    reconstructionMode = DEFAULT_RECONSTRUCTION_MODE,
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
  const unrepresentedChanges = await detectUnrepresentedChanges(
    originalArchive,
    revisedArchive,
  );
  const originalOpaqueRelationships = new OpaqueRelationshipClosureResolver(originalArchive);
  const revisedOpaqueRelationships = new OpaqueRelationshipClosureResolver(revisedArchive);

  // Step 1b: Resolve auxiliary ID collisions. When both sides define
  // different content under the same comment/footnote/endnote w:id or the
  // same comment paraId, rewrite the revised side so no anchor or ancillary
  // row in the merged output can bind to the other document's definition.
  // Must run before any document.xml extraction so every downstream step sees
  // the rewritten archive.
  await renumberCollidingAuxiliaryIds(originalArchive, revisedArchive);
  await restampCollidingCommentParaIds(originalArchive, revisedArchive);

  // Step 2: Extract document.xml
  const originalXml = canonicalizeWordprocessingPrefixes(await originalArchive.getDocumentXml());
  const revisedXml = canonicalizeWordprocessingPrefixes(await revisedArchive.getDocumentXml());

  // Extract numbering.xml if available
  const originalNumberingXml = await originalArchive.getNumberingXml() ?? undefined;
  const revisedNumberingXml = await revisedArchive.getNumberingXml() ?? undefined;

  // Extract hyperlink relationship tables from BOTH archives (issue #376).
  // The salt uses these to hash a link's resolved destination (so retargeting
  // becomes delete-old-link + insert-new-link); step 12 uses them to ship a
  // resolvable relationship for any inserted/retargeted link in rebuild output.
  const [originalRelsRaw, revisedRelsRaw] = await Promise.all([
    originalArchive.getFile('word/_rels/document.xml.rels'),
    revisedArchive.getFile('word/_rels/document.xml.rels'),
  ]);
  const originalRelsDoc = originalRelsRaw ? parseXml(originalRelsRaw) : null;
  const revisedRelsDoc = revisedRelsRaw ? parseXml(revisedRelsRaw) : null;
  const originalHyperlinkTargets = parseHyperlinkRelTargets(originalRelsDoc);
  const revisedHyperlinkTargets = parseHyperlinkRelTargets(revisedRelsDoc);

  // The legacy round-trip check remains main-story-only. The publication gate
  // validates every final note entry and inspects the opposite archive only
  // when merge provenance proves that it contributed definitions.
  const auxiliarySidecars = {
    footnotesXmls: [] as const,
    endnotesXmls: [] as const,
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
  const originalTextForRoundTrip = extractRoundTripComparisonText(
    rejectAllChanges(originalXml),
  );
  const revisedTextForRoundTrip = extractRoundTripComparisonText(
    acceptAllChanges(revisedXml),
  );
  const originalBookmarkDiagnostics = collectBookmarkDiagnostics(originalXml);
  const revisedBookmarkDiagnostics = collectBookmarkDiagnostics(revisedXml);

  const runComparisonPass = async (
    atomizeOptions: Parameters<typeof atomizeTree>[3] | undefined,
    outputMode: ReconstructionMode
  ): Promise<{
    mergedAtoms: ComparisonUnitAtom[];
    newDocumentXml: string;
    outputMode: ReconstructionMode;
    hyperlinkRelationships: NewHyperlinkRel[];
  }> => {
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

    const effectiveAtomizeOptions = outputMode === 'rebuild'
      ? {
          ...atomizeOptions,
          captureInlineSdtPassthrough: true,
          captureComplexFieldPassthrough: reconstructionMode === 'rebuild',
        }
      : atomizeOptions;
    let { atoms: originalAtoms } = atomizeTree(originalBody, [], originalPart, effectiveAtomizeOptions);
    let { atoms: revisedAtoms } = atomizeTree(revisedBody, [], revisedPart, effectiveAtomizeOptions);

    // Assign paragraph indices for proper grouping during reconstruction
    assignParagraphIndices(originalAtoms);
    assignParagraphIndices(revisedAtoms);
    if (outputMode === 'rebuild') {
      await bindOpaquePassthroughCounterparts(
        originalAtoms,
        revisedAtoms,
        originalOpaqueRelationships,
        revisedOpaqueRelationships,
        originalPart.uri,
      );
    }

    // Step 5: Apply numbering virtualization (optional)
    if (numberingSettings.enabled) {
      virtualizeNumberingLabels(originalAtoms, originalNumberingXml, numberingSettings);
      virtualizeNumberingLabels(revisedAtoms, revisedNumberingXml, numberingSettings);
    }

    // Step 5b: Salt atom identity with each side's resolved hyperlink target so
    // the LCS represents a retargeted link as delete-old-link + insert-new-link
    // instead of matching its text across different destinations (issue #376).
    applyHyperlinkDestinationSalt(originalAtoms, originalHyperlinkTargets);
    applyHyperlinkDestinationSalt(revisedAtoms, revisedHyperlinkTargets);

    // Step 5c: Intern each atom's now-finalized identity into a shared integer id.
    // One interner per comparison pass covers both documents, so equal identities
    // get equal ids across sides; the LCS then compares ids instead of hash strings.
    const identityInterner = new IdentityInterner();
    assignIdentityIds(originalAtoms, identityInterner);
    assignIdentityIds(revisedAtoms, identityInterner);

    // Step 6: Run hierarchical LCS (paragraph-level first, then atom-level within)
    let lcsResult = hierarchicalCompare(originalAtoms, revisedAtoms);

    // Run-level atomization normally preserves formatting boundaries best, but
    // a single long changed run can contain mostly-equal prose. Refine only
    // fuzzy deleted/inserted run pairs inside paragraphs that the first LCS
    // already aligned, then rerun the comparison. This obtains word precision
    // without exposing unrelated paragraphs to the global word-split strategy.
    // (#717)
    if (!effectiveAtomizeOptions?.splitTextIntoWords) {
      const refined = refineFuzzyRunsWithinAlignedParagraphs(
        originalAtoms,
        revisedAtoms,
        lcsResult,
        moveSettings,
        identityInterner,
        maxWordRefinementChangeRanges,
      );
      originalAtoms = refined.originalAtoms;
      revisedAtoms = refined.revisedAtoms;
      lcsResult = refined.lcsResult;
    }

    // Step 7: Mark correlation status using hierarchical result
    markHierarchicalCorrelationStatus(originalAtoms, revisedAtoms, lcsResult);

    // Step 8: Run move detection
    if (moveSettings.detectMoves) {
      // Create a combined list for move detection
      // Move detection looks at the revised atoms with Inserted status
      // and original atoms with Deleted status
      const allAtoms = [...originalAtoms, ...revisedAtoms];
      const preservedMoveNames = collectPreservedMoveNames([originalTree, revisedTree]);
      const alignedParagraphPairs = new Set<string>();
      for (const match of lcsResult.matches) {
        const originalParagraph = originalAtoms[match.originalIndex]?.paragraphIndex;
        const revisedParagraph = revisedAtoms[match.revisedIndex]?.paragraphIndex;
        if (originalParagraph !== undefined && revisedParagraph !== undefined) {
          alignedParagraphPairs.add(`${originalParagraph}:${revisedParagraph}`);
        }
      }
      detectMovesInAtomList(
        allAtoms,
        moveSettings,
        preservedMoveNames,
        (deleted, inserted) => {
          // A fuzzy source/destination pair inside an already-aligned paragraph
          // is an edit, not evidence that text moved. Exact text can still be a
          // genuine within-paragraph relocation. This preserves move detection
          // across paragraphs while preventing broad changed runs from dragging
          // unchanged inline content into moveFrom/moveTo wrappers. (#717)
          if (deleted.text === inserted.text) return true;
          return !deleted.atoms.some((originalAtom) =>
            inserted.atoms.some((revisedAtom) =>
              originalAtom.paragraphIndex !== undefined &&
              revisedAtom.paragraphIndex !== undefined &&
              alignedParagraphPairs.has(
                `${originalAtom.paragraphIndex}:${revisedAtom.paragraphIndex}`,
              ),
            ),
          );
        },
      );
    }

    // Step 9: Run format detection
    // Paragraph styles are inventoried even when formatting is ignored so the
    // rebuild path can retain the revised live style for equal empty paragraphs.
    detectParagraphStyleChanges(
      originalAtoms,
      revisedAtoms,
      formatSettings.detectFormatChanges,
    );
    if (formatSettings.detectFormatChanges) {
      // Format detection operates on the revised atoms that are Equal
      detectFormatChangesInAtomList(revisedAtoms, formatSettings);
    }

    // Step 10: Create merged atom list for reconstruction
    const mergedAtoms = createMergedAtomList(originalAtoms, revisedAtoms, lcsResult);

    // Step 10b: Assign unified paragraph indices to handle atoms from different trees
    assignUnifiedParagraphIndices(originalAtoms, revisedAtoms, mergedAtoms, lcsResult);
    if (outputMode === 'rebuild') {
      validateOpaquePassthroughCorrelation(mergedAtoms);
    }

    // Step 11: Reconstruct document with track changes
    let newDocumentXml: string;
    let hyperlinkRelationships: NewHyperlinkRel[] = [];
    if (outputMode === 'inplace') {
      // In-place mode: modify the revised AST directly, producing revised-based output.
      newDocumentXml = modifyRevisedDocument(
        revisedTree,
        originalAtoms,
        revisedAtoms,
        mergedAtoms,
        { author, date, preservedRoots: [originalTree] }
      );
      newDocumentXml = suppressVolatileTocPagerefCacheRevisions(newDocumentXml);
    } else {
      // Rebuild mode: reconstruct from atoms using original as the structural base.
      // Ship a resolvable relationship for any inserted/retargeted link whose
      // r:id lives only in the revised package (issue #376).
      const { resolver, newRelationships } = createRebuildHyperlinkRelResolver(
        originalRelsDoc, revisedRelsDoc
      );
      newDocumentXml = reconstructDocument(mergedAtoms, originalXml, {
        author, date, hyperlinkRelResolver: resolver,
      });
      hyperlinkRelationships = newRelationships;
    }

    return { mergedAtoms, newDocumentXml, outputMode, hyperlinkRelationships };
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
    hyperlinkRelationships: NewHyperlinkRel[];
  };
  let fallbackReason: ReconstructionFallbackReason | undefined;
  let fallbackDiagnostics: ReconstructionFallbackDiagnostics | undefined;
  let inplaceSuccessDiagnostics: ReconstructionInplaceSuccessDiagnostics | undefined;
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
    let selectedPass: ReconstructionAttemptDiagnostics['pass'] | undefined;
    for (const { pass, atomizeOptions } of inplacePasses) {
      let candidate: typeof comparisonResult;
      try {
        candidate = await runComparisonPass(atomizeOptions, 'inplace');
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
        selectedPass = pass;
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
      // selectedPass is always set when `selected` is (assigned together at the
      // break). Surface which pass won and which it superseded so callers can
      // distinguish a cross-run rescue from a first-pass success.
      inplaceSuccessDiagnostics = {
        passUsed: selectedPass!,
        precedingFailedAttempts: failedAttempts,
      };
    } else {
      comparisonResult = await runComparisonPass(
        { atomizeParagraphLevelMarkers: true },
        'rebuild'
      );
      fallbackReason = 'round_trip_safety_check_failed';
      fallbackDiagnostics = {
        attempts: failedAttempts,
      };
    }
  } else {
    comparisonResult = await runComparisonPass(
      { atomizeParagraphLevelMarkers: true },
      'rebuild'
    );
  }

  const assembleCandidate = async (candidate: typeof comparisonResult): Promise<{
    resultBuffer: Buffer;
    ancillaryFieldEvidence: AncillaryFieldEvidence;
  }> => {
    const { newDocumentXml } = candidate;
    // Step 12: Clone the mode-selected archive and update document.xml.
    const baseArchive = candidate.outputMode === 'inplace' ? revisedArchive : originalArchive;
    const mergeSourceArchive = candidate.outputMode === 'inplace' ? originalArchive : revisedArchive;
    const baseSide = candidate.outputMode === 'inplace' ? 'revised' : 'original';
    const mergeSourceSide = candidate.outputMode === 'inplace' ? 'original' : 'revised';
    const resultArchive = await baseArchive.clone();
    maybeCaptureEmittedDocumentXml(newDocumentXml);
    resultArchive.setDocumentXml(newDocumentXml);

    await appendHyperlinkRelationships(resultArchive, candidate.hyperlinkRelationships);

    const noteMergeResults = new Map<'footnote' | 'endnote', AuxiliaryMergeResult>();
    for (const descriptor of AUXILIARY_PARTS) {
      let mergeResult: AuxiliaryMergeResult;
      try {
        mergeResult = await mergeAuxiliaryPartDefinitions(
          mergeSourceArchive, resultArchive, newDocumentXml, descriptor
        );
      } catch (error) {
        if (descriptor.label !== 'footnote' && descriptor.label !== 'endnote') throw error;
        throw new AncillaryStorySafetyError([{
          category: 'strict_field_structure',
          code: 'NOTE_PART_XML_INVALID',
          detail: error instanceof Error ? error.message : String(error),
          locator: {
            locatorType: 'package_part',
            normalizedPartPath: descriptor.partPath,
          },
        }]);
      }
      if (descriptor.label === 'footnote' || descriptor.label === 'endnote') {
        noteMergeResults.set(descriptor.label, mergeResult);
      }
    }

    const rootCommentIds = await collectStoryReferenceIds(
      resultArchive, newDocumentXml, 'w:commentReference', null
    );
    if (rootCommentIds.size > 0) {
      await mergeCommentAncillaryParts(mergeSourceArchive, resultArchive, rootCommentIds);
    }

    const ancillaryFieldEvidence = await evaluateAncillaryFieldSafety({
      resultArchive,
      baseArchive,
      mergeSourceArchive,
      reconstructionMode: candidate.outputMode,
      baseSide,
      mergeSourceSide,
      noteMergeResults,
    });
    return {
      resultBuffer: await resultArchive.save(),
      ancillaryFieldEvidence,
    };
  };

  let ancillaryFallbackDiagnostics: AncillaryFallbackDiagnostics | undefined;
  let assembled: Awaited<ReturnType<typeof assembleCandidate>>;
  try {
    assembled = await assembleCandidate(comparisonResult);
  } catch (error) {
    if (comparisonResult.outputMode !== 'inplace' || !(error instanceof AncillaryStorySafetyError)) {
      throw error;
    }
    ancillaryFallbackDiagnostics = { issues: error.issues };
    fallbackReason = 'ancillary_story_safety_check_failed';
    fallbackDiagnostics = undefined;
    inplaceSuccessDiagnostics = undefined;
    comparisonResult = await runComparisonPass(
      { atomizeParagraphLevelMarkers: true },
      'rebuild'
    );
    try {
      assembled = await assembleCandidate(comparisonResult);
    } catch (rebuildError) {
      if (!(rebuildError instanceof AncillaryStorySafetyError)) throw rebuildError;
      throw new AncillaryStorySafetyError(rebuildError.issues, [
        { reconstructionMode: 'inplace', issues: error.issues },
        { reconstructionMode: 'rebuild', issues: rebuildError.issues },
      ]);
    }
  }

  // Rebuild remains the terminal main-story strategy. Its established
  // round-trip diagnostics stay caller-visible. A terminal ancillary failure
  // throws with both reconstruction attempts attached.
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

  const { mergedAtoms } = comparisonResult;
  const { resultBuffer, ancillaryFieldEvidence } = assembled;
  const stats = computeAtomizerStats(mergedAtoms);
  return {
    document: resultBuffer,
    stats,
    engine: 'atomizer' as const,
    unrepresentedChanges:
      unrepresentedChanges.length > 0 ? unrepresentedChanges : undefined,
    reconstructionModeRequested: reconstructionMode,
    reconstructionModeUsed: comparisonResult.outputMode,
    fallbackReason,
    fallbackDiagnostics,
    ancillaryFallbackDiagnostics,
    rebuildSafetyDiagnostics,
    inplaceSuccessDiagnostics,
    ancillaryFieldEvidence,
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

  const resultPartXml = await resultArchive.getFile(descriptor.partPath);
  const resultParsed = resultPartXml ? parseEntries(resultPartXml, descriptor.entryTag) : null;
  const missingIds = [...referencedIds].filter((id) => !resultParsed?.entries.has(id));
  if (missingIds.length === 0) return result;

  const sourcePartXml = await sourceArchive.getFile(descriptor.partPath);
  if (!sourcePartXml) return result;
  const sourceParsed = parseEntries(sourcePartXml, descriptor.entryTag);

  // Find missing entries: referenced in document.xml but not in result
  const missingElements: Element[] = [];
  for (const id of missingIds) {
    if (sourceParsed.entries.has(id)) {
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
// Hyperlink Relationship Merging (issue #376)
//
// Rebuild output is cloned from the ORIGINAL archive, so a hyperlink inserted
// or retargeted by the revision references an r:id that resolves only in the
// REVISED package. These helpers ship the revised destination into the output's
// document.xml.rels — reusing an original relationship that already points at
// the same target, or allocating a fresh collision-free id — mirroring the
// copy-if-missing convention used for auxiliary parts (issue #94).
// =============================================================================

/** A hyperlink relationship to append to the rebuild output's rels part. */
interface NewHyperlinkRel {
  id: string;
  target: string;
  external: boolean;
}

/** Destination identity that folds in the target mode (external vs internal). */
function hyperlinkDestKey(entry: HyperlinkRelEntry): string {
  return `${entry.external ? 'ext' : 'int'}:${entry.target}`;
}

/** Highest numeric `rIdN` among a set of relationship ids (0 when none). */
function maxNumericRelId(ids: Set<string>): number {
  let max = 0;
  for (const id of ids) {
    const m = /^rId(\d+)$/.exec(id);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return max;
}

/**
 * Build the HyperlinkRelResolver for rebuild output. `resolveRevisedOnlyRid`
 * maps a revised-only hyperlink r:id to one that resolves in the output
 * package, recording any freshly-allocated relationship in `newRelationships`
 * for the pipeline to append. Returns null when the revised side has no
 * shippable relationship for that r:id (the wrapper is then dropped).
 */
function createRebuildHyperlinkRelResolver(
  originalRelsDoc: Document | null,
  revisedRelsDoc: Document | null,
): { resolver: HyperlinkRelResolver; newRelationships: NewHyperlinkRel[] } {
  const originalEntries = parseHyperlinkRelEntries(originalRelsDoc);
  const revisedEntries = parseHyperlinkRelEntries(revisedRelsDoc);
  const existingIds = listRelationshipIds(originalRelsDoc);

  const originalIdByDest = new Map<string, string>();
  for (const [id, entry] of originalEntries) {
    if (!originalIdByDest.has(hyperlinkDestKey(entry))) {
      originalIdByDest.set(hyperlinkDestKey(entry), id);
    }
  }

  const newRelationships: NewHyperlinkRel[] = [];
  const allocatedIdByDest = new Map<string, string>();
  const resultByRid = new Map<string, string | null>();
  let maxId = maxNumericRelId(existingIds);

  const resolver: HyperlinkRelResolver = {
    destinationKey(element, fromOriginal): string {
      const rid = element.getAttribute('r:id');
      const anchor = element.getAttribute('w:anchor');
      const parts: string[] = [];
      if (rid) {
        const entry = (fromOriginal ? originalEntries : revisedEntries).get(rid);
        parts.push(`rel=${entry ? hyperlinkDestKey(entry) : `unresolved:${rid}`}`);
      }
      if (anchor) parts.push(`anchor=${anchor}`);
      // Attribute-less wrapper: fall back to identity so distinct empty
      // wrappers never accidentally merge.
      return parts.length > 0 ? parts.join('|') : `wrapper:${fromOriginal ? 'o' : 'r'}`;
    },
    resolveRevisedOnlyRid(revisedRid: string): string | null {
      const cached = resultByRid.get(revisedRid);
      if (cached !== undefined) return cached;

      const entry = revisedEntries.get(revisedRid);
      let result: string | null;
      if (!entry) {
        result = null;
      } else {
        const key = hyperlinkDestKey(entry);
        const reused = originalIdByDest.get(key) ?? allocatedIdByDest.get(key);
        if (reused) {
          result = reused;
        } else {
          let id: string;
          do {
            id = `rId${++maxId}`;
          } while (existingIds.has(id));
          allocatedIdByDest.set(key, id);
          newRelationships.push({ id, target: entry.target, external: entry.external });
          result = id;
        }
      }
      resultByRid.set(revisedRid, result);
      return result;
    },
  };

  return { resolver, newRelationships };
}

/**
 * Append merged-in hyperlink relationships to the result package's
 * document.xml.rels. No-op when there are none.
 */
async function appendHyperlinkRelationships(
  archive: DocxArchive,
  relationships: NewHyperlinkRel[],
): Promise<void> {
  if (relationships.length === 0) return;
  const relsPath = 'word/_rels/document.xml.rels';
  const relsXml = await archive.getFile(relsPath);
  const relsDoc = relsXml
    ? parseXml(relsXml)
    : parseXml(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="${REL_NS}"></Relationships>`,
      );
  const relsEl = relsDoc.documentElement;
  for (const rel of relationships) {
    const el = relsDoc.createElementNS(REL_NS, 'Relationship');
    el.setAttribute('Id', rel.id);
    el.setAttribute('Type', OOXML.HYPERLINK_REL_TYPE);
    el.setAttribute('Target', rel.target);
    if (rel.external) el.setAttribute('TargetMode', 'External');
    relsEl.appendChild(el);
  }
  archive.setFile(relsPath, serializer.serializeToString(relsDoc));
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

  // Build full source comment maps. The threading key is the comment's LAST
  // content paragraph's w14:paraId — Word keys its w15:commentEx and
  // w16cid:commentId rows by that paragraph, not the first one, for
  // multi-paragraph comments (Word extension-part behavior, [MS-DOCX]).
  // getCommentAncillaryParaId() falls back to the first <w:p> when the last
  // carries no paraId, so single-paragraph comments (first == last, the common
  // case) are unaffected.
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
    const paraId = getCommentAncillaryParaId(el);
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

  // Merge commentsExtended, commentsIds, and people for the expanded set.
  await mergeCommentsExtended(sourceArchive, resultArchive, includedParaIds);
  await mergeCommentsIds(sourceArchive, resultArchive, includedParaIds);
  await mergePeople(sourceArchive, resultArchive, includedAuthors);
}

/**
 * Return the w14:paraId Word uses to key a comment's ancillary threading rows
 * (w15:commentEx in commentsExtended.xml, w16cid:commentId in commentsIds.xml).
 *
 * Word keys those rows by the comment's LAST content paragraph's paraId, not
 * the first — so for a multi-paragraph comment the first-paragraph paraId used
 * elsewhere (e.g. getCommentElParaId() in primitives/comments.ts) would miss
 * the row and drop reply/thread metadata on merge (issue #470). This is a Word
 * extension-part convention ([MS-DOCX] w15/w16cid), outside the base OOXML
 * wordprocessingml schema.
 *
 * Falls back to the first <w:p> paraId when the last paragraph carries none, so
 * single-paragraph comments (first === last, the common case) resolve exactly
 * as before.
 */
function getCommentAncillaryParaId(commentEl: Element): string | null {
  const paras = commentEl.getElementsByTagName('w:p');
  let firstParaId: string | null = null;
  for (let i = 0; i < paras.length; i++) {
    const pid = (paras[i] as Element).getAttribute('w14:paraId');
    if (pid && firstParaId === null) firstParaId = pid;
  }
  // Walk backwards for the last paragraph that carries a paraId.
  for (let i = paras.length - 1; i >= 0; i--) {
    const pid = (paras[i] as Element).getAttribute('w14:paraId');
    if (pid) return pid;
  }
  return firstParaId;
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

const COMMENTS_IDS_DESCRIPTOR: AuxiliaryPartDescriptor = {
  label: 'commentsIds',
  partPath: 'word/commentsIds.xml',
  referenceTag: '',
  entryTag: 'w16cid:commentId',
  rootTag: 'w16cid:commentsIds',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml',
  relationshipType: 'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds',
  idBearingTags: [], // keyed by w16cid:paraId, not w:id
};

/**
 * Merge the merge-source side's commentsIds.xml durable-ID rows for the
 * expanded comment set. commentsIds.xml ([MS-DOCX]) keys each
 * <w16cid:commentId> by the comment paragraph's w16cid:paraId — the same
 * paraIds threaded through commentsExtended.xml — so merged-in comments retain
 * their Word durable IDs instead of forcing Word to regenerate them (issue
 * #471). Mirrors mergeCommentsExtended's append/bootstrap shape.
 */
async function mergeCommentsIds(
  sourceArchive: DocxArchive,
  resultArchive: DocxArchive,
  mergedParaIds: Set<string>,
): Promise<void> {
  if (mergedParaIds.size === 0) return;

  const sourceXml = await sourceArchive.getFile('word/commentsIds.xml');
  if (!sourceXml) return;

  const sourceDoc = parseXml(sourceXml);
  const sourceEntries = sourceDoc.getElementsByTagName('w16cid:commentId');

  // Collect rows whose paraId matches a merged comment's paragraph.
  const entriesToMerge: Element[] = [];
  for (let i = 0; i < sourceEntries.length; i++) {
    const el = sourceEntries[i] as Element;
    const paraId = el.getAttribute('w16cid:paraId');
    if (paraId && mergedParaIds.has(paraId)) {
      entriesToMerge.push(el);
    }
  }

  if (entriesToMerge.length === 0) return;

  const resultXml = await resultArchive.getFile('word/commentsIds.xml');

  if (resultXml) {
    const resultDoc = parseXml(resultXml);
    const rootEl = resultDoc.documentElement;

    const existingParaIds = new Set<string>();
    const existing = rootEl.getElementsByTagName('w16cid:commentId');
    for (let i = 0; i < existing.length; i++) {
      const pid = (existing[i] as Element).getAttribute('w16cid:paraId');
      if (pid) existingParaIds.add(pid);
    }

    for (const el of entriesToMerge) {
      const pid = el.getAttribute('w16cid:paraId');
      if (pid && !existingParaIds.has(pid)) {
        rootEl.appendChild(resultDoc.importNode(el, true));
      }
    }

    resultArchive.setFile('word/commentsIds.xml', serializer.serializeToString(resultDoc));
    return;
  }

  // Bootstrap: result lacks commentsIds.xml but the merged comments carry
  // durable IDs. Clone the source's root (preserves namespaces), drop
  // non-matching rows, then add OPC metadata.
  const newDoc = parseXml(sourceXml);
  const newRoot = newDoc.documentElement;
  const allEntries = newRoot.getElementsByTagName('w16cid:commentId');
  const toRemove: Element[] = [];
  for (let i = 0; i < allEntries.length; i++) {
    const el = allEntries[i] as Element;
    const paraId = el.getAttribute('w16cid:paraId');
    if (!paraId || !mergedParaIds.has(paraId)) toRemove.push(el);
  }
  for (const el of toRemove) newRoot.removeChild(el);
  resultArchive.setFile('word/commentsIds.xml', serializer.serializeToString(newDoc));
  await ensureOpcMetadata(resultArchive, COMMENTS_IDS_DESCRIPTOR);
}

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
  const paragraphStyleChanges = new Set<string>();

  for (const atom of mergedAtoms) {
    const paragraphKey = paragraphStatsKey(atom);
    const status = atom.correlationStatus;
    if (paragraphKey && atom.paragraphStyleChange?.tracked) {
      paragraphStyleChanges.add(paragraphKey);
    }
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
    formatChanges: formatChanges + paragraphStyleChanges.size,
    formatChangeAtoms: reconstructionStats.formatChanges + paragraphStyleChanges.size,
  };
}
