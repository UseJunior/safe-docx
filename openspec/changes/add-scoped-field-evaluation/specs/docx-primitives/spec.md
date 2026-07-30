## ADDED Requirements

### Requirement: Scoped deterministic Word field refresh

The system SHALL expose a transactional main-story field refresh operation that
evaluates the bookmarked-text projection of an admitted REF complex field from
one unique, well-formed bookmark range, preserves the first cached-result run's
formatting, and returns a structured outcome for every encountered outer
complex field.

The operation SHALL NOT evaluate layout-dependent PAGE, NUMPAGES, PAGEREF, or
TOC results. When requested, it SHALL mark those fields dirty for host
recalculation without changing their cached result.

#### Scenario: [SDX-FIELD-EVAL-01] REF cache refreshes from bookmark text

- **GIVEN** a complete, untracked REF field with a stale cached result
- **AND** its target name resolves to exactly one ID-paired bookmark range
- **WHEN** scoped field refresh runs
- **THEN** the first cached-result text payload SHALL contain the bookmarked
  visible text
- **AND** the result run and its formatting SHALL remain in place
- **AND** the field outcome SHALL be `evaluated`

#### Scenario: [SDX-FIELD-EVAL-02] Layout-dependent field is marked dirty

- **GIVEN** a complete PAGE, NUMPAGES, PAGEREF, or TOC field
- **WHEN** scoped field refresh runs with layout-dependent dirty marking enabled
- **THEN** its begin field character SHALL carry `w:dirty="true"`
- **AND** its cached result SHALL remain unchanged
- **AND** the field outcome SHALL be `dirtied`

#### Scenario: [SDX-FIELD-EVAL-03] Unsupported REF projection is preserved

- **GIVEN** a REF instruction with a numbering, position, separator, unknown, or
  otherwise unsupported projection switch
- **WHEN** scoped field refresh runs
- **THEN** the field XML SHALL remain unchanged
- **AND** the field outcome SHALL be `unsupported` with a stable reason

#### Scenario: [SDX-FIELD-EVAL-04] Ambiguous bookmark does not retarget

- **GIVEN** a REF target with duplicate names, duplicate IDs, a missing paired
  end, a reversed range, or a self-reference
- **WHEN** scoped field refresh runs
- **THEN** the field SHALL remain unchanged
- **AND** the outcome SHALL identify the bookmark-resolution failure

#### Scenario: [SDX-FIELD-EVAL-05] Malformed field topology fails transactionally

- **GIVEN** a main story with stray, duplicated, unknown, or unclosed complex
  field markers
- **WHEN** scoped field refresh runs
- **THEN** the operation SHALL throw a typed structural error
- **AND** it SHALL return no mutated XML
