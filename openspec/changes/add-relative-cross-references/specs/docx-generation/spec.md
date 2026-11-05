## ADDED Requirements

### Requirement: Relative cross-references in generated documents

`generateDocx` SHALL accept `number: 'relative'` on a number cross-reference
and SHALL emit it as the REF field ` REF <name> \r \h `. Its cached result
SHALL be the full-context number less the leading levels whose values the
target shares with the last paragraph of the target's list (`w:numId`) at
or before the paragraph holding the field, keeping at least the target's
own level, as Word shows it after updating fields. With no paragraph of the
target's list before the field, and in a footnote, the cached result SHALL
be the full-context number. Generation SHALL refuse a relative reference in
a footnote when a footnote paragraph is numbered, and a relative number
that depends on a list level shown at its start value. A spec without
relative cross-references SHALL compile to the same bytes as before.

#### Scenario: [SDX-GEN-130] relative cross-references emit REF fields with the relative switch whose cached results equal Word's
- **GIVEN** the probe specs and the Word 16.114 after-update results recorded in the #1258 oracle evidence, with fields in another Article, the same Section, a sibling clause, the target's own paragraph, numbered headings, plain paragraphs, table cells, footnotes, and lists of other definitions and instances
- **WHEN** each recorded spec is generated again
- **THEN** every field SHALL have the instruction ` REF <name> \r \h ` and a cached result equal to Word's
- **AND** the package SHALL pass the structural check and regenerate byte for byte
- **AND** the #1236 probe's recorded `\r` results at nine places SHALL equal a regenerated probe's

#### Scenario: [SDX-GEN-131] a relative number drops the levels it shares with the target list at the field
- **GIVEN** a target `2(b)(ii)` and positions in its list at `3(a)`, `2(a)`, `2(b)(i)`, `2(b)(ii)` and `2`, a position in another list, and no position
- **WHEN** the relative number is resolved
- **THEN** it SHALL read `2(b)(ii)`, `(b)(ii)`, `(ii)`, `(ii)`, `(b)(ii)`, `2(b)(ii)` and `2(b)(ii)`, and a reference to `2` from inside `2(b)(i)` SHALL read `2`
- **AND** a level shown at its start value in the target or the position SHALL be refused as `relativeStartValue`
- **AND** generated references SHALL number from their own place in the body, a table cell included, and in a footnote in full

#### Scenario: [SDX-GEN-132] relative cross-references Word would show unmeasured numbers for are rejected
- **GIVEN** a relative reference in a footnote beside a numbered footnote paragraph (by list, or by a style based on a linked style), a relative reference to and from a clause right after an Article, and a text reference with `number: 'relative'`
- **WHEN** each is generated
- **THEN** generation SHALL fail with a `GenerationSpecError` whose path names the reference or the bookmark
- **AND** the same footnote reference without a numbered footnote paragraph SHALL generate, showing the full number
