## MODIFIED Requirements

### Requirement: Two-file comparison preserves table-topology truth

The comparator SHALL publish schema-valid native whole-row insertion and deletion revisions when its tagged alignment identifies a complete row or an unmatched whole table. When a matched main-body row changes its physical-cell count, its horizontal merges (`w:gridSpan` or `w:hMerge`), or its `w:gridBefore`/`w:gridAfter` offsets within an unchanged grid, the comparator SHALL publish the original row as a deleted row immediately followed by the revised row as an inserted row, in the same table. A row's skeleton includes the cells inside its cell-level content controls (`w:sdt`) and cell-level custom XML elements (`w:customXml`), and such a row is replaced the same way, each replaced row keeping its own whole wrapper; no `w:ins` or `w:del` SHALL ever wrap a `w:tc` or a cell-level wrapper. When a matched main-body row's skeleton changes where a vertical merge (`w:vMerge`) is involved, the comparator SHALL publish the smallest band of consecutive rows that holds every merge chain the change touches, in both documents, as all of the band's original rows deleted immediately followed by all of its revised rows inserted. When a matched table's own properties (`w:tblPr`) or a matched row's table-property exceptions (`w:tblPrEx`) differ, the comparator SHALL publish the revised properties with a native `w:tblPrChange` or `w:tblPrExChange` record holding the original ones, and SHALL never place `w:ins` or `w:del` among the children of `w:tblPr`, `w:tblGrid` or `w:tblPrEx`. A matched row whose pending cell-level topology revisions (`w:cellIns`, `w:cellDel`, `w:cellMerge`) or pending row revision markers (`w:trPr/w:ins`, `w:trPr/w:del`) differ between the documents is replaced the same way, as is a row or band holding such a pending revision whose skeleton changes; each replaced row keeps its own source's pending revisions in place, and the comparison writes no cell-level revision of its own. An unmatched table whose rows already carry pending row revision markers SHALL be published with native row markers like any other unmatched table. An unmatched table with no rows SHALL be left out of the redline and reported in `unrepresentedChanges`, because no row can carry its revision. When a matched table grid changes column widths or count, it SHALL publish the revised grid with a native `w:tblGridChange` holding the original grid. Column-count changes SHALL replace every row whose layout changes. Grid revisions SHALL carry Word-compatible table and row companions (`w:tblPrChange`, `w:tblPrExChange`, and `w:trPrChange`); grid history SHALL have only schema-permitted revision metadata. Geometry revisions remain structural when optional formatting detection is disabled. Unsupported topology SHALL fail before publication rather than producing malformed OOXML. The main-body guard SHALL identify the table and affected logical coordinates in a typed diagnostic. Unsupported selected header/footer scaffold changes SHALL continue to use the existing SDX-CMP-STORY-05 precise `unrepresentedChanges`/typed-diagnostic contract.

#### Scenario: [SDX-COMPTABLE-01] whole-row insertion and deletion remain native
- **GIVEN** two documents that differ by one complete table row while the grid and matched-row cell intervals remain unchanged
- **WHEN** they are compared in either direction
- **THEN** the result SHALL contain one native `w:trPr/w:ins` or `w:trPr/w:del` marker, respectively
- **AND** accept-all SHALL project to the revised table, reject-all to the original table, and the emitted document SHALL validate against the vendored Transitional schema

#### Scenario: [SDX-COMPTABLE-02] changed grids use native table revisions
- **GIVEN** matched tables whose direct `tblGrid` column sequence differs in count or width
- **WHEN** the documents are compared in either direction
- **THEN** the result SHALL carry a native `tblGridChange` snapshot with Word-compatible table and row companions
- **AND** rows whose layout changes SHALL be replaced as deleted original rows and inserted revised rows
- **AND** both acceptors SHALL reproduce the revised table on Accept All and the original on Reject All, and the output SHALL validate against the Transitional schema

#### Scenario: [SDX-COMPTABLE-03] individual-cell topology emits a native row replacement
- **GIVEN** matched main-body rows in a table with an unchanged grid that differ in physical-cell count, `gridSpan` or `hMerge` horizontal merges, or `gridBefore`/`gridAfter` row offsets
- **WHEN** the documents are compared
- **THEN** the result SHALL contain the original row carrying a `w:trPr/w:del` marker immediately followed by the revised row carrying a `w:trPr/w:ins` marker, and unchanged rows SHALL carry no row marker
- **AND** `deletedTableRows` and `insertedTableRows` SHALL each count the replaced row once when the comparison emits its row marker
- **AND** accept-all SHALL project to the revised document and reject-all to the original document with both the comparison acceptor and docx-core `acceptChanges`/`rejectChanges`, including the `bodyTableFootprint`, and the emitted document SHALL validate against the vendored Transitional schema
- **AND** a replaced row whose `w:trPr` already carries a pending `w:ins` or `w:del` SHALL keep that marker and its attribution, SHALL not receive a second marker of the same kind, and SHALL not be counted for that kind, because the comparison emitted no marker for it
- **AND** a bookmark range that crosses out of a replaced row SHALL be as balanced in each projection as in the same projection of its source document, so a source projection with no unmatched or duplicate start or end yields none, including when the replaced row carries a pending row revision

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
- **GIVEN** an unmatched main-body table whose rows are wrapped in row-level content controls or custom XML elements
- **WHEN** the documents are compared
- **THEN** comparison SHALL throw a typed `tableContainer` diagnostic before returning a DOCX

#### Scenario: [SDX-COMPTABLE-09] a row holding a pending cell-level revision emits a native row replacement
- **GIVEN** matched rows with an unchanged grid, in the main body or in a text box, where a cell carries a pending cell-level topology revision (`w:cellIns`, `w:cellDel` or `w:cellMerge`) from an earlier reviewer, directly or inside a cell-level content control, and either the row's cell skeleton changes, the vertical-merge band a change replaces holds such a row, or the pending cell-level revisions themselves differ between the documents
- **WHEN** the documents are compared
- **THEN** the result SHALL contain the original row (or band) carrying `w:trPr/w:del` immediately followed by the revised row (or band) carrying `w:trPr/w:ins`, each keeping its own source's pending cell-level revisions with their attribution, and the comparison SHALL write no `w:cellIns`, `w:cellDel` or `w:cellMerge` of its own
- **AND** no `w:ins`, `w:del`, `w:moveFrom` or `w:moveTo` SHALL wrap a `w:tc`
- **AND** accept-all SHALL project to the accept-all projection of the revised document and reject-all to the reject-all projection of the original document with both the comparison acceptor and docx-core `acceptChanges`/`rejectChanges`, on text and the `bodyTableFootprint`, and the emitted document SHALL validate against the vendored Transitional schema
- **AND** a cell text edit in a table whose pending cell-level revisions and skeleton are unchanged SHALL keep its in-cell redline, with the pending revisions kept in place and no row marker

#### Scenario: [SDX-COMPTABLE-12] a row holding a cell-level content control emits a native row replacement
- **GIVEN** matched rows with an unchanged grid, in the main body or in a body text box, where a row holds a cell-level content control (`w:sdt` wrapping `w:tc`) or cell-level custom XML element and its cell skeleton changes: a cell added or removed beside or inside the control, a controlled cell merged or split, or a cell moved into a control, including when the control holds a field, a bookmark, a data binding or a pending revision, beside an ordinary body edit
- **WHEN** the documents are compared
- **THEN** the result SHALL contain the original row carrying a `w:trPr/w:del` marker immediately followed by the revised row carrying a `w:trPr/w:ins` marker, each holding its own whole content control with its properties, and no `w:ins`, `w:del`, `w:moveFrom` or `w:moveTo` SHALL wrap a `w:tc` or a cell-level content control
- **AND** a vertical-merge band holding such a row SHALL be replaced as a band (SDX-COMPTABLE-10)
- **AND** accept-all SHALL project to the revised document and reject-all to the original document with both the comparison acceptor and docx-core `acceptChanges`/`rejectChanges`, on text, the `bodyTableFootprint` and each cell-level wrapper's properties and cells, with balanced bookmarks, and the emitted document SHALL validate against the vendored Transitional schema
- **AND** a pending revision inside the controlled cell SHALL be kept with its attribution in each replaced row
- **AND** a text-only edit inside a controlled cell whose skeleton is unchanged SHALL keep its in-cell redline without a row marker

#### Scenario: [SDX-COMPTABLE-13] pending row revisions in a changed table keep each projection
- **GIVEN** a main-body table whose rows already carry pending `w:trPr/w:ins` or `w:trPr/w:del` markers from an earlier reviewer, and either the whole table is inserted or deleted, or a matched row's pending row markers differ between the documents
- **WHEN** the documents are compared
- **THEN** an unmatched table SHALL carry a native row marker on every row, a row keeping its pending marker and attribution without a second marker of the same kind
- **AND** a matched row whose pending row markers differ SHALL be published as the original row carrying `w:trPr/w:del` immediately followed by the revised row carrying `w:trPr/w:ins`, each keeping its own source's pending markers, and no `w:trPrChange` SHALL record a pending `w:ins` or `w:del`
- **AND** accept-all SHALL project to the accept-all projection of the revised document and reject-all to the reject-all projection of the original document with both the comparison acceptor and docx-core `acceptChanges`/`rejectChanges`, and the emitted document SHALL validate against the vendored Transitional schema

#### Scenario: [SDX-COMPTABLE-14] an unmatched table with no rows is left out and reported
- **GIVEN** a main-body table with no `w:tr` present in only one of the documents, beside an ordinary body edit
- **WHEN** the documents are compared
- **THEN** the comparison SHALL return a DOCX without that table, with the body edit tracked
- **AND** a table with no rows that holds a range boundary (a `w:bookmarkStart`, comment or move range marker) SHALL instead be refused with a typed `emptyTable` diagnostic before returning a DOCX, so no range is left unbalanced
- **AND** `unrepresentedChanges` SHALL hold one entry with `scope: 'table'`, `kind` `added` (revised only) or `removed` (original only), `table.index`, the table's document-order ordinal among the `w:tbl` elements of the document that holds it, and `sectionIndex`, the section holding it in that same document
- **AND** `formatUnrepresentedChangeWarnings` SHALL say that Accept All (added) or Reject All (removed) lacks the table
- **AND** apart from that table, accept-all SHALL project to the revised document and reject-all to the original document, and the emitted document SHALL validate against the vendored Transitional schema
- **AND** a table with no rows present in both documents SHALL be published as it is, and a header, footer or text-box story holding such a table keeps its SDX-CMP-STORY-05 contract

#### Scenario: [SDX-COMPTABLE-10] a vertical-merge change emits a native band replacement
- **GIVEN** matched main-body tables with an unchanged grid where a vertical merge (`w:vMerge`) is created, extended, shrunk or split, is combined with a horizontal span, or loses the row where it starts or ends, so that a matched row's skeleton changes, or where an unmatched row of one document interrupts a merge of the other without continuing that merge at the same grid columns (for example a merged row whose text changed too much to pair)
- **WHEN** the documents are compared
- **THEN** the result SHALL contain the band (the smallest run of consecutive rows that holds every merge chain the change touches, in both documents) as all of its original rows carrying a `w:trPr/w:del` marker, immediately followed by all of its revised rows carrying a `w:trPr/w:ins` marker
- **AND** rows outside every band SHALL keep their ordinary redline, so an unrelated merge or an in-row text edit beside the band carries no row marker, and two separate merge changes in one table SHALL form two bands
- **AND** a merge continuation row deleted or inserted while every other row keeps its skeleton SHALL stay a plain whole-row deletion or insertion
- **AND** accept-all SHALL project to the revised document and reject-all to the original document with both the comparison acceptor and docx-core `acceptChanges`/`rejectChanges`, including every cell's `w:vMerge` state in the `bodyTableFootprint`, and the emitted document SHALL validate against the vendored Transitional schema
- **AND** a bookmark range that crosses into or out of a band SHALL be as balanced in each projection as in the same projection of its source document, and a table-level bookmark boundary between band rows SHALL appear once, with its own document's rows

#### Scenario: [SDX-COMPTABLE-11] a table property change emits a native table-property revision
- **GIVEN** matched tables whose `w:tblPr` differs (for example `w:tblStyle` or `w:tblBorders`), or matched rows whose `w:tblPrEx` differs, beside an ordinary body edit
- **WHEN** the documents are compared
- **THEN** the table's `w:tblPr` SHALL hold the revised properties followed by one `w:tblPrChange` whose `w:tblPr` snapshot holds the original properties, and each changed row's `w:tblPrEx` SHALL hold the revised exceptions followed by one `w:tblPrExChange` holding the original ones
- **AND** when the published `w:tblPr` gains a `w:tblPrChange` (a comparison record, or an original-only pending record the comparison keeps), every row of that table (direct or wrapped in `w:sdt`/`w:customXml`, not rows of nested tables) SHALL carry a `w:tblPrExChange`, whose snapshot equals the row's live exceptions when they did not change, because Word shows a table-property revision only through a row-level `w:tblPrExChange`
- **AND** no `w:ins`, `w:del`, `w:moveFrom` or `w:moveTo` SHALL appear among the children of `w:tblPr`, `w:tblGrid` or `w:tblPrEx`, `w:tblGrid` SHALL directly follow `w:tblPr` with only bare range markup before them (also when a bookmark is added or removed at the start of the table), and the emitted document SHALL validate against the vendored Transitional schema
- **AND** a pending `w:tblPrChange`, `w:tblGridChange` or `w:tblPrExChange` carried only by the original SHALL be kept with its attribution and a fresh revision ID, one carried only by the revised document SHALL be dropped, and one both inputs carry unchanged SHALL be kept as is
- **AND** accept-all SHALL project to the revised document and reject-all to the original document through the comparison acceptor, including every table-level property, and through docx-core `acceptChanges`/`rejectChanges` on text, `bodyTableFootprint` and `w:tblPr`
- **AND** with formatting ignored, the revised properties SHALL be published without a comparison record

#### Scenario: [SDX-COMPTABLE-07] selected story scaffold changes remain explicit
- **GIVEN** a selected header or footer has unsupported table insertion, deletion, row, or column topology changes
- **WHEN** the documents are compared
- **THEN** the comparator SHALL retain the SDX-CMP-STORY-05 precise `unrepresentedChanges` or typed-diagnostic contract and SHALL not emit malformed story XML
