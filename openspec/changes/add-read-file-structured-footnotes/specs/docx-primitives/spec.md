## ADDED Requirements

### Requirement: Structured Footnote Model with Run-Level Fidelity

The footnote reader SHALL return each user footnote body with its
paragraph-node structure and run-level formatting retained at the same fidelity
as document-body paragraphs. The `Footnote` type SHALL expose a `paragraphs`
array — one entry per `<w:p>` in the footnote body — where each entry carries
the flattened `text`, an inline-tagged rendering (`tagged_text`) that preserves
run-level bold/italic/underline/highlight/color/font, and the paragraph
`w:pStyle` id. The reader SHALL also expose `refParagraphIds`, the ordered,
deduplicated list of every body paragraph that references the footnote. The
legacy fields `text` (a `\n`-joined flattening of the paragraph bodies),
`displayNumber`, and `anchoredParagraphId` (the first referencing paragraph, or
null) SHALL remain unchanged so existing consumers keep working.

#### Scenario: Multi-paragraph footnote body preserved

- **WHEN** a footnote body contains multiple `<w:p>` paragraphs
- **THEN** `paragraphs` SHALL contain one entry per paragraph in document order
- **AND** the flattened `text` SHALL equal the paragraph texts joined by `\n`

#### Scenario: Footnote-internal run formatting preserved

- **GIVEN** a footnote paragraph mixing plain, bold, and italic runs
- **WHEN** the footnote is read
- **THEN** the paragraph's `tagged_text` SHALL wrap the bold run in `<b>` and the italic run in `<i>`

#### Scenario: Reference paragraph ids are an array

- **WHEN** a footnote is referenced from a body paragraph
- **THEN** `refParagraphIds` SHALL be an array containing that paragraph's bookmark id
- **AND** when a malformed document references one footnote id from multiple paragraphs, `refParagraphIds` SHALL contain each distinct referencing paragraph id

#### Scenario: Zero user footnotes yields empty result

- **WHEN** a document has no user footnotes (only reserved separator entries, or no footnotes part)
- **THEN** the reader SHALL return an empty array
