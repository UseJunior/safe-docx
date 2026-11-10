## ADDED Requirements
### Requirement: Nested field structural checks
The structural package checker SHALL support nested fields, optional separators,
and fields spanning paragraphs within a story part. It SHALL reject stray or
duplicate markers and unclosed fields independently in each story part, note,
comment, or text box.

#### Scenario: [SDX-FIELD-001] nested and spanning fields use strict story-local traversal
- **WHEN** generated package field structure is checked
- **THEN** valid nested fields and optional separators SHALL pass

#### Scenario: [SDX-FIELD-002] malformed field markers fail strictly
- **WHEN** a story contains stray or duplicate markers, an unknown marker, or an unclosed field
- **THEN** the structural checker SHALL report field pairing issues

#### Scenario: [SDX-FIELD-003] field stacks do not pair body markers with footer markers
- **WHEN** a field begins in the body and ends in a footer
- **THEN** the checker SHALL report field pairing issues for both parts

#### Scenario: [SDX-FIELD-004] notes and text boxes cannot close fields in another story
- **WHEN** unmatched field markers in notes, comments, or text boxes balance across independent stories
- **THEN** the checker SHALL report field pairing issues for each malformed story
