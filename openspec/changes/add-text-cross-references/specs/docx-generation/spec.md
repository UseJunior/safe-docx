## ADDED Requirements

### Requirement: Text cross-references in generated documents

`generateDocx` SHALL accept `show: 'text'` on a cross-reference
(`CROSS_REFERENCE_SHOWS` is `number`, the default, and `text`). A text
cross-reference SHALL emit the REF field ` REF <name> \h `, with no number
switch, and its cached result SHALL be a copy of each text run the target's
bookmark encloses, with that run's own formatting. The result SHALL leave out
the target's list label and footnote reference marks, as Word does after
updating fields. A text cross-reference SHALL carry no run formatting of its
own and no `number`. Its target SHALL hold only text runs and footnote
references, with text that is not blank, and need not be numbered. A spec
without text cross-references SHALL compile to the same bytes as before.

#### Scenario: [SDX-GEN-127] text cross-references emit REF fields whose cached result is the target's text runs
- **GIVEN** text references, in the body, a table cell and a footnote, to a numbered Article, a numbered Section holding an italic word and a footnote, a clause and a paragraph in a table cell, beside a number reference
- **WHEN** the document is generated
- **THEN** each text reference SHALL be a complex field with the instruction ` REF <name> \h `
- **AND** its result SHALL be the target's text runs with their own formatting (the italic word stays italic), without "Section 1.01" and without a footnote reference
- **AND** the package SHALL pass the structural check and regenerate byte for byte
- **AND** docx-core's REF refresh, which reads the bookmarked text from the package, SHALL find every text result unchanged

#### Scenario: [SDX-GEN-128] text cross-reference results equal Word's after-update results
- **GIVEN** the spec and the Word 16.114 after-update results recorded in the #1259 oracle evidence
- **WHEN** the recorded spec is generated again
- **THEN** every field SHALL have the recorded instruction, and a cached result equal to Word's in text and in bold, italic and highlight
- **AND** Word's own "Bookmark text" cross-reference SHALL have the same instruction, and its "Heading text" cross-reference SHALL reuse the generated heading bookmark
- **AND** the evidence SHALL show that text typed at the start of or inside a target stays in its bookmark, text typed at its end or over its last word lands after the bookmark, and typing over the whole text deletes it

#### Scenario: [SDX-GEN-129] invalid text cross-references are rejected
- **GIVEN** an unknown `show` value, a text reference with a `number`, a text reference with run formatting, targets holding a tab, a break, a field or a cross-reference, and a target whose only text is blank
- **WHEN** each is generated
- **THEN** generation SHALL fail with a `GenerationSpecError` whose path names the reference
- **AND** a text reference to an unnumbered paragraph holding a footnote SHALL generate, showing the paragraph's text without the note's mark
