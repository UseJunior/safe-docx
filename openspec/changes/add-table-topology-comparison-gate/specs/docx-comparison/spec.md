## ADDED Requirements

### Requirement: Two-file comparison preserves table-topology truth

The comparator SHALL publish schema-valid native whole-row insertion and deletion revisions when its tagged alignment identifies a complete row or an unmatched whole table. It SHALL refuse unsupported main-body table-grid, column, or individual-cell topology changes in matched tables before returning a DOCX rather than presenting them as ordinary cell-text edits or emitting malformed OOXML. The main-body guard SHALL identify the table and affected logical coordinates in a typed diagnostic. Unsupported selected header/footer scaffold changes SHALL continue to use the existing SDX-CMP-STORY-05 precise `unrepresentedChanges`/typed-diagnostic contract.

#### Scenario: [SDX-COMPTABLE-01] whole-row insertion and deletion remain native
- **GIVEN** two documents that differ by one complete table row while the grid and matched-row cell intervals remain unchanged
- **WHEN** they are compared in either direction
- **THEN** the result SHALL contain one native `w:trPr/w:ins` or `w:trPr/w:del` marker, respectively
- **AND** accept-all SHALL project to the revised table, reject-all to the original table, and the emitted document SHALL validate against the vendored Transitional schema

#### Scenario: [SDX-COMPTABLE-02] changed grid topology fails closed
- **GIVEN** matched tables whose direct `tblGrid` column sequence differs in count or width
- **WHEN** the documents are compared
- **THEN** main-body comparison SHALL throw a typed table-grid diagnostic before returning a DOCX, with table and logical-column coordinates, even if no rows were matched
- **AND** a width-only change SHALL have a distinct `tblGridWidth` feature

#### Scenario: [SDX-COMPTABLE-03] individual-cell topology fails closed
- **GIVEN** matched rows that differ in physical-cell count, `gridSpan` intervals, or row offsets
- **WHEN** the documents are compared
- **THEN** main-body comparison SHALL throw a typed row/cell/column diagnostic before returning a DOCX
- **AND** no invalid direct `w:tc` insertion/deletion wrapper SHALL be published

#### Scenario: [SDX-COMPTABLE-04] ordinary table content remains comparable
- **GIVEN** matched tables with unchanged grid and cell intervals but changed cell text or safe properties
- **WHEN** the documents are compared
- **THEN** the existing text/property redline path SHALL remain available and the emitted document SHALL be schema-valid
- **AND** an unchanged table SHALL not be rejected solely because an occupancy inventory cannot model its identical structure
- **AND** text-only edits in tables with `w:tblPrEx` or `w:sdt`-wrapped rows SHALL keep succeeding when their structural skeleton is unchanged

#### Scenario: [SDX-COMPTABLE-06] unmatched whole tables use native row revisions
- **GIVEN** a whole table is inserted or deleted, including a table containing a nested table
- **WHEN** the documents are compared in either direction
- **THEN** each physical row SHALL carry the appropriate native `w:trPr/w:ins` or `w:trPr/w:del` marker, without wrapping `w:tbl` in `w:ins` or `w:del` under `w:body`
- **AND** accept-all and reject-all SHALL project to the revised and original documents respectively, and emitted XML SHALL validate against the vendored Transitional schema
- **AND** both docx-core and docx-compare accept/reject engines SHALL restore the source top-level block order, table count, and row count, including nested and adjacent-table cases
- **AND** the comparator acceptor SHALL remove a table only when resolution changes that same table from at least one row container to none, counting direct `w:tr` and `w:sdt`/`w:customXml`-wrapped rows; an unrelated already-empty table and a table still holding a wrapped row SHALL survive

#### Scenario: [SDX-COMPTABLE-08] unsupported unmatched table shape fails closed
- **GIVEN** an unmatched main-body table with zero rows, wrapped rows, or pre-existing row revision markers that prevent faithful native row projection
- **WHEN** the documents are compared
- **THEN** comparison SHALL throw a typed `emptyTable` or `tableContainer` diagnostic before returning a DOCX

#### Scenario: [SDX-COMPTABLE-07] selected story scaffold changes remain explicit
- **GIVEN** a selected header or footer has unsupported table insertion, deletion, row, or column topology changes
- **WHEN** the documents are compared
- **THEN** the comparator SHALL retain the SDX-CMP-STORY-05 precise `unrepresentedChanges` or typed-diagnostic contract and SHALL not emit malformed story XML

### Requirement: Comparison statistics distinguish structural table rows

The result SHALL report comparison-generated complete-row insertions and deletions separately from text/range metrics. Pre-existing row revisions SHALL not inflate those counters. Unsupported column/cell topology SHALL be reported by a typed error, not by a successful result with fabricated counts.

#### Scenario: [SDX-COMPTABLE-05] row counts are independent of text ranges
- **GIVEN** a comparison with one complete inserted or deleted row containing multiple paragraphs
- **WHEN** the result statistics are reported
- **THEN** `insertedTableRows` or `deletedTableRows` SHALL equal one, regardless of the number of `w:ins`/`w:del` text ranges inside that row
- **AND** the existing `tagged-token-v1` text and atom metrics SHALL retain their meanings
- **AND** nested-table rows and every row of an inserted/deleted whole table SHALL count once, while pre-existing row revisions SHALL not count
