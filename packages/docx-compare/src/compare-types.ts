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
  /**
   * How generated run revisions are grouped. `'token-minimal'` (the default)
   * emits the smallest deletion/insertion set, which alternates word by word
   * in a heavily rewritten paragraph. `'readable-semantic'` regroups each
   * change cluster as one deletion followed by one insertion, absorbing short
   * unchanged stretches between changes; Accept All and Reject All projections
   * are unchanged.
   */
  revisionGrouping?: CompareRevisionGrouping;
}

/** Public revision-grouping presentation policies accepted by `compareDocuments`. */
export type CompareRevisionGrouping = 'token-minimal' | 'readable-semantic';

/** The public revision-grouping values, in documentation order. */
export const COMPARE_REVISION_GROUPINGS: readonly CompareRevisionGrouping[] = [
  'token-minimal',
  'readable-semantic',
];

/** @internal A source-side range whose generated revision must remain attributable. */
export interface RevisionAttributionRange {
  operationId: string;
  side: 'original' | 'revised';
  startParagraphId: string;
  start: number;
  endParagraphId: string;
  end: number;
}

/**
 * @internal Presentation policy for generated run revisions. Markdoc selects
 * `readable-whitespace`; `readable-semantic` is the public readable policy.
 */
export type RevisionGroupingPolicy = 'token-minimal' | 'readable-whitespace' | 'readable-semantic';

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
   * runs in the tagged main-story alignment, before ancillary reconciliation.
   * A note edit may subsequently move into its definition without a second
   * count; this is not a final-package w:ins element inventory.
   */
  insertions: number;
  /**
   * Human-facing deleted change ranges. This counts contiguous deleted atom
   * runs in the tagged main-story alignment, before ancillary reconciliation.
   * A note edit may subsequently move into its definition without a second
   * count; this is not a final-package w:del element inventory.
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
  /** Comparison-generated native whole-table-row insertion markers, including nested rows. */
  insertedTableRows: number;
  /** Comparison-generated native whole-table-row deletion markers, including nested rows. */
  deletedTableRows: number;
  /**
   * Detected moves. Each counts one balanced source/destination pair
   * (`w:moveFrom`/`w:moveTo`), so moved content is never also counted in
   * insertions, deletions, or the inserted/deleted atom totals. A pure move
   * therefore reports `moves > 0` with every insertion/deletion field at zero.
   */
  moves: number;
  /** Detected moves whose source is a whole paragraph (a subset of `moves`). */
  movedParagraphs: number;
  /**
   * Comparison-generated move-source revision ranges, counted like
   * insertedRanges/deletedRanges: content wrappers plus move-owned paragraph
   * mark revisions. One whole-paragraph move usually yields more than one.
   */
  moveFromRanges: number;
  /** Comparison-generated move-destination revision ranges; see moveFromRanges. */
  moveToRanges: number;
}

/** @deprecated Comparison no longer has reconstruction modes. */
export type ReconstructionMode = 'rebuild' | 'inplace';
/** @deprecated Comparison no longer accepts or reports strategy selection. */
export type ComparisonStrategy = 'tagged-tree' | 'legacy';

/** @deprecated Tagged publication throws instead of falling back to a legacy strategy. */
export type ComparisonStrategyFallbackReason =
  | 'tagged_tree_publication_safety_check_failed';

export type UnrepresentedChangeScope =
  | 'section'
  | 'header'
  | 'footer'
  | 'contentControl'
  | 'picture'
  | 'drawing'
  | 'table';
export type UnrepresentedChangeKind = 'added' | 'removed' | 'changed';

/**
 * Identity of the content control whose properties differ, or of a whole block
 * container inserted or deleted (`contentControl` scope).
 */
export interface UnrepresentedContentControlChange {
  /**
   * Zero-based document-order ordinal among the revised document's content
   * controls. For a whole container (`element` `sdt` or `customXml`), its
   * ordinal among the comparison output's elements of that name. For a
   * custom XML element's properties (`customXmlPr`), the ordinal of the
   * enclosing `w:customXml` among the comparison output's `w:customXml`
   * elements.
   */
  index: number;
  /**
   * The property element that differs, or, for a whole block container present
   * in one document only, the container (`sdt` or `customXml`). The redline
   * tracks that container's paragraphs, runs and table rows, but no revision
   * can wrap the container itself, so Reject All of an added one (Accept All
   * of a removed one) leaves it empty, holding one empty paragraph.
   */
  element: 'sdtPr' | 'sdtEndPr' | 'customXmlPr' | 'sdt' | 'customXml';
  /** `w:id`, `w:tag` and `w:alias` from the control's `w:sdtPr` (revised side first), when present. */
  id?: string;
  tag?: string;
  alias?: string;
  /**
   * For a whole `w:customXml` container or its `w:customXmlPr`, the
   * container's `w:element` and `w:uri` (revised side for properties), which
   * name it: a container renamed between the documents is reported as the
   * original element removed and the revised element added.
   */
  customXmlElement?: string;
  customXmlUri?: string;
}

/**
 * A picture or embedded object whose payload (image bytes, OLE binary, chart
 * part, or relationship target) changed in a way the redline does not show
 * (`picture` scope). The picture is named as the redline holds it: Reject All
 * (or Accept All) of the output resolves it to a different payload than the
 * original (or revised) document does.
 */
export interface UnrepresentedPictureChange {
  /** The story holding the picture. */
  story: 'body' | 'header' | 'footer' | 'footnote' | 'endnote';
  /** The output package part holding the picture, e.g. `word/footer1.xml`. */
  partPath: string;
  /** The projection in which the payload differs from its source document. */
  projection: 'accept' | 'reject';
  /**
   * Zero-based reading-order ordinal, in that projection, of the outermost
   * picture, object or text box holding the picture among those of its story.
   */
  index: number;
  /** The picture's own WordprocessingML container: `w:drawing`, `w:pict` or `w:object`. */
  element: 'drawing' | 'pict' | 'object';
  /** The relationship id the picture names its payload by. */
  relationshipId: string;
  /** The relationship target in the output part, when it resolves. */
  target?: string;
  /** `wp:docPr/@name`, the OLE ProgID or the VML shape id, when present. */
  name?: string;
}

/**
 * A text box whose drawing shape (size, position, wrap or other geometry of
 * its `w:drawing`, `w:pict` or `w:object` container) changed while the text
 * inside it also changed, or, in a header or footer, a shape change alone
 * (`drawing` scope). WordprocessingML has no revision markup for drawing
 * geometry, so the redline tracks the text inside the box and carries the
 * revised shape: Accept All shows the revised shape, and Reject All shows the
 * original text in the revised shape.
 */
export interface UnrepresentedDrawingChange {
  /** The story holding the drawing. */
  story: 'body' | 'header' | 'footer';
  /** The output package part holding the drawing, e.g. `word/document.xml`. */
  partPath: string;
  /**
   * Zero-based ordinal of the text box among the text boxes a reader sees in
   * that part, counting one `mc:AlternateContent` twin as one box.
   */
  index: number;
  /** The drawing's WordprocessingML container in the revised document. */
  element: 'drawing' | 'pict' | 'object';
  /** `wp:docPr/@name` or the VML shape id, when present. */
  name?: string;
}

/**
 * A table with no rows (a `w:tbl` holding no `w:tr`) present in one document
 * only (`table` scope). A table is inserted or deleted only through the
 * revision markers of its rows (ECMA-376 Part 1 §17.13.5.17, §17.13.5.12), so
 * a table with no rows has nothing to carry one, and the comparison leaves it
 * out of the redline: Accept All of an added one, or Reject All of a removed
 * one, lacks it. Only a table holding nothing but its properties and grid
 * is left out; one that holds a bookmark, comment or move range boundary is
 * refused (`emptyTable`) rather than have that range unbalanced.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @see https://github.com/UseJunior/safe-docx/issues/1400
 */
export interface UnrepresentedTableChange {
  /** The story holding the table. */
  story: 'body';
  /**
   * Zero-based document-order ordinal of the table among the `w:tbl`
   * elements of the document that holds it, nested tables included: the
   * revised document for an added table, the original for a removed one.
   * The entry's `sectionIndex` names the section of that same document.
   */
  index: number;
}

/**
 * A package-level input difference not expressed by emitted tracked-change
 * markup. Revision counts intentionally remain text-oriented.
 */
export interface UnrepresentedChange {
  scope: UnrepresentedChangeScope;
  kind: UnrepresentedChangeKind;
  /** Zero-based document-order section ordinal (the containing section for a content control). */
  sectionIndex: number;
  /** Header/footer role when scope is not `section`. */
  role?: 'default' | 'first' | 'even';
  /** The affected control when scope is `contentControl` (a changed `w:sdtPr`/`w:sdtEndPr`). */
  contentControl?: UnrepresentedContentControlChange;
  /** The affected picture or object when scope is `picture`. */
  picture?: UnrepresentedPictureChange;
  /** The affected drawing when scope is `drawing`. */
  drawing?: UnrepresentedDrawingChange;
  /** The table left out of the redline when scope is `table`. */
  table?: UnrepresentedTableChange;
}

/** @deprecated Tagged publication throws instead of falling back to reconstruction. */
export type ReconstructionFallbackReason =
  | 'round_trip_safety_check_failed'
  | 'ancillary_story_safety_check_failed';

/** @deprecated Retained for one-release compatibility with historical diagnostic types. */
export type ReconstructionSafetyCheckName =
  | 'acceptText'
  | 'rejectText'
  | 'acceptBookmarks'
  | 'rejectBookmarks'
  | 'fieldStructure';

/** @deprecated Retained for one-release compatibility with historical diagnostic types. */
export interface ReconstructionSafetyChecks {
  acceptText: boolean;
  rejectText: boolean;
  acceptBookmarks: boolean;
  rejectBookmarks: boolean;
  fieldStructure: boolean;
}

/** @deprecated Retained for one-release compatibility with historical diagnostic types. */
export interface ReconstructionTextMismatchDetails {
  expectedLength: number;
  actualLength: number;
  firstDifferingParagraphIndex: number;
  expectedParagraph: string;
  actualParagraph: string;
  differenceSample: string[];
}

/** @deprecated Retained for one-release compatibility with historical diagnostic types. */
export interface ReconstructionIdDelta {
  missing: string[];
  unexpected: string[];
}

/** @deprecated Retained for one-release compatibility with historical diagnostic types. */
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

/**
 * Where a projection's paragraph topology departs from the source projection
 * it must reproduce. A paragraph is empty when it projects no character other
 * than spaces (layout characters such as a tab or a page break count).
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1027
 */
export interface ParagraphTopologyMismatchDetails {
  expectedParagraphCount: number;
  actualParagraphCount: number;
  expectedEmptyParagraphCount: number;
  actualEmptyParagraphCount: number;
  /** First paragraph index whose presence or emptiness differs. */
  firstDifferingParagraphIndex: number;
  /** Emptiness of the expected paragraph at that index; `null` past its end. */
  expectedParagraphEmpty: boolean | null;
  /** Emptiness of the actual paragraph at that index; `null` past its end. */
  actualParagraphEmpty: boolean | null;
  /** The last non-empty expected paragraph before that index, to locate it. */
  precedingExpectedParagraph: string;
}

/** @deprecated Retained for one-release compatibility with historical diagnostic types. */
export interface ReconstructionSafetyFailureDetails {
  acceptText?: ReconstructionTextMismatchDetails;
  rejectText?: ReconstructionTextMismatchDetails;
  acceptBookmarks?: ReconstructionBookmarkMismatchDetails;
  rejectBookmarks?: ReconstructionBookmarkMismatchDetails;
  /** Set by tagged publication when `acceptParagraphTopology` fails. */
  acceptParagraphTopology?: ParagraphTopologyMismatchDetails;
  /** Set by tagged publication when `rejectParagraphTopology` fails. */
  rejectParagraphTopology?: ParagraphTopologyMismatchDetails;
}

/** @deprecated Retained for one-release compatibility with historical diagnostic types. */
export interface ReconstructionIdDeltaSummary {
  missingCount: number;
  unexpectedCount: number;
  firstMissing?: string;
  firstUnexpected?: string;
}

/** @deprecated Retained for one-release compatibility with historical diagnostic types. */
export interface ReconstructionTextMismatchSummary {
  firstDifferingParagraphIndex: number;
  expectedParagraph: string;
  actualParagraph: string;
  firstDifference: string;
}

/** @deprecated Retained for one-release compatibility with historical diagnostic types. */
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

/** @deprecated Retained for one-release compatibility with historical diagnostic types. */
export interface ReconstructionSafetyFailureSummary {
  acceptText?: ReconstructionTextMismatchSummary;
  rejectText?: ReconstructionTextMismatchSummary;
  acceptBookmarks?: ReconstructionBookmarkMismatchSummary;
  rejectBookmarks?: ReconstructionBookmarkMismatchSummary;
  acceptParagraphTopology?: ParagraphTopologyMismatchDetails;
  rejectParagraphTopology?: ParagraphTopologyMismatchDetails;
}

/** @deprecated The tagged publisher does not make reconstruction attempts. */
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

/** @deprecated The tagged publisher throws instead of falling back to reconstruction. */
export interface ReconstructionFallbackDiagnostics {
  attempts: ReconstructionAttemptDiagnostics[];
}

/**
 * Historical tagged-to-legacy fallback evidence.
 * @deprecated The tagged publisher throws instead of falling back and never returns this shape.
 */
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
  | 'acceptParagraphTopology'
  | 'rejectParagraphTopology'
  | 'formattingFidelity';

/**
 * The final gates a tagged publication must pass. Each is `true` when the
 * check passed; the failing names are listed in
 * {@link TaggedPublicationSafetyError.failedChecks}.
 */
export interface TaggedPublicationSafetyChecks extends ReconstructionSafetyChecks {
  /**
   * The Accept All projection reproduces the revised document's text. The
   * projected characters are those of `w:t`, `w:delText` and `w:sym`, plus the
   * run-content layout characters `w:tab`, `w:br` (line, page and column
   * breaks project differently), `w:cr`, `w:noBreakHyphen` and
   * `w:softHyphen`, so dropping or adding any of these fails the check.
   * Whitespace runs collapse and repeated paragraph breaks are not counted
   * (see {@link acceptParagraphTopology}). Drawings, pictures, embedded
   * objects, `w:ptab` and `w:pgNum` are outside the check.
   */
  acceptText: boolean;
  /** As {@link acceptText}, for the Reject All projection against the original. */
  rejectText: boolean;
  /**
   * The Accept All projection has the revised document's paragraph topology:
   * the same number of paragraphs, and the same paragraphs empty. Text box
   * paragraphs are outside the check, and so is one empty final paragraph
   * when the output's final body paragraph carries a mark revision this
   * projection resolves: the residue a resolved final paragraph mark leaves
   * (#891).
   */
  acceptParagraphTopology: boolean;
  /** As {@link acceptParagraphTopology}, for Reject All against the original. */
  rejectParagraphTopology: boolean;
  formattingFidelity: boolean;
}

/**
 * Historical diagnostics for the removed inplace reconstruction pipeline.
 * @deprecated The tagged publisher never returns this shape.
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
 * Historical safety evaluation for the removed rebuild pipeline.
 * @deprecated The tagged publisher never returns rebuild output.
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

/**
 * Historical wrapper for ancillary fallback issues.
 * @deprecated Successful results carry `AncillaryFieldEvidence`; failures throw `AncillaryStorySafetyError`.
 */
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
  /** The sole comparison implementation that constructed this result. */
  engine: 'tagged-tree';
  /**
   * Input differences that the emitted revision markup does not represent.
   * Absent when no supported package-level difference is detected.
   */
  unrepresentedChanges?: UnrepresentedChange[];
  /**
   * Successful structural and canonical evidence for the final assembled
   * ancillary stories. Absence means unavailable evidence, not a pass.
   */
  ancillaryFieldEvidence?: AncillaryFieldEvidence;
}
