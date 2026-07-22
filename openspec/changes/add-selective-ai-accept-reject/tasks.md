# Tasks

## 1. docx-core engine
- [x] 1.1 Thread an optional revision-id filter through `acceptChanges`/`rejectChanges` (default = whole-document); skip the global rsidDel strip in selective mode.
- [x] 1.2 Add `accept_ai_edits.ts`: id resolution (revisionIds | author), ambiguous-overlap detection over content-wrapper revisions, `acceptAIEdits`/`rejectAIEdits`.
- [x] 1.3 Add `DocxDocument.acceptAIEdits`/`rejectAIEdits` sweeping document.xml + side-story parts, resolving ids package-wide.

## 2. MCP tools
- [x] 2.1 Add `accept_ai_edits` / `reject_ai_edits` tools + catalog entries (surface: internal) + server dispatch.
- [x] 2.2 Surface the structured `overlaps` list and `AMBIGUOUS_REVISION_OVERLAP` error code.

## 3. Tests
- [x] 3.1 docx-core unit tests: per-revision-type non-overlap accept/reject, foreign-revision byte preservation, subset-by-id, ambiguous hard-error, normalizeFirst, no-false-positive on nested property change.
- [x] 3.2 MCP e2e tests covering the mcp-server scenarios.
