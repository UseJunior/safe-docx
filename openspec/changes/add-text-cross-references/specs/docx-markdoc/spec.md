## ADDED Requirements

### Requirement: Text cross-references in created documents

The creation grammar SHALL admit `show="number" | "text"` on `{% xref /%}`.
`show="number"` is the default. `{% xref to="id" show="text" /%}` SHALL
become a REF field with no number switch, showing the text of the heading or
list item marked `{% #id %}`, numbered or not: its text without its number
and without footnote reference marks, with the target's own formatting.
`show="text"` SHALL take neither `number` nor `format`, and SHALL not sit
inside bold, italic or underline. `docx-markdoc create` SHALL verify each
text reference against text the oracle reads from the source.

#### Scenario: [SDX-MDOC-XREFTEXT-01] show="text" cross-references show the target text without its number or footnote marks
- **GIVEN** a source with `heading-numbers: legal` and text references, in the body, a table cell and a footnote, to an Article, a Section holding a footnote reference and a fill, a clause holding an italic word, and a bullet item, beside number references
- **WHEN** the source is created
- **THEN** each text reference SHALL be a ` REF <name> \h ` field that reads back as its target's text, without "ARTICLE I", "Section 1.01" or a list label, and without footnote marks, and a fill SHALL keep its brackets
- **AND** its cached result SHALL keep the target's run formatting (the italic word, the highlighted fill)
- **AND** the certificate SHALL pass, with a cross-reference check that counts 8 text references and detects every negative control, the text-extent control included

#### Scenario: [SDX-MDOC-XREFTEXT-02] malformed text cross-references fail closed with a code and a line
- **GIVEN** sources with `show="page"`, `show="text"` with `number` or `format`, a text reference inside bold, italic or `{% u %}`, a text reference to an unknown id, and text targets holding an xref or a line break
- **WHEN** each is created
- **THEN** creation SHALL fail with `INVALID_CROSS_REFERENCE`, `XREF_UNKNOWN_ID` or `XREF_TEXT_TARGET_UNSUPPORTED` and the line of the reference
- **AND** a text reference to an unnumbered heading or a bullet item SHALL be created, while a number reference to one still fails with `XREF_TARGET_NOT_NUMBERED`

#### Scenario: [SDX-MDOC-XREFTEXT-03] verification checks each text cross-reference's instruction, target and bookmarked text
- **GIVEN** lowerings that point a text reference at another heading, turn it into a number reference, or point it at a heading with the same text
- **WHEN** each is verified
- **THEN** a reference retargeted to a different text SHALL pass the read-back check but fail the round trip, which reads the target's text from the source
- **AND** each SHALL fail the cross-reference check on its instruction, although a same-text twin leaves every paragraph's text unchanged
- **AND** with only same-text targets the retargeting control SHALL be not applicable, while the text-extent control, which shortens a bookmark by one character, SHALL be detected

#### Scenario: [SDX-MDOC-XREFTEXT-04] the CLI summary counts text cross-references
- **GIVEN** sources with number and text references, with number references only, and with a single text reference
- **WHEN** each is created through the CLI
- **THEN** the summary SHALL read `cross-references ok (12 references: 4 number, 8 text; negative controls ok)` for the first
- **AND** a source with number references only SHALL keep the summary it had before, without a text-extent control

#### Scenario: [SDX-MDOC-XREFTEXT-05] text cross-references import as their text and the PDF checks expect the same text
- **GIVEN** a created document with text references
- **WHEN** it is imported, and its PDF expectations are projected for LibreOffice
- **THEN** each text reference SHALL import as its text
- **AND** the LibreOffice projection SHALL expect the same text as Word's, adding a period after a leading number only for full-context number references

#### Scenario: [SDX-MDOC-XREFTEXT-06] a real LibreOffice PDF of text cross-references passes the PDF checks
- **GIVEN** the source of SDX-MDOC-XREFTEXT-01
- **WHEN** it is created with `--require-pdf`
- **THEN** the PDF SHALL render and pass the word check
