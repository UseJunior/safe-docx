## ADDED Requirements

### Requirement: Clean table-cell split and absorb, distinct from Word-style insertion and deletion

The engine SHALL address a clean split or absorb using a paragraph anchor and logical `w:tblGrid` coordinates. The Stage A APIs SHALL be named `splitTableCell` and `absorbTableCell`; `insertTableCell` and `deleteTableCell` are reserved for Stage B's Word-style shifting operations. The target table SHALL have direct rows/cells with only simple or horizontal `w:gridSpan` geometry. Split SHALL divide one physical cell at an explicit interior grid boundary, keep its authored content on an explicitly chosen side, and create one new physical cell on the other side without changing the table grid. Absorb SHALL remove one physical cell and merge all its grid slots into an explicitly chosen immediately adjacent sibling in the same row without changing the table grid or other rows. No row SHALL lose its final physical cell.

#### Scenario: [SDX-TABLECELL-01] split a horizontal span into two physical cells
- **GIVEN** a supported cell spanning at least two logical grid columns
- **WHEN** the caller invokes `splitTableCell` at an interior boundary and selects which side keeps the existing content
- **THEN** exactly one new physical cell SHALL appear, the two intervals SHALL partition the original interval, and the table grid and other rows SHALL remain unchanged
- **AND** the new cell SHALL have a direct paragraph with a fresh stable anchor

#### Scenario: [SDX-TABLECELL-02] delete one cell and absorb its interval
- **GIVEN** a supported row with a target cell and an immediately adjacent physical sibling on the requested side
- **WHEN** the caller invokes `absorbTableCell` on the target and chooses that sibling to absorb its interval
- **THEN** the target cell SHALL be removed, the sibling SHALL occupy the union interval, and the table grid and other rows SHALL remain unchanged

#### Scenario: [SDX-TABLECELL-03] split and absorb preferred widths
- **GIVEN** integer grid-column widths and resolvable affected preferred cell widths
- **WHEN** a clean split or absorb succeeds
- **THEN** dxa `w:tcW` values SHALL follow the declared grid-width allocation without redistributing other widths
- **AND** a `pct` preferred width on split or on the absorbing sibling, omitted width type, unresolvable dxa width, or mismatched dxa/grid sum on split SHALL fail before mutation with `UNSUPPORTED_EDIT` feature `width`

### Requirement: Ambiguous individual cell edits fail transactionally

The engine SHALL reject a split without an interior boundary; absorption without an adjacent sibling; removal of the final physical cell; unsupported vertical-merged, offset, nested, or wrapped topology; pending topology (including `w:trPr/w:ins` or `w:trPr/w:del` on the target row) or removed-cell content revisions; and any supplied `RevisionContext`. Rejected edits SHALL leave serialized XML, bookmark allocation, and revision-ID state unchanged. Unaffected physical-cell subtrees and live element references SHALL survive a successful edit, except that a range endpoint whose partner lay inside a removed cell SHALL be removed to avoid an orphan. Diagnostics SHALL use the shared table-edit coordinates and feature fields.

#### Scenario: [SDX-TABLECELL-04] unsupported or invalid cell edit leaves no trace
- **GIVEN** an invalid split/absorb request, unsupported topology, pending revision in a removed cell, or a tracked request
- **WHEN** an individual cell edit is attempted
- **THEN** it SHALL fail with a structured table/row/column/cell diagnostic and SHALL leave the document and allocation state unchanged

#### Scenario: [SDX-TABLECELL-05] unaffected cell content and identities survive
- **GIVEN** a supported clean cell edit beside cells with bookmarks, comments, fields, or formatting
- **WHEN** the edit succeeds
- **THEN** unaffected physical-cell subtrees and their identities SHALL remain unchanged except for removal of any range endpoint whose partner lay in a removed cell, and every surviving cell SHALL end in a direct paragraph
