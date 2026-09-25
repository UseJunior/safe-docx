## Context

`w:tblGrid` gives a logical coordinate system, while a `w:tc` can occupy several columns through `w:gridSpan`. A single-cell insert/delete that changes the grid width would affect every row and is the #1041 column operation instead. The #1040 occupancy inventory provides each physical cell's `[start,end)` interval and rejects malformed topology.

## Decisions

### 1. Clean operation shapes

`splitTableCell` accepts a paragraph anchor inside a direct body-level table, a zero-based logical `splitColumnIndex` that is the boundary before column `k` with `start < k < end` for that cell's interval, `existingSide: 'left' | 'right'`, and `newCellText`. The original cell retains all authored content and identities on `existingSide`; the other interval becomes one new physical cell with a safe formatting shell, a direct paragraph, and a fresh paragraph bookmark. This is a split, not a new grid column. A width-one cell cannot be split; use the shipped `insertTableColumn` for changes that require a new `gridCol`.

`absorbTableCell` accepts a paragraph anchor inside the physical cell to remove and `absorbSide: 'left' | 'right'`. That side must name an immediately adjacent physical sibling in the same row. The removed cell's entire interval is absorbed by increasing the sibling's `gridSpan`; no `tblGrid` or other row changes. The method explicitly removes the target cell's authored content; no second loss-of-content flag is needed. The final physical cell of a row cannot be removed. Reserve `insertTableCell` and `deleteTableCell` for Stage B's Word-style row-shifting APIs.

Both calls use stable paragraph IDs for targeting but return logical grid coordinates and, for a split, the new paragraph ID. `SplitTableCellResult` contains `tableIndex`, `rowIndex`, `retained: [start,end)`, `created: [start,end)`, and `newParagraphId`; `AbsorbTableCellResult` contains `tableIndex`, `rowIndex`, and `absorbedInto: [start,end)`. Neither accepts a physical-cell array index as the address of a grid column. Successful edits preserve live references to unaffected DOM elements. Their anchor resolution, diagnostic detail shape, new-cell shell exclusion list, shared width parsing/validation, pending-revision scan, and orphan-range cleanup SHALL be shared with the shipped `table_columns.ts` implementation through a small `table_edit_common.ts` extraction. Split adds the equality, `pct` rejection, and two-width assignment rule below; it cannot be implemented by #1072's delta arithmetic alone. The extraction keeps the public `TableColumnEditDetail` export and existing column-edit diagnostic wording intact, parameterizes wording for cell edits, and leaves existing column-operation tests unchanged. Cell-edit details use `splitColumnIndex` as `columnIndex` on split and the target cell's start column on absorb.

### 2. Width and identity policy

The first phase requires integer twip widths for every `w:gridCol` in the affected interval. On split, an existing dxa `w:tcW` must equal the sum of those grid widths; each resulting cell receives a dxa `tcW` equal to its interval sum. An absent `tcW` stays absent in the original cell; the new cell receives a dxa width from its interval. `auto`/`nil` widths are left unchanged on the original cell, with a new dxa cell width and no pixel-layout promise. A `pct` width, omitted `type`, unresolvable dxa `w`, or mismatched dxa/grid sum fails closed (`feature: 'width'`) rather than silently changing the meaning of a percentage or inventing a split allocation.

On deletion, a dxa `tcW` on the absorbing sibling increases by the sum of the removed grid widths; `pct` on that sibling fails closed rather than leaving a percentage with a changed span, while `auto`/`nil` and absent widths remain unchanged. No `w:tblW` or `gridCol` changes. A surviving span of width one is represented without `w:gridSpan`. The #1072 new-cell shell excludes `tcW`, `gridSpan`, `vMerge`, `hMerge`, `cellIns`, `cellDel`, `cellMerge`, `tcPrChange`, `cnfStyle`, `hideMark`, and `headers`; the extracted helper remains the single source for that exclusion list. Range endpoints crossing a deleted cell use the existing row-deletion pair cleanup; deletion refuses a cell containing any pending revision record so unresolved history is not silently lost.

Stage A rejects duplicate `tcW` on a touched cell and XML-1.0-illegal new-cell text before mutation. Absorb does not impose split's equality check on the surviving sibling's pre-existing dxa width: it preserves that authored width's offset from the grid by adding only the removed interval's grid width. This allows an intentionally non-grid-matching preferred width without reallocating it.

### 3. Bounded topology and transactionality

The initial clean phase admits only direct rows/cells with simple or horizontal `gridSpan` geometry in a direct body-level table. It rejects `vMerge`, legacy `hMerge`, row offsets, nested tables, wrapped topology, table-property exceptions, pending topology revisions (including `w:trPr/w:ins` or `w:trPr/w:del` on the target row), and a supplied `RevisionContext` with `UNSUPPORTED_EDIT` and coordinates. The #1040 occupancy reader admits row-level ins/del, so the cell operation must check those separately (`feature: 'topologyRevision'`). Every surviving cell must end in a direct paragraph. Build a read-only plan for all geometry, width, identity and content-loss checks, then apply it in place; validation errors leave XML and revision/bookmark allocation unchanged. Re-run occupancy as a postcondition. Diagnostic details share the `TableColumnEditDetail` fields (`anchorId`, `tableIndex`, `rowIndex`, `columnIndex`, optional `cellIndex`, `feature`).

### 4. Staged Word-style cell shifting

The user chose **both operation families, staged**. This change is Stage A: horizontal split/absorb within one row and a fixed `tblGrid`. Stage B is a separate proposal for Word-style shift-right/shift-down insertion and shift-left/shift-up deletion. Unlike split/absorb, those actions may move content across physical cells or row boundaries. Do not infer their topology from this proposal, a rectangularity check alone, or the horizontal `gridSpan` whole-row-deletion oracle in `table-examples.docx` (which contains no `w:vMerge`). That file supports only a pending-row-deletion rejection fixture and a width-rule data point, not a cell-operation oracle. Obtain Word-authored before/after and tracked packages for each candidate cell action; specify the affected-row boundary, content ordering, grid-width behavior, and fail-closed cases before implementation.

### 5. Tracked follow-up

Issue #1042 also seeks accept-all/reject-all round trips for native cell revisions in both operation families. The candidate records are `w:cellIns`, `w:cellDel`, `w:cellMerge`, `w:tcPrChange`, and possibly `w:tblGridChange`; their interplay is not assumed to be Word-compatible. Before emitting them, obtain Word Track Changes packages for split/absorb and each admitted shift action, ship the separately named `report-unresolved-table-cell-revisions` prerequisite from #1072, and implement atomic accept/reject of the supported unit. The initial OpenSpec delta contains only clean Stage A scenarios and must not close #1042. Every partial PR body uses `Refs #1042`, never an auto-closing keyword.

## Alternatives considered

- Add/remove one cell in a simple row and implicitly resize the grid: changes every row and duplicates column operations.
- Split at a physical index: ambiguous when neighboring cells span different logical columns.
- Cleanly rewrite the table then compare it: loses native cell revision intent and identity fidelity.

## Review decisions and remaining evidence

- The Stage A API uses the target cell's paragraph anchor plus a logical `splitColumnIndex`, matching #1072's anchored logical-grid convention. A grid boundary has no independent stable OOXML identity.
- Absorbing a spanning cell is a same-row merge, not Word's "Delete Cells" shift action; the distinct API name makes that scope explicit.
- A local scan of the user-provided Word file and repo DOCX fixtures found 12/12 spanning cells with dxa `tcW` equal to their grid-width sum. Keep the strict preflight until contrary Word evidence supports a broader rule.
- New-cell properties use the #1072 exclusion list, not an independently guessed clone policy.
- Stage B still requires Word-authored individual-cell shift oracles, and the tracked phase requires Word-authored revision/accept/reject oracles. Neither is supplied by the horizontal whole-row-deletion example.
