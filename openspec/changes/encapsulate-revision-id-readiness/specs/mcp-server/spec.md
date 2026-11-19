## ADDED Requirements
### Requirement: Managed revision allocation readiness
The server SHALL seed managed revision allocators once from supported stories
before allocation, share concurrent seed attempts, and retry failed attempts.
It SHALL preserve synchronous core emitter APIs and the established logical
revision grouping policy.

#### Scenario: Shared first seed and retry
- **WHEN** concurrent tracked-edit callers first request revision contexts
- **THEN** they share a seed and ready counter
- **AND** a failed seed permits a later successful retry

#### Scenario: Candidate allocation publication
- **WHEN** a tracked mutation allocates IDs on an unpublished candidate
- **THEN** failure, retirement or a no-op leaves active allocations unchanged
- **AND** changed live candidates publish only if no conflicting direct allocation occurred
- **AND** existing direct contexts continue to allocate beyond published IDs

#### Scenario: Supported story maxima
- **WHEN** supported current side stories contain higher revision identifiers
- **THEN** the first tracked mutation allocates above those identifiers
- **AND** non-revision identifiers do not affect seeding
