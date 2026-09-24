# Change: Add Merge-Aware Table Row Operations

## Why

The existing row primitive intentionally refuses any table containing `w:gridSpan` or `w:vMerge`, even when inserting or deleting a row has one rectangular interpretation. That leaves merged label/value schedules and signature grids under issue #1040 dependent on direct OOXML surgery.

## What Changes

- Add a read-only logical occupancy inventory for body-level tables: grid columns, row offsets, physical cells, horizontal spans, and vertical restart/continuation ownership.
- Add an explicit opt-in merge-aware mode to anchored row insertion and deletion. The current unmerged behavior and default rejection remain unchanged.
- Admit only operations whose inserted/deleted row and surviving merge rectangles have one validated interpretation. Preserve untouched cells and nested authored content, and fail transactionally with coordinates when malformed or ambiguous.
- Emit clean and native tracked results, including the surviving-cell property revision needed when deleting a vertical-merge restart row. Require exact accept/reject topology projections and schema-valid output before claiming support.
- Add shared synthetic fixtures, a real-world merged-table smoke, and proportional Word/LibreOffice evidence. A Word tracked-merge oracle is a gate before freezing the revision representation; LibreOffice alone is not a semantic oracle for row markers.

## Impact

- Affected spec: `docx-primitives` (the existing row-operation capability and topology guard).
- Affected code: `packages/docx-core/src/primitives/table_rows.ts`, row accept/reject property handling, facade types, shared OOXML fixtures, and integration tests.
- Compatibility: additive opt-in. Existing calls without the new mode retain their current validation and output. No Markdoc syntax or column/cell API is added here.
- Delivery: this approval-only PR records and tests the current default fail-closed guard as a new compatibility requirement. It defers every new merge-aware operation scenario to the implementation PR, where each arrives with a mapped test. The earlier `add-structural-table-row-operations` change must archive before that PR modifies its topology guard.

## Non-Goals

- Repairing malformed source tables, guessing between non-rectangular merge interpretations, or rewriting unchanged cell content.
- Structural column/cell insertion or deletion (#1041/#1042), two-file topology comparison (#1043), and arbitrary nested-table row editing.
- Pixel-equivalent layout guarantees.

Refs #1040, #764, #998.
