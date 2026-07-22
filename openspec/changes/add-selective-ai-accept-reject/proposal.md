# Change: Add selective accept/reject by revision id (with author convenience mode)

## Why

The strongest argument for tracked-changes-as-canonical (#118/#120) is that
acceptance can target only the AI actor's revisions, leaving any pre-existing
third-party tracked changes untouched. Today `accept_changes` / `reject_changes`
are whole-document only, so accepting the AI's edits also flattens a reviewer's
revisions. This change adds selective accept/reject keyed on revision id (with an
author convenience mode), which is the precondition for the mixed-author
preservation corpus (#124/#125) and for removing whole-document comparison from
the default finalization path (#126).

## What Changes

- Add `acceptAIEdits(doc, { revisionIds | author })` and `rejectAIEdits(...)` to
  `@usejunior/docx-core`, driving the existing accept/reject engines through a
  revision-id filter so only targeted revisions are resolved and every other
  revision is left byte-untouched. Coverage spans document.xml and supported
  side-story parts (footnotes, endnotes, comments).
- Define selective accept/reject only on a normalized, non-overlapping revision
  graph. An ambiguous overlap — a targeted revision structurally containing, or
  contained by, a non-targeted content-wrapper revision (nested ins/del/move) —
  hard-errors with a structured list of offending pairs. `normalizeFirst` opts
  into best-effort operation (no byte-identical promise).
- Expose `accept_ai_edits` and `reject_ai_edits` MCP tools. `accept_changes`
  remains as the whole-document convenience.

## Impact

- Affected specs: `mcp-server`
- Affected code: `packages/docx-core/src/primitives/accept_ai_edits.ts` (new),
  `packages/docx-core/src/primitives/{accept_changes,reject_changes,document}.ts`
  (optional revision filter), `packages/docx-mcp/src/tools/{accept,reject}_ai_edits.ts`
  (new), `packages/docx-mcp/src/tool_catalog.ts`, `packages/docx-mcp/src/server.ts`
- Unblocks: #124, #125 (corpora), #126 (remove comparison default)
