# Change: Add Footnote Support

## Why
Safe-docx cannot read or write footnotes. American lawyers use footnotes extensively in contracts, financing documents, and agreements (e.g., NVCA Stock Purchase Agreement). A legal document editing tool must support footnote CRUD to be viable for legal workflows.

## What Changes
- NEW: `footnotes.ts` in docx-primitives — bootstrap, parse, add, update, delete footnotes
- NEW: `DocxDocument` wrapper methods for footnotes (`getFootnotes`, `getFootnote`, `addFootnote`, `updateFootnoteText`, `deleteFootnote`)
- NEW: `get_footnotes` MCP tool (read-only)
- NEW: `add_footnote` MCP tool (create)
- NEW: `update_footnote` MCP tool (edit)
- NEW: `delete_footnote` MCP tool (remove)
- MODIFIED: `document_view.ts` — render `[^N]` inline markers at footnote reference positions
- MODIFIED: `namespaces.ts` — add footnote element constants
- MODIFIED: `server.ts` — register new tools

## Impact
- Affected specs: `docx-primitives`, `mcp-server`
- Affected code: `packages/docx-primitives/src/footnotes.ts` (new), `packages/docx-primitives/src/document.ts`, `packages/docx-primitives/src/namespaces.ts`, `packages/docx-primitives/src/document_view.ts`, `packages/safe-docx/src/server.ts`, `packages/safe-docx/src/tools/get_footnotes.ts` (new), `packages/safe-docx/src/tools/add_footnote.ts` (new), `packages/safe-docx/src/tools/update_footnote.ts` (new), `packages/safe-docx/src/tools/delete_footnote.ts` (new)
