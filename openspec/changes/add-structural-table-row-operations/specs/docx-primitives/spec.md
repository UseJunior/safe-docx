## ADDED Requirements

### Requirement: Rectangular body-level table rows are structurally editable

The docx-primitives library SHALL insert a row before or after the body-level
table row identified by an anchored paragraph and SHALL delete an identified
row. Before allocating revision IDs or mutating the DOM, it SHALL validate the
complete target table as rectangular and unmerged, with direct rows/cells,
trailing direct cell paragraphs, and no unsupported topology revisions.
Unsupported or malformed topology SHALL fail transactionally with a typed
diagnostic containing the anchor, table/row/cell coordinate, and feature.

#### Scenario: [SDX-TABLEROW-01] clean insertion uses an anchored formatting shell
- **GIVEN** an anchored paragraph in an admitted body-level table row
- **WHEN** a caller inserts a row before or after it with one text value per grid column
- **THEN** the new row SHALL occupy the requested position and contain the supplied text
- **AND** its row, cell, paragraph, and run formatting SHALL use the explicit safe-property subset defined by the design
- **AND** each new cell SHALL end in one direct `w:p` with a fresh deterministic bookmark
- **AND** the result SHALL return `{ rowIndex, cellParagraphIds }` so another insertion can target the new row
- **AND** unrelated table content SHALL remain unchanged

#### Scenario: [SDX-TABLEROW-02] inserted rows do not duplicate authored content or semantic properties
- **GIVEN** an admitted anchor row carrying bookmarks and formatting properties that the safe-shell contract excludes
- **WHEN** a row is inserted from that row's formatting shell
- **THEN** source bookmarks, fields, comments, drawings, content controls, authored blocks, and revision records SHALL not be copied
- **AND** `cnfStyle`, `tblHeader`, `hidden`, `divId`, `hideMark`, `numPr`, and section/revision properties SHALL not be copied
- **AND** the output bookmark inventory SHALL remain valid

#### Scenario: [SDX-TABLEROW-03] clean deletion preserves table and range validity
- **GIVEN** an admitted table with at least two direct rows
- **WHEN** a caller deletes the row identified by an anchored paragraph
- **THEN** exactly that row SHALL be removed while grid columns and other rows remain unchanged
- **AND** every removed paragraph anchor SHALL become unresolvable
- **AND** a range with exactly one endpoint in the removed row SHALL have its surviving endpoint removed
- **AND** deleting the final direct row SHALL fail before mutation

### Requirement: Ambiguous table topology fails closed

Row operations SHALL reject `w:gridSpan`, `w:vMerge`, `w:gridBefore`,
`w:gridAfter`, nested tables, `w:tblPrEx`, wrapped row/cell containers,
heterogeneous direct occupancy, missing trailing cell paragraphs, and topology
revision records. Ordinary content revisions and row-level markers SHALL remain
admissible; phase one SHALL reject tracked deletion of a row already marked
inserted or deleted. Failed tracked operations SHALL leave both serialized XML
and `ctx.idState.nextId` unchanged.

#### Scenario: [SDX-TABLEROW-07] merge, wrapper, and nested-table guards are table-wide
- **GIVEN** a target table containing a span, vertical merge, row offset, nested table, `w:tblPrEx`, or wrapped row/cell anywhere
- **WHEN** insertion or deletion is requested against any row in that table
- **THEN** the operation SHALL fail before mutation
- **AND** `SafeDocxError` code SHALL be `UNSUPPORTED_EDIT`
- **AND** its detail SHALL identify the unsupported feature and row/cell or child coordinate

#### Scenario: [SDX-TABLEROW-08] malformed and topology-revised tables are transactional
- **GIVEN** heterogeneous occupancy, a cell not ending in a direct paragraph, a topology revision, an invalid value count, or final-row deletion
- **WHEN** insertion or deletion is requested
- **THEN** the operation SHALL fail without changing serialized document XML
- **AND** the error SHALL distinguish `UNSUPPORTED_EDIT` topology from `INVALID_ARGUMENT` input
- **AND** `ctx.idState.nextId` SHALL be unchanged

### Requirement: Row-Level Revision Resolution

Accept and reject SHALL resolve row-level revision markers (`w:tr > w:trPr >
w:ins|w:del`) wherever the engine runs, including body, side-story, and nested
tables. A selected marker removes or retains its enclosing row according to
ECMA-376 5th edition Part 1 §§17.13.5.17 and 17.13.5.12, rather than being
treated as an empty content wrapper. Content inside a removed row disappears
with that row even when it carries an unselected revision; those inner records
SHALL not be reported as separately resolved. Foreign row markers SHALL remain
untouched, including through sibling `w:trPrChange` restoration.

Tracked row mutation SHALL also mark paragraph marks and run contents under
§§17.13.5.20/17.13.5.18 and §§17.13.5.15/17.13.5.14 respectively. Projection
checks SHALL compare reject-all output with reject-all source and accept-all
output with accept-all clean output, so pre-existing content revisions remain
composable. `unresolvedRowRevisions` remains required for result-shape
compatibility and SHALL be `0`; the field no longer represents any admitted
row-marker class.

#### Scenario: [SDX-TABLEROW-04] tracked insertion has inverse projections
- **GIVEN** an admitted source table and a requested row insertion
- **WHEN** tracked output is produced with row, paragraph-mark, and run-content insertion records
- **THEN** accept-all SHALL keep the inserted row and remove its revision records
- **AND** reject-all SHALL remove the inserted row
- **AND** reject-all SHALL equal reject-all of the source
- **AND** accept-all SHALL equal accept-all of the clean insertion

#### Scenario: [SDX-TABLEROW-05] tracked deletion has inverse projections and valid ranges
- **GIVEN** an admitted source table with at least two rows and a requested row deletion
- **WHEN** tracked output is produced with row, paragraph-mark, and run-content deletion records
- **THEN** accept-all SHALL remove the row and repair any cross-row range whose other endpoint would be orphaned
- **AND** reject-all SHALL keep the row and remove its revision records
- **AND** reject-all SHALL equal reject-all of the source
- **AND** accept-all SHALL equal accept-all of the clean deletion

#### Scenario: [SDX-TABLEROW-06] selective row resolution is explicit and honest
- **GIVEN** row markers in any story processed by the engine, with inner content revisions and a foreign row marker
- **WHEN** accept or reject runs with a filter selecting one row marker
- **THEN** the selected marker SHALL apply its whole-row semantic even if the row contains unselected content revisions
- **AND** the foreign row marker and row SHALL remain byte-for-byte unchanged
- **AND** surviving row markers SHALL remain intact through `w:trPrChange` restoration
- **AND** `unresolvedRowRevisions` SHALL be `0` for the supported selected marker

## REMOVED Requirements

### Requirement: Unresolvable Row-Level Revision Preservation

**Reason**: Row-level markers are now resolved semantically in every processed
story; this requirement is superseded by `Row-Level Revision Resolution`.

**Migration**: `unresolvedRowRevisions` stays on `AcceptChangesResult` and
`RejectChangesResult` and reports `0` for supported markers. Callers that
previously branched on a non-zero value now receive a resolved row topology.
