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

#### Scenario: [SDX-CMP-UNREP-03] Footer selected by a tracked inserted section is represented

- **GIVEN** a revised DOCX whose tracked inserted section exclusively selects a new relationship-addressed footer
- **WHEN** the pair is successfully compared in place
- **THEN** every paragraph in the inserted footer story SHALL carry tracked insertion evidence
- **AND** text insertions SHALL NOT wrap VML or DrawingML carrier objects
- **AND** the represented footer SHALL NOT also appear in `unrepresentedChanges`

#### Scenario: [SDX-CMP-UNREP-04] Story selected only by a removed section slot is a tracked deletion

- **GIVEN** an original DOCX whose header or footer is selected only by section slots that the revised DOCX no longer has, because the section was removed or it no longer selects that role
- **WHEN** the pair is successfully compared in place
- **THEN** every paragraph in the removed story SHALL carry a tracked paragraph-mark deletion and its text SHALL be `w:delText` inside `w:del`
- **AND** deletions SHALL NOT wrap VML or DrawingML carrier objects
- **AND** reject-all SHALL reselect the story with its original text while accept-all SHALL select it through no section
- **AND** revision identifiers SHALL remain unique across the package
- **AND** the represented story SHALL NOT appear in `unrepresentedChanges`
