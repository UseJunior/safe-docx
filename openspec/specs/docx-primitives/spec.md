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
The semantic tag engine SHALL detect explicit definition patterns in text and emit/strip `<definition>` and `<highlighting>` tags for role-model-based formatting.

#### Scenario: emit definition tags for quoted term before definition verb
- **GIVEN** text containing a quoted term followed by a definition verb (`means`, `shall mean`, `is defined as`, `refers to`, `has the meaning`, `shall have the meaning`)
- **WHEN** `emitDefinitionTagsFromString` is called
- **THEN** the term SHALL be wrapped in `<definition>` tags with quotes removed
- **AND** the definition verb and surrounding text SHALL be unchanged

#### Scenario: emit definition tags for smart/curly quotes
- **GIVEN** text containing curly double or single quotes around a term before a definition verb
- **WHEN** `emitDefinitionTagsFromString` is called
- **THEN** the term SHALL be wrapped in `<definition>` tags with curly quotes removed

#### Scenario: no tags emitted for text without definitions
- **GIVEN** text without any recognized definition pattern
- **WHEN** `emitDefinitionTagsFromString` is called
- **THEN** the text SHALL be returned unchanged

#### Scenario: strip definition tags replaces with quotes
- **GIVEN** text containing `<definition>Term</definition>`
- **WHEN** `stripDefinitionTags` is called
- **THEN** the tag SHALL be replaced with `"Term"` (straight double quotes)

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

### Requirement: Paragraph Bookmark Identity
The bookmark engine SHALL mint and persist stable `jr_para_*` identifiers for paragraphs, ensuring unique addressability and idempotent allocation.

#### Scenario: insertParagraphBookmarks mints IDs matching expected pattern
- **WHEN** `insertParagraphBookmarks` is called on a document with paragraphs lacking bookmarks
- **THEN** each paragraph SHALL receive a `jr_para_*` identifier matching the pattern `jr_para_[0-9a-f]{12}`

#### Scenario: getParagraphBookmarkId retrieves minted ID
- **GIVEN** a paragraph with a previously minted `jr_para_*` bookmark
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

### Requirement: Docx Primitives Package Migrates with Canonical Naming
The repository SHALL provide a `docx-primitives` package in `packages/docx-primitives` published as `@usejunior/docx-primitives`.

#### Scenario: canonical package identity is declared
- **WHEN** `packages/docx-primitives/package.json` is evaluated
- **THEN** the package name is `@usejunior/docx-primitives`
- **AND** licensing remains MIT

#### Scenario: canonical OpenSpec capability is present
- **WHEN** destination OpenSpec specs are listed
- **THEN** a canonical `docx-primitives` capability spec is present

