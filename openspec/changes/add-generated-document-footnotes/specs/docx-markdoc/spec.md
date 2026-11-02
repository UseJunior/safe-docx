## ADDED Requirements

### Requirement: Footnotes in created documents

The creation grammar SHALL admit an inline `{% fnref id="…" /%}` footnote
reference and a top-level `{% footnote id="…" %}…{% /footnote %}` block holding
the note's text. The id SHALL only pair a reference with its body; notes SHALL
be numbered by reference order. `docx-markdoc create` SHALL verify footnotes in
its read-back, round-trip and PDF checks.

#### Scenario: [SDX-MDOC-FOOTNOTE-01] a reference tag and a footnote block create a numbered footnote
- **GIVEN** references in a body paragraph, a list item and a table cell, with a two-paragraph note holding bold, underlined and italic text and a one-line note holding a `{% fill %}`
- **WHEN** the source is created
- **THEN** the DOCX SHALL hold `w:footnoteReference` ids 1, 2 and 3 in reference order, and the footnote blocks SHALL leave no body paragraph
- **AND** each note paragraph SHALL carry `FootnoteText`, and its runs SHALL carry the authored bold, italic, underline and fill highlight
- **AND** the certificate SHALL pass, with a footnote read-back check and a footnote round-trip comparison of note text and reference places whose negative controls are detected
- **AND** the text mirror SHALL list each note after the body, opening with its number

#### Scenario: [SDX-MDOC-FOOTNOTE-02] notes are numbered by reference order, wherever their bodies sit
- **GIVEN** a footnote body declared before the paragraph that references it, and a second body after it that is referenced first
- **WHEN** the source is created
- **THEN** the note referenced first SHALL be number 1, whatever its id or the order of the bodies
- **AND** a source without footnotes SHALL report the footnote check's negative control as not applicable and SHALL produce no footnotes part

#### Scenario: [SDX-MDOC-FOOTNOTE-03] malformed footnotes fail closed with a code and a line
- **GIVEN** sources with a reference or body with a missing or empty id, a reference with content or inside `{% literal %}` or `{% fill %}`, an empty body, a line break or a list in a body, a reference or body inside a body, a duplicated id, a body referenced twice, a reference with no body, a body with no reference, and a body nested in a list item
- **WHEN** each is created
- **THEN** creation SHALL fail before writing any output, with `INVALID_FOOTNOTE`, `NESTED_FOOTNOTE`, `DUPLICATE_FOOTNOTE_ID`, `DUPLICATE_FOOTNOTE_REFERENCE`, `FOOTNOTE_REFERENCE_WITHOUT_BODY`, `FOOTNOTE_BODY_WITHOUT_REFERENCE` or `UNSUPPORTED_CREATION_SYNTAX`, and with the source line where the error is

#### Scenario: [SDX-MDOC-FOOTNOTE-04] the PDF word check reads each note at the foot of its reference page
- **GIVEN** PDF page texts where each page shows its footer region, its body with each footnote number joined to the word before it, and then its footnote area: the rest of a note continued from the page before, then each note that starts on the page
- **WHEN** the PDF words are compared with the source
- **THEN** the comparison SHALL pass and report each page's footnote area
- **AND** it SHALL fail when a note loses a word, a note starts on a different page from its reference, notes appear out of order, or a reference number is missing
- **AND** a reference printed in the later fragment of a table row split across pages SHALL require its note on that later page, a repeated table header SHALL be expected without its footnote number, and a page holding only the rest of a continued note SHALL pass under the footer of the content before it
- **AND** an inserted empty page, or a continuation page under another section's footer, SHALL fail
- **AND** real LibreOffice PDFs of a long note that continues onto the next page, a note that continues onto a page with no body text, a note in a repeated header row and a note in a row split across pages SHALL pass

#### Scenario: [SDX-MDOC-FOOTNOTE-05] created footnotes survive import and compile
- **GIVEN** a created document with footnotes
- **WHEN** it is imported to Markdoc and compiled back, preserving annotations
- **THEN** the import SHALL hold one footnote annotation per note
- **AND** the compiled document's footnotes SHALL have the same numbers, paragraph text, formatting and `FootnoteText` styles as the created document's
- **AND** import SHALL admit the `w:bCs` and `w:iCs` twins on text without complex-script characters, and SHALL fail closed with `ANNOTATION_IMPORT_UNSUPPORTED` when the text holds Hebrew, Arabic, Indic, Thai or other complex-script characters

#### Scenario: [SDX-MDOC-FOOTNOTE-06] the round trip checks where each reference sits against the source
- **GIVEN** a created document, and the same source built through a lowering that moves a reference and projects the moved place consistently: within its paragraph, into another paragraph or table cell with the same text, or across a literal `‸` in the text; and two notes with the same text whose references are moved together
- **WHEN** each is verified
- **THEN** the round trip SHALL compare, in reference order and field by field, the place of each reference taken from the source (which non-empty body paragraph holds it, counted independently on each side, and the text before and after it) with the place of each imported footnote anchor, with negative controls that move one reference within its paragraph and to a neighbouring paragraph
- **AND** the moved references SHALL fail the build even though the read-back check, which compares with the lowering's own projection, passes
