## ADDED Requirements
### Requirement: Atomic local mutation publication
The server SHALL serialize local session mutations and publish document changes, revision allocation, edit counters, cache invalidation and attribution together only after validating that the same unexpired session is active.

#### Scenario: Precommit candidate remains invisible
- **WHEN** a local mutation pauses before commit or fails after editing its candidate
- **THEN** active reads and temporary resources remain unchanged

#### Scenario: Retired generation cannot commit
- **WHEN** a session closes, expires or is replaced during a mutation
- **THEN** that candidate cannot publish into the active registry

#### Scenario: No-op preserves bookkeeping
- **WHEN** an operation leaves package contents unchanged
- **THEN** counters, caches, revision allocator and attribution remain unchanged

#### Scenario: ODF identity across transaction forks
- **WHEN** insertion is followed by a transaction fork in an ODF session
- **THEN** the fork preserves the current positional IDs and existing insertion invalidation response

### Requirement: Confirmed remote mutation accounting
The server SHALL serialize Google mutations and retain bookkeeping for confirmed remote writes even when refresh fails, while marking the structure stale until successful refresh.

#### Scenario: Remote write succeeds and refresh fails
- **WHEN** batchUpdate succeeds but the subsequent structure fetch fails
- **THEN** the edit is counted and the provider reports stale structure without claiming rollback
