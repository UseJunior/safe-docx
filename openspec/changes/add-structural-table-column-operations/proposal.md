# Change: Add Structural Table Column Operations

## Why

Callers can edit table rows but cannot add or remove a logical column. Hand-editing `w:tblGrid` and every affected row is brittle when rows have spans, offsets, or vertical merges; issue #1041 is the column slice of #764.

## What Changes

- Add anchored `insertTableColumn` and `deleteTableColumn` primitives addressed by logical grid column, not physical `w:tc` index.
- Reuse the read-only occupancy model from #1040, and require a deterministic per-row transformation before changing any XML or allocating revision IDs.
- Insert a declared grid-column width using explicit per-row actions to create a cell, grow a specified neighboring cell, or grow an offset; update deletion by removing/shrinking the cell or offset covering that logical column. Reject malformed or ambiguous shapes with row/column/cell coordinates.
- Stage clean-only simple/horizontal-span columns first, then clean offset/vertical-merge cases. Reject tracked requests until a Word oracle confirms the representation, a separate prerequisite reports foreign unresolved grid/cell revisions, and accept/reject can resolve each emitted unit atomically. Keep unsupported combinations fail-closed.
- Prove clean and tracked projections, schema validity, and preservation of unaffected cells with synthetic and real-world merged-table documents.

## Impact

- Affected spec: `docx-primitives`; later MCP/Markdoc exposure is separate and not implied.
- Affected code: `packages/docx-core/src/primitives/table_rows.ts`, the occupancy model, a new column-operations module, accept/reject sweeps, and public facade types.
- Compatibility: additive API. Existing row operations retain their current default guard and output.
- Dependency: #1040's occupancy and merged-row semantics should land first. Do not publish a partially tracked column operation whose accept/reject projections cannot be proven. The initial positive OpenSpec delta specifies only the clean horizontal phase and remains local until it ships with mapped implementation tests; future phases add their own deltas. A proposal-only PR containing positive scenarios would fail strict coverage.

## Non-Goals

- Arbitrary repair of malformed tables or layout/pixel equivalence.
- Inferring whether an interior span insertion should split a cell; the deterministic rule is expansion, with a new physical cell only at a cell boundary.
- Individual cell operations (#1042) and two-file column/cell topology comparison (#1043).

Refs #1041, #764, #998.
