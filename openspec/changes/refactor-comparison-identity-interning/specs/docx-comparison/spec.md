## MODIFIED Requirements

### Requirement: Comparison Unit Base Interface

The system SHALL provide a `ComparisonUnit` interface with `contents` array, `sha1Hash` string, and `correlationStatus` property as the base for all comparison units. The `sha1Hash` value SHALL be computed lazily — materialized on first read rather than eagerly when the unit is created — and reads SHALL return a stable 40-character hexadecimal digest (optionally extended by identity salts). Content-identity comparison in the LCS SHALL NOT depend on reading or recomputing `sha1Hash`; it SHALL use interned integer identity tokens derived from each unit's pre-hash identity string and recursive text content, such that two units share a token if and only if they satisfy the established atom-equality relation (equal content hash, equal text content, equal tag name).

#### Scenario: Hash calculation for content identity

- **WHEN** a comparison unit is created
- **THEN** its `sha1Hash` is derived from its content for identity comparison
- **AND** the digest is materialized on first read of `sha1Hash` and cached for subsequent reads

#### Scenario: Hash is a stable hexadecimal digest on read

- **WHEN** a consumer reads `sha1Hash` on a comparison unit
- **THEN** the value is a 40-character hexadecimal string, extended only by any applied identity salts

#### Scenario: Identity comparison uses interned tokens

- **WHEN** two comparison units are compared for content identity during LCS
- **THEN** the comparison uses interned integer identity tokens rather than reading or recomputing SHA1 hashes
- **AND** two units receive equal tokens if and only if they have equal content hash, equal text content, and equal tag name
