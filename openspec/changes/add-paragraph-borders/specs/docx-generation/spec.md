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

#### Scenario: [SDX-GEN-045] all paragraph border edges emit in schema order with defaults
- **GIVEN** a generated body paragraph declaring top, left, bottom, right, and between edges
- **WHEN** the emitted `word/document.xml` is inspected
- **THEN** the `w:pBdr` children SHALL appear in the order top, left, bottom, right, between
- **AND** an omitted size SHALL default to `w:sz="4"`, a `none` style SHALL emit `w:sz="0"`, and an omitted color SHALL default to `w:color="auto"`
- **AND** the emitted document SHALL pass the schema validation gate
