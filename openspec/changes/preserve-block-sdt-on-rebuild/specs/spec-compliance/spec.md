## ADDED Requirements

### Requirement: Block structured document tag claims cite exact normative structure

The conformance registry SHALL cite ECMA-376 edition 5 Part 1 §§17.5.2.29,
17.5.2.34, and 17.5.2.38 for block SDT structure, block content, and properties,
while exact opaque preservation remains a separately labeled SafeDocX
metamorphic invariant.

#### Scenario: [SPEC-COV-SDT-BLOCK-01] Block preservation evidence remains bounded

- **WHEN** block-SDT implementation and tests claim normative structure
- **THEN** JSDoc and Allure metadata SHALL cite the three exact ECMA sections
- **AND** no claim SHALL broaden to row, cell, nested, editable, footer, or ancillary control reconstruction
