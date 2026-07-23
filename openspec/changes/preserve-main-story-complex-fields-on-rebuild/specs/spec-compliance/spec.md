## ADDED Requirements

### Requirement: Complex-field capability evidence distinguishes conformance from preservation

Generated capability and conformance artifacts SHALL distinguish normative
complex-field structure/instruction claims from the repository-level
metamorphic claim that an unchanged field interval remains structurally
equivalent through forced rebuild.

#### Scenario: [FIELD-COMP-01] Evidence scope remains explicit

- **WHEN** capability and conformance artifacts are regenerated after the
  unchanged-field work
- **THEN** ECMA-376 citations SHALL cover only registered field structure and
  instruction semantics
- **AND** exact interval preservation SHALL be labeled as a SafeDocX
  metamorphic invariant
- **AND** neutral-suite evidence SHALL not claim forced-rebuild coverage unless
  the neutral scenario actually requests and observes that mode
