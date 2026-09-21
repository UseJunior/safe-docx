## ADDED Requirements

### Requirement: Whole-row comparison emits complete revision state

Tagged comparison SHALL independently mark affected paragraph marks and cell
run contents whenever it represents a pure table-row insertion or deletion
with a row-level marker, so the row topology and its contents both carry native
revision state. Operation provenance for a structural row change SHALL be
attached only to run-content revision wrappers, not to row or paragraph-mark
property markers.

#### Scenario: [SDX-CMP-ROW-01] Inserted and deleted rows carry complete revisions
- **GIVEN** two admitted documents that differ by a pure rectangular table-row insertion or deletion
- **WHEN** tagged comparison emits tracked OOXML
- **THEN** the changed row SHALL carry the corresponding `w:trPr` row marker
- **AND** its affected paragraph marks and run contents SHALL carry independent insertion or deletion revisions
- **AND** deleted run text SHALL use `w:delText`
- **AND** accept-all and reject-all SHALL reproduce the revised and source text, formatting, and table topology
- **AND** the emitted document SHALL validate against the targeted Transitional WML schema

#### Scenario: [SDX-CMP-ROW-02] Structural attribution excludes property markers
- **GIVEN** a complete whole-row revision attributed to one structural operation
- **WHEN** tagged revision attribution resolves its start and end revisions
- **THEN** both endpoints SHALL be run-content revisions whose parents admit comment range markers
- **AND** the row-level and paragraph-mark revision markers SHALL carry no operation provenance
