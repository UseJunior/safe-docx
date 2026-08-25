## ADDED Requirements

### Requirement: Annotation-only projection preserves existing revisions

The compiler SHALL admit annotation-only compilation from a source containing
supported existing tracked revisions. It SHALL preserve each existing revision's
serialized XML, type, ID, author, date, content, accept/reject semantics, order,
and WordprocessingML story placement while applying canonical annotation body
edits and presentation choices.

#### Scenario: [SDX-MDOC-92] Existing insertion survives ranged-comment editing
- **GIVEN** a source containing an existing insertion and an admitted ranged comment
- **WHEN** the canonical comment body is edited and projected
- **THEN** the edited comment SHALL reopen with its range intact
- **AND** the existing insertion SHALL retain exact XML and accept/reject semantics

#### Scenario: [SDX-MDOC-93] Existing deletion survives point-comment editing
- **GIVEN** a source containing an existing deletion and an admitted point comment
- **WHEN** the canonical comment body is edited and projected
- **THEN** the edited point comment SHALL reopen at the same visible coordinate
- **AND** the existing deletion SHALL retain exact XML and accept/reject semantics

#### Scenario: [SDX-MDOC-94] Existing revisions survive footnote presentation changes
- **GIVEN** a source containing an existing revision and an admitted point footnote
- **WHEN** the footnote body is edited and projected as a footnote or point comment
- **THEN** each annotation projection SHALL contain the edited body at the canonical point
- **AND** the existing revision SHALL retain exact XML and accept/reject semantics

#### Scenario: [SDX-MDOC-95] Operative edits with existing revisions fail closed
- **GIVEN** a source containing existing revisions and a canonical compile request containing operative text edits
- **WHEN** compilation is attempted
- **THEN** compilation SHALL fail before document mutation with revision and operation diagnostics
- **AND** SHALL publish no partial output

#### Scenario: [SDX-MDOC-96] Reply topology survives beside existing revisions
- **GIVEN** a source containing an existing revision and an admitted comment thread
- **WHEN** a reply body is edited and the thread is projected as comments
- **THEN** the edited reply SHALL reopen under its original root comment
- **AND** the existing revision SHALL retain exact XML and accept/reject semantics
