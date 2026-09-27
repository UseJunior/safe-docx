## ADDED Requirements

### Requirement: Edits are named by the edit attribute

The system SHALL read the name of an edit from the `edit` attribute on the
`change`, `replace-source`, `delete-source`, `insert-before`, `insert-after`,
`insert-table-rows` and `delete-table-row` tags, and optionally on
`annotation`, and SHALL read change-set membership from `edits`. Rationale
`for` and requirement `satisfied-by` references SHALL resolve against those
names. The `id` attribute of a source-anchored tag SHALL remain the source
paragraph identity and SHALL NOT be used as the edit name. The former
`operation` and `operations` spellings SHALL be accepted with a deprecation
warning for one minor version.

#### Scenario: [SDX-MDOC-147] New spelling parses without warnings and compiles
- **GIVEN** canonical Markdoc whose edit tags use `edit=` and whose change sets use `edits=`
- **WHEN** the Markdoc is validated and compiled
- **THEN** validation SHALL succeed with no warnings
- **AND** rationale, annotation, requirement and change-set references SHALL resolve to the named edit
- **AND** the verification certificate SHALL carry no Markdoc warnings

#### Scenario: [SDX-MDOC-148] Deprecated `operation=` spelling warns but still compiles
- **GIVEN** Markdoc that names an edit with `operation=` or lists change-set members with `operations=`
- **WHEN** the Markdoc is validated and compiled
- **THEN** validation SHALL succeed
- **AND** each deprecated attribute SHALL produce a `DEPRECATED_EDIT_ATTRIBUTE` warning naming the replacement spelling and its line
- **AND** compilation SHALL record those warnings in the certificate without changing delivery readiness

#### Scenario: [SDX-MDOC-149] Both spellings on one tag are rejected
- **GIVEN** one tag that sets both `edit=` and `operation=`, or both `edits=` and `operations=`
- **WHEN** the Markdoc is validated
- **THEN** validation SHALL fail with `CONFLICTING_EDIT_ATTRIBUTES`

#### Scenario: [SDX-MDOC-150] Import emits only the new spelling
- **GIVEN** a DOCX imported to canonical Markdoc
- **WHEN** the emitted Markdoc is inspected and re-validated
- **THEN** it SHALL contain no `operation=` or `operations=` attribute
- **AND** it SHALL validate without warnings
- **AND** importing the same source again SHALL produce byte-identical Markdoc
