## ADDED Requirements

### Requirement: Reproducible neutral capability denominator

The repository SHALL vendor unchanged neutral capability, profile, and scenario
mapping inputs and SHALL pin their upstream repository, commit, schema version,
registry version, and SHA-256 digests so projection checks require no network.

#### Scenario: Vendored input drifts from its pin

- **GIVEN** a vendored neutral registry file changes without a pin update
- **WHEN** the capability projection check runs
- **THEN** the check SHALL fail before generating support claims

### Requirement: Complete per-axis SafeDocX projection

The repository SHALL record exactly one explicit SafeDocX status for every
capability and applicable axis selected by the pinned profile, and SHALL reject
unknown capability IDs, undeclared axes, duplicate pairs, and missing pairs.
Every claim SHALL identify package-part and story scope, reconstruction mode
where applicable, evidence class, implementation version, and the exact commit
at which its evidence was last verified.
Every positive claim SHALL include at least one executable evidence item with
the same implementation version and verified commit; historical neutral results
SHALL NOT be promoted to a newer SafeDocX version.

#### Scenario: Profile denominator changes

- **GIVEN** a capability or axis is added to the pinned profile denominator
- **WHEN** no corresponding SafeDocX status exists
- **THEN** the capability projection check SHALL fail

#### Scenario: Claim provenance or scope drifts

- **GIVEN** a claim's package parts disagree with its neutral capability or its evidence version and commit disagree with the pinned result
- **WHEN** the capability projection check runs
- **THEN** the check SHALL fail before publishing the report

### Requirement: Positive claims require executable evidence

Every `supported`, `partial`, or `preservation-only` status SHALL reference an
exact existing executable evidence path. Citations, source paths, and prose-only
manifests SHALL NOT independently establish a positive status.

#### Scenario: Positive claim has only a citation

- **GIVEN** a positive status references normative metadata but no executable evidence
- **WHEN** the capability projection check runs
- **THEN** the check SHALL fail

#### Scenario: Lean claim exceeds checker scope

- **GIVEN** a projection cites Lean evidence for a capability, axis, story, or reconstruction mode outside the existing Lean coverage registry
- **WHEN** the capability projection check runs
- **THEN** the check SHALL fail as an overclaim

### Requirement: Deterministic capability reports

The repository SHALL generate machine-readable and human-readable reports that
retain the raw per-axis denominator, status counts, evidence links, and explicit
limitations without collapsing support into one boolean or percentage.
The reports SHALL distinguish the profile capability/axis denominator from
authored scenario-mapping rows, complete-run derived rows, and rows measured in
the pinned result snapshot.

#### Scenario: Generated projection report is stale

- **WHEN** pinned inputs or SafeDocX statuses change without regeneration
- **THEN** the capability projection check SHALL fail with a regeneration instruction
