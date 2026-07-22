# docx-generation Specification

## Purpose
TBD - created by archiving change add-docx-generation. Update Purpose after archive.
## Requirements
### Requirement: Declarative document specification

The library SHALL provide a `generateDocx(spec)` entry point that compiles a plain-data,
JSON-serializable `DocumentSpec` (sections → blocks → inline runs, with document-level
styles and numbering definitions) into a complete DOCX package in one pass. Spec features
whose emitters are not implemented SHALL be rejected with a typed error, never silently
ignored.

#### Scenario: [SDX-GEN-001] a minimal spec compiles to a loadable document
- **GIVEN** a `DocumentSpec` with one section containing one paragraph of plain text
- **WHEN** `generateDocx(spec)` is called
- **THEN** the returned buffer SHALL load via `DocxDocument.load` with the paragraph text intact
- **AND** `validateDocument()` SHALL report zero warnings

#### Scenario: [SDX-GEN-002] the spec is plain JSON-serializable data
- **GIVEN** any valid `DocumentSpec`
- **WHEN** the spec is round-tripped through `JSON.parse(JSON.stringify(spec))` and compiled
- **THEN** the output SHALL be byte-identical to compiling the original spec

#### Scenario: [SDX-GEN-003] unimplemented spec features are rejected loudly
- **GIVEN** a `DocumentSpec` using a spec feature without a shipped emitter — a declared feature whose phase has not landed yet, or an unrecognized block/inline kind arriving from a JSON caller
- **WHEN** `generateDocx(spec)` is called
- **THEN** compilation SHALL fail with a typed error naming the unsupported feature and its path in the spec

#### Scenario: [SDX-GEN-004] dangling references are rejected before emission
- **GIVEN** a paragraph referencing a `styleId` or `numId` absent from the document-level definitions
- **WHEN** `generateDocx(spec)` is called
- **THEN** compilation SHALL fail with a typed error identifying the dangling reference and its path

### Requirement: Package structural integrity

Generated packages SHALL satisfy the structural invariants that reading applications
require to open a document without repair or recovery dialogs: complete content-type
coverage, a closed relationship graph, well-formed parts, and exactly one body-level
`sectPr` positioned last.

#### Scenario: [SDX-GEN-010] the package relationship graph is closed
- **GIVEN** any generated package
- **WHEN** its parts and relationships are enumerated
- **THEN** every relationship target (resolved relative to the owning part, excluding `TargetMode="External"`) SHALL exist in the package
- **AND** every part SHALL be covered by a content-type Default or Override
- **AND** every `r:id` referenced in any part SHALL resolve in that part's relationships

#### Scenario: [SDX-GEN-011] every XML part carries an XML declaration
- **GIVEN** any generated package
- **WHEN** each XML part's bytes are inspected
- **THEN** every part SHALL begin with an `<?xml` declaration

#### Scenario: [SDX-GEN-012] exactly one body-level sectPr, positioned last
- **GIVEN** any generated package
- **WHEN** `word/document.xml` is parsed
- **THEN** the body SHALL contain exactly one body-level `w:sectPr` as its last child

#### Scenario: [SDX-GEN-013] generation is deterministic
- **GIVEN** any valid `DocumentSpec`
- **WHEN** it is compiled twice
- **THEN** the two buffers SHALL be byte-identical (no wall-clock or random inputs)

### Requirement: Sections, page setup, and headers/footers

The compiler SHALL emit per-section page size, margins, page-numbering properties, and
section breaks per ECMA-376 sectPr semantics, and SHALL wire distinct header/footer parts
(default, first-page, even-page) through relationships and content-type overrides so a
cover page can carry different furniture than the body.

#### Scenario: [SDX-GEN-020] page size and margins are emitted in the section properties
- **GIVEN** a section specifying page size and margins in twips
- **WHEN** the document is generated
- **THEN** the section's `w:sectPr` SHALL carry matching `w:pgSz` and `w:pgMar` values

#### Scenario: [SDX-GEN-021] non-final sections end with a dedicated break paragraph
- **GIVEN** a spec with two sections
- **WHEN** the document is generated
- **THEN** the first section SHALL end with a paragraph whose `w:pPr` contains only that section's `w:sectPr`
- **AND** the final section's `w:sectPr` SHALL remain the body's last child

#### Scenario: [SDX-GEN-022] a distinct cover-page header uses the title-page switch
- **GIVEN** a section with a `first` header differing from its `default` header
- **WHEN** the document is generated
- **THEN** the `w:sectPr` SHALL contain `w:titlePg` and both `w:headerReference` entries with type `first` and `default`

#### Scenario: [SDX-GEN-023] header and footer parts are fully wired
- **GIVEN** a section declaring any header or footer
- **WHEN** the document is generated
- **THEN** each declared header/footer SHALL exist as its own part with a content-type override
- **AND** SHALL be referenced from the section via an `r:id` that resolves in the document's relationships

#### Scenario: [SDX-GEN-024] page numbering format and start are honored
- **GIVEN** a section specifying a page-number format and start value
- **WHEN** the document is generated
- **THEN** the section's `w:sectPr` SHALL carry a matching `w:pgNumType`

### Requirement: Field codes with cached results

PAGE and NUMPAGES fields SHALL be emitted as complete five-part field runs — begin,
instruction text, separate, cached result, end — with the cached result required by the
spec type, so reading applications display correct values without recomputation prompts.

#### Scenario: [SDX-GEN-030] a PAGE field is structurally complete
- **GIVEN** a footer paragraph containing a PAGE field with cached result "1"
- **WHEN** the document is generated
- **THEN** the footer SHALL contain, in order: `fldChar begin`, `w:instrText` with the PAGE instruction and preserved spacing, `fldChar separate`, a run whose text is "1", and `fldChar end`

#### Scenario: [SDX-GEN-031] a NUMPAGES field carries its cached result
- **GIVEN** a footer containing "Page X of Y" composed of PAGE and NUMPAGES fields with cached results
- **WHEN** the document is generated
- **THEN** both fields SHALL be complete five-part sequences whose cached result runs render the cached text

#### Scenario: [SDX-GEN-032] field pairing holds in every story part
- **GIVEN** any generated package containing fields in body, headers, or footers
- **WHEN** each story part is scanned
- **THEN** every `fldChar begin` SHALL have matching `separate` and `end` markers in the same part with instruction text only between begin and separate

### Requirement: Named styles and run formatting

The compiler SHALL emit a `styles.xml` part containing document defaults, a Normal style,
and every declared named style. It SHALL emit each supported direct run property (bold,
italic, underline, color, font, size) at most once and SHALL emit paragraph properties
(alignment, spacing, indentation, tabs) in the child order required by the WML schema.

#### Scenario: [SDX-GEN-040] declared styles are emitted into the style table
- **GIVEN** a spec declaring a named paragraph style based on Normal
- **WHEN** the document is generated
- **THEN** `word/styles.xml` SHALL contain document defaults, Normal, and the declared style with its `basedOn` link
- **AND** paragraphs referencing the style SHALL carry the matching `w:pStyle`

#### Scenario: [SDX-GEN-041] run properties are emitted at most once
- **GIVEN** a run specifying bold, italic, underline, color, font, and size
- **WHEN** the document is generated
- **THEN** each supported direct property SHALL occur at most once under the run's `w:rPr`
- **AND** the formatting SHALL survive a round-trip through the run-formatting reader

#### Scenario: [SDX-GEN-042] paragraph properties are emitted in schema order
- **GIVEN** a paragraph specifying alignment, spacing, indentation, and tab stops
- **WHEN** the document is generated
- **THEN** the paragraph's `w:pPr` children SHALL appear in the WML schema sequence

#### Scenario: [SDX-GEN-043] property constraints match the vendored schema
- **GIVEN** the emitter's ordered property tables
- **WHEN** they are compared against the vendored transitional WML schema
- **THEN** each table's relative order SHALL match the schema's declared sequence

### Requirement: Tables

The compiler SHALL emit tables with fixed layout, explicit column widths, table- and
cell-level borders, shading, vertical alignment, cell margins, and merged cells, while
preserving the structural invariants readers require (grid arithmetic, trailing paragraph
in every cell, no table as the body's final block).

#### Scenario: [SDX-GEN-050] a fixed-layout table carries its grid
- **GIVEN** a table specifying fixed layout and explicit column widths
- **WHEN** the document is generated
- **THEN** the table SHALL carry `w:tblLayout` fixed, a `w:tblGrid` matching the widths, and a `w:tblW` consistent with their sum

#### Scenario: [SDX-GEN-051] cell decoration is emitted
- **GIVEN** cells specifying borders, shading, vertical alignment, and margins
- **WHEN** the document is generated
- **THEN** each cell's `w:tcPr` SHALL carry the matching `w:tcBorders`, `w:shd`, `w:vAlign`, and `w:tcMar` in schema order

#### Scenario: [SDX-GEN-052] merged cells keep the grid arithmetic consistent
- **GIVEN** rows using `gridSpan` and vertical merges
- **WHEN** the spec is validated and the document generated
- **THEN** any row whose effective column count diverges from the grid SHALL be rejected at validation
- **AND** emitted rows SHALL carry the matching `w:gridSpan` and `w:vMerge` markers

#### Scenario: [SDX-GEN-053] table structural invariants hold
- **GIVEN** any generated package containing tables
- **WHEN** the body and cells are inspected
- **THEN** every cell SHALL end with a `w:p`
- **AND** the body SHALL NOT end with a table

### Requirement: Multi-level numbering

The compiler SHALL emit a `numbering.xml` part from declared numbering definitions and wire
list paragraphs through `w:numPr`, producing labels that match the read-side list-label
computation.

#### Scenario: [SDX-GEN-060] numbering definitions are emitted
- **GIVEN** a spec declaring a multi-level numbering definition
- **WHEN** the document is generated
- **THEN** `word/numbering.xml` SHALL contain a matching abstract definition and instance
- **AND** list paragraphs SHALL reference it via `w:numPr` with the declared level

#### Scenario: [SDX-GEN-061] generated labels match the read-side computation
- **GIVEN** a generated document with nested numbered lists
- **WHEN** the read-side list-label computation runs over the loaded document
- **THEN** the computed labels SHALL match the labels implied by the spec's numbering definition

#### Scenario: [SDX-GEN-062] bullet and ordinal formats are both supported
- **GIVEN** numbering definitions using bullet, decimal, and roman formats across levels
- **WHEN** the document is generated
- **THEN** each level SHALL carry the declared `w:numFmt` and level text

### Requirement: Separable drafting-note layer

Drafting notes SHALL be emitted as OOXML comments anchored beside content, such that the
layer is separable both at compile time and after the fact, and the body text layer is
identical with and without the layer.

#### Scenario: [SDX-GEN-080] a drafting note becomes an anchored comment
- **GIVEN** a paragraph carrying a drafting note
- **WHEN** the document is generated with notes enabled
- **THEN** the package SHALL contain a comments part and the paragraph SHALL carry comment range anchors and a comment reference

#### Scenario: [SDX-GEN-081] compile-time omission leaves the body identical
- **GIVEN** the same spec compiled with notes enabled and disabled
- **WHEN** the two outputs' body text layers are extracted
- **THEN** they SHALL be identical
- **AND** the disabled output SHALL contain no comment parts or anchors

#### Scenario: [SDX-GEN-082] notes can be stripped after generation
- **GIVEN** a generated document with drafting notes
- **WHEN** each comment is deleted through the existing comment-deletion path
- **THEN** the result SHALL contain no comment parts, anchors, or references and SHALL still pass structural validation

#### Scenario: [SDX-GEN-083] comment metadata is deterministic
- **GIVEN** a spec with drafting notes carrying explicit ISO dates
- **WHEN** it is compiled twice
- **THEN** the outputs SHALL be byte-identical, with comment ids and dates derived only from the spec and compile context

### Requirement: Cross-reader compatibility evidence

Generated documents SHALL be exercised against LibreOffice (load→save identity and PDF
conversion) where available, and a recorded manual compatibility matrix SHALL track
Word for Mac, Pages, and Google Docs observations for every published artifact class.

#### Scenario: [SDX-GEN-090] LibreOffice identity round-trip succeeds
- **GIVEN** a generated full-package document and a local LibreOffice installation
- **WHEN** the document is loaded and re-saved headlessly
- **THEN** the re-saved package SHALL load successfully with paragraph content and header/footer references preserved

#### Scenario: [SDX-GEN-091] headless PDF conversion succeeds
- **GIVEN** a generated document and a local LibreOffice installation
- **WHEN** the document is converted to PDF headlessly
- **THEN** the conversion SHALL produce a non-empty PDF

#### Scenario: [SDX-GEN-092] the manual compatibility matrix tracks every artifact class
- **GIVEN** the set of generated review artifacts
- **WHEN** the manual compatibility checklist is checked against the artifact set
- **THEN** every artifact class SHALL have a row covering Word for Mac, Pages, Google Docs, and LibreOffice observations
