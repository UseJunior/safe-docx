## ADDED Requirements

### Requirement: AI Revision Validation

The docx-primitives library SHALL validate AI-authored tracked-change markup across DOCX story parts using the ECMA-376 tracked-change vocabulary supported by SafeDocX.

AI-authored revision anomalies SHALL be returned as errors. Foreign-authored revision anomalies SHALL be returned as warnings. The validator SHALL NOT hard-error solely because a valid-but-unemitted tracked-change element type appears.

#### Scenario: valid AI revision markup passes
- **GIVEN** a document containing AI-authored tracked changes with valid `w:id`, `w:author`, and `w:date` metadata
- **WHEN** AI revision validation runs for that AI author
- **THEN** the result SHALL contain no errors

#### Scenario: malformed AI revision metadata fails
- **GIVEN** a document containing an AI-authored tracked change with a missing author, non-integer `w:id`, or invalid `w:date`
- **WHEN** AI revision validation runs for that AI author
- **THEN** the result SHALL contain a hard validation error identifying the malformed revision

#### Scenario: malformed foreign revision metadata warns
- **GIVEN** a document containing a foreign-authored tracked change with malformed metadata
- **WHEN** AI revision validation runs for the configured AI author
- **THEN** the result SHALL report a warning
- **AND** the result SHALL NOT report a hard error for that foreign revision

#### Scenario: AI revision IDs are unique across story parts
- **GIVEN** a document containing two AI-authored revisions with the same `w:id` in different story parts
- **WHEN** AI revision validation runs
- **THEN** the result SHALL contain a hard validation error for duplicate AI revision IDs

#### Scenario: paired range markers are balanced
- **GIVEN** a document containing AI-touched range markers such as move, comment, permission, or custom XML start/end pairs
- **WHEN** AI revision validation runs
- **THEN** every start marker SHALL have a matching end marker with the same ID in the same story
- **AND** missing or mismatched AI-touched pairs SHALL be hard validation errors

#### Scenario: field structure remains valid
- **GIVEN** a document containing AI-authored tracked changes around Word fields
- **WHEN** AI revision validation runs
- **THEN** field begin/separate/end state SHALL remain valid per story
- **AND** deleted field code text SHALL use deletion-safe field text elements

#### Scenario: tracked-change placement rules are enforced
- **GIVEN** a document containing AI-authored tracked-change elements in structural locations
- **WHEN** AI revision validation runs
- **THEN** cell change records SHALL appear under `w:tcPr`
- **AND** table-grid change records SHALL appear under `w:tblGrid`
- **AND** section-property change records SHALL appear under `w:sectPr`
- **AND** numbering change records SHALL appear under paragraph or run properties

### Requirement: DOCX Package Revision Invariants

The docx-primitives library SHALL validate package-level invariants for AI-touched side effects associated with revision-bearing operations.

#### Scenario: relationship targets resolve to package parts
- **GIVEN** an AI-touched relationship whose target mode is not external
- **WHEN** package revision invariant validation runs
- **THEN** the relationship target SHALL resolve relative to the source `.rels` part
- **AND** the resolved target part SHALL exist in the DOCX package

#### Scenario: external relationship targets are exempt
- **GIVEN** a relationship with `TargetMode="External"`
- **WHEN** package revision invariant validation runs
- **THEN** the validator SHALL NOT require the target URI to exist as a package part

#### Scenario: created side parts are registered
- **GIVEN** an AI operation creates a side part such as comments, footnotes, or people metadata
- **WHEN** package revision invariant validation runs
- **THEN** the created side part SHALL have a matching `[Content_Types].xml` registration
