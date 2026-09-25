# Change: Add bounded individual table-cell operations

## Why

Issue #1042 has no API for inserting or deleting one physical table cell. A cell edit cannot generally be inferred from a physical index: it must leave every row's logical `tblGrid` occupancy valid, and it must not silently discard pending revision history. The #1040 occupancy inventory and #1041 column operations shipped in PR #1072 make a narrow clean phase possible. The requested end state includes both horizontal split/absorb and Word-style cell shifting, staged as separate bounded changes.

## What Changes

- Add clean-only `splitTableCell` to split one horizontal-spanning physical cell at an explicit logical grid boundary, retaining its authored content on an explicit side and creating one new cell on the other side.
- Add clean-only `absorbTableCell` to remove one physical cell and absorb its interval into an explicitly chosen adjacent sibling in the same row, without changing `tblGrid` or other rows. Reserve `insertTableCell` and `deleteTableCell` for Stage B's Word-style shifting operations.
- Preflight geometry, widths, content-loss and revision guards before changing the live DOM. Return structured table/row/column/cell diagnostics and fresh paragraph anchors for new cells.
- Keep vertical merges, offsets, nested tables, pending topology, and tracked requests unsupported in this Stage A split/absorb phase.
- Stage B will specify and implement Word-style individual-cell shifting (right/down on insertion, left/up on deletion as supported by Word-authored examples) in a separate OpenSpec change. It will define row-boundary behavior, content order, grid occupancy, and transactional rejection from actual Word cell-operation oracles before any code is written.
- A tracked phase will cover native revision records and exact accept/reject for each admitted clean operation. This Stage A delta does not claim to satisfy #1042's tracked round-trip acceptance criterion, and #1042 remains open until both operation families and their supported tracked forms ship.
- Land this proposal with its Stage A implementation after approval; a proposal-only PR would fail the required primitives scenario-coverage gate. Partial PRs reference, but do not close, #1042.

## Impact

- Affected specs: `docx-primitives`.
- Affected code: `packages/docx-core/src/primitives/table_cells.ts`, `table_columns.ts`, a shared `table_edit_common.ts` extraction, `table_occupancy.ts`, `document.ts`, primitive exports, tests, and README.
- References: #1042, #1041, #1040, #998.
