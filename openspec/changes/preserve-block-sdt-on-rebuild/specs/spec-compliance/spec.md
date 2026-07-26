## ADDED Requirements

### Requirement: Block structured document tag claims cite exact normative structure

The conformance registry SHALL cite ECMA-376 edition 5 Part 1 §§17.5.2.29,
17.5.2.32, 17.5.2.33, 17.5.2.34, and 17.5.2.38 for block/cell SDT structure,
content, and properties, while exact opaque or scaffold preservation remains a
separately labeled SafeDocX metamorphic invariant.

#### Scenario: [SPEC-COV-SDT-BLOCK-01] Block preservation evidence remains bounded

- **WHEN** block-SDT implementation and tests claim normative structure
- **THEN** JSDoc and Allure metadata SHALL cite the exact ECMA sections for each supported placement
- **AND** no claim SHALL broaden to nested, footer, ancillary, or structurally mutated control reconstruction
