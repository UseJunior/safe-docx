# Tasks

## Phase 1: Save path rewrite

- [x] 1.1 Redline artifact = write-time markup
  - Serialize `session.doc.toBuffer()` directly; remove `compareDocuments`/`documentReconstructor`/`restoreTrackedUntouchedBlocks`/tracked `ensureBaselines`
  - Count tracked stats from the write-time markup (`collectTrackedStats`)
  - File: `packages/docx-mcp/src/tools/save.ts`

- [x] 1.2 Clean artifact = accept-all with #408 preservation
  - Accept the AI author's edits on an isolated copy; preserve untouched blocks byte-identically via minimal reserialization against the true original
  - File: `packages/docx-core/src/primitives/document.ts` (`toAcceptedBuffer`), `packages/docx-mcp/src/tools/save.ts`

- [x] 1.3 Deprecate comparison knobs and slim the report
  - Accept-but-ignore `tracked_changes_engine` / `fail_on_rebuild_fallback`
  - Drop comparison-only report fields; add `tracked_changes_source: "write-time"`
  - Remove comparison fields from `SaveCacheEntry`
  - Files: `packages/docx-mcp/src/tools/save.ts`, `packages/docx-mcp/src/session/manager.ts`

## Phase 2: Tests

- [x] 2.1 Add traceability tests covering each scenario
  - Default save serializes write-time markup without comparison
  - Clean artifact accepts AI edits and preserves untouched blocks (#408)
  - Comparison-only fields are absent from the save report
  - File: `packages/docx-mcp/src/tools/save_write_time_finalization.test.ts`

- [x] 2.2 Add docx-core unit coverage for `toAcceptedBuffer`
  - File: `packages/docx-core/src/primitives/minimal_save.test.ts`

- [x] 2.3 Re-baseline the comparison-era save tests to the write-time path
  - Files: `parity.test.ts`, `nvca_spa_regression.test.ts`, `open_agreements_e2e.test.ts`, `cli/commands/edit.test.ts`

## Phase 3: Docs

- [x] 3.1 Update README / SUPPORT to describe write-time canonical redlines + opt-in comparison
