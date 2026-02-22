## ADDED Requirements

### Requirement: Comparator Round-Trip Semantic Invariants

The comparator SHALL enforce semantic round-trip invariants using the package read-text surface and structural diagnostics.

#### Scenario: Accept-all and reject-all preserve semantic read-text parity
- **GIVEN** a comparison output document with tracked changes
- **WHEN** `Accept All` is applied to the output
- **THEN** the read-text output SHALL match the revised input document
- **AND** when `Reject All` is applied, the read-text output SHALL match the original input document

#### Scenario: Structural diagnostics remain equivalent across round-trip projections
- **GIVEN** a comparison output document with numbering, notes, and bookmarks
- **WHEN** `Accept All` and `Reject All` projections are computed
- **THEN** numbering, footnote/endnote, and bookmark integrity diagnostics SHALL remain equivalent to the revised and original baselines respectively

### Requirement: Inplace Bookmark Safety Uses Semantic Parity

The inplace reconstruction safety gate SHALL compare bookmark semantics rather than strict bookmark ID identity.

#### Scenario: Inplace remains valid when bookmark IDs are remapped but semantics are preserved
- **GIVEN** a corpus pair where bookmark IDs may differ after reconstruction
- **WHEN** bookmark names, bookmark-reference targets, unresolved-reference sets, and start/end integrity diagnostics match
- **THEN** inplace reconstruction SHALL be accepted
- **AND** the comparator SHALL NOT downgrade to rebuild mode for bookmark-ID mismatch alone

#### Scenario: Inplace downgrades when semantic bookmark parity fails
- **GIVEN** a corpus pair where round-trip checks fail
- **WHEN** semantic bookmark parity or other round-trip safety checks do not hold
- **THEN** the comparator SHALL downgrade from inplace to rebuild mode
- **AND** the fallback reason SHALL be `round_trip_safety_check_failed`

### Requirement: Inplace Paragraph-Boundary Bookmark Preservation

When inplace reconstruction creates paragraphs for deleted or moved-source atoms, paragraph-boundary bookmark markers SHALL be preserved.

#### Scenario: Created inplace paragraphs retain bookmark boundary markers
- **GIVEN** source paragraphs that contain boundary `w:bookmarkStart` and `w:bookmarkEnd` markers
- **WHEN** inplace reconstruction emits created paragraphs for deleted or moved-source content
- **THEN** leading and trailing bookmark markers SHALL be preserved in the created output paragraphs
- **AND** bookmark start/end integrity diagnostics SHALL remain valid after reconstruction
