# Change: Fix inplace modifier for mixed-status runs via pre-split pass

## Why
When a single `<w:r>` run in the revised document contains atoms with mixed correlation statuses (e.g. Equal + Inserted), the inplace modifier wraps the entire run as inserted, destroying Equal content. This causes the NVCA SPA template (and similar documents with placeholder fills like `[___]` → `A`) to always fall back to rebuild mode, which strips tables and page breaks from exhibits.

Additionally, the CLI `compare` command was reporting the *requested* mode rather than the *actually used* mode, hiding fallback behavior from users.

## What Changes
- MODIFIED: `packages/docx-mcp/src/cli/commands/compare.ts` — `CompareCommandResult` now includes `mode_requested` and `fallback_reason`; `mode` reflects actual mode used
- MODIFIED: `packages/docx-core/src/primitives/text.ts` — exported `splitRunAtVisibleOffset`, `visibleLengthForEl`, `getDirectContentElements` (previously private)
- MODIFIED: `packages/docx-core/src/baselines/atomizer/inPlaceModifier.ts` — added `preSplitMixedStatusRuns()` pre-pass between `attachSourceElementPointers` and `processAtoms`
- NEW: `packages/docx-core/src/baselines/atomizer/inPlaceModifier-split.test.ts` — 11 unit tests for the pre-split logic
- MODIFIED: `packages/docx-mcp/src/cli/index.test.ts` — added test for mode fallback reporting

## Impact
- Affected specs: `docx-comparison`
- Affected code:
  - `packages/docx-core/src/primitives/text.ts`
  - `packages/docx-core/src/baselines/atomizer/inPlaceModifier.ts`
  - `packages/docx-mcp/src/cli/commands/compare.ts`
  - `packages/docx-mcp/src/cli/index.test.ts`
