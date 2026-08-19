export interface CompareOptions {
  /** Author name for revision tracking. Default: "Comparison" */
  author?: string;
  /**
   * Revision timestamp used for generated track changes (`w:date`).
   * Default: current time.
   */
  date?: Date;
  /** Ignore formatting differences. Default: false */
  ignoreFormatting?: boolean;
  /** Detect content moved within the document. Default: true */
  detectMoves?: boolean;
}

/** @internal A source-side range whose generated revision must remain attributable. */
export interface RevisionAttributionRange {
  operationId: string;
  side: 'original' | 'revised';
  startParagraphId: string;
  start: number;
  endParagraphId: string;
  end: number;
}

/** @internal The exact generated revision interval for one attributed operation. */
export interface RevisionAttribution {
  operationId: string;
  startRevision: { type: 'ins' | 'del' | 'moveFrom' | 'moveTo'; id: string };
  endRevision: { type: 'ins' | 'del' | 'moveFrom' | 'moveTo'; id: string };
}

export interface CompareStats {
  /**
   * Versioned unit contract for the atom-named metrics below. `tagged-token-v1`
   * counts comparison-text tokens (including whitespace and edge punctuation)
   * plus supported non-text comparison leaves in the tagged alignment. It does
   * not reproduce the deleted flattened-atom/LCS engine's weighting.
   */
  atomMetricVersion: 'tagged-token-v1';
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
  /** Inserted `tagged-token-v1` units for granular/benchmark consumers. */
  insertedAtoms: number;
  /** Deleted `tagged-token-v1` units for granular/benchmark consumers. */
  deletedAtoms: number;
  /** Same value as modifications, exposed without overloading the term. */
  modifiedParagraphs: number;
  /** Contiguous format-only change ranges. */
  formatChanges: number;
  /** Format-only `tagged-token-v1` units for granular/benchmark consumers. */
  formatChangeAtoms: number;
}

export type ReconstructionMode = 'rebuild' | 'inplace';
export type ComparisonStrategy = 'tagged-tree' | 'legacy';

export type ComparisonStrategyFallbackReason =
  | 'tagged_tree_publication_safety_check_failed';

export type UnrepresentedChangeScope = 'section' | 'header' | 'footer';
export type UnrepresentedChangeKind = 'added' | 'removed' | 'changed';

/**
 * A package-level input difference not expressed by emitted tracked-change
 * markup. Revision counts intentionally remain text-oriented.
 */
export interface UnrepresentedChange {
  scope: UnrepresentedChangeScope;
  kind: UnrepresentedChangeKind;
  /** Zero-based document-order section ordinal. */
  sectionIndex: number;
  /** Header/footer role when scope is not `section`. */
  role?: 'default' | 'first' | 'even';
}

export type ReconstructionFallbackReason =
  | 'round_trip_safety_check_failed'
  | 'ancillary_story_safety_check_failed';

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

/** Safety evidence retained when tagged-tree publication falls back to legacy output. */
export interface TaggedTreeFallbackDiagnostics {
  checks: TaggedPublicationSafetyChecks;
  failedChecks: TaggedPublicationSafetyCheckName[];
  failureDetails?: ReconstructionSafetyFailureDetails;
  firstDiffSummary?: ReconstructionSafetyFailureSummary;
  /** Source-projected formatting evidence when formatting rejected publication. */
  formattingFidelity?: import('./tagged/formattingFidelity.js').ProjectedFormattingFidelity;
}

export type TaggedPublicationSafetyCheckName =
  | ReconstructionSafetyCheckName
  | 'formattingFidelity';

export interface TaggedPublicationSafetyChecks extends ReconstructionSafetyChecks {
  formattingFidelity: boolean;
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

export type AncillaryStorySafetyCategory =
  | 'binding_resolution'
  | 'strict_field_structure'
  | 'canonical_evidence';

export interface AncillaryBindingLocator {
  locatorType: 'section_binding';
  sectionOrdinal: number;
  kind: 'header' | 'footer';
  role: 'default' | 'first' | 'even';
  normalizedPartPath?: string;
}

export interface AncillaryHeaderFooterStoryLocator {
  locatorType: 'header_footer_story';
  normalizedPartPath: string;
  selectingBindings: AncillaryBindingLocator[];
}

export interface AncillaryNoteStoryLocator {
  locatorType: 'note_entry';
  normalizedPartPath: 'word/footnotes.xml' | 'word/endnotes.xml';
  entryId: string;
  sourceSide?: 'original' | 'revised';
}

export interface AncillaryPackageLocator {
  locatorType: 'package_part';
  normalizedPartPath: string;
}

export interface AncillaryFieldLocator {
  locatorType: 'field_range';
  normalizedPartPath: string;
  entryId?: string;
  paragraphOrdinal: number;
  eligibleFieldOrdinal: number;
  instructionKind: AncillaryFieldInstructionKind;
}

export type AncillaryStoryLocator =
  | AncillaryBindingLocator
  | AncillaryHeaderFooterStoryLocator
  | AncillaryNoteStoryLocator
  | AncillaryPackageLocator
  | AncillaryFieldLocator;

export interface AncillaryStorySafetyIssue {
  category: AncillaryStorySafetyCategory;
  code: string;
  detail: string;
  locator: AncillaryStoryLocator;
}

export interface AncillaryFallbackDiagnostics {
  issues: AncillaryStorySafetyIssue[];
}

export type AncillaryFieldInstructionKind = 'PAGE' | 'NUMPAGES' | 'REF' | 'PAGEREF';

export interface AncillarySelectedBindingSummary {
  sectionOrdinal: number;
  kind: 'header' | 'footer';
  role: 'default' | 'first' | 'even';
  relationshipId: string;
  normalizedPartPath: string;
}

export interface AncillaryStorySummary {
  storyKind: 'header' | 'footer' | 'footnote' | 'endnote';
  normalizedPartPath: string;
  entryId?: string;
  selectingBindings?: AncillaryBindingLocator[];
  sourceSide?: 'original' | 'revised';
  provenance?: 'base' | 'imported';
  strictFieldStructure: 'passed';
}

export interface AncillaryFieldRangeEvidence {
  locator: AncillaryFieldLocator;
  instructionKind: AncillaryFieldInstructionKind;
  sourceSide: 'original' | 'revised';
  provenance: 'base' | 'imported';
  canonicalMatch: true;
}

export interface AncillaryFieldEvidence {
  status: 'passed';
  selectedBindings: AncillarySelectedBindingSummary[];
  stories: AncillaryStorySummary[];
  ranges: AncillaryFieldRangeEvidence[];
}

export interface CompareResult {
  /** The resulting DOCX with track changes */
  document: Buffer;
  /** Statistics about the comparison */
  stats: CompareStats;
  /** Which engine was used */
  engine: 'wmlcomparer' | 'atomizer';
  /** Strategy requested by the caller, including the tagged-tree default. */
  comparisonStrategyRequested?: ComparisonStrategy;
  /** Strategy that constructed the published document. */
  comparisonStrategyUsed?: ComparisonStrategy;
  /** Why tagged-tree publication was rejected in favor of validated legacy output. */
  comparisonStrategyFallbackReason?: ComparisonStrategyFallbackReason;
  /** Failed tagged-tree publication checks retained for diagnosis and telemetry. */
  taggedTreeFallbackDiagnostics?: TaggedTreeFallbackDiagnostics;
  /**
   * Input differences that the emitted revision markup does not represent.
   * Absent when no supported package-level difference is detected.
   */
  unrepresentedChanges?: UnrepresentedChange[];
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
   * Ancillary issues from an inplace candidate rejected at package assembly.
   * Present only when ancillary validation itself caused rebuild fallback.
   */
  ancillaryFallbackDiagnostics?: AncillaryFallbackDiagnostics;
  /**
   * Safety-check failures observed on rebuild output — whether rebuild was
   * requested explicitly or reached via fallback from the inplace default.
   * Present only when at least one check failed.
   */
  rebuildSafetyDiagnostics?: ReconstructionRebuildSafetyDiagnostics;
  /**
   * Which inplace pass produced the output and which passes it superseded.
   * Present only when atomizer produced inplace output.
   */
  inplaceSuccessDiagnostics?: ReconstructionInplaceSuccessDiagnostics;
  /**
   * Successful structural and canonical evidence for the final assembled
   * ancillary stories. Absence means unavailable evidence, not a pass.
   */
  ancillaryFieldEvidence?: AncillaryFieldEvidence;
}
