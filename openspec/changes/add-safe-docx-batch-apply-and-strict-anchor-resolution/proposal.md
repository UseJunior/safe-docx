# Change: Canonical MCP Tool Surface and File-First Entry Hardening

## Why
The first open-source release needs a clean, explicit MCP contract with no legacy alias ambiguity and no path-dependent assumptions in specs. The shipped Safe-Docx behavior now uses canonical edit names and file-first session entry, and the active spec should match that behavior directly.

## What Changes
- Keep canonical edit tool names only: `replace_text` and `insert_paragraph`.
- Keep legacy smart aliases (`smart_edit`, `smart_insert`) unavailable in the MCP catalog.
- Reject legacy smart aliases when submitted as plan operations in `merge_plans`.
- Keep `open_document` out of the MCP catalog and reject it as an unknown/unsupported MCP call.
- Keep file-first session auto-resolution for document tools (`read_file`, `grep`, `replace_text`, `insert_paragraph`, `download`, `get_session_status`).
- Add scenario-mapped OpenSpec traceability tests for this behavior set.

## Impact
- Affected specs: `mcp-server`
- Affected code:
  - `packages/safe-docx/src/server.ts`
  - `packages/safe-docx/src/tools/merge_plans.ts`
  - `packages/safe-docx/src/tools/*.allure.test.ts` (traceability coverage)
