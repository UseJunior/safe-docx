## ADDED Requirements

### Requirement: Authored columns in received rectangular tables

Compilation SHALL admit an `insert-table-column` operation anchored to a
paragraph of a direct-body simple rectangular table. `width-twips` SHALL
be a positive safe integer. An omitted `column-index` SHALL append; an
explicit index SHALL identify a zero-based grid boundary. The operation
SHALL have an edit name and one `column-cell` per source row. A new cell
SHALL have either a plain text attribute, including empty text, or one or
more plain-text paragraphs.

#### Scenario: [SDX-MDOC-COLUMN-01] a response column compiles with inverse tracked projections

- **GIVEN** an imported rectangular table and a column operation with one cell per row
- **WHEN** the operation is compiled with an omitted, beginning or interior column index
- **THEN** clean output SHALL contain the authored cells at that boundary, with all their paragraphs, a new declared grid width, and the core primitive's neighbour-derived cell properties and table-width bookkeeping
- **AND** unaffected source cells SHALL retain their content and properties
- **AND** tracked output SHALL use the existing grid/row comparison representation, Accept All SHALL match clean output, Reject All SHALL match the source, the topology certificate SHALL pass, and emitted OOXML SHALL validate

#### Scenario: [SDX-MDOC-COLUMN-02] landscape applies to the containing section

- **GIVEN** a column operation with `landscape=true` on a table in a section with explicit page dimensions
- **WHEN** the operation is compiled
- **THEN** clean output SHALL rotate that section using the existing section-property primitive, preserving other sections and unrelated package parts
- **AND** tracked Accept All SHALL match the clean page setup and Reject All SHALL restore the source setup

#### Scenario: [SDX-MDOC-COLUMN-03] ambiguous or unsupported column requests fail before output

- **GIVEN** an invalid width/index, wrong cell count, missing edit or anchor, a non-table anchor, a merged/nested/wrapped/offset table, pending revisions, repeated column edits on one table, a mixed row/column structural edit on that table, or unsupported cell markup
- **WHEN** the source is parsed or compiled
- **THEN** it SHALL fail with a specific diagnostic and SHALL not modify the pinned source or publish partial output
- **AND** attempts to export the column as paragraph edit pairs SHALL fail explicitly instead of omitting it

- **AND** a selected rationale SHALL fail explicitly if the comparison cannot attribute an exact range; it SHALL never be placed on an unrelated revision
