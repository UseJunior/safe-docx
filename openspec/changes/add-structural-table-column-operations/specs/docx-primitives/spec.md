## ADDED Requirements

### Requirement: Clean logical table column insertion and deletion

The engine SHALL address clean column edits by zero-based logical `w:tblGrid`
column, not physical cell index. In the initial phase, the target table SHALL
contain only direct rows whose physical cells have simple or horizontal
`w:gridSpan` geometry; `w:gridBefore`, `w:gridAfter`, `w:vMerge`, legacy
`w:hMerge`, nested tables, and pending topology revisions remain unsupported.
Insertion SHALL add one grid column with a declared positive width and apply
one explicit `cell` or `growCell` action per row. At a shared cell boundary,
`growCell.side` selects the neighboring owner; strictly inside one span, both
side values identify the same owner and are equivalent. Deletion SHALL remove
the selected width-one physical cell or shrink the span covering that column.
No row SHALL lose its final physical cell. Clean deletion SHALL reject a
width-one cell containing pending revision records rather than silently
discarding unresolved history. Existing grid-column widths SHALL not be redistributed.

#### Scenario: [SDX-TABLECOL-01] clean insertion across simple and spanning rows
- **GIVEN** a valid body-level table with simple-cell and horizontal-span rows
- **WHEN** a caller inserts a logical column with a positive width and one valid `cell` or `growCell` action per row
- **THEN** each row SHALL create the requested physical cell or grow the selected span, and `w:tblGrid` SHALL gain exactly one column
- **AND** a full-width title cell SHALL be growable when the column is prepended or appended

#### Scenario: [SDX-TABLECOL-02] clean deletion across simple and spanning rows
- **GIVEN** a valid body-level table whose chosen logical column crosses a width-one cell and a wider horizontal span in different rows
- **WHEN** a caller deletes that column without leaving any row empty
- **THEN** each row SHALL remove or shrink the covering physical cell and `w:tblGrid` SHALL lose exactly one column

#### Scenario: [SDX-TABLECOL-09] explicit width bookkeeping
- **GIVEN** a supported column edit with dxa `w:tcW` on affected cells and dxa `w:tblW`
- **WHEN** a column of `widthTwips` is inserted or deleted
- **THEN** affected dxa cell and table widths SHALL change by exactly that amount without redistributing other grid widths
- **AND** `pct`, `auto`, and `nil` widths SHALL remain unchanged
- **AND** an affected width with omitted `type`, an affected dxa width that would change but has omitted `w`, a non-integer or universal-measure `w`, a deleted grid column without integer `w`, or a negative resulting dxa width SHALL fail before mutation with `UNSUPPORTED_EDIT` feature `width`

### Requirement: Ambiguous clean table column operations fail transactionally

The engine SHALL reject malformed occupancy, inconsistent row actions,
nonpositive or unresolvable width, row offsets, vertical or legacy horizontal merges, nested
tables, pending topology revisions, pending revisions in a removed cell,
final-column deletion, and any deletion
leaving a row without a physical cell before XML mutation or revision-ID
allocation. A supplied `RevisionContext` SHALL return `UNSUPPORTED_EDIT`
until tracked column semantics are implemented. Unaffected physical-cell
subtrees SHALL remain byte-equivalent under the same serializer, except
properties necessarily changed by the column transformation.

#### Scenario: [SDX-TABLECOL-06] unsupported or invalid requests leave no trace
- **GIVEN** an invalid per-row action, malformed table, offset, vertical or legacy horizontal merge, pending topology or removed-cell revision, nested table, final-column deletion, or a row that would lose its last cell
- **WHEN** a clean or tracked column operation is attempted
- **THEN** it SHALL fail with a structured row/column/cell diagnostic, unchanged serialized XML, and unchanged revision-ID state

#### Scenario: [SDX-TABLECOL-07] unaffected content and identities survive
- **GIVEN** a supported clean column edit beside unaffected cells with bookmarks, comments, fields, or formatting
- **WHEN** the output is produced
- **THEN** every unaffected physical-cell subtree and its identities SHALL remain unchanged, and every surviving cell SHALL end in a direct paragraph
