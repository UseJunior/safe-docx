## ADDED Requirements

### Requirement: Paragraph borders

The compiler SHALL accept paragraph borders on the top, bottom, left, right,
and between edges using the shared border value shape. It SHALL emit those
edges under `w:pBdr` in schema order and place `w:pBdr` in the schema-defined
`w:pPr` child position.

#### Scenario: [SDX-GEN-044] a paragraph border survives document workflows
- **GIVEN** a generated header containing a bottom-bordered paragraph
- **WHEN** the document is loaded, saved, and compared with an edited revision
- **THEN** the paragraph border SHALL remain present with the authored attributes
- **AND** the emitted document SHALL pass the schema validation gate
