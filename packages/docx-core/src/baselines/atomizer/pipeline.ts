/**
 * Atomizer Pipeline
 *
 * Main orchestration for the atomizer-based document comparison.
 * Integrates atomization, LCS comparison, move detection, format detection,
 * and document reconstruction.
 */

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
  ReconstructionSafetyFailureSummary,
  ReconstructionSafetyFailureDetails,
  ReconstructionSafetyCheckName,
  ReconstructionSafetyChecks,
  ReconstructionTextMismatchSummary,
  ReconstructionTextMismatchDetails,
  ReconstructionMode,
} from '../../index.js';
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
import { modifyRevisedDocument } from './inPlaceModifier.js';
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
   * Default: false.
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

function evaluateSafetyChecks(
  originalTextForRoundTrip: string,
  revisedTextForRoundTrip: string,
  originalBookmarkDiagnostics: BookmarkDiagnostics,
  revisedBookmarkDiagnostics: BookmarkDiagnostics,
  candidateXml: string
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

  const checks: ReconstructionSafetyChecks = {
    acceptText: acceptTextComparison.normalizedIdentical,
    rejectText: rejectTextComparison.normalizedIdentical,
    // Bookmark checks are soft: consumer compatibility pass legitimately alters
    // bookmarks (deduplication, orphan repair, hoisting out of revision wrappers).
    // Log mismatches in diagnostics but don't trigger fallback to rebuild.
    acceptBookmarks: true,
    rejectBookmarks: true,
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
    premergeRuns = false,
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

  // Step 2: Extract document.xml
  const originalXml = await originalArchive.getDocumentXml();
  const revisedXml = await revisedArchive.getDocumentXml();

  // Extract numbering.xml if available
  const originalNumberingXml = await originalArchive.getNumberingXml() ?? undefined;
  const revisedNumberingXml = await revisedArchive.getNumberingXml() ?? undefined;

  const originalPart: OpcPart = {
    uri: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  };

  const revisedPart: OpcPart = {
    uri: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  };

  const originalTextForRoundTrip = extractTextWithParagraphs(originalXml);
  const revisedTextForRoundTrip = extractTextWithParagraphs(revisedXml);
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
      candidateXml
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
      const candidate = runComparisonPass(atomizeOptions, 'inplace');
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
      comparisonResult = runComparisonPass(undefined, 'rebuild');
      fallbackReason = 'round_trip_safety_check_failed';
      fallbackDiagnostics = {
        attempts: failedAttempts,
      };
    }
  } else {
    comparisonResult = runComparisonPass(undefined, 'rebuild');
  }

  const { mergedAtoms, newDocumentXml } = comparisonResult;

  // Step 12: Clone appropriate archive and update document.xml.
  // Use the revised archive only for true inplace output.
  const baseArchive = comparisonResult.outputMode === 'inplace' ? revisedArchive : originalArchive;
  const resultArchive = await baseArchive.clone();
  resultArchive.setDocumentXml(newDocumentXml);

  // Step 12b: For inplace mode, merge footnote/endnote definitions from the
  // original document. Inplace reconstruction inserts deleted content that may
  // reference footnotes/endnotes not present in the revised archive.
  if (comparisonResult.outputMode === 'inplace') {
    await mergeFootnoteDefinitions(originalArchive, resultArchive, newDocumentXml);
    await mergeEndnoteDefinitions(originalArchive, resultArchive, newDocumentXml);
  }

  // Step 13: Save result and compute stats
  const resultBuffer = await resultArchive.save();
  const stats = computeStats(mergedAtoms);

  return {
    document: resultBuffer,
    stats,
    engine: 'atomizer' as const,
    reconstructionModeRequested: reconstructionMode,
    reconstructionModeUsed: comparisonResult.outputMode,
    fallbackReason,
    fallbackDiagnostics,
  };
}

// =============================================================================
// Footnote / Endnote Merging for Inplace Mode
// =============================================================================

/**
 * Collect footnote/endnote reference IDs from document.xml.
 *
 * @param documentXml - The reconstructed document XML
 * @param refTag - 'w:footnoteReference' or 'w:endnoteReference'
 * @returns Set of referenced IDs (w:id attribute values)
 */
function collectReferenceIds(documentXml: string, refTag: string): Set<string> {
  const ids = new Set<string>();
  // Match <w:footnoteReference w:id="NNN" .../> or <w:endnoteReference w:id="NNN" .../>
  const regex = new RegExp(`<${refTag}[^>]*\\bw:id="([^"]+)"`, 'g');
  let match;
  while ((match = regex.exec(documentXml)) !== null) {
    ids.add(match[1]!);
  }
  return ids;
}

/**
 * Parse a footnotes.xml or endnotes.xml and extract entries by ID.
 *
 * @param xml - The footnotes/endnotes XML content
 * @param entryTag - 'w:footnote' or 'w:endnote'
 * @returns Map of ID -> full XML fragment for each entry
 */
function parseNoteEntries(xml: string, entryTag: string): Map<string, string> {
  const entries = new Map<string, string>();
  // Match <w:footnote w:id="NNN" ...>...</w:footnote> (or endnote)
  // Use a simple regex approach since the structure is predictable
  const regex = new RegExp(`(<${entryTag}\\s[^>]*\\bw:id="([^"]+)"[\\s\\S]*?<\\/${entryTag}>)`, 'g');
  let match;
  while ((match = regex.exec(xml)) !== null) {
    entries.set(match[2]!, match[1]!);
  }
  return entries;
}

/**
 * Merge footnote definitions from the original archive into the result archive.
 *
 * When inplace mode inserts deleted content containing w:footnoteReference,
 * the corresponding footnote definitions must exist in footnotes.xml.
 * The revised archive may lack these definitions.
 */
async function mergeFootnoteDefinitions(
  originalArchive: DocxArchive,
  resultArchive: DocxArchive,
  documentXml: string
): Promise<void> {
  const referencedIds = collectReferenceIds(documentXml, 'w:footnoteReference');
  if (referencedIds.size === 0) return;

  const originalFootnotesXml = await originalArchive.getFile('word/footnotes.xml');
  if (!originalFootnotesXml) return;

  const resultFootnotesXml = await resultArchive.getFile('word/footnotes.xml');

  const originalEntries = parseNoteEntries(originalFootnotesXml, 'w:footnote');
  const resultEntries = resultFootnotesXml ? parseNoteEntries(resultFootnotesXml, 'w:footnote') : new Map();

  // Find missing footnotes: referenced in document.xml but not in result
  const missingEntries: string[] = [];
  for (const id of referencedIds) {
    if (!resultEntries.has(id) && originalEntries.has(id)) {
      missingEntries.push(originalEntries.get(id)!);
    }
  }

  if (missingEntries.length === 0) return;

  if (resultFootnotesXml) {
    // Insert missing entries before the closing </w:footnotes> tag
    const closingTag = '</w:footnotes>';
    const insertionPoint = resultFootnotesXml.lastIndexOf(closingTag);
    if (insertionPoint >= 0) {
      const merged = resultFootnotesXml.slice(0, insertionPoint) +
        missingEntries.join('') +
        resultFootnotesXml.slice(insertionPoint);
      resultArchive.setFile('word/footnotes.xml', merged);
    }
  } else {
    // Create a new footnotes.xml with the standard wrapper and missing entries.
    // Copy the root element and namespace declarations from the original.
    const rootMatch = originalFootnotesXml.match(/^([\s\S]*?<w:footnotes[^>]*>)/);
    if (rootMatch) {
      const newFootnotesXml = rootMatch[1] + missingEntries.join('') + '</w:footnotes>';
      resultArchive.setFile('word/footnotes.xml', newFootnotesXml);
    }
  }
}

/**
 * Merge endnote definitions from the original archive into the result archive.
 * Same logic as mergeFootnoteDefinitions but for endnotes.
 */
async function mergeEndnoteDefinitions(
  originalArchive: DocxArchive,
  resultArchive: DocxArchive,
  documentXml: string
): Promise<void> {
  const referencedIds = collectReferenceIds(documentXml, 'w:endnoteReference');
  if (referencedIds.size === 0) return;

  const originalEndnotesXml = await originalArchive.getFile('word/endnotes.xml');
  if (!originalEndnotesXml) return;

  const resultEndnotesXml = await resultArchive.getFile('word/endnotes.xml');

  const originalEntries = parseNoteEntries(originalEndnotesXml, 'w:endnote');
  const resultEntries = resultEndnotesXml ? parseNoteEntries(resultEndnotesXml, 'w:endnote') : new Map();

  const missingEntries: string[] = [];
  for (const id of referencedIds) {
    if (!resultEntries.has(id) && originalEntries.has(id)) {
      missingEntries.push(originalEntries.get(id)!);
    }
  }

  if (missingEntries.length === 0) return;

  if (resultEndnotesXml) {
    const closingTag = '</w:endnotes>';
    const insertionPoint = resultEndnotesXml.lastIndexOf(closingTag);
    if (insertionPoint >= 0) {
      const merged = resultEndnotesXml.slice(0, insertionPoint) +
        missingEntries.join('') +
        resultEndnotesXml.slice(insertionPoint);
      resultArchive.setFile('word/endnotes.xml', merged);
    }
  } else {
    const rootMatch = originalEndnotesXml.match(/^([\s\S]*?<w:endnotes[^>]*>)/);
    if (rootMatch) {
      const newEndnotesXml = rootMatch[1] + missingEntries.join('') + '</w:endnotes>';
      resultArchive.setFile('word/endnotes.xml', newEndnotesXml);
    }
  }
}

/**
 * Compute comparison statistics from merged atoms.
 */
function computeStats(mergedAtoms: ComparisonUnitAtom[]): CompareStats {
  const reconstructionStats = computeReconstructionStats(mergedAtoms);

  // Count unique paragraphs for modifications
  // A modification is when we have both deleted and inserted atoms in the same paragraph
  const modifiedParagraphs = new Set<string>();

  let currentParagraph = '';
  let hasDeleted = false;
  let hasInserted = false;

  for (const atom of mergedAtoms) {
    // Detect paragraph boundaries
    const pAncestor = atom.ancestorElements.find((a) => a.tagName === 'w:p');
    const paragraphId = pAncestor
      ? `${atom.part.uri}:${atom.ancestorElements.indexOf(pAncestor)}`
      : '';

    if (paragraphId !== currentParagraph) {
      // Check previous paragraph
      if (currentParagraph && hasDeleted && hasInserted) {
        modifiedParagraphs.add(currentParagraph);
      }
      currentParagraph = paragraphId;
      hasDeleted = false;
      hasInserted = false;
    }

    if (atom.correlationStatus === CorrelationStatus.Deleted) {
      hasDeleted = true;
    } else if (atom.correlationStatus === CorrelationStatus.Inserted) {
      hasInserted = true;
    }
  }

  // Check last paragraph
  if (currentParagraph && hasDeleted && hasInserted) {
    modifiedParagraphs.add(currentParagraph);
  }

  return {
    insertions: reconstructionStats.insertions,
    deletions: reconstructionStats.deletions,
    modifications: modifiedParagraphs.size + reconstructionStats.formatChanges,
  };
}
