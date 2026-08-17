/**
 * DOCX comparison and redline generation.
 *
 * This package owns comparison-time reconstruction. Core OOXML primitives live
 * in `@usejunior/docx-core`; comparison depends on core, never the reverse.
 */

import { compareDocumentsAtomizer } from './baselines/atomizer/pipeline.js';
import type { CompareOptions, CompareResult } from './compare-types.js';

const REMOVED_COMPARISON_OPTIONS = [
  'reconstructionMode',
  'comparisonStrategy',
  'engine',
  'premergeRuns',
  'maxWordRefinementChangeRanges',
] as const;

export type {
  CompareOptions,
  CompareResult,
  CompareStats,
  AncillaryBindingLocator,
  AncillaryFallbackDiagnostics,
  AncillaryFieldEvidence,
  AncillaryFieldInstructionKind,
  AncillaryFieldLocator,
  AncillaryFieldRangeEvidence,
  AncillaryHeaderFooterStoryLocator,
  AncillaryNoteStoryLocator,
  AncillaryPackageLocator,
  AncillarySelectedBindingSummary,
  AncillaryStoryLocator,
  AncillaryStorySafetyCategory,
  AncillaryStorySafetyIssue,
  AncillaryStorySummary,
  ComparisonStrategy,
  ComparisonStrategyFallbackReason,
  ReconstructionAttemptDiagnostics,
  ReconstructionBookmarkMismatchDetails,
  ReconstructionBookmarkMismatchSummary,
  ReconstructionFallbackDiagnostics,
  ReconstructionFallbackReason,
  ReconstructionIdDelta,
  ReconstructionIdDeltaSummary,
  ReconstructionInplaceSuccessDiagnostics,
  ReconstructionMode,
  UnrepresentedChange,
  UnrepresentedChangeKind,
  UnrepresentedChangeScope,
  ReconstructionRebuildSafetyDiagnostics,
  ReconstructionSafetyCheckName,
  ReconstructionSafetyChecks,
  ReconstructionSafetyFailureDetails,
  ReconstructionSafetyFailureSummary,
  ReconstructionTextMismatchDetails,
  ReconstructionTextMismatchSummary,
  TaggedTreeFallbackDiagnostics,
  TaggedPublicationSafetyCheckName,
  TaggedPublicationSafetyChecks,
} from './compare-types.js';

/**
 * Compare two DOCX documents and produce a document with track changes.
 *
 * @param original - The original document.
 * @param revised - The revised document.
 * @param options - Comparison options.
 * @returns The comparison result with track changes markup.
 */
export async function compareDocuments(
  original: Buffer,
  revised: Buffer,
  options: CompareOptions = {},
): Promise<CompareResult> {
  for (const option of REMOVED_COMPARISON_OPTIONS) {
    if (Object.hasOwn(options, option)) {
      throw new TypeError(
        `Unsupported comparison option: ${option}. ` +
        'Comparison now always publishes the revised-based tagged result.',
      );
    }
  }
  const {
    author,
    date,
    ignoreFormatting,
    detectMoves,
  } = options;

  return compareDocumentsAtomizer(original, revised, {
    author,
    date,
    formatDetection:
      ignoreFormatting === undefined
        ? undefined
        : { detectFormatChanges: !ignoreFormatting },
    moveDetection:
      detectMoves === undefined
        ? undefined
        : { detectMoves },
  });
}

export * from './atomizer.js';
export * from './move-detection.js';
export * from './format-detection.js';
export * from './paragraph-style-detection.js';
export { extractRoundTripComparisonText } from './fieldComparisonSemantics.js';
export * from './baselines/atomizer/formattingFidelity.js';
export {
  acceptAllChanges,
  rejectAllChanges,
  extractTextWithParagraphs,
  normalizeText,
  compareTexts,
} from './baselines/atomizer/trackChangesAcceptorAst.js';
export {
  validateFieldStructure,
  compareDocumentsAtomizer,
  TaggedPublicationSafetyError,
} from './baselines/atomizer/pipeline.js';
/** @deprecated fldChar inside w:del is valid; see the docx-core definition. */
export { hasFldCharInsideDel } from '@usejunior/docx-core';
export { parseDocumentXml } from './baselines/atomizer/xmlToWmlElement.js';
export {
  AncillaryStorySafetyError,
  type AncillaryStorySafetyAttempt,
} from './baselines/atomizer/ancillaryFieldSafety.js';
export {
  UnsupportedTextBoxRevisionError,
  assertTextBoxContentUnchanged,
} from './baselines/atomizer/textBoxRevisionSafety.js';
export type { TextBoxRevisionChange } from './baselines/atomizer/textBoxRevisionSafety.js';
export { computeAtomLcs, markCorrelationStatus } from './baselines/atomizer/atomLcs.js';
export { alignComparisonSequences, tokenizeComparisonText } from './textAlignment.js';
export {
  MC_NAMESPACE,
  groupElementsByTagNameNS,
  selectAlternateContentBranch,
  selectedElementsByTagNameNS,
} from './markupCompatibility.js';
export type {
  MarkupCompatibilityGroup,
  MarkupCompatibilityOptions,
  RequiredNamespace,
} from './markupCompatibility.js';
