/**
 * Document Comparison Engine
 *
 * Provides multiple comparison approaches:
 * - Baseline A: WmlComparer wrapper (Docxodus WASM or dotnet CLI)
 * - Baseline B: Pure TypeScript (diff-match-patch + OOXML renderer) - paragraph level
 * - Atomizer: Pure TypeScript with atom-level comparison, move detection, format detection
 */

import { compareDocumentsBaselineB } from './baselines/diffmatch/pipeline.js';
import { compareDocumentsAtomizer } from './baselines/atomizer/pipeline.js';

export interface CompareOptions {
  /** Author name for revision tracking. Default: "Comparison" */
  author?: string;
  /**
   * Revision timestamp used for generated track changes (`w:date`).
   * Default: current time.
   */
  date?: Date;
  /** Ignore formatting differences. Default: true (v1) */
  ignoreFormatting?: boolean;
  /**
   * Atomizer-only normalization: merge adjacent <w:r> siblings with identical formatting
   * prior to comparison. This can reduce overly-granular diffs for heavily-fragmented docs.
   *
   * Default: false.
   */
  premergeRuns?: boolean;
  /**
   * How to reconstruct the output DOCX when using the atomizer engine:
   * - 'rebuild': rebuild document.xml from scratch (more reject/accept stable)
   * - 'inplace': modify the revised document AST in place (more experimental)
   *
   * Default: 'rebuild'
   */
  reconstructionMode?: ReconstructionMode;
  /**
   * Comparison engine to use:
   * - 'atomizer': Character-level comparison with move detection (recommended)
   * - 'diffmatch': Paragraph-level comparison (faster, less precise)
   * - 'wmlcomparer': .NET WmlComparer (requires external runtime)
   * - 'auto': Automatically select best available engine (currently 'atomizer')
   *
   * Default: 'auto'
   */
  engine?: 'wmlcomparer' | 'diffmatch' | 'atomizer' | 'auto';
}

export interface CompareStats {
  insertions: number;
  deletions: number;
  modifications: number;
}

export type ReconstructionMode = 'rebuild' | 'inplace';

export type ReconstructionFallbackReason = 'round_trip_safety_check_failed';

export type ReconstructionSafetyCheckName =
  | 'acceptText'
  | 'rejectText'
  | 'acceptBookmarks'
  | 'rejectBookmarks';

export interface ReconstructionSafetyChecks {
  acceptText: boolean;
  rejectText: boolean;
  acceptBookmarks: boolean;
  rejectBookmarks: boolean;
}

export interface ReconstructionTextMismatchDetails {
  expectedLength: number;
  actualLength: number;
  firstDifferingParagraphIndex: number;
  expectedParagraph: string;
  actualParagraph: string;
  differenceSample: string[];
}

export interface ReconstructionIdDelta {
  missing: string[];
  unexpected: string[];
}

export interface ReconstructionBookmarkMismatchDetails {
  startNames: ReconstructionIdDelta;
  referencedBookmarkNames: ReconstructionIdDelta;
  unresolvedReferenceNames: ReconstructionIdDelta;
  startIds: ReconstructionIdDelta;
  endIds: ReconstructionIdDelta;
  expectedDuplicateStartNames: string[];
  actualDuplicateStartNames: string[];
  expectedDuplicateStartIds: string[];
  actualDuplicateStartIds: string[];
  expectedDuplicateEndIds: string[];
  actualDuplicateEndIds: string[];
  expectedUnmatchedStartIds: string[];
  actualUnmatchedStartIds: string[];
  expectedUnmatchedEndIds: string[];
  actualUnmatchedEndIds: string[];
}

export interface ReconstructionSafetyFailureDetails {
  acceptText?: ReconstructionTextMismatchDetails;
  rejectText?: ReconstructionTextMismatchDetails;
  acceptBookmarks?: ReconstructionBookmarkMismatchDetails;
  rejectBookmarks?: ReconstructionBookmarkMismatchDetails;
}

export interface ReconstructionIdDeltaSummary {
  missingCount: number;
  unexpectedCount: number;
  firstMissing?: string;
  firstUnexpected?: string;
}

export interface ReconstructionTextMismatchSummary {
  firstDifferingParagraphIndex: number;
  expectedParagraph: string;
  actualParagraph: string;
  firstDifference: string;
}

export interface ReconstructionBookmarkMismatchSummary {
  startNames: ReconstructionIdDeltaSummary;
  referencedBookmarkNames: ReconstructionIdDeltaSummary;
  unresolvedReferenceNames: ReconstructionIdDeltaSummary;
  startIds: ReconstructionIdDeltaSummary;
  endIds: ReconstructionIdDeltaSummary;
  unmatchedStartCount: number;
  unmatchedEndCount: number;
  firstUnmatchedStartId?: string;
  firstUnmatchedEndId?: string;
}

export interface ReconstructionSafetyFailureSummary {
  acceptText?: ReconstructionTextMismatchSummary;
  rejectText?: ReconstructionTextMismatchSummary;
  acceptBookmarks?: ReconstructionBookmarkMismatchSummary;
  rejectBookmarks?: ReconstructionBookmarkMismatchSummary;
}

export interface ReconstructionAttemptDiagnostics {
  pass:
    | 'inplace_word_split'
    | 'inplace_run_level'
    | 'inplace_word_split_cross_run'
    | 'inplace_run_level_cross_run';
  checks: ReconstructionSafetyChecks;
  failedChecks: ReconstructionSafetyCheckName[];
  failureDetails?: ReconstructionSafetyFailureDetails;
  firstDiffSummary?: ReconstructionSafetyFailureSummary;
}

export interface ReconstructionFallbackDiagnostics {
  attempts: ReconstructionAttemptDiagnostics[];
}

export interface CompareResult {
  /** The resulting DOCX with track changes */
  document: Buffer;
  /** Statistics about the comparison */
  stats: CompareStats;
  /** Which engine was used */
  engine: 'wmlcomparer' | 'diffmatch' | 'atomizer';
  /**
   * Requested reconstruction mode. Present for atomizer outputs.
   */
  reconstructionModeRequested?: ReconstructionMode;
  /**
   * Actual reconstruction mode used to produce the output. Present for atomizer outputs.
   */
  reconstructionModeUsed?: ReconstructionMode;
  /**
   * Why the requested reconstruction mode could not be used.
   * Present only when atomizer falls back.
   */
  fallbackReason?: ReconstructionFallbackReason;
  /**
   * Detailed safety-check diagnostics for fallback decisions.
   * Present only when atomizer falls back.
   */
  fallbackDiagnostics?: ReconstructionFallbackDiagnostics;
}

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

  // Atomizer engine (recommended) - character-level with move detection
  if (engine === 'atomizer' || engine === 'auto') {
    return compareDocumentsAtomizer(original, revised, {
      author,
      date,
      reconstructionMode,
      premergeRuns,
    });
  }

  // Diffmatch engine - paragraph-level (fallback)
  if (engine === 'diffmatch') {
    return compareDocumentsBaselineB(original, revised, { author, date });
  }

  // WmlComparer engine requires --docxodus option at CLI level
  throw new Error(
    'WmlComparer engine is only available through the benchmark CLI. ' +
    'Use engine: "diffmatch" or "atomizer" for programmatic access.'
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

// Re-export numbering utilities
export * from './numbering.js';

// Re-export footnote utilities
export * from './footnotes.js';

// Re-export primitives (editing, DOM helpers, document operations)
export * from './primitives/index.js';
