## ADDED Requirements

### Requirement: One operation can carry separate private and public explanations

The system SHALL permit one internal rationale and one external-facing rationale
for the same operation. It SHALL enforce uniqueness independently for each
visibility and SHALL preserve the existing rendering authorization boundary.

#### Scenario: [SDX-MDOC-60] External-only compilation keeps paired internal rationale private
- **GIVEN** one operation with one internal and one external-facing rationale
- **WHEN** compilation includes external comments without the dangerous internal-comment capability
- **THEN** the external-facing rationale SHALL become a native comment
- **AND** the internal rationale text SHALL be absent from every output DOCX part

#### Scenario: [SDX-MDOC-61] Duplicate rationale visibility fails before mutation
- **GIVEN** one operation with more than one rationale in the same visibility class
- **WHEN** validation runs
- **THEN** validation SHALL fail before document mutation with a stable duplicate-visibility diagnostic
