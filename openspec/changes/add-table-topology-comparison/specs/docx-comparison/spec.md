## MODIFIED Requirements

### Requirement: Two-file comparison preserves table-topology truth

The comparator SHALL publish schema-valid native whole-row insertion and deletion revisions when its tagged alignment identifies a complete row or an unmatched whole table. When a matched main-body row changes its physical-cell count, its horizontal merges (`w:gridSpan` or `w:hMerge`), or its `w:gridBefore`/`w:gridAfter` offsets within an unchanged grid, the comparator SHALL publish the original row as a deleted row immediately followed by the revised row as an inserted row, in the same table. It SHALL refuse the main-body table topology changes it cannot yet express natively (grid column count or width, vertical merges, pending cell-level topology revisions, and cells wrapped in cell-level content controls) before returning a DOCX rather than presenting them as ordinary cell-text edits or emitting malformed OOXML. The main-body guard SHALL identify the table and affected logical coordinates in a typed diagnostic. Unsupported selected header/footer scaffold changes SHALL continue to use the existing SDX-CMP-STORY-05 precise `unrepresentedChanges`/typed-diagnostic contract.

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

#### Scenario: [SDX-COMPTABLE-03] individual-cell topology emits a native row replacement
- **GIVEN** matched main-body rows in a table with an unchanged grid that differ in physical-cell count, `gridSpan` or `hMerge` horizontal merges, or `gridBefore`/`gridAfter` row offsets
- **WHEN** the documents are compared
- **THEN** the result SHALL contain the original row carrying a `w:trPr/w:del` marker immediately followed by the revised row carrying a `w:trPr/w:ins` marker, and unchanged rows SHALL carry no row marker
- **AND** `deletedTableRows` and `insertedTableRows` SHALL each count the replaced row once
- **AND** accept-all SHALL project to the revised document and reject-all to the original document with both the comparison acceptor and docx-core `acceptChanges`/`rejectChanges`, including the `bodyTableFootprint`, and the emitted document SHALL validate against the vendored Transitional schema
- **AND** a replaced row whose `w:trPr` already carries a pending `w:ins` or `w:del` SHALL not receive a second marker of the same kind

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
- **GIVEN** an unmatched main-body table with zero rows, wrapped rows, or pre-existing row revision markers that prevent faithful native projection
- **WHEN** the documents are compared
- **THEN** comparison SHALL throw a typed `emptyTable` or `tableContainer` diagnostic before returning a DOCX

#### Scenario: [SDX-COMPTABLE-09] cell topology without a native row replacement fails closed
- **GIVEN** matched main-body rows whose cell skeleton differs where either row has a vertical merge (`w:vMerge`), a pending cell-level topology revision (`w:cellIns`, `w:cellDel` or `w:cellMerge`), or cells inside a cell-level content control
- **WHEN** the documents are compared
- **THEN** main-body comparison SHALL throw a typed `vMerge`, `topologyRevision` or `occupancy` diagnostic with table and row coordinates before returning a DOCX
- **AND** no invalid direct `w:tc` insertion/deletion wrapper SHALL be published

#### Scenario: [SDX-COMPTABLE-07] selected story scaffold changes remain explicit
- **GIVEN** a selected header or footer has unsupported table insertion, deletion, row, or column topology changes
- **WHEN** the documents are compared
- **THEN** the comparator SHALL retain the SDX-CMP-STORY-05 precise `unrepresentedChanges` or typed-diagnostic contract and SHALL not emit malformed story XML
