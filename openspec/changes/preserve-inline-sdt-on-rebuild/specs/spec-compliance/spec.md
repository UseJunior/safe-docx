## ADDED Requirements

### Requirement: Inline content-control capability evidence separates neutral edits from rebuild preservation

The generated SafeDocX capability projection SHALL consume the neutral registry
at commit `fe0ee99602e6f982255ecaa2b45d4936a7f46150` and SHALL keep the scope of
neutral content-control scenario evidence distinct from the repository-local
opaque inline-SDT forced-rebuild invariant.

#### Scenario: [SDX-SDT-06] Capability projection refresh preserves evidence scope

- **WHEN** `generate:capability-projection` runs against the refreshed upstream registry
- **THEN** the generated projection SHALL name commit `fe0ee99602e6f982255ecaa2b45d4936a7f46150`
- **AND** no neutral scenario row SHALL claim `reconstructionModeUsed: rebuild` unless that scenario actually forces rebuild

### Requirement: Emitted-schema preprocessing honors effective MCE scope

The emitted document schema gate SHALL resolve `mc:Ignorable` prefixes at the
element where each declaration is effective and SHALL carry inherited
ignorable namespace names by URI into descendants.

#### Scenario: [SDX-SDT-07] Root, local, aliased, and shadowed ignorable namespaces preprocess correctly

- **GIVEN** emitted `document.xml` using root or local `mc:Ignorable` declarations, prefix aliases, or legal descendant shadowing
- **WHEN** the schema gate computes the post-MCE validation projection
- **THEN** ignorable elements and attributes SHALL be removed only where their namespace name is effective
- **AND** an unbound `mc:Ignorable` token SHALL fail preprocessing
- **AND** CI-captured forced-rebuild inline-SDT output SHALL validate against the vendored Transitional WML schema
