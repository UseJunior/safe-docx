## ADDED Requirements

### Requirement: Rectangular body-level table rows are structurally editable

The docx-primitives library SHALL insert a row before or after the body-level
table row identified by an anchored paragraph and SHALL delete an identified
row. The operation SHALL validate the complete target table before mutation and
SHALL admit only rectangular, unmerged, revision-free tables whose direct cells
end in direct paragraphs and contain no nested tables. Unsupported or malformed
topology SHALL fail transactionally with a typed diagnostic naming the first
unsupported feature and coordinate.

#### Scenario: [SDX-TABLEROW-01] clean insertion uses an anchored formatting shell
- **GIVEN** an anchored paragraph in a rectangular body-level table row
- **WHEN** a caller inserts a row before or after it with one text value per grid column
- **THEN** the new row SHALL occupy the requested position and contain the supplied text
- **AND** its row, cell, and paragraph formatting shell SHALL derive from the anchor row
- **AND** each new cell SHALL end in a direct `w:p`
- **AND** the source row and all unrelated table content SHALL remain unchanged

#### Scenario: [SDX-TABLEROW-02] inserted rows do not duplicate anchored content
- **GIVEN** an admitted anchor row whose paragraphs carry deterministic bookmarks
- **WHEN** a row is inserted from that row's formatting shell
- **THEN** no source bookmark start or end SHALL be copied into the inserted row
- **AND** fields, comments, drawings, content controls, nested blocks, and revision records SHALL not be cloned
- **AND** the output bookmark inventory SHALL remain valid

#### Scenario: [SDX-TABLEROW-03] clean deletion preserves a valid table
- **GIVEN** an admitted table with at least two direct rows
- **WHEN** a caller deletes the row identified by an anchored paragraph
- **THEN** exactly that direct row SHALL be removed
- **AND** grid columns and all other rows SHALL remain unchanged
- **AND** deleting the table's final direct row SHALL fail before mutation

### Requirement: Tracked table-row topology round-trips through accept and reject

Tracked insertion SHALL mark the inserted row with `w:trPr > w:ins` according
to ECMA-376 5th edition Part 1 §17.13.5.19. Tracked deletion SHALL mark the
existing row with `w:trPr > w:del` according to §17.13.5.16. Accept and reject
SHALL resolve those semantic row markers rather than treating them as content
wrappers, and SHALL preserve unsupported side-story row markers.

#### Scenario: [SDX-TABLEROW-04] tracked insertion has inverse projections
- **GIVEN** an admitted source table and a requested row insertion
- **WHEN** tracked output is produced
- **THEN** accept-all SHALL keep the inserted row and remove its row marker
- **AND** reject-all SHALL remove the inserted row
- **AND** reject-all topology and content SHALL equal the source
- **AND** accept-all topology and content SHALL equal the clean insertion

#### Scenario: [SDX-TABLEROW-05] tracked deletion has inverse projections
- **GIVEN** an admitted source table with at least two rows and a requested row deletion
- **WHEN** tracked output is produced
- **THEN** accept-all SHALL remove the deleted row
- **AND** reject-all SHALL keep the row and remove its row marker
- **AND** reject-all topology and content SHALL equal the source
- **AND** accept-all topology and content SHALL equal the clean deletion

#### Scenario: [SDX-TABLEROW-06] selective resolution and unresolved counts remain honest
- **GIVEN** body-level row markers created by the supported primitive and unsupported row markers outside that scope
- **WHEN** accept or reject runs with or without a revision filter
- **THEN** only selected supported markers SHALL alter row topology
- **AND** unsupported markers SHALL remain attached to their rows
- **AND** `unresolvedRowRevisions` SHALL equal the unsupported selected markers left in the output

### Requirement: Ambiguous table topology fails closed

The row operations SHALL reject a target table containing `w:gridSpan`,
`w:vMerge`, `w:gridBefore`, `w:gridAfter`, nested tables, heterogeneous direct
cell counts, missing trailing cell paragraphs, or pre-existing revision markup.
The complete validation SHALL occur before revision metadata allocation or DOM
mutation.

#### Scenario: [SDX-TABLEROW-07] merge and nested-table guards are table-wide
- **GIVEN** a target body-level table containing a horizontal span, vertical-merge chain, row offset, or nested table anywhere in its direct rows
- **WHEN** insertion or deletion is requested against any row in that table
- **THEN** the operation SHALL fail before mutation
- **AND** the diagnostic SHALL identify the unsupported feature and its row/cell coordinate

#### Scenario: [SDX-TABLEROW-08] malformed and revised tables are transactional
- **GIVEN** a target table with heterogeneous row occupancy, a cell not ending in a direct paragraph, or existing revision markup
- **WHEN** insertion or deletion is requested
- **THEN** the operation SHALL fail without changing serialized document XML
- **AND** no revision identifier SHALL be consumed by the failed operation
