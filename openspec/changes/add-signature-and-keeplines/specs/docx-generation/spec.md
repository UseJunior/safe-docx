## ADDED Requirements

### Requirement: Paragraph keep-lines pagination

`ParagraphSpec` SHALL support an optional `keepLines` flag that emits
`w:keepLines` in the paragraph properties so a paragraph's lines stay together
on one page, ordered immediately after `w:keepNext`, and SHALL omit the element
when the flag is unset.

#### Scenario: [SDX-GEN-108] keepLines emits w:keepLines after w:keepNext and is absent when unset
- **GIVEN** a paragraph with both `keepLines` and `keepNext`, a paragraph without either, and a paragraph style whose paragraph properties set `keepLines`
- **WHEN** the document is generated and parsed back
- **THEN** the keep-together paragraph's `w:pPr` SHALL contain `w:keepLines` immediately after `w:keepNext`
- **AND** the paragraph without the flag SHALL emit no `w:keepLines`
- **AND** the paragraph style SHALL also emit `w:keepLines` through the shared paragraph-property builder
- **AND** the generated package SHALL remain structurally valid and well-formed
