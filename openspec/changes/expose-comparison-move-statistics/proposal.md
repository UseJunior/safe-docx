# Change: Report detected moves in comparison statistics

## Why

Issue #940: a comparison whose only change is a detected paragraph move emits a balanced `w:moveFrom`/`w:moveTo` pair, but every public `CompareStats` field is zero. A caller reading the stats (including the MCP `compare_documents` response) cannot tell a pure move from an unchanged document without parsing the DOCX. The tagged publication already counts serialized move ranges internally (`serializedRangeStats`); they were not surfaced.

## What Changes

- Add four additive fields to `CompareStats`:
  - `moves`: detected moves, each one balanced source/destination pair. A move relation counts only when both of its named move ranges are emitted; a relation whose content serializes to nothing (a relocated layout-only `w:lastRenderedPageBreak`) is not counted.
  - `movedParagraphs`: the subset of `moves` whose source is a whole paragraph.
  - `moveFromRanges` / `moveToRanges`: comparison-generated move revision ranges, counted with the same serialized-markup rule as `insertedRanges`/`deletedRanges` (content wrappers plus move-owned paragraph-mark revisions).
- Aggregate the new fields across selected stories like the existing counters.
- Existing fields and the `tagged-token-v1` atom unit keep their meanings. Moved content stays out of insertion, deletion, and atom totals, so a move is never double-counted. No metric unit changes, so `atomMetricVersion` is unchanged.
- The MCP `compare_documents` tool and the `compare-two` CLI pass `result.stats` through, so both report the new fields with no further change.

## Impact

- Affected specs: `docx-comparison`.
- Affected code: `packages/docx-compare/src/compare-types.ts`, `tagged/taggedTreeShadow.ts`, `tagged/pipeline.ts`, and tests in `docx-compare` and `docx-mcp`.
- References: #940, #1207 (split/merge marks never produce move markup).
