## ADDED Requirements

### Requirement: Unresolvable Row-Level Revision Preservation

The accept and reject engines SHALL NOT remove a row-level revision marker (`w:tr > w:trPr > w:ins`,
`w:tr > w:trPr > w:del`) in the direction they cannot resolve. Such a marker describes the ROW rather than
wrapping a span of content, so the existing content-wrapper sweeps do not apply to it.

Two directions are unresolvable and SHALL preserve the marker together with its `w:tr`: `acceptChanges` over
`w:trPr > w:del` (the row should disappear) and `rejectChanges` over `w:trPr > w:ins` (the inserted row should
disappear). The other two directions are resolved correctly by keeping the row and dropping the marker, and SHALL
continue to do so.

Preserved markers SHALL be reported as `unresolvedRowRevisions` on `AcceptChangesResult` and
`RejectChangesResult`, separately from the resolved-revision counters, and SHALL NOT cause a document to be
treated as changed. Removing the marker while keeping the row would destroy the `w:id`/`w:author`/`w:date`
evidence and leave no residual record, so this requirement follows the preserve-and-report convention already
applied to other unresolved advanced revision records.

Resolving row-level revisions semantically is out of scope; `packages/docx-core/src/cli/conformance-adapter.ts`
already classifies both unresolvable combinations as `supported: false`, and this requirement makes the library
and MCP surfaces agree with that classification.

#### Scenario: [SDX-ROWREV-01] accepting a deleted row preserves the unresolvable marker
- **GIVEN** a table row whose `w:trPr` carries a `w:del` row-level revision marker
- **WHEN** `acceptChanges` processes the document
- **THEN** the `w:del` marker SHALL be preserved with its `w:id`, `w:author` and `w:date` intact
- **AND** the `w:tr` SHALL be preserved
- **AND** the marker SHALL NOT be counted in `deletionsAccepted`
- **AND** the result SHALL report `unresolvedRowRevisions` as `1`

#### Scenario: [SDX-ROWREV-02] rejecting an inserted row preserves the unresolvable marker
- **GIVEN** a table row whose `w:trPr` carries an `w:ins` row-level revision marker
- **WHEN** `rejectChanges` processes the document
- **THEN** the `w:ins` marker SHALL be preserved with its `w:id`, `w:author` and `w:date` intact
- **AND** the `w:tr` SHALL be preserved
- **AND** the marker SHALL NOT be counted in `insertionsRemoved`
- **AND** the result SHALL report `unresolvedRowRevisions` as `1`

#### Scenario: [SDX-ROWREV-03] row markers the engine resolves correctly are still removed
- **GIVEN** a table row whose `w:trPr` carries an `w:ins` marker
- **WHEN** `acceptChanges` processes the document
- **THEN** the marker SHALL be removed and the `w:tr` SHALL be preserved, because accepting an inserted row keeps the row
- **AND** the symmetric case SHALL hold for `rejectChanges` over a `w:trPr > w:del` marker
- **AND** neither case SHALL be reported in `unresolvedRowRevisions`

#### Scenario: [SDX-ROWREV-04] content revisions and selective filters are unaffected
- **GIVEN** a document containing content revisions, property change records and moves but no row-level markers
- **WHEN** either engine processes the document
- **THEN** the resolved-revision counters SHALL be unchanged from the previous behavior
- **AND** `unresolvedRowRevisions` SHALL be `0`
- **AND** a selective accept or reject SHALL count only the row markers its `RevisionFilter` selects
