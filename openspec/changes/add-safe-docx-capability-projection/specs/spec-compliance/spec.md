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
Every claim SHALL identify a nonempty subset of package-part scope, matching
story scope, reconstruction mode where applicable, evidence class,
implementation version, and the exact commit at which its evidence was last
verified.
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

#### Scenario: Unstructured local test is offered as positive evidence

- **GIVEN** a local test entry names an exact test title but has no structured capability-and-axis metadata
- **WHEN** the capability projection check runs
- **THEN** the check SHALL fail because local tests cannot establish a positive row in this projection

### Requirement: Positive claims require executable evidence

Every `supported`, `partial`, or `preservation-only` status SHALL reference a
pinned neutral scenario result with exact implementation provenance. Local
tests without structured capability-and-axis metadata, citations, source paths,
and prose-only manifests SHALL NOT independently establish a positive status.

#### Scenario: Positive claim has only a citation

- **GIVEN** a positive status references normative metadata but no executable evidence
- **WHEN** the capability projection check runs
- **THEN** the check SHALL fail

#### Scenario: Lean scope metadata is offered as evidence

- **GIVEN** a projection cites the Lean checker coverage manifest as evidence for a positive capability row
- **WHEN** the capability projection check runs
- **THEN** the check SHALL fail because scope metadata is not an executable checker result

### Requirement: Pinned result rows are complete and internally consistent

The measured scenario inventory SHALL equal every mapped scenario ID minus the
declared unmeasured scenario IDs and SHALL exactly equal the source result
scenario count. For every authored capability/axis pair with measured
scenarios, the pinned summary SHALL contain exactly one row with exactly that
mapped measured set. For every capability with measured scenarios, it SHALL
contain exactly one cross-platform row with the exact union of that
capability's measured mapped scenarios. Missing, extra, and duplicate rows
SHALL be rejected. Every adapter outcome SHALL use nonnegative integer counts
that sum to the row denominator. A positive neutral SafeDocX result SHALL cover
and pass every row scenario; a cross-platform result SHALL also require a
second adapter that covers and passes every row scenario.

#### Scenario: Sparse adapter outcome is presented as complete

- **GIVEN** a pinned row omits a mapped measured scenario or an adapter outcome uses a smaller denominator or inconsistent count sum
- **WHEN** the capability projection check runs
- **THEN** the check SHALL fail before the row can establish a claim

#### Scenario: Measured rows are deleted while claims are downgraded

- **GIVEN** measured authored and cross-platform rows are removed while their projection claims are downgraded
- **WHEN** the capability projection check runs
- **THEN** the check SHALL fail because the measured row map is incomplete

### Requirement: Deterministic capability reports

The repository SHALL generate machine-readable and human-readable reports that
retain the raw per-axis denominator, status counts, evidence links, and explicit
limitations without collapsing support into one boolean or percentage.
The reports SHALL distinguish the profile capability/axis denominator from
authored scenario-mapping rows, complete-run derived rows, and rows measured in
the pinned result snapshot.
The reports SHALL expose the current Lean boundary as in-place checking of the
main, footnote, and endnote text and field-marker projections, SHALL retain its
exact exclusions, and SHALL state that this scope metadata establishes no
capability row.

#### Scenario: Generated projection report is stale

- **WHEN** pinned inputs or SafeDocX statuses change without regeneration
- **THEN** the capability projection check SHALL fail with a regeneration instruction
