## ADDED Requirements

### Requirement: Footnotes in generated documents

`generateDocx` SHALL accept a `{ kind: 'footnote', blocks: ParagraphSpec[] }`
inline in the body story, table cells included, and emit it as a numbered
footnote. The reference SHALL be a `w:footnoteReference` run, and the note SHALL
be a `w:footnote` in `word/footnotes.xml`. A spec without footnotes SHALL
compile to the same bytes as before.

#### Scenario: [SDX-GEN-118] footnote inlines emit numbered references and FootnoteText note bodies
- **GIVEN** a body paragraph with a plain one-paragraph footnote, a paragraph with a two-paragraph footnote whose runs are bold, italic and underlined, and a table cell with a footnote
- **WHEN** the document is generated
- **THEN** each reference SHALL be a run carrying `w:rStyle` `FootnoteReference`, `w:vertAlign` `superscript` and `w:footnoteReference`, with ids 1, 2 and 3 in document order, in place among the paragraph's other runs
- **AND** each note SHALL be a `w:footnote` with the same id whose first paragraph opens with a `FootnoteReference` run holding `w:footnoteRef` and then a single-space run
- **AND** every note paragraph without a `styleId` SHALL carry `w:pStyle` `FootnoteText`, and note runs SHALL keep their formatting
- **AND** a declared `styleId` or list numbering on a note paragraph SHALL be kept
- **AND** the package SHALL pass the structural check, regenerate byte for byte, and its document, footnotes, styles and settings parts SHALL validate against the transitional WML schema

#### Scenario: [SDX-GEN-119] the footnotes part, settings and styles are added only when a footnote is used
- **GIVEN** a spec with footnotes and a spec without
- **WHEN** each is generated
- **THEN** the first SHALL register `word/footnotes.xml` with the footnotes content type and a footnotes relationship from the document part
- **AND** the part SHALL open with the separator note (id -1) and the continuation-separator note (id 0)
- **AND** `word/settings.xml` SHALL list both in `w:footnotePr`, before `w:compat`
- **AND** `word/styles.xml` SHALL define Word's built-in `FootnoteText` paragraph style (10 pt, single-spaced, no space after) and `FootnoteReference` character style (superscript), except where the spec declares a style with the same id
- **AND** the spec without footnotes SHALL produce no footnotes part, relationship, `w:footnotePr` or footnote styles

#### Scenario: [SDX-GEN-120] invalid footnote specs are rejected before emission
- **GIVEN** footnotes that are empty, nested in another footnote, hold a non-paragraph block, set `pageBreakBefore`, hold a page break or a drafting note, name an undeclared style, or sit in a header or footer, and declared `FootnoteText` or `FootnoteReference` styles of the wrong type
- **WHEN** each is generated
- **THEN** generation SHALL fail with a `GenerationSpecError` whose path names the offending node
- **AND** `FootnoteText` and `FootnoteReference` SHALL resolve as paragraph style ids only in a document that uses footnotes

#### Scenario: [SDX-GEN-121] generated footnotes read back through getFootnotes and accept add_footnote
- **GIVEN** a generated document with three footnotes
- **WHEN** it is loaded for editing
- **THEN** `getFootnotes` SHALL return each note with its id, display number, paragraph text, `FootnoteText` style, formatting and reference offset
- **AND** a footnote added with `add_footnote` SHALL take the next free id, and after saving the notes SHALL be numbered by document order
- **AND** every paragraph of a multi-paragraph note added with `add_footnote` SHALL carry `FootnoteText`
