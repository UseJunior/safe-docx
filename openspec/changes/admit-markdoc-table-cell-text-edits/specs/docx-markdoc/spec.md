## ADDED Requirements

### Requirement: Existing table-cell text is editable without structural drift

Canonical brownfield Markdoc SHALL admit anchored text replacement, paragraph
insertion, and paragraph deletion inside an existing table cell while
preserving the surrounding table topology. An inserted paragraph's formatting
source MUST belong to the same physical cell, and the complete operation set
MUST leave at least one direct paragraph in that cell. The compiler SHALL keep
vertical-merge continuation cells fail-closed because they have no independently
visible content, and SHALL continue to reject operations that
insert or remove rows, columns, cells, grid spans, or merge topology unless
those operations use a separately admitted structural-table contract.

#### Scenario: [SDX-MDOC-108] Table-cell text replacement preserves topology
- **GIVEN** a hash-pinned source containing an anchored paragraph in a table cell
- **WHEN** canonical Markdoc replaces text and inserts or safely deletes a paragraph in that cell
- **THEN** clean output and accept-all tracked output SHALL contain the revised text
- **AND** reject-all tracked output SHALL contain the source text
- **AND** row, cell, grid, merge, and unrelated-cell content SHALL remain unchanged

#### Scenario: [SDX-MDOC-109] Required cell paragraph remains fail-closed
- **GIVEN** canonical Markdoc requests deletion of every direct paragraph in one cell, uses a formatting source from another cell, or targets a vertical-merge continuation cell
- **WHEN** compilation is attempted
- **THEN** compilation SHALL fail before document mutation
- **AND** the diagnostic SHALL identify unsupported table structure
