## ADDED Requirements

### Requirement: Run highlight

`generateDocx` SHALL accept `RunProps.highlight` as a fixed enumerated text
highlight value and emit the corresponding run property without accepting
arbitrary fill colors through this field.

#### Scenario: [SDX-GEN-105] highlighted runs emit ordered highlight properties
- **GIVEN** a run authored with `highlight`
- **WHEN** the document spec is compiled
- **THEN** the run's `rPr` SHALL contain `w:highlight` with `w:val` equal to the authored value
- **AND** `w:highlight` SHALL appear in the run-property element order after size/color properties and before underline
- **AND** the generated package SHALL remain well-formed
