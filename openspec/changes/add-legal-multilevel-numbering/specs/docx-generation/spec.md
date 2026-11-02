## ADDED Requirements

### Requirement: Legal multilevel numbering

`generateDocx` SHALL let a numbering definition express US legal outline
numbering: the `decimalZero` format, per-level `isLgl`, `lvlRestart`, `pStyle`,
`firstLine` indentation and tab stops, and additional numbering instances that
restart the definition through `w:lvlOverride`/`w:startOverride`. Every new
field SHALL be optional, and a spec that uses none of them SHALL compile to the
same bytes as before.

#### Scenario: [SDX-GEN-112] legal outline level properties are authorable
- **GIVEN** numbering levels declaring `numFmt: 'decimalZero'`, `isLgl`, and `lvlRestart`
- **WHEN** the document is generated
- **THEN** each level SHALL carry the authored `w:numFmt`, a bare `w:isLgl` when `isLgl` is true (none when false), and `w:lvlRestart` with the authored value
- **AND** level children SHALL follow the CT_Lvl sequence of the vendored schema
- **AND** a spec using none of the new properties SHALL emit the pre-change `word/numbering.xml` byte for byte
- **AND** an `lvlRestart` that is not `0` and not below the level's `ilvl`, or a non-boolean `isLgl`, SHALL be rejected with a validation error before emission

#### Scenario: [SDX-GEN-113] numbering levels link to paragraph styles
- **GIVEN** levels whose `pStyle` names declared paragraph styles
- **WHEN** the document is generated
- **THEN** each such level SHALL carry `w:pStyle` with the style id
- **AND** each linked style SHALL carry `w:numPr` (`w:ilvl` then `w:numId`) naming the level and its definition's default instance, at its CT_PPrBase slot
- **AND** a `pStyle` naming an undeclared style, a character style, an empty id, or a style another level already links SHALL be rejected with a validation error

#### Scenario: [SDX-GEN-114] level indents take firstLine and tab stops
- **GIVEN** levels declaring `indentTwips.firstLine` and `tabs`
- **WHEN** the document is generated
- **THEN** the level `w:pPr` SHALL carry `w:tabs` before `w:ind`, and `w:ind` SHALL carry the authored `left` and `firstLine`
- **AND** tab stops without an indent SHALL emit a `w:pPr` holding only `w:tabs`
- **AND** `firstLine` together with `hanging`, a negative `firstLine`, or a malformed tab stop SHALL be rejected with a validation error

#### Scenario: [SDX-GEN-115] numbering instances restart a definition
- **GIVEN** a definition declaring additional `instances` with `levelOverrides`
- **WHEN** the document is generated
- **THEN** default instances SHALL keep numeric ids `1..N` in declaration order and additional instances SHALL follow from `N+1`, each referencing its definition's abstract id
- **AND** each additional instance SHALL carry one `w:lvlOverride` per override in ascending `ilvl`, each holding only `w:startOverride`
- **AND** paragraphs naming an instance handle SHALL reference that instance's numeric id
- **AND** an instance with no overrides, a duplicate handle, an override of an undeclared or repeated level, or a non-integer `startOverride` SHALL be rejected with a validation error

#### Scenario: [SDX-GEN-116] a two-article agreement carries US legal outline numbering
- **GIVEN** a two-article agreement whose Article and Section headings only apply Heading 1 / Heading 2, linked to an `upperRoman` "ARTICLE %1" level and a legal `decimalZero` "Section %1.%2" level
- **WHEN** the agreement is generated
- **THEN** the Section level SHALL carry `w:isLgl`, `decimalZero`, and `w:pStyle` Heading2
- **AND** no level SHALL carry `w:lvlRestart`, so "(a)" restarts in each Section by the reader default
- **AND** the read-side labels SHALL read ARTICLE I, Section 1.01, (a), (i), (A), (B), (ii), (b), Section 1.02, (a), ARTICLE II, Section 2.01, (a), (i), Section 2.02
- **AND** a re-render of the same spec SHALL be byte-identical

#### Scenario: [SDX-GEN-117] read-side labels honor legal numbering and restart thresholds
- **GIVEN** a numbering part with `w:isLgl`, `decimalZero`, `w:lvlRestart`, and a `w:startOverride` instance
- **WHEN** list labels are computed for a paragraph sequence
- **THEN** an `isLgl` level SHALL print every placeholder as an Arabic numeral, keeping `decimalZero` padding (`1.09`, `1.10`) and bullet glyphs
- **AND** `lvlRestart` `0` SHALL never restart its level, and `lvlRestart` `r` SHALL restart it only when one of the first `r` levels is used
- **AND** a `startOverride` instance SHALL start its level at the override value
