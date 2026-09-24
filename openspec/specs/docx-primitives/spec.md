# docx-primitives Specification

## Purpose
Define behavior guarantees for the docx-primitives-ts library: deterministic text matching with fallback modes, list label extraction, semantic tag handling, OOXML layout mutations, XML round-trip fidelity, and paragraph bookmark identity.
## Requirements
### Requirement: Unique Substring Matching with Fallback Modes
The matching engine SHALL find a unique substring match in paragraph text using a prioritized chain of fallback modes: exact → quote_normalized → flexible_whitespace → quote_optional.

#### Scenario: exact match found for literal substring
- **GIVEN** paragraph text containing the needle as a literal substring exactly once
- **WHEN** `findUniqueSubstringMatch` is called
- **THEN** the result SHALL have status `unique` and mode `exact`
- **AND** `matchedText` SHALL equal the needle verbatim

#### Scenario: not_found when needle is absent
- **WHEN** `findUniqueSubstringMatch` is called with a needle not present in any fallback mode
- **THEN** the result SHALL have status `not_found`

#### Scenario: multiple when needle appears more than once
- **GIVEN** paragraph text containing the needle more than once
- **WHEN** `findUniqueSubstringMatch` is called
- **THEN** the result SHALL have status `multiple` with an accurate `matchCount`

#### Scenario: not_found for empty needle
- **WHEN** `findUniqueSubstringMatch` is called with an empty string needle
- **THEN** the result SHALL have status `not_found`

#### Scenario: quote_normalized matches curly quotes against straight quotes
- **GIVEN** paragraph text containing curly double or single quotes
- **WHEN** the needle uses straight quote equivalents and no exact match exists
- **THEN** the result SHALL have status `unique` and mode `quote_normalized`

#### Scenario: exact mode preferred over quote_normalized when both match
- **GIVEN** paragraph text that matches the needle exactly AND via quote normalization
- **WHEN** `findUniqueSubstringMatch` is called
- **THEN** the result SHALL have mode `exact`

#### Scenario: flexible_whitespace matches across spacing variance
- **GIVEN** paragraph text with extra spaces, tabs, or newlines between words
- **WHEN** the needle uses single-space equivalents and no higher-priority mode matches uniquely
- **THEN** the result SHALL have status `unique` and mode `flexible_whitespace`

#### Scenario: quote_optional matches quoted and unquoted term references
- **GIVEN** paragraph text containing quoted terms
- **WHEN** the needle omits the quotes and no higher-priority mode matches uniquely
- **THEN** the result SHALL have status `unique` and mode `quote_optional`

### Requirement: List Label Extraction and Stripping
The list label engine SHALL detect and extract structured list labels from paragraph text, supporting letter, roman, number, section, article, and numbered heading patterns.

#### Scenario: extract parenthesized letter labels
- **GIVEN** paragraph text starting with a parenthesized letter like `(a)` or `(A)`
- **WHEN** `extractListLabel` is called
- **THEN** the result SHALL have `label_type` of `LETTER` and the full label including parentheses

#### Scenario: single-char roman-like letters classified as LETTER not ROMAN
- **GIVEN** paragraph text starting with `(i)` or `(v)`
- **WHEN** `extractListLabel` is called
- **THEN** the result SHALL have `label_type` of `LETTER`

#### Scenario: extract multi-char roman numeral labels
- **GIVEN** paragraph text starting with a multi-character roman numeral like `(ii)`, `(iv)`, `(xiii)`
- **WHEN** `extractListLabel` is called
- **THEN** the result SHALL have `label_type` of `ROMAN`

#### Scenario: extract section labels with sub-paragraph support
- **GIVEN** paragraph text starting with `Section 1`, `Section 1.2`, or `Section 3.1(a)`
- **WHEN** `extractListLabel` is called
- **THEN** the result SHALL have `label_type` of `SECTION` with the full section reference
- **AND** matching SHALL be case-insensitive

#### Scenario: extract article labels with roman numeral support
- **GIVEN** paragraph text starting with `Article 1` or `Article IV`
- **WHEN** `extractListLabel` is called
- **THEN** the result SHALL have `label_type` of `ARTICLE`
- **AND** matching SHALL be case-insensitive

#### Scenario: extract numbered heading labels
- **GIVEN** paragraph text starting with `1.`, `1.1`, or `2.3.1` followed by a space
- **WHEN** `extractListLabel` is called
- **THEN** the result SHALL have `label_type` of `NUMBERED_HEADING`

#### Scenario: null label for plain text without list patterns
- **GIVEN** paragraph text without any recognized list label pattern
- **WHEN** `extractListLabel` is called
- **THEN** `label` and `label_type` SHALL be `null`

#### Scenario: stripListLabel removes label and leading whitespace
- **GIVEN** paragraph text with a recognized list label
- **WHEN** `stripListLabel` is called
- **THEN** the result SHALL contain `stripped_text` with the label and leading whitespace removed
- **AND** `result.label` SHALL contain the extracted label

### Requirement: Semantic Tag Emission and Stripping
The semantic tag engine SHALL emit/strip `<highlighting>` and `<font>` tags for formatting visibility and support `stripAllInlineTags` for removing all known inline tags.

#### Scenario: strip highlight tags leaves content intact
- **GIVEN** text containing `<highlighting>` tags
- **WHEN** `stripHighlightTags` is called
- **THEN** the tag wrappers SHALL be removed and the inner content preserved

### Requirement: OOXML Layout Mutations
The layout engine SHALL perform deterministic OOXML mutations for paragraph spacing, table row height, and table cell padding, creating missing container elements as needed.

#### Scenario: setParagraphSpacing creates missing pPr and spacing containers
- **GIVEN** a paragraph element without `w:pPr` or `w:spacing` children
- **WHEN** `setParagraphSpacing` is called with `beforeTwips`, `afterTwips`, `lineTwips`, and `lineRule`
- **THEN** the engine SHALL create `w:pPr` and `w:spacing` elements
- **AND** SHALL set the requested attributes in twip units

#### Scenario: setParagraphSpacing preserves unrelated formatting nodes
- **GIVEN** a paragraph with existing `w:pPr` children (e.g., `w:jc` for justification)
- **WHEN** `setParagraphSpacing` is called
- **THEN** existing `w:pPr` children SHALL be preserved
- **AND** a `w:spacing` element SHALL be added or updated

#### Scenario: setTableRowHeight reports missing indexes
- **WHEN** `setTableRowHeight` is called with table or row indexes that do not exist in the document
- **THEN** the result SHALL report `missingTableIndexes` and `missingRowIndexes`
- **AND** SHALL only apply mutations to existing rows

#### Scenario: setTableCellPadding creates tcPr and tcMar containers
- **GIVEN** a table cell without `w:tcPr` or `w:tcMar` children
- **WHEN** `setTableCellPadding` is called with directional padding values
- **THEN** the engine SHALL create the container elements and set padding in `dxa` units
- **AND** untargeted cells SHALL NOT be modified

### Requirement: XML Round-Trip Fidelity
The XML engine SHALL parse and serialize OOXML without data loss, preserving elements, attributes, namespaces, and text content through round-trips.

#### Scenario: parse and serialize preserves element structure
- **WHEN** valid XML is parsed and immediately serialized
- **THEN** the output SHALL contain all original elements, attributes, and text content

#### Scenario: namespaced XML preserved through round-trip
- **GIVEN** XML using OOXML namespaces (e.g., `w:document`, `w:body`)
- **WHEN** the XML is parsed and serialized
- **THEN** namespace prefixes and URIs SHALL be preserved

#### Scenario: textContent returns concatenated text of nested elements
- **GIVEN** an element containing nested child elements with text
- **WHEN** `textContent` is called
- **THEN** the result SHALL be the concatenated text content of all descendants

#### Scenario: textContent returns empty string for null or undefined input
- **WHEN** `textContent` is called with `null` or `undefined`
- **THEN** the result SHALL be an empty string

### Requirement: WML Conformance-Class Gate at Load
`DocxDocument.load` SHALL refuse a package whose main document root element is in the ISO/IEC 29500 Strict WordprocessingML namespace (`http://purl.oclc.org/ooxml/wordprocessingml/main`) by throwing `UnsupportedConformanceClassError` (code `UNSUPPORTED_CONFORMANCE_CLASS`) whose message names the conformance class. Strict consumption is out of scope; the gate exists so a Strict document is never read as empty text.

#### Scenario: [SDX-CONF-01] Loading a WML Strict package throws a typed conformance-class error
- **GIVEN** a package whose `word/document.xml` root element is in the Strict WordprocessingML namespace
- **WHEN** `DocxDocument.load` is called
- **THEN** it SHALL reject with `UnsupportedConformanceClassError`
- **AND** the error SHALL carry code `UNSUPPORTED_CONFORMANCE_CLASS`, `conformanceClass: 'strict'`, the Strict namespace URI, a message naming "WML Strict", and a hint on re-saving as Transitional

#### Scenario: [SDX-CONF-02] A Transitional control package loads and reads its body text
- **GIVEN** the same package in the Transitional namespace, including one that merely declares the Strict URI as an unused prefix
- **WHEN** it is loaded and rendered as plain text
- **THEN** loading SHALL succeed and the body text SHALL be present

### Requirement: Paragraph Bookmark Identity
The bookmark engine SHALL mint and persist stable `_bk_*` identifiers for paragraphs, ensuring unique addressability and idempotent allocation.

#### Scenario: insertParagraphBookmarks mints IDs matching expected pattern
- **WHEN** `insertParagraphBookmarks` is called on a document with paragraphs lacking bookmarks
- **THEN** each paragraph SHALL receive a `_bk_*` identifier matching the pattern `_bk_[0-9a-f]{12}`

#### Scenario: getParagraphBookmarkId retrieves minted ID
- **GIVEN** a paragraph with a previously minted `_bk_*` bookmark
- **WHEN** `getParagraphBookmarkId` is called
- **THEN** the result SHALL return the stable identifier

### Requirement: Comparator Round-Trip Semantic Invariants

The comparator SHALL enforce semantic round-trip invariants using the package read-text surface and structural diagnostics.

#### Scenario: Accept-all and reject-all preserve semantic read-text parity
- **GIVEN** a comparison output document with tracked changes
- **WHEN** `Accept All` is applied to the output
- **THEN** the read-text output SHALL match the revised input document
- **AND** when `Reject All` is applied, the read-text output SHALL match the original input document

#### Scenario: Structural diagnostics remain equivalent across round-trip projections
- **GIVEN** a comparison output document with numbering, notes, and bookmarks
- **WHEN** `Accept All` and `Reject All` projections are computed
- **THEN** numbering, footnote/endnote, and bookmark integrity diagnostics SHALL remain equivalent to the revised and original baselines respectively

### Requirement: Inplace Bookmark Safety Uses Semantic Parity

The inplace reconstruction safety gate SHALL compare bookmark semantics rather than strict bookmark ID identity.

#### Scenario: Inplace remains valid when bookmark IDs are remapped but semantics are preserved
- **GIVEN** a corpus pair where bookmark IDs may differ after reconstruction
- **WHEN** bookmark names, bookmark-reference targets, unresolved-reference sets, and start/end integrity diagnostics match
- **THEN** inplace reconstruction SHALL be accepted
- **AND** the comparator SHALL NOT downgrade to rebuild mode for bookmark-ID mismatch alone

#### Scenario: Inplace downgrades when semantic bookmark parity fails
- **GIVEN** a corpus pair where round-trip checks fail
- **WHEN** semantic bookmark parity or other round-trip safety checks do not hold
- **THEN** the comparator SHALL downgrade from inplace to rebuild mode
- **AND** the fallback reason SHALL be `round_trip_safety_check_failed`

### Requirement: Inplace Paragraph-Boundary Bookmark Preservation

When inplace reconstruction creates paragraphs for deleted or moved-source atoms, paragraph-boundary bookmark markers SHALL be preserved.

#### Scenario: Created inplace paragraphs retain bookmark boundary markers
- **GIVEN** source paragraphs that contain boundary `w:bookmarkStart` and `w:bookmarkEnd` markers
- **WHEN** inplace reconstruction emits created paragraphs for deleted or moved-source content
- **THEN** leading and trailing bookmark markers SHALL be preserved in the created output paragraphs
- **AND** bookmark start/end integrity diagnostics SHALL remain valid after reconstruction

### Requirement: Tracked Change Acceptance Engine
The docx-primitives library SHALL programmatically accept all tracked changes in OOXML document body content, resolving each revision type into its accepted state.

#### Scenario: accept insertions by unwrapping w:ins wrappers
- **GIVEN** a document body containing `w:ins` elements wrapping inserted content
- **WHEN** the acceptance engine processes the document
- **THEN** all `w:ins` wrapper elements SHALL be removed
- **AND** their child content SHALL be promoted to the parent element in place

#### Scenario: accept deletions by removing w:del elements and content
- **GIVEN** a document body containing `w:del` elements wrapping deleted content
- **WHEN** the acceptance engine processes the document
- **THEN** all `w:del` elements and their children SHALL be removed entirely

#### Scenario: accept property changes by removing change records
- **GIVEN** a document body containing property change records (`w:rPrChange`, `w:pPrChange`, `w:sectPrChange`, `w:tblPrChange`, `w:trPrChange`, `w:tcPrChange`)
- **WHEN** the acceptance engine processes the document
- **THEN** the change record elements SHALL be removed
- **AND** the current formatting properties SHALL be preserved

#### Scenario: accept moves by keeping destination and removing source
- **GIVEN** a document body containing `w:moveFrom` and `w:moveTo` pairs
- **WHEN** the acceptance engine processes the document
- **THEN** `w:moveFrom` elements and their children SHALL be removed
- **AND** `w:moveTo` wrapper elements SHALL be removed with child content promoted to the parent

#### Scenario: bottom-up processing resolves nested revisions
- **GIVEN** nested tracked changes (e.g., a `w:del` inside a `w:ins`)
- **WHEN** the acceptance engine processes the document
- **THEN** inner revisions SHALL be resolved before outer revisions
- **AND** no orphaned elements SHALL remain

#### Scenario: orphaned moves handled with safe fallback
- **GIVEN** a `w:moveFrom` without a corresponding `w:moveTo` (or vice versa)
- **WHEN** the acceptance engine processes the document
- **THEN** orphaned `w:moveFrom` SHALL be treated as `w:del` (removed)
- **AND** orphaned `w:moveTo` SHALL be treated as `w:ins` (unwrapped)

### Requirement: Run Merging with Safety Barriers
The docx-primitives library SHALL merge adjacent format-identical runs to reduce XML fragmentation, while enforcing safety barriers that prevent merges across structural boundaries.

#### Scenario: merge adjacent runs with equivalent formatting
- **GIVEN** a paragraph containing adjacent runs with identical effective run properties
- **WHEN** `merge_runs` is called
- **THEN** the adjacent runs SHALL be consolidated into a single run
- **AND** the merged run SHALL preserve the original visible text and formatting

#### Scenario: never merge across field boundaries
- **GIVEN** a paragraph containing runs separated by `fldChar` or `instrText` elements
- **WHEN** `merge_runs` is called
- **THEN** the runs SHALL NOT be merged across the field boundary
- **AND** field structure SHALL remain intact

#### Scenario: never merge across comment range boundaries
- **GIVEN** a paragraph containing runs separated by `commentRangeStart` or `commentRangeEnd` markers
- **WHEN** `merge_runs` is called
- **THEN** the runs SHALL NOT be merged across comment range boundaries

#### Scenario: never merge across bookmark boundaries
- **GIVEN** a paragraph containing runs separated by `bookmarkStart` or `bookmarkEnd` markers
- **WHEN** `merge_runs` is called
- **THEN** the runs SHALL NOT be merged across bookmark boundaries

#### Scenario: never merge across tracked-change wrapper boundaries
- **GIVEN** a paragraph containing runs inside different tracked-change wrappers (`w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`)
- **WHEN** `merge_runs` is called
- **THEN** runs in different tracked-change wrappers SHALL NOT be merged

### Requirement: Redline Simplification with Author Constraint
The docx-primitives library SHALL consolidate adjacent tracked-change wrappers of the same type and author to reduce XML verbosity, without altering document semantics.

#### Scenario: merge adjacent same-author same-type tracked-change wrappers
- **GIVEN** adjacent `w:ins` (or `w:del`) wrappers attributed to the same author
- **WHEN** `simplify_redlines` is called
- **THEN** the adjacent wrappers SHALL be consolidated into a single wrapper
- **AND** the merged wrapper SHALL preserve all child content

#### Scenario: never merge wrappers from different authors
- **GIVEN** adjacent tracked-change wrappers attributed to different authors
- **WHEN** `simplify_redlines` is called
- **THEN** the wrappers SHALL NOT be merged
- **AND** author attribution SHALL be preserved

#### Scenario: never merge across different change types
- **GIVEN** adjacent tracked-change wrappers of different types (e.g., `w:ins` followed by `w:del`)
- **WHEN** `simplify_redlines` is called
- **THEN** the wrappers SHALL NOT be merged

### Requirement: Table Context in Document View

The document view pipeline SHALL derive table structure context for each paragraph inside a body-level table. The `TableContext` type SHALL include: `table_id` (body-level index string like `_tbl_0`), `table_index` (0-based), `row_index`, `col_index` (grid-aware, accounting for `gridSpan`), `col_header` (text from header row), `total_rows`, `total_cols`, `is_header_row` (true for row index 0), `para_in_cell`, and `cell_para_count`.

Table context derivation SHALL use ancestor-based DOM walking from each paragraph to find the enclosing `w:tc`, `w:tr`, and `w:tbl` elements. Only body-level tables (direct children of `w:body`) SHALL be indexed. Paragraphs inside nested tables SHALL receive the context of their enclosing body-level table cell.

The paragraph set and ordering produced by `buildDocumentView()` SHALL remain identical to the existing `getParagraphs()` traversal. Empty table cell paragraphs SHALL be preserved (not skipped) to maintain structural completeness.

#### Scenario: [SDX-TABLE-01] Simple table produces correct table context
- **WHEN** a document contains a 2-row x 3-column table
- **THEN** each cell paragraph has `table_context` with correct `row_index`, `col_index`, `total_rows`, `total_cols`, and `is_header_row`

#### Scenario: [SDX-TABLE-02] gridSpan produces grid-aware column indices
- **WHEN** a table cell has `w:gridSpan val="2"`
- **THEN** subsequent cells in the row have `col_index` offset by the span value

#### Scenario: [SDX-TABLE-03] Tracked-change wrapped rows are included
- **WHEN** a `w:tr` element is wrapped in `w:ins`
- **THEN** paragraphs in the wrapped row receive table context with the correct `row_index`

#### Scenario: [SDX-TABLE-04] Nested table paragraphs get outer cell context
- **WHEN** a cell contains a nested `w:tbl`
- **THEN** paragraphs inside the nested table receive the context of the outer body-level table cell

#### Scenario: [SDX-TABLE-05] Empty cells are preserved
- **WHEN** a table cell contains only an empty `w:p`
- **THEN** the empty paragraph is included in document view nodes with `table_context` set

### Requirement: Table-Aware Toon Rendering

`renderToon()` SHALL emit `#TABLE` and `#END_TABLE` structural markers around table content. The `#TABLE` marker format SHALL be: `#TABLE {table_id} | {rows} rows × {cols} cols`. Column headers are NOT repeated in the marker — they appear exactly once in the `th(0,N)` data rows which carry editable `_bk_*` IDs. The `#END_TABLE` marker SHALL be emitted when leaving a table.

Table cell paragraphs SHALL use `th(row,col)` (header row) or `td(row,col)` (data rows) in the style column instead of the paragraph style.

`formatToonDataLine()` SHALL be exported as a standalone helper for per-node rendering with table-aware styles.

#### Scenario: [SDX-TABLE-06] Toon output includes table markers
- **WHEN** `renderToon()` is called with nodes containing `table_context`
- **THEN** `#TABLE` appears before the first table node and `#END_TABLE` after the last

#### Scenario: [SDX-TABLE-07] Style column uses th/td notation
- **WHEN** a node has `table_context` with `is_header_row=true`
- **THEN** the style column shows `th(row_index,col_index)` instead of the paragraph style

### Requirement: Shared DOM Helpers

`isW()` and `getDirectChildrenByName()` SHALL be exported from `dom-helpers.ts` for namespace-aware element checks and direct-child queries across primitives modules.

#### Scenario: [SDX-TABLE-08] isW checks namespace and localName
- **WHEN** `isW(el, 'tbl')` is called on a WordprocessingML element
- **THEN** it returns true only if the element has the correct namespace URI and local name

### Requirement: Evidence-backed paragraph merge formatting

Accept and Reject paragraph-mark resolution SHALL treat paragraph-break removal and surviving paragraph formatting as separately verified concerns. Changes to the formatting-selection rule SHALL be supported by a documented decision table and conformance evidence, with independent reader measurements and their limitations recorded. A paragraph SHALL NOT be deleted solely because all of its run content disappears under projection.

#### Scenario: Merge formatting differs from the existing following-mark assumption

- **GIVEN** a tracked paragraph break whose measured formatting differs from the existing following-paragraph rule
- **WHEN** a replacement rule is implemented
- **THEN** the affected content-survival cases SHALL have regression tests in core and comparison projections
- **AND** the rule SHALL NOT be generalized to unmeasured cases solely to make a reader test pass

#### Scenario: Untracked empty paragraph remains

- **GIVEN** all run content disappears under projection but the paragraph mark is not removed in that projection
- **WHEN** Accept or Reject resolves the revisions
- **THEN** the paragraph SHALL remain, including its applicable formatting

#### Scenario: Selective merge retains following pending property history

- **GIVEN** the leading formatting owner has no property history and the following paragraph carries another author's pending property revisions
- **WHEN** only the paragraph break author's revisions are accepted or rejected
- **THEN** the following author's pending property history SHALL remain unresolved on the merged paragraph
- **AND** selected property revisions SHALL resolve before merged formatting is chosen in unfiltered Reject projections

#### Scenario: Reader evidence does not establish Word behavior

- **GIVEN** a projection has been checked only in LibreOffice
- **WHEN** the repair's evidence is reported
- **THEN** Word projection behavior SHALL remain explicitly unverified
- **AND** any unresolved normative or reader conflict SHALL block a claimed general formatting correction

### Requirement: Rectangular body-level table rows are structurally editable

The docx-primitives library SHALL insert a row before or after the body-level
table row identified by an anchored paragraph and SHALL delete an identified
row. Before allocating revision IDs or mutating the DOM, it SHALL validate the
complete target table as rectangular and unmerged, with direct rows/cells,
trailing direct cell paragraphs, and no unsupported topology revisions.
Unsupported or malformed topology SHALL fail transactionally with a typed
diagnostic containing the anchor, table/row/cell coordinate, and feature.

#### Scenario: [SDX-TABLEROW-01] clean insertion uses an anchored formatting shell
- **GIVEN** an anchored paragraph in an admitted body-level table row
- **WHEN** a caller inserts a row before or after it with one text value per grid column
- **THEN** the new row SHALL occupy the requested position and contain the supplied text
- **AND** its row, cell, paragraph, and run formatting SHALL use the explicit safe-property subset defined by the design
- **AND** each new cell SHALL end in one direct `w:p` with a fresh deterministic bookmark
- **AND** the result SHALL return `{ rowIndex, cellParagraphIds }` so another insertion can target the new row
- **AND** unrelated table content SHALL remain unchanged

#### Scenario: [SDX-TABLEROW-02] inserted rows do not duplicate authored content or semantic properties
- **GIVEN** an admitted anchor row carrying bookmarks and formatting properties that the safe-shell contract excludes
- **WHEN** a row is inserted from that row's formatting shell
- **THEN** source bookmarks, fields, comments, drawings, content controls, authored blocks, and revision records SHALL not be copied
- **AND** `cnfStyle`, `tblHeader`, `hidden`, `divId`, `hideMark`, `numPr`, and section/revision properties SHALL not be copied
- **AND** the output bookmark inventory SHALL remain valid

#### Scenario: [SDX-TABLEROW-03] clean deletion preserves table and range validity
- **GIVEN** an admitted table with at least two direct rows
- **WHEN** a caller deletes the row identified by an anchored paragraph
- **THEN** exactly that row SHALL be removed while grid columns and other rows remain unchanged
- **AND** every removed paragraph anchor SHALL become unresolvable
- **AND** a range with exactly one endpoint in the removed row SHALL have its surviving endpoint removed
- **AND** deleting the final direct row SHALL fail before mutation

### Requirement: Ambiguous table topology fails closed

Row operations SHALL reject `w:gridSpan`, `w:vMerge`, `w:gridBefore`,
`w:gridAfter`, nested tables, `w:tblPrEx`, wrapped row/cell containers,
heterogeneous direct occupancy, missing trailing cell paragraphs, and topology
revision records. Ordinary content revisions and row-level markers SHALL remain
admissible; phase one SHALL reject tracked deletion of a row already marked
inserted or deleted. Failed tracked operations SHALL leave both serialized XML
and `ctx.idState.nextId` unchanged.

#### Scenario: [SDX-TABLEROW-07] merge, wrapper, and nested-table guards are table-wide
- **GIVEN** a target table containing a span, vertical merge, row offset, nested table, `w:tblPrEx`, or wrapped row/cell anywhere
- **WHEN** insertion or deletion is requested against any row in that table
- **THEN** the operation SHALL fail before mutation
- **AND** `SafeDocxError` code SHALL be `UNSUPPORTED_EDIT`
- **AND** its detail SHALL identify the unsupported feature and row/cell or child coordinate

#### Scenario: [SDX-TABLEROW-08] malformed and topology-revised tables are transactional
- **GIVEN** heterogeneous occupancy, a cell not ending in a direct paragraph, a topology revision, an invalid value count, or final-row deletion
- **WHEN** insertion or deletion is requested
- **THEN** the operation SHALL fail without changing serialized document XML
- **AND** the error SHALL distinguish `UNSUPPORTED_EDIT` topology from `INVALID_ARGUMENT` input
- **AND** `ctx.idState.nextId` SHALL be unchanged

### Requirement: Row-Level Revision Resolution

Accept and reject SHALL resolve row-level revision markers (`w:tr > w:trPr >
w:ins|w:del`) wherever the engine runs, including body, side-story, and nested
tables. A selected marker removes or retains its enclosing row according to
ECMA-376 5th edition Part 1 §§17.13.5.17 and 17.13.5.12, rather than being
treated as an empty content wrapper. Content inside a removed row disappears
with that row even when it carries an unselected revision; those inner records
SHALL not be reported as separately resolved. Foreign row markers SHALL remain
untouched, including through sibling `w:trPrChange` restoration. Removing the
final physical row SHALL remove its now-empty `w:tbl` container.

Tracked row mutation SHALL also mark paragraph marks and run contents under
§§17.13.5.20/17.13.5.18 and §§17.13.5.15/17.13.5.14 respectively. Projection
checks SHALL compare reject-all output with reject-all source and accept-all
output with accept-all clean output, so pre-existing content revisions remain
composable. `unresolvedRowRevisions` remains required for result-shape
compatibility and SHALL be `0`; the field no longer represents any admitted
row-marker class.

#### Scenario: [SDX-TABLEROW-04] tracked insertion has inverse projections
- **GIVEN** an admitted source table and a requested row insertion
- **WHEN** tracked output is produced with row, paragraph-mark, and run-content insertion records
- **THEN** accept-all SHALL keep the inserted row and remove its revision records
- **AND** reject-all SHALL remove the inserted row
- **AND** reject-all SHALL equal reject-all of the source
- **AND** accept-all SHALL equal accept-all of the clean insertion

#### Scenario: [SDX-TABLEROW-05] tracked deletion has inverse projections and valid ranges
- **GIVEN** an admitted source table with at least two rows and a requested row deletion
- **WHEN** tracked output is produced with row, paragraph-mark, and run-content deletion records
- **THEN** accept-all SHALL remove the row and repair any cross-row range whose other endpoint would be orphaned
- **AND** reject-all SHALL keep the row and remove its revision records
- **AND** reject-all SHALL equal reject-all of the source
- **AND** accept-all SHALL equal accept-all of the clean deletion

#### Scenario: [SDX-TABLEROW-06] selective row resolution is explicit and honest
- **GIVEN** row markers in any story processed by the engine, with inner content revisions and a foreign row marker
- **WHEN** accept or reject runs with a filter selecting one row marker
- **THEN** the selected marker SHALL apply its whole-row semantic even if the row contains unselected content revisions
- **AND** the foreign row marker and row SHALL remain byte-for-byte unchanged
- **AND** surviving row markers SHALL remain intact through `w:trPrChange` restoration
- **AND** `unresolvedRowRevisions` SHALL be `0` for the supported selected marker

