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
   * Optional Lean 4 verifier for atomizer inplace output. When enabled, the
   * atomizer still produces the DOCX, then a separately compiled Lean checker
   * extracts and evaluates fixed WordprocessingML stories from the actual
   * original/revised/result DOCX package triple.
   */
  leanXmlVerifier?: LeanXmlVerifierOptions;
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

export interface LeanXmlVerifierOptions {
  /**
   * Run the Lean fixed-story verifier. Default: false.
   * The compiled verifier currently requires `unzip` on PATH to extract DOCX parts.
   */
  enabled?: boolean;
  /**
   * Path to the compiled `leanDocxChecker` executable. Defaults to
   * `SAFE_DOCX_LEAN_XML_CHECKER` when set, otherwise
   * `verification/lean/.lake/build/bin/leanDocxChecker` relative to cwd.
   */
  executablePath?: string;
  /** Maximum verifier runtime in milliseconds. Default: 10000. */
  timeoutMs?: number;
}

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

/**
 * Diagnostics for a *successful* inplace reconstruction: which pass produced the
 * accepted output, and the passes that were tried and rejected before it. The
 * fallback diagnostics above only surface when every inplace pass fails and the
 * pipeline reroutes to rebuild; this surfaces the same per-pass detail on the
 * success path, so a caller can tell which pass produced the output — e.g. a
 * later pass rescuing what an earlier pass could not reconstruct safely —
 * without inferring it from the absence of a fallback. Present only for atomizer
 * inplace output (`reconstructionModeUsed === 'inplace'`).
 *
 * @see https://github.com/UseJunior/safe-docx/issues/469
 */
export interface ReconstructionInplaceSuccessDiagnostics {
  /** The inplace pass whose output passed all round-trip safety checks. */
  passUsed: ReconstructionAttemptDiagnostics['pass'];
  /**
   * Passes tried and rejected (in evaluation order) before `passUsed`
   * succeeded. Empty when the first pass already satisfied every safety check.
   */
  precedingFailedAttempts: ReconstructionAttemptDiagnostics[];
}

/**
 * Round-trip safety evaluation of rebuild output. Rebuild is the terminal
 * reconstruction strategy — there is no further fallback — so a failed check
 * cannot reroute the pipeline. The document is returned anyway and the
 * failures are surfaced here as a caller-visible warning.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/226
 */
export interface ReconstructionRebuildSafetyDiagnostics {
  checks: ReconstructionSafetyChecks;
  failedChecks: ReconstructionSafetyCheckName[];
  failureDetails?: ReconstructionSafetyFailureDetails;
  firstDiffSummary?: ReconstructionSafetyFailureSummary;
}

export type DocumentIntegrityCertificateStatus =
  | 'passed'
  | 'failed'
  | 'not_applicable'
  | 'not_run';

export type DocumentIntegrityCheckStatus = 'passed' | 'failed' | 'not_evaluated';

export interface DocumentIntegrityCheckCertificate {
  status: DocumentIntegrityCheckStatus;
  claim: string;
}

export type DocumentIntegrityStoryName = 'main' | 'footnotes' | 'endnotes';

export interface DocumentIntegrityStoryCertificate {
  name: DocumentIntegrityStoryName;
  status: 'passed' | 'failed';
  checks: {
    acceptingAllTrackedChangesMatchesRevisedText: DocumentIntegrityCheckCertificate;
    rejectingAllTrackedChangesMatchesOriginalText: DocumentIntegrityCheckCertificate;
    acceptingAllTrackedChangesKeepsValidFieldStructure: DocumentIntegrityCheckCertificate;
    rejectingAllTrackedChangesKeepsValidFieldStructure: DocumentIntegrityCheckCertificate;
    comparedStoryHasNoFieldMarkersInsideDeletions: DocumentIntegrityCheckCertificate;
  };
  parsedTokenCounts: { original: number; revised: number; compared: number };
  presence: { original: boolean; revised: boolean; compared: boolean };
}

export interface DocumentIntegrityCertificate {
  /** Overall result from the separately compiled Lean verifier. */
  status: DocumentIntegrityCertificateStatus;
  /** Human-facing verifier name, intentionally not a Lean theorem identifier. */
  verifier: 'Lean XML triple checker';
  /** Stable public certificate protocol retained for v1 consumers. */
  protocolVersion: 1;
  /** Stable v1 main-document scope. See `fixedStoryScope` for additive coverage. */
  scope: 'word/document.xml';
  /** Reconstruction mode of the compared DOCX that was offered to the verifier. */
  reconstructionMode: ReconstructionMode;
  /** Stable v1 hashes of the main-document XML projections. */
  inputSha256: {
    originalDocumentXml: string;
    revisedDocumentXml: string;
    comparedDocumentXml: string;
  };
  /** Stable v1 main-story checks, populated from the compiled checker report. */
  checks: {
    acceptingAllTrackedChangesMatchesRevisedText: DocumentIntegrityCheckCertificate;
    rejectingAllTrackedChangesMatchesOriginalText: DocumentIntegrityCheckCertificate;
    acceptingAllTrackedChangesKeepsValidFieldStructure: DocumentIntegrityCheckCertificate;
    rejectingAllTrackedChangesKeepsValidFieldStructure: DocumentIntegrityCheckCertificate;
    comparedDocumentHasNoFieldMarkersInsideDeletions: DocumentIntegrityCheckCertificate;
  };
  /** Stable v1 main-story token counts. */
  parsedTokenCounts?: { original: number; revised: number; compared: number };
  /** Internal executable protocol used for package-level verification. */
  checkerProtocolVersion?: 2;
  fixedStoryScope?: readonly ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'];
  inputPackageSha256?: { originalDocx: string; revisedDocx: string; comparedDocx: string };
  stories?: DocumentIntegrityStoryCertificate[];
  presenceMismatches?: Array<{
    name: string;
    packagePart: string;
    required: boolean;
    presence: { original: boolean; revised: boolean; combined: boolean };
  }>;
  /** Important surfaces this certificate does not claim to validate. */
  exclusions?: string[];
  reason?: string;
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
  /**
   * Safety-check failures observed on rebuild output — whether rebuild was
   * requested explicitly (the default mode) or reached via inplace fallback.
   * Present only when at least one check failed.
   */
  rebuildSafetyDiagnostics?: ReconstructionRebuildSafetyDiagnostics;
  /**
   * Which inplace pass produced the output and which passes it superseded.
   * Present only when atomizer produced inplace output.
   */
  inplaceSuccessDiagnostics?: ReconstructionInplaceSuccessDiagnostics;
  /**
   * Optional per-document integrity certificate from the separately compiled
   * Lean XML triple verifier. Present only when `leanXmlVerifier.enabled` is set.
   */
  documentIntegrity?: DocumentIntegrityCertificate;
}
