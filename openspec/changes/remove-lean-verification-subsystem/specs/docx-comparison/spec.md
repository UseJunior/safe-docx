## ADDED Requirements

### Requirement: Comparison integrity is enforced without an external Lean verifier

The comparison pipeline SHALL enforce its supported package, relationship,
story-topology, and accept/reject integrity requirements through maintained
runtime validation and TypeScript regression or property tests, without a Lean
executable or Lean-specific public API.

#### Scenario: Comparison runs without a Lean toolchain

- **GIVEN** a supported comparison input on a machine with no Lean installation or compiled checker
- **WHEN** comparison runs
- **THEN** all required runtime integrity checks SHALL execute without invoking Lean
- **AND** the result SHALL contain no Lean-specific certificate or not-run state

#### Scenario: Former verifier option is absent

- **GIVEN** the post-retirement public comparison API
- **WHEN** a caller inspects its options and exports
- **THEN** `leanXmlVerifier`, `LeanXmlVerifierOptions`, and `runLeanXmlTripleVerifier` SHALL not be present

#### Scenario: Behavioral coverage survives retirement

- **GIVEN** an OOXML case whose user-visible invariant was previously checked only by Lean integration
- **WHEN** the Lean subsystem is removed
- **THEN** an equivalent TypeScript regression, property, or corpus test SHALL protect that invariant before deletion
