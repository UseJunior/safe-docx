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
