## ADDED Requirements

### Requirement: Footnote Part Bootstrapping
The system SHALL create `word/footnotes.xml` with reserved separator entries when missing from a DOCX archive. Bootstrapping SHALL be idempotent, update `[Content_Types].xml` and `word/_rels/document.xml.rels`, and preserve existing reserved entries.

#### Scenario: bootstrap creates footnotes.xml when missing
- **GIVEN** a DOCX archive without `word/footnotes.xml`
- **WHEN** `bootstrapFootnoteParts` is called
- **THEN** `word/footnotes.xml` SHALL be created with reserved separator and continuationSeparator entries
- **AND** `[Content_Types].xml` SHALL include the footnotes content type override
- **AND** `word/_rels/document.xml.rels` SHALL include the footnotes relationship

#### Scenario: bootstrap is idempotent
- **GIVEN** a DOCX archive that already has `word/footnotes.xml`
- **WHEN** `bootstrapFootnoteParts` is called
- **THEN** no parts SHALL be created
- **AND** the existing footnotes.xml SHALL be unchanged

#### Scenario: bootstrap preserves existing reserved entries
- **GIVEN** a DOCX archive with footnotes.xml containing reserved entries with real IDs -1/0
- **WHEN** `bootstrapFootnoteParts` is called
- **THEN** the reserved entries SHALL be preserved unchanged

### Requirement: Footnote Reading
The system SHALL parse footnotes from `word/footnotes.xml`, compute display numbers from document order, resolve anchored paragraph IDs, and handle both dedicated and mixed-run reference patterns.

#### Scenario: read footnotes from document with multiple footnotes
- **GIVEN** a DOCX with 3 user footnotes in footnotes.xml
- **WHEN** `getFootnotes` is called
- **THEN** 3 footnotes SHALL be returned with correct text, IDs, and sequential display numbers

#### Scenario: display numbers follow document order
- **GIVEN** a DOCX with footnote references in document.xml in a specific order
- **WHEN** `getFootnotes` is called
- **THEN** display numbers SHALL be assigned sequentially (1, 2, 3...) based on reference order in document.xml

#### Scenario: read from empty document returns empty array
- **GIVEN** a DOCX without footnotes.xml
- **WHEN** `getFootnotes` is called
- **THEN** an empty array SHALL be returned

#### Scenario: anchored paragraph IDs resolved
- **GIVEN** a DOCX with footnote references inside bookmarked paragraphs
- **WHEN** `getFootnotes` is called
- **THEN** each footnote SHALL include the `anchoredParagraphId` of its containing paragraph

#### Scenario: mixed-run references handled
- **GIVEN** a DOCX with `w:footnoteReference` inside a run that also contains text
- **WHEN** `getFootnotes` is called
- **THEN** the footnote SHALL be correctly read

### Requirement: Footnote Insertion
The system SHALL insert footnote references in document.xml and create Word-compatible footnote body entries in footnotes.xml.

#### Scenario: add footnote at end of paragraph
- **GIVEN** a paragraph element with no `after_text` specified
- **WHEN** `addFootnote` is called
- **THEN** a `w:footnoteReference` run SHALL be appended at the end of the paragraph
- **AND** a footnote body with `<w:footnoteRef/>` run SHALL be added to footnotes.xml

#### Scenario: add footnote after specific text with mid-run split
- **GIVEN** a paragraph containing "Hello World" in a single run
- **WHEN** `addFootnote` is called with `afterText: "Hello"`
- **THEN** the run SHALL be split at the boundary
- **AND** the `w:footnoteReference` run SHALL be inserted between "Hello" and " World"

#### Scenario: ID allocation skips reserved entries by type
- **GIVEN** a DOCX with reserved footnotes (type=separator, type=continuationSeparator)
- **WHEN** `addFootnote` is called
- **THEN** the allocated ID SHALL be max(existing IDs) + 1

#### Scenario: footnote body includes Word-compatible skeleton
- **WHEN** `addFootnote` creates a new footnote
- **THEN** the footnote body SHALL include FootnoteText paragraph style, FootnoteReference run style, and `<w:footnoteRef/>` element

### Requirement: Footnote Text Update
The system SHALL update footnote text content while preserving the `<w:footnoteRef/>` run and other footnotes.

#### Scenario: update changes text content
- **GIVEN** a footnote with ID N and text "old text"
- **WHEN** `updateFootnoteText` is called with newText "new text"
- **THEN** the footnote text SHALL be "new text"
- **AND** the `<w:footnoteRef/>` run SHALL be preserved

#### Scenario: update preserves other footnotes
- **GIVEN** a document with footnotes A and B
- **WHEN** `updateFootnoteText` is called for footnote A
- **THEN** footnote B SHALL be unchanged

### Requirement: Footnote Deletion
The system SHALL remove footnote entries from footnotes.xml and footnote reference elements from document.xml.

#### Scenario: delete removes footnoteReference from mixed run without losing text
- **GIVEN** a run containing text and a `w:footnoteReference` element
- **WHEN** `deleteFootnote` is called for that footnote
- **THEN** only the `w:footnoteReference` element SHALL be removed
- **AND** the run text SHALL be preserved

#### Scenario: delete removes dedicated reference run
- **GIVEN** a run containing only a `w:footnoteReference` element
- **WHEN** `deleteFootnote` is called
- **THEN** the entire run SHALL be removed

#### Scenario: delete refuses reserved type entries
- **GIVEN** a footnote with `w:type="separator"`
- **WHEN** `deleteFootnote` is called for that footnote
- **THEN** an error SHALL be thrown

### Requirement: Footnote Round-Trip Fidelity
The system SHALL preserve footnote data through serialize-reload cycles and coexist with comments and hyperlinks.

#### Scenario: round-trip preserves footnotes
- **GIVEN** a document with footnotes, comments, and hyperlinks
- **WHEN** the document is serialized and reloaded
- **THEN** all footnotes SHALL be readable with correct text and display numbers
