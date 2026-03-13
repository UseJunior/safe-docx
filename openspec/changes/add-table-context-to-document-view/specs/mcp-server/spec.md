## ADDED Requirements

### Requirement: Table Structure in read_file Output

The `read_file` tool SHALL render table structure in all output formats:

- **Toon format**: Emit `#TABLE`/`#END_TABLE` markers around table content with `th(r,c)`/`td(r,c)` styles. Budget-aware rendering SHALL use `formatToonDataLine()` directly and track table boundary state. `#TABLE`/`#END_TABLE` lines SHALL count toward token budget but NOT toward `paragraphsReturned`.
- **Simple format**: Emit `#TABLE`/`#END_TABLE` markers around table content. Cell text is rendered normally.
- **JSON format**: Include `table_context` field on nodes inside tables (automatic via serialization).

If budget truncation cuts mid-table, `#END_TABLE` SHALL be appended before returning. `#TABLE` and `#END_TABLE` markers SHALL always be balanced within a single response.

#### Scenario: Toon format includes table markers
- **WHEN** `read_file` is called on a document with tables in toon format
- **THEN** output contains `#TABLE _tbl_N | {rows} rows × {cols} cols` and `#END_TABLE`, with column headers in `th(0,N)` rows only

#### Scenario: Table markers do not inflate paragraph count
- **WHEN** a table with 2 rows is rendered
- **THEN** `paragraphs_returned` equals 2 (not 2 + marker lines)

#### Scenario: Simple format includes table markers
- **WHEN** `read_file` is called with `format=simple` on a document with tables
- **THEN** output contains `#TABLE` and `#END_TABLE` markers

#### Scenario: JSON format includes table_context
- **WHEN** `read_file` is called with `format=json` on a document with tables
- **THEN** each table cell node has a `table_context` object with `table_id`, `row_index`, `col_index`, etc.
