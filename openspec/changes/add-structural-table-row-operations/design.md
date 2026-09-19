# Design: Structural Table Row Operations

## Addressing and transaction boundary

The public operation resolves a paragraph bookmark to its nearest physical
`w:tc`, then its direct `w:tr` and body-level `w:tbl`. Nested-table paragraphs
are rejected rather than silently selecting an outer row. Validation constructs
an in-memory description of every direct row and cell before any DOM mutation.
Any unsupported feature aborts the operation without changing the document.

## Admitted table shape

Phase one admits only a rectangular table:

- `w:tblGrid` has at least one direct `w:gridCol`;
- every direct `w:tr` has exactly that many direct `w:tc` children;
- no direct row uses `w:gridBefore` or `w:gridAfter`;
- no direct cell uses `w:gridSpan` or `w:vMerge`;
- no direct cell contains a descendant `w:tbl`;
- no table/row/cell subtree contains revision markup; and
- every direct cell ends with a direct `w:p`.

These restrictions are table-wide, not limited to the target row. Inserting a
row into a vertical-merge chain, for example, changes the meaning of cells above
and below the insertion even if the anchor row itself has no `w:vMerge`.

## Inserted-row construction

The anchor row supplies only the formatting shell:

- clone `w:trPr` after removing revision children;
- create the same number of direct cells;
- clone each corresponding `w:tcPr` after removing revision children;
- create exactly one direct paragraph per cell, copying only the first direct
  paragraph's `w:pPr` and its paragraph-mark `w:rPr` formatting;
- populate plain text from the caller's cell array; and
- remove all `w:bookmarkStart`/`w:bookmarkEnd` descendants from the clone.

The constructor does not clone content blocks. This avoids duplicated bookmark
identities, fields, comments, drawings, nested tables, content controls, and
revision histories. Because each new cell ends in its newly-created paragraph,
the required trailing-cell-paragraph invariant holds by construction.

## Tracked topology

Tracked insertion attaches an empty `w:ins` record to the inserted row's
`w:trPr`; tracked deletion attaches an empty `w:del` record to the existing
row's `w:trPr`. Metadata uses the document's normal revision-id allocator.

Accept/reject resolve markers by their direct `w:trPr` parent:

| Marker | Accept | Reject |
| --- | --- | --- |
| `w:trPr > w:ins` | keep row; remove marker | remove row |
| `w:trPr > w:del` | remove row | keep row; remove marker |

Row removal occurs before generic content-wrapper sweeps so a marker is never
stripped while its row survives. Selective filters resolve only matching row
markers. Existing unsupported row markers in side stories remain preserved and
reported because this phase exposes body-level table mutation only.

## Safety and diagnostics

Failures use typed diagnostics carrying the anchor and the first unsupported
feature/coordinate. The operation must not partially add markers, allocate
visible content, or alter the XML when validation fails.

## Conformance basis

- ECMA-376 5th edition, Part 1 §17.4.48 (`w:tblGrid`).
- ECMA-376 5th edition, Part 1 §17.4.65 (`w:tc` and trailing paragraph).
- ECMA-376 5th edition, Part 1 §17.4.84 (`w:vMerge`).
- ECMA-376 5th edition, Part 1 §17.13.5.19 (inserted table row).
- ECMA-376 5th edition, Part 1 §17.13.5.16 (deleted table row).

LibreOffice is not a semantic oracle for the row markers because it strips them
on import. Schema validation plus accept/reject projection tests are therefore
the release gate for tracked topology; LibreOffice is used only to confirm the
clean accepted/rejected documents open and render.
