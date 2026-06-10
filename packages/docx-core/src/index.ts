/**
 * Document Comparison Engine
 *
 * Provides multiple comparison approaches:
 * - Baseline A: WmlComparer wrapper (Docxodus WASM or dotnet CLI)
 * - Baseline B: Pure TypeScript (diff-match-patch + OOXML renderer) - paragraph level (dev-only)
 * - Atomizer: Pure TypeScript with atom-level comparison, move detection, format detection
 */

import { compareDocumentsAtomizer } from './baselines/atomizer/pipeline.js';
import type { CompareOptions, CompareResult } from './compare-types.js';

export type {
  CompareOptions,
  CompareResult,
  CompareStats,
  ReconstructionAttemptDiagnostics,
  ReconstructionBookmarkMismatchDetails,
  ReconstructionBookmarkMismatchSummary,
  ReconstructionFallbackDiagnostics,
  ReconstructionFallbackReason,
  ReconstructionIdDelta,
  ReconstructionIdDeltaSummary,
  ReconstructionMode,
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
 * @param original - The original document (Buffer)
 * @param revised - The revised document (Buffer)
 * @param options - Comparison options
 * @returns The comparison result with track changes markup
 */
export async function compareDocuments(
  original: Buffer,
  revised: Buffer,
  options: CompareOptions = {}
): Promise<CompareResult> {
  const { engine = 'auto', author, date, reconstructionMode, premergeRuns } = options;

  // Migration error for removed diffmatch engine
  if ((engine as string) === 'diffmatch') {
    throw new Error(
      "The 'diffmatch' engine has been removed from the public API. " +
      "Use engine: 'atomizer' (recommended) or 'auto'."
    );
  }

  // Atomizer engine (recommended) - character-level with move detection
  if (engine === 'atomizer' || engine === 'auto') {
    return compareDocumentsAtomizer(original, revised, {
      author,
      date,
      reconstructionMode,
      premergeRuns,
    });
  }

  // WmlComparer engine requires --docxodus option at CLI level
  throw new Error(
    'WmlComparer engine is only available through the benchmark CLI. ' +
    'Use engine: "atomizer" or "auto" for programmatic access.'
  );
}

// Re-export shared utilities
export * from './shared/ooxml/namespaces.js';
export * from './shared/ooxml/types.js';

// Re-export core WmlComparer types
export * from './core-types.js';

// Re-export atomizer functions
export * from './atomizer.js';

// Re-export move detection
export * from './move-detection.js';

// Re-export format detection
export * from './format-detection.js';

// Re-export the formatting-fidelity comparison check
export * from './baselines/atomizer/formattingFidelity.js';

// Re-export numbering utilities
export * from './numbering.js';

// Re-export footnote utilities
export * from './footnotes.js';

// Re-export primitives (editing, DOM helpers, document operations)
export * from './primitives/index.js';
export {
  allocateRevisionId,
  buildPPrChangeElement,
  buildTcPrChangeElement,
  buildTrPrChangeElement,
  buildRPrChangeElement,
  createRevisionContainer,
  createRevisionContext,
  createRevisionIdState,
  escapeXmlAttr,
  formatDate,
  prepareElementForDeletion,
  wrapElementWithDel,
  wrapElementWithIns,
} from './primitives/track-changes-emitter.js';
export type {
  RevisionContext,
  RevisionContextOptions,
  RevisionIdState,
} from './primitives/track-changes-emitter.js';
