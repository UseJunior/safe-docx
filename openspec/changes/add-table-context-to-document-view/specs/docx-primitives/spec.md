## ADDED Requirements

### Requirement: Table Context in Document View

The document view pipeline SHALL derive table structure context for each paragraph inside a body-level table. The `TableContext` type SHALL include: `table_id` (body-level index string like `_tbl_0`), `table_index` (0-based), `row_index`, `col_index` (grid-aware, accounting for `gridSpan`), `col_header` (text from header row), `total_rows`, `total_cols`, `is_header_row` (true for row index 0), `para_in_cell`, and `cell_para_count`.

Table context derivation SHALL use ancestor-based DOM walking from each paragraph to find the enclosing `w:tc`, `w:tr`, and `w:tbl` elements. Only body-level tables (direct children of `w:body`) SHALL be indexed. Paragraphs inside nested tables SHALL receive the context of their enclosing body-level table cell.

The paragraph set and ordering produced by `buildDocumentView()` SHALL remain identical to the existing `getParagraphs()` traversal. Empty table cell paragraphs SHALL be preserved (not skipped) to maintain structural completeness.

#### Scenario: Simple table produces correct table context
- **WHEN** a document contains a 2-row x 3-column table
- **THEN** each cell paragraph has `table_context` with correct `row_index`, `col_index`, `total_rows`, `total_cols`, and `is_header_row`

#### Scenario: gridSpan produces grid-aware column indices
- **WHEN** a table cell has `w:gridSpan val="2"`
- **THEN** subsequent cells in the row have `col_index` offset by the span value

#### Scenario: Tracked-change wrapped rows are included
- **WHEN** a `w:tr` element is wrapped in `w:ins`
- **THEN** paragraphs in the wrapped row receive table context with the correct `row_index`

#### Scenario: Nested table paragraphs get outer cell context
- **WHEN** a cell contains a nested `w:tbl`
- **THEN** paragraphs inside the nested table receive the context of the outer body-level table cell

#### Scenario: Empty cells are preserved
- **WHEN** a table cell contains only an empty `w:p`
- **THEN** the empty paragraph is included in document view nodes with `table_context` set

### Requirement: Table-Aware Toon Rendering

`renderToon()` SHALL emit `#TABLE` and `#END_TABLE` structural markers around table content. The `#TABLE` marker format SHALL be: `#TABLE {table_id} | {rows} rows x {cols} cols | {header1} | {header2} | ...`. The `#END_TABLE` marker SHALL be emitted when leaving a table.

Table cell paragraphs SHALL use `th(row,col)` (header row) or `td(row,col)` (data rows) in the style column instead of the paragraph style.

`formatToonDataLine()` SHALL be exported as a standalone helper for per-node rendering with table-aware styles.

#### Scenario: Toon output includes table markers
- **WHEN** `renderToon()` is called with nodes containing `table_context`
- **THEN** `#TABLE` appears before the first table node and `#END_TABLE` after the last

#### Scenario: Style column uses th/td notation
- **WHEN** a node has `table_context` with `is_header_row=true`
- **THEN** the style column shows `th(row_index,col_index)` instead of the paragraph style

### Requirement: Shared DOM Helpers

`isW()` and `getDirectChildrenByName()` SHALL be exported from `dom-helpers.ts` for namespace-aware element checks and direct-child queries across primitives modules.

#### Scenario: isW checks namespace and localName
- **WHEN** `isW(el, 'tbl')` is called on a WordprocessingML element
- **THEN** it returns true only if the element has the correct namespace URI and local name
