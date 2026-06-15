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

### Requirement: Two-column signature block layout

`signatureBlock` SHALL support an optional two-column layout that renders signers
as a paired signing grid while preserving the existing single-column block when
the layout option is omitted.

#### Scenario: [SDX-GEN-109] two-column signature renders a paired pre-filled signing grid
- **GIVEN** a `signatureBlock` authored with `layout: 'two-column'` over three signers
- **WHEN** the recipe builds the block and the document is generated
- **THEN** the recipe SHALL return a single three-column grid table (signer / gutter / signer)
- **AND** each signer cell SHALL lead with a centered uppercase muted party header
- **AND** each signer cell SHALL carry ruled Signature / Print Name / Title / Date lines with Print Name and Title pre-filled from the party data and Signature/Date left blank
- **AND** an odd signer count SHALL produce a trailing empty padding cell with no nested form
- **AND** the grid SHALL use no VML or pictures
- **AND** omitting the layout option SHALL preserve the existing single-column signature behavior
- **AND** the generated package SHALL remain structurally valid and well-formed
