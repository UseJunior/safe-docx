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
   * Default: true.
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
   * - 'wmlcomparer': .NET WmlComparer (requires external runtime)
   * - 'auto': Automatically select best available engine (currently 'atomizer')
   *
   * Default: 'auto'
   */
  engine?: 'wmlcomparer' | 'atomizer' | 'auto';
}

export interface CompareStats {
  /**
   * Human-facing inserted change ranges. This counts contiguous inserted atom
   * runs, matching the coalesced w:ins regions emitted in OOXML.
   */
  insertions: number;
  /**
   * Human-facing deleted change ranges. This counts contiguous deleted atom
   * runs, matching the coalesced w:del regions emitted in OOXML.
   */
  deletions: number;
  /**
   * Paragraphs containing both inserted and deleted content. Format-only
   * changes are reported separately in formatChanges.
   */
  modifications: number;
  /** Same value as insertions, exposed with explicit range-level semantics. */
  insertedRanges: number;
  /** Same value as deletions, exposed with explicit range-level semantics. */
  deletedRanges: number;
  /** Atom-level inserted units for granular/benchmark consumers. */
  insertedAtoms: number;
  /** Atom-level deleted units for granular/benchmark consumers. */
  deletedAtoms: number;
  /** Same value as modifications, exposed without overloading the term. */
  modifiedParagraphs: number;
  /** Contiguous format-only change ranges. */
  formatChanges: number;
  /** Atom-level format-only units for granular/benchmark consumers. */
  formatChangeAtoms: number;
}

export type ReconstructionMode = 'rebuild' | 'inplace';

export type ReconstructionFallbackReason = 'round_trip_safety_check_failed';

export type ReconstructionSafetyCheckName =
  | 'acceptText'
  | 'rejectText'
  | 'acceptBookmarks'
  | 'rejectBookmarks'
  | 'fieldStructure';

export interface ReconstructionSafetyChecks {
  acceptText: boolean;
  rejectText: boolean;
  acceptBookmarks: boolean;
  rejectBookmarks: boolean;
  fieldStructure: boolean;
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
  engine: 'wmlcomparer' | 'atomizer';
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
