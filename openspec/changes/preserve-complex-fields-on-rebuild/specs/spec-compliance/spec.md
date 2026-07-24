## ADDED Requirements

### Requirement: Complex-field rebuild evidence separates normative structure from topology preservation

The ECMA-376 registry SHALL target edition 5 Part 1 §§17.16.18,
17.16.5.42, 17.16.5.44, 17.16.5.45, and 17.16.5.51 for the bounded supported
field vocabulary. Source and tests SHALL cite those clauses using the repository
conformance grammar. Exact ordered topology preservation through rebuild SHALL
be labeled as a SafeDocX metamorphic invariant rather than an ECMA requirement.

#### Scenario: [SDX-FIELD-CONFORMANCE-01] REF and PAGEREF claims are bounded

- **WHEN** REF and PAGEREF are added to the targeted registry
- **THEN** their entries SHALL describe classification and unchanged rebuild preservation
- **AND** SHALL NOT claim field evaluation, pagination, cached-result correctness, or complete field-engine equivalence

#### Scenario: [SDX-FIELD-CONFORMANCE-02] Executable evidence names the verification boundary

- **WHEN** conformance checks inspect the field rebuild implementation and tests
- **THEN** citations SHALL resolve to registry entries for each supported instruction and complex-field structure
- **AND** the evidence SHALL state that the Lean verifier does not cover rebuild topology
