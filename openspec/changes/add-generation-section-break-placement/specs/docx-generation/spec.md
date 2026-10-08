## ADDED Requirements

### Requirement: Section break placement

`generateDocx` SHALL let a non-final section bind its `w:sectPr` to the
section's final paragraph instead of a dedicated empty break paragraph, and
SHALL keep the dedicated paragraph as the default.

#### Scenario: [SDX-GEN-111] a section break can bind to the section's last paragraph
- **GIVEN** three sections where the first sets `breakPlacement: 'lastParagraph'` and ends with a centred paragraph, and the second uses the default placement
- **WHEN** the document spec is compiled
- **THEN** the body SHALL contain exactly one empty paragraph, the second section's dedicated break paragraph
- **AND** the first section's `w:sectPr` SHALL be the last child of the centred paragraph's `w:pPr`, after its alignment, and SHALL carry its footer reference
- **AND** a paragraph with no properties of its own SHALL gain a `w:pPr` holding only the `w:sectPr`
- **AND** the section audit SHALL report two paragraph-level and one body-level `w:sectPr` with intact footer bindings, and `document.xml` SHALL validate against the transitional WML schema
- **AND** `'lastParagraph'` on a non-final section that is empty or ends with a table, or an unknown placement value, SHALL be rejected before emission
