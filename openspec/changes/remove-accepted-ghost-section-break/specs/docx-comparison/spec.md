## ADDED Requirements

### Requirement: Accept-All Removes Tracked Paragraph Section-Break Removals

When accepting all revisions, the system SHALL treat a paragraph-owned `w:sectPr` whose only element child is its `w:sectPrChange` snapshot as a tracked removal of that paragraph-level section break, and SHALL remove that section-properties container from the accept-all projection so no ghost section remains. It SHALL NOT remove the body-level final section-properties container or a paragraph-owned section-properties container that has any live section-property child. Reject-all restoration of the prior section properties SHALL be unchanged.

#### Scenario: accepting a tracked section-break removal does not leave a ghost section

- **GIVEN** an invented candidate whose paragraph-owned `w:sectPr` has a `w:sectPrChange` snapshot and no live section-property child
- **WHEN** accept-all and reject-all projections are compared with their corresponding revised and original source views
- **THEN** both formatting-fidelity scores are exactly 1.0
- **AND** accept-all contains no paragraph-owned section-properties container for the removed break
- **AND** reject-all restores the prior section properties

#### Scenario: live and final section properties are preserved

- **GIVEN** section-properties containers with live formatting children or a body-level final section-properties container
- **WHEN** revisions are accepted
- **THEN** those section-properties containers remain present
