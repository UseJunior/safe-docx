## ADDED Requirements

### Requirement: Immutable ECMA-376 source artifact manifest

The repository SHALL preserve unchanged official ECMA-376 Parts 1-4 ZIP
publications and SHALL verify each artifact against both `SHA256SUMS` and a
machine-readable artifact manifest containing edition, part, title,
publication date, path, checksum, source URL, and copyright status.

#### Scenario: Official artifact identity is reproducible

- **WHEN** `npm run check:ecma-376-coverage` runs
- **THEN** every vendored ZIP SHALL match its manifest SHA-256
- **AND** `SHA256SUMS` SHALL contain exactly the same artifact set
- **AND** the existing Strict, Transitional, and OPC schema trees SHALL match
  the corresponding nested official XSD archives byte for byte

### Requirement: Generated ECMA-376 vocabulary

The repository SHALL generate raw OOXML vocabulary metadata and TypeScript
constants from declarations in a schema archive nested inside an official
vendored ZIP, and every generated entry SHALL record its source artifact
checksum and schema locator.

#### Scenario: Seeded declaration is absent

- **GIVEN** a vocabulary seed names an element or attribute absent from the source XSD
- **WHEN** the generator runs
- **THEN** generation SHALL fail before updating committed outputs

#### Scenario: Generated TypeScript drifts

- **GIVEN** the generated TypeScript vocabulary differs from generator output
- **WHEN** `npm run check:ecma-376-coverage` runs
- **THEN** the check SHALL fail with a regeneration instruction

### Requirement: Semantic OOXML references remain explicit

Hand-authored semantic groups SHALL consume generated raw vocabulary constants
and SHALL identify their spec-reference manifest entry with an `@ooxmlSpec`
tag. The spec-reference manifest SHALL classify each seeded reference with a
coverage status and related source and tests.

#### Scenario: Initial field-fragmentation linkage is complete

- **WHEN** the ECMA-376 coverage check scans source
- **THEN** each initial spec-reference ID SHALL have an `@ooxmlSpec` linkage
- **AND** the field-fragmentation group SHALL use generated constants for
  `w:fldChar`, `w:instrText`, and `w:delInstrText`

### Requirement: Honest generated coverage report

The repository SHALL generate a report summarizing spec-reference coverage
statuses and generated vocabulary use, and the report SHALL state that unlisted
prose requirements remain not yet covered.

#### Scenario: Coverage report is stale

- **WHEN** manifests or source usage change without regenerating the report
- **THEN** `npm run check:ecma-376-coverage` SHALL fail
