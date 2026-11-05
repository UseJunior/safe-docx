## ADDED Requirements

### Requirement: Relative cross-references in generated documents

`generateDocx` SHALL accept `number: 'relative'` on a number cross-reference
and SHALL emit it as the REF field ` REF <name> \r \h `. Its cached result
SHALL be the full-context number less the leading levels whose values the
target shares with the last paragraph of the target's list (`w:numId`) at
or before the paragraph holding the field, keeping at least the target's
own level, as Word shows it after updating fields. With no paragraph of the
target's list before the field, and in a footnote, the cached result SHALL
be the full-context number. A list level shown at its start value, in the
target or at the position, SHALL be compared at that value and passed over
in the shown number as in the full-context number. Generation SHALL refuse
a relative reference in a footnote when a footnote paragraph is numbered by
the target's numbering definition (any of its instances). A spec without
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
- **AND** a level shown at its start value in the target or the position SHALL be compared at that value (`2(i)` with the middle level at its start value reads `(i)` from `2(a)(ii)` at the same start value, and `2(i)` from `3`)
- **AND** generated references SHALL number from their own place in the body, a table cell included, and in a footnote in full

#### Scenario: [SDX-GEN-132] relative cross-references Word would show unmeasured numbers for are rejected
- **GIVEN** a relative reference in a footnote beside a footnote paragraph numbered by the target's definition (by list, by an additional instance, or by a style based on a linked style), and a text reference with `number: 'relative'`
- **WHEN** each is generated
- **THEN** generation SHALL fail with a `GenerationSpecError` whose path names the reference
- **AND** the same footnote reference without a numbered footnote paragraph, or beside one numbered by another definition, SHALL generate, showing the full number

#### Scenario: [SDX-GEN-133] a relative number compares a level shown at its start value at that value, as Word does
- **GIVEN** the start-value probe and the Word 16.114 after-update results recorded in the #1284 oracle evidence: clauses before any Article, clauses directly under an Article, sub-clauses directly under a Section or an Article, with fields among them and to and from ordinary targets
- **WHEN** the recorded spec is generated
- **THEN** every one of its 47 fields SHALL have a cached result equal to Word's (`(a)` for `ARTICLE II(a)` from the Article's next clause, `(i)` for `ARTICLE IV(i)` from `Section 4.02(a)`, the full number from another Article)
- **AND** the package SHALL pass the structural check

#### Scenario: [SDX-GEN-134] a relative reference in a footnote shows the full number unless a footnote paragraph is numbered by its target's list
- **GIVEN** the #1284 footnote probes: footnote paragraphs numbered by another definition, and footnote paragraphs numbered by the target's own heading list
- **WHEN** each recorded spec is generated
- **THEN** the first SHALL generate, every footnote field's cached result equal to Word's full number
- **AND** the second SHALL fail with a `GenerationSpecError` naming the reference and the numbered footnote paragraph, because Word numbers it relative to the footnotes' own count of the list (`(a)` for `Section 1.01(a)` after a footnote `(a)`)
