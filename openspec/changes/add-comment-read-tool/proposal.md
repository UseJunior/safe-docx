# Change: Add comment reading tool

## Why
Comments have write-only MCP coverage (`add_comment`) while footnotes have full CRUD.
The primitives layer already implements `getComments()` — this wires it as an MCP tool.

## What Changes
- NEW: `get_comments` MCP tool (read-only)
- MODIFIED: `server.ts` — register in dispatch chain
- MODIFIED: `tool_catalog.ts` — add catalog entry
- NEW: `get_comments.test.ts` — OpenSpec-traceable tests

## Non-Goals
- `update_comment` and `delete_comment` are out of scope. Comments in legal workflows are
  typically additive. Update/delete may be added separately if needed.

## Impact
- Affected specs: `mcp-server`
- Affected code:
  - `packages/safe-docx/src/tools/get_comments.ts` (new)
  - `packages/safe-docx/src/tools/get_comments.test.ts` (new)
  - `packages/safe-docx/src/tool_catalog.ts`
  - `packages/safe-docx/src/server.ts`
