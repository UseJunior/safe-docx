/**
 * DOCX comparison and redline generation.
 *
 * This package owns comparison-time reconstruction. Core OOXML primitives live
 * in `@usejunior/docx-core`; comparison depends on core, never the reverse.
 */

import { compareDocumentsAtomizer } from './tagged/pipeline.js';
import { choosePlaceholderRevisionDate, omitPlaceholderRevisionDates } from './revisionDateOmission.js';
import { COMPARE_REVISION_GROUPINGS, DEFAULT_COMPARE_REVISION_GROUPING, type CompareOptions, type CompareResult } from './compare-types.js';
export { UnsupportedTableTopologyComparisonError } from './tagged/tableTopologyGuard.js';

const REMOVED_COMPARISON_OPTIONS = [
  'reconstructionMode',
  'comparisonStrategy',
  'engine',
  'premergeRuns',
  'maxWordRefinementChangeRanges',
] as const;

export {
  COMPARE_REVISION_GROUPINGS,
  DEFAULT_COMPARE_REVISION_GROUPING,
  parseCompareRevisionGrouping,
} from './compare-types.js';

export type {
  CompareOptions,
  CompareRevisionGrouping,
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
  ParagraphTopologyMismatchDetails,
  ParagraphPropertyMismatchDetails,
  UnrepresentedChange,
  UnrepresentedChangeKind,
  UnrepresentedChangeScope,
  UnrepresentedContentControlChange,
  UnrepresentedDrawingChange,
  UnrepresentedPictureChange,
  UnrepresentedTableChange,
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
  original: Uint8Array,
  revised: Uint8Array,
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
    revisionGrouping = DEFAULT_COMPARE_REVISION_GROUPING,
  } = options;
  if (!COMPARE_REVISION_GROUPINGS.includes(revisionGrouping)) {
    throw new TypeError(
      `Unsupported revisionGrouping: ${String(revisionGrouping)}. ` +
      `Expected one of: ${COMPARE_REVISION_GROUPINGS.join(', ')}.`,
    );
  }

  if (date !== undefined && date !== null && !(date instanceof Date && !Number.isNaN(date.getTime()))) {
    throw new TypeError('Unsupported date: expected a valid Date, null (omit w:date) or undefined (now).');
  }
  // `null`: run with a placeholder timestamp absent from both inputs, then
  // strip exactly that value, so pre-existing revisions keep their dates.
  const placeholderDate = date === null
    ? await choosePlaceholderRevisionDate([original as Buffer, revised as Buffer])
    : undefined;
  const tagged = await compareDocumentsAtomizer(original as Buffer, revised as Buffer, {
    author,
    date: placeholderDate ?? date ?? undefined,
    formatDetection:
      ignoreFormatting === undefined
        ? undefined
        : { detectFormatChanges: !ignoreFormatting },
    moveDetection:
      detectMoves === undefined
        ? undefined
        : { detectMoves },
    revisionGrouping,
  });

  return {
    document: placeholderDate === undefined
      ? tagged.document
      : await omitPlaceholderRevisionDates(tagged.document, placeholderDate),
    stats: tagged.stats,
    engine: tagged.engine,
    ...(tagged.unrepresentedChanges === undefined
      ? {}
      : { unrepresentedChanges: tagged.unrepresentedChanges }),
    ...(tagged.ancillaryFieldEvidence === undefined
      ? {}
      : { ancillaryFieldEvidence: tagged.ancillaryFieldEvidence }),
  };
}

export * from './move-detection.js';
export {
  areRunPropertiesEqual,
  areNormalizedRunPropertiesEqual,
  categorizePropertyChanges,
  getChangedPropertyNames,
  normalizeRunProperties,
} from './propertyNaming.js';
export { extractRoundTripComparisonText } from './fieldComparisonSemantics.js';
export {
  formatUnrepresentedChangeWarnings,
  summarizeUnrepresentedChanges,
} from './unrepresented-change-warnings.js';
export * from './tagged/formattingFidelity.js';
export {
  acceptAllChanges,
  rejectAllChanges,
  extractTextWithParagraphs,
  normalizeText,
  compareTexts,
} from './tagged/trackChangesAcceptorAst.js';
export {
  validateFieldStructure,
  compareDocumentsAtomizer,
  TaggedPublicationSafetyError,
} from './tagged/pipeline.js';
/** @deprecated fldChar inside w:del is valid; see the docx-core definition. */
export { hasFldCharInsideDel } from '@usejunior/docx-core';
export { parseDocumentXml } from './tagged/xmlToWmlElement.js';
export { UnsupportedBlockContainerRevisionError } from './tagged/taggedTreeSerializer.js';
export {
  AncillaryStorySafetyError,
} from './tagged/ancillaryFieldSafety.js';
export {
  UnsupportedTextBoxRevisionError,
  assertTextBoxContentUnchanged,
} from './tagged/textBoxRevisionSafety.js';
export type { TextBoxRevisionChange } from './tagged/textBoxRevisionSafety.js';
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
