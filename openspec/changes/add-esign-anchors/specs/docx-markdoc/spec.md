## ADDED Requirements

### Requirement: E-signature placement anchors

The creation compiler SHALL render inline `{% esign-anchor %}` content as searchable text with fixed formatting for placement on white pages. The tag SHALL accept one nonempty plain-text marker without whitespace or inline formatting.

#### Scenario: [SDX-MDOC-ESIGN-01] A signature marker survives PDF conversion

- **WHEN** a placement marker is authored immediately before a signature line on a white page
- **THEN** the generated PDF text layer contains the marker with coordinates at the line start
- **AND** the marker is invisible on the rendered page and the signature line does not visibly move
