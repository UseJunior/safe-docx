## ADDED Requirements

### Requirement: Resolved Markdoc operations receive structural validation

The system SHALL validate resolved Markdoc operations against the pinned source document's ordered hierarchy before mutating a document or writing output. Diagnostics SHALL have stable codes, severity, operation and anchor identity, structural evidence, and a corrective anchor when one is deterministic.

#### Scenario: Parent-child slicing fails before mutation

- **GIVEN** a section-level insertion anchored between a parent paragraph and its existing descendants
- **WHEN** the inserted level would separate those descendants from their parent
- **THEN** validation SHALL emit a parent-child-slicing diagnostic
- **AND** SHALL identify the last descendant before the ancestor boundary as the suggested anchor
- **AND** strict compilation SHALL write no output

#### Scenario: Nested peer insertion is not misdiagnosed

- **GIVEN** an insertion whose intended level is at or below the first following child's level
- **WHEN** structural validation runs
- **THEN** the parent-child-slicing validator SHALL pass

#### Scenario: Validation output is actionable and stable

- **GIVEN** a structurally unsafe resolved operation
- **WHEN** `docx-markdoc validate` or compilation preflight reports it
- **THEN** both surfaces SHALL use the same stable diagnostic code and evidence fields

#### Scenario: Bonded run-in subsection requires two paragraphs

- **GIVEN** the source repeatedly pairs a deterministic heading style with a distinct body-follower style
- **WHEN** an insertion supplies only the heading half or orders the two insertions incorrectly
- **THEN** strict validation SHALL fail before mutation
- **AND** SHALL identify both structural peer styles without relying on title-case text
