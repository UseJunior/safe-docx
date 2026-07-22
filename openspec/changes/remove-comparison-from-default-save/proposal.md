# Change: Remove comparison from the default save/finalization path

## Why

Until now the `save` tool derived its redline by *comparing* the original document against the edited-clean copy (`compareDocuments` + `documentReconstructor`) and re-authoring tracked changes from that diff. That made comparison "the truth layer": every finalization re-atomized the edit into synthetic `w:ins`/`w:del`, discarding the provenance (author, stable revision ids, and any pre-existing third-party revisions) that the write-time emitter (#120–#125) already recorded on the session document. It also coupled the default path to a heuristic reconstruction engine with a `rebuild` fallback that could destroy table structure.

With write-time tracked markup now canonical, the redline is already present on the session document exactly as authored. The default save should serialize that markup directly, and comparison should be an explicit, opt-in operation via the `compare_documents` tool — not an implicit step in every finalization.

## What Changes

- The `save` tool's **redline** artifact SHALL be the session document's write-time tracked markup, serialized directly — no comparison, no reconstruction engine, no `rebuild` fallback. Author, stable revision ids, and pre-existing third-party revisions are preserved as authored.
- The `save` tool's **clean** artifact SHALL be produced by accepting the AI author's tracked edits (accept-all for that author). Pre-existing third-party revisions are preserved (never silently accepted). Body blocks the AI never touched stay byte-identical to the source (issue #408) — accepting on an isolated copy while carrying the true original document.xml forward as the minimal-reserialization baseline.
- Comparison-based redlining is available **only** through the `compare_documents` tool.
- The `tracked_changes_engine` and `fail_on_rebuild_fallback` parameters are accepted for backward compatibility but no longer affect the save path (deprecated, ignored).
- The save report drops comparison-only fields (`tracked_reconstruction_mode`, `tracked_fallback_reason`, `tracked_fallback_diagnostics`, `tracked_blocks_restored`, `tracked_restore_error`, `tracked_rebuild_warning`) and adds `tracked_changes_source: "write-time"`.

## Impact

- Affected specs: `mcp-server`
- Affected code:
  - `packages/docx-mcp/src/tools/save.ts` (redline = write-time markup; clean = accept-all; comparison removed)
  - `packages/docx-mcp/src/session/manager.ts` (SaveCacheEntry drops comparison fields)
  - `packages/docx-core/src/primitives/document.ts` (`toAcceptedBuffer` — non-destructive accept-all with true-baseline minimal reserialization, protecting #408)
- Follow-up: comparison is extracted into its own package in a subsequent change (epic #118, issue #128).

## Out of scope

- Extracting comparison into a standalone package / severing the docx-core runtime dependency (issue #128).
- Changing the write-time emitter's diff granularity (redlines remain char-level minimal diffs).
- ODF finalization (this change is DOCX `save`).
