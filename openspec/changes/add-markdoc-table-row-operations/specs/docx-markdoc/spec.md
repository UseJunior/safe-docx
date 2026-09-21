## ADDED Requirements

### Requirement: Canonical Markdoc authors bounded table-row topology changes

Canonical brownfield Markdoc SHALL express insertion of one or more ordered
rows before or after an anchored source row and deletion of an anchored source
row. Each inserted row SHALL contain one exact single-line plain-text value per admitted grid
column. The compiler SHALL reuse the docx-core rectangular-row contract,
preserve unrelated table/package content, emit native tracked revisions,
and fail transactionally for missing anchors, conflicting operations, invalid
cell counts, final-row deletion, or unsupported topology.

#### Scenario: [SDX-MDOC-110] Ordered multi-row insertion compiles clean and tracked artifacts
- **GIVEN** a hash-pinned source with an admitted rectangular body-level table
- **AND** one Markdoc operation containing multiple ordered rows with one cell value per grid column
- **WHEN** the rows are inserted before or after an anchored source row
- **THEN** the clean artifact SHALL contain the rows in authored order using the bounded safe formatting shell
- **AND** tracked output SHALL carry native inserted-row, paragraph-mark, and run-content revisions attributable to the operation
- **AND** accept-all SHALL equal the intended clean text, formatting, and table topology
- **AND** reject-all SHALL equal the source text, formatting, and table topology

#### Scenario: [SDX-MDOC-111] Source-row deletion compiles inverse projections
- **GIVEN** a hash-pinned source with an admitted table containing at least two direct rows
- **WHEN** canonical Markdoc deletes the row identified by an anchored paragraph
- **THEN** clean output SHALL omit exactly that row
- **AND** tracked output SHALL carry native deleted-row, paragraph-mark, and run-content revisions attributable to the operation
- **AND** accept-all SHALL remove the row and reject-all SHALL restore it
- **AND** unrelated rows, ranges, package parts, and table properties SHALL remain unchanged

#### Scenario: [SDX-MDOC-112] Structural row operations compose with paragraph edits
- **GIVEN** one canonical build containing admitted table-row operations and ordinary anchored paragraph edits
- **WHEN** the compiler produces clean and tracked artifacts
- **THEN** every declared operation SHALL apply exactly once
- **AND** structural rationales SHALL bind to cell-content revisions without placing comment markup in row properties
- **AND** tracked output with a structural rationale SHALL remain schema-valid
- **AND** both text and table-topology projection certificates SHALL pass

#### Scenario: [SDX-MDOC-113] Unsupported or conflicting topology fails before output
- **GIVEN** a structural operation with a missing or nested anchor, invalid cell count, final-row deletion, merged/offset/wrapped/malformed table, topology revision, duplicate target row, paragraph edit or formatting source inside a deleted row, or annotation anchored inside a deleted row
- **WHEN** compilation is attempted
- **THEN** compilation SHALL fail without returning clean or tracked artifacts
- **AND** the diagnostic SHALL retain the operation ID and typed table feature/coordinate detail

#### Scenario: [SDX-MDOC-116] Equal-count row replacement may use in-row revisions
- **GIVEN** one admitted row deletion and one admitted insertion that leave the table with the same row count
- **WHEN** tagged comparison aligns the clean and source rows
- **THEN** it MAY represent the change with projection-correct in-row revisions instead of one row marker per authored operation
- **AND** accept-all and reject-all text, formatting, and topology SHALL still equal their clean and source projections

### Requirement: Markdoc certificates prove table topology projections

For a build containing structural row operations, the version-1 certificate SHALL
include an optional table-topology report that compares a
normalized source table topology with reject-all and a normalized intended-clean
topology with accept-all. Topology equality and zero unresolved row revisions
SHALL supplement—not replace—text and formatting projection gates and SHALL
gate projection success and delivery readiness.

#### Scenario: [SDX-MDOC-114] Table topology mismatch blocks delivery
- **GIVEN** a tracked artifact whose accepted or rejected row/cell topology differs from its corresponding clean or source projection
- **WHEN** the compiler evaluates the verification certificate
- **THEN** the certificate SHALL identify the first mismatching table and row
- **AND** `projectionPassed`, `deliveryReady`, and `passed` SHALL be false

#### Scenario: [SDX-MDOC-115] Paragraph-only builds remain compatible
- **GIVEN** canonical Markdoc with no structural row operation
- **WHEN** compilation succeeds
- **THEN** existing syntax, artifacts, and certificate behavior SHALL remain unchanged
