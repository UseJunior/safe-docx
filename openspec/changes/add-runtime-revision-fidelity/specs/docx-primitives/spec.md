## ADDED Requirements
### Requirement: Runtime revision fidelity
The engine SHALL reject tracked output whose Reject All projection differs from its source projection or whose Accept All projection differs from the independent intended result. The failure SHALL carry `REVISION_FIDELITY_VIOLATION`, the failed side, part and location. The guard SHALL be enabled by default and MAY be explicitly disabled for performance.

#### Scenario: Valid tracked edits preserve both projections
- **WHEN** a valid tracked insertion, deletion or formatting change is checked
- **THEN** both effective projections match and publication is allowed

#### Scenario: Broken revisions fail closed with a location
- **WHEN** a tracked candidate loses source or intended content
- **THEN** validation fails with the affected side, part and location

#### Scenario: Referenced notes and assets survive resolution
- **WHEN** an output drops a note reference, note body, drawing or embedded object payload
- **THEN** the guard refuses the output

#### Scenario: Explicit performance opt-out
- **WHEN** a caller explicitly disables revision fidelity
- **THEN** this round-trip check is skipped
