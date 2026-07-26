## ADDED Requirements

### Requirement: Unrepresented package-level changes are reported

The atomizer comparison result SHALL expose structured
`unrepresentedChanges` diagnostics when the original and revised packages
differ in section properties or relationship-selected header/footer stories
and those changes are not represented by revision markup. Text revision
statistics SHALL retain their existing meaning.

#### Scenario: [SDX-CMP-UNREP-01] Added section and footer are surfaced

- **GIVEN** a revised DOCX that adds a section break and a relationship-selected footer while body text remains unchanged
- **WHEN** the pair is successfully compared
- **THEN** the result SHALL include section and footer entries in `unrepresentedChanges`
- **AND** zero text insertions and deletions SHALL not suppress those entries

#### Scenario: [SDX-CMP-UNREP-02] Identical package state reports no unrepresented changes

- **GIVEN** identical original and revised DOCX packages
- **WHEN** they are compared
- **THEN** `unrepresentedChanges` SHALL be absent
