## ADDED Requirements

### Requirement: Numbered paragraph reorder reader fidelity

For supported numbered-paragraph reorders, the comparison engine SHALL preserve the numbering and paragraph formatting of each corresponding source state through native and independently checked reader projections. Accept SHALL match the revised state and Reject SHALL match the original state. Changed ordinal values caused by the revised ordering SHALL NOT be treated as numbering loss.

#### Scenario: Reject restores the original numbered paragraph

- **GIVEN** a numbered paragraph with a note moves between stable paragraphs
- **WHEN** all generated revisions are rejected
- **THEN** original paragraph order, text, note binding and numbering SHALL be restored
- **AND** the restored paragraph SHALL NOT become an unnumbered list header unless the original was one

#### Scenario: Accept permits correct renumbering

- **GIVEN** the revised ordering changes a paragraph's automatically displayed ordinal
- **WHEN** all generated revisions are accepted
- **THEN** the numbering SHALL match the revised source state rather than the paragraph's former ordinal
- **AND** neighboring paragraphs SHALL retain their revised formatting without extra empty paragraphs

#### Scenario: Reader agreement does not bypass native formatting failure

- **GIVEN** a candidate matches an independent reader's measured projections but fails native formatting fidelity
- **WHEN** release readiness is evaluated
- **THEN** the candidate SHALL remain blocked until the disagreement is explained and repaired
- **AND** successful schema validation or text-only comparison SHALL NOT override that failure

### Requirement: Complete field deletion preserves paragraph formatting

When all boundaries and contents of complete complex fields are deleted together, the serializer SHALL keep those boundaries inside the deletion rather than emit surviving field objects. It SHALL distinguish complete sequences, including multiple and nested fields, from partial field revisions.

#### Scenario: Complete field deletion does not leave live controls

- **GIVEN** a deleted paragraph contains multiple or nested complete fields
- **WHEN** all generated deletions are accepted
- **THEN** the deleted fields SHALL leave no live field controls
- **AND** the following surviving paragraph SHALL retain its expected formatting

#### Scenario: Partial field controls retain their existing boundary treatment

- **GIVEN** a deleted fragment contains only part of a complex field
- **WHEN** the fragment is serialized
- **THEN** the complete-field exemption SHALL NOT absorb field controls that belong to the surviving field structure
