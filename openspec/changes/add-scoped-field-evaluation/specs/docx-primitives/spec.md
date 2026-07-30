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

### Requirement: Refresh refuses projections it cannot represent faithfully

The refresh operation SHALL cache a REF result only when the bookmarked
projection is a single run of characters. Word writes tabs, breaks, and
paragraph transitions structurally, so a projection containing them SHALL be
reported `unsupported` rather than flattened into literal control characters.

A `w:fldSimple` element and its descendants SHALL be opaque to complex-field
collection, and SHALL NOT be adopted as an enclosing field's instruction or
cached result.

#### Scenario: [SDX-FIELD-EVAL-08] Layout-bearing bookmark projection is refused

- **GIVEN** a deterministic REF whose bookmark range contains a tab, a break, or
  a paragraph transition
- **WHEN** scoped field refresh runs
- **THEN** the cached result SHALL remain unchanged
- **AND** the outcome SHALL be `unsupported` with reason `unsupported-bookmark-layout`

#### Scenario: [SDX-FIELD-EVAL-09] Simple field inside a cached result is opaque

- **GIVEN** a `w:fldSimple` element inside an outer complex field's result range
- **WHEN** scoped field refresh evaluates the outer field
- **THEN** the simple field's cached text SHALL remain unchanged

### Requirement: Revision state and story scope are reported honestly

Instruction text carried inside a deletion revision SHALL NOT be concatenated
with surviving instruction text. Classification SHALL read the surviving
instruction, falling back to the deleted instruction only when no surviving
instruction remains.

The DOCX-buffer refresh operation SHALL name every field-bearing part it did
not read. A field locator SHALL omit its paragraph ordinal rather than report a
sentinel when the field has no paragraph ancestor.

#### Scenario: [SDX-FIELD-EVAL-10] Revised instruction classifies from the surviving text

- **GIVEN** a REF field whose instruction was retargeted under tracked changes
- **WHEN** scoped field refresh runs
- **THEN** the reported instruction SHALL be the surviving instruction alone
- **AND** the outcome SHALL be `unsupported` with reason `field-contains-revisions`

#### Scenario: [SDX-FIELD-EVAL-11] Unread field-bearing stories are named

- **GIVEN** a DOCX package containing headers, footers, or footnotes
- **WHEN** DOCX-buffer field refresh runs
- **THEN** the result SHALL list those parts as skipped stories
