## ADDED Requirements

### Requirement: Numbering level justification

`generateDocx` SHALL accept an optional `lvlJc` on each `NumberingSpec` level as
a fixed enumerated value (the transitional ST_Jc subset `left`/`center`/`right`)
and emit it as `w:lvlJc`, defaulting to `left` when omitted so existing output is
unchanged, without accepting values outside that enumeration.

#### Scenario: [SDX-GEN-063] level justification is authorable
- **GIVEN** a numbering definition whose levels declare `lvlJc` of `right` and `center`, plus a level that omits it
- **WHEN** the document spec is compiled
- **THEN** each level's `w:lvlJc` `w:val` SHALL equal the authored value, and `left` for the omitted level
- **AND** `w:lvlJc` SHALL keep its CT_Lvl position after `w:lvlText` and before any `w:pPr`
- **AND** a re-render of the same spec SHALL be byte-identical
- **AND** an `lvlJc` value outside the fixed enumeration (e.g. supplied by a JSON/JS caller bypassing the type) SHALL be rejected with a validation error before emission, so no out-of-enum `w:lvlJc` can be produced
- **AND** the generated package SHALL remain well-formed
