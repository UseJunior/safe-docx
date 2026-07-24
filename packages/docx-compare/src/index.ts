/**
 * DOCX comparison and redline generation.
 *
 * This package owns comparison-time reconstruction. Core OOXML primitives live
 * in `@usejunior/docx-core`; comparison depends on core, never the reverse.
 */

import { compareDocumentsAtomizer } from './baselines/atomizer/pipeline.js';
import type { CompareOptions, CompareResult } from './compare-types.js';

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
  DocumentIntegrityCertificate,
  DocumentIntegrityCertificateStatus,
  DocumentIntegrityCheckCertificate,
  DocumentIntegrityCheckStatus,
  DocumentIntegrityStoryCertificate,
  DocumentIntegrityStoryName,
  LeanXmlVerifierOptions,
  ReconstructionAttemptDiagnostics,
  ReconstructionBookmarkMismatchDetails,
  ReconstructionBookmarkMismatchSummary,
  ReconstructionFallbackDiagnostics,
  ReconstructionFallbackReason,
  ReconstructionIdDelta,
  ReconstructionIdDeltaSummary,
  ReconstructionInplaceSuccessDiagnostics,
  ReconstructionMode,
  ReconstructionRebuildSafetyDiagnostics,
  ReconstructionSafetyCheckName,
  ReconstructionSafetyChecks,
  ReconstructionSafetyFailureDetails,
  ReconstructionSafetyFailureSummary,
  ReconstructionTextMismatchDetails,
  ReconstructionTextMismatchSummary,
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
  const {
    engine = 'auto',
    author,
    date,
    ignoreFormatting,
    detectMoves,
    reconstructionMode,
    premergeRuns,
    leanXmlVerifier,
  } = options;

  if ((engine as string) === 'diffmatch') {
    throw new Error(
      "The 'diffmatch' engine has been removed from the public API. " +
        "Use engine: 'atomizer' (recommended) or 'auto'.",
    );
  }

  if (engine === 'atomizer' || engine === 'auto') {
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
      reconstructionMode,
      premergeRuns,
      leanXmlVerifier,
    });
  }

  throw new Error(
    'WmlComparer engine is only available through the benchmark CLI. ' +
      'Use engine: "atomizer" or "auto" for programmatic access.',
  );
}

export * from './atomizer.js';
export * from './move-detection.js';
export * from './format-detection.js';
export * from './baselines/atomizer/formattingFidelity.js';
export {
  acceptAllChanges,
  rejectAllChanges,
  extractTextWithParagraphs,
  normalizeText,
  compareTexts,
} from './baselines/atomizer/trackChangesAcceptorAst.js';
export {
  hasFldCharInsideDel,
  validateFieldStructure,
  compareDocumentsAtomizer,
} from './baselines/atomizer/pipeline.js';
export { parseDocumentXml } from './baselines/atomizer/xmlToWmlElement.js';
export { AncillaryStorySafetyError } from './baselines/atomizer/ancillaryFieldSafety.js';
export { computeAtomLcs, markCorrelationStatus } from './baselines/atomizer/atomLcs.js';
