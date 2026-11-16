# Change: Read, edit and attach DOCX headers and footers through the MCP server

## Why
No docx-mcp tool returns header or footer content, edits it, or gives a
section its own header or footer (#1050, #1051, #1052, #1200). Agents saw only
the relationship ids `get_sections` reports, and changing the running footer
(a page number, a "Signature Page" caption, a confidentiality legend) meant
hand-editing package XML outside the session's change accounting. docx-core
already selects header/footer stories through section relationships (#1005)
and edits their paragraphs (#1006); the MCP surface did not expose them.

## What Changes
- New read-only `get_headers_footers` tool: per section, the default, first
  and even header and footer with relationship id, part name, inheritance and
  paragraphs carrying the same `_bk_*` ids `read_file` uses. A separate tool
  rather than a `read_file` option because headers and footers are
  per-section, typed and shared between sections, which the paginated body
  view has no place for.
- `replace_text` and `insert_paragraph` accept a header/footer paragraph id
  and edit that story (plain text), tracked as `w:ins`/`w:del` in the header
  or footer part in a tracked session. `batch_edit` refuses such ids with a
  message pointing at the single-edit tools.
- New `set_header_footer` tool: create a part (text and PAGE/NUMPAGES fields
  with alignment) or reuse an existing one, or link to the previous section;
  writes the part, relationship and content-type override, sets the
  section's reference, sets `w:titlePg` for the first type, keeps the
  following sections' headers/footers by pinning the next section, records
  `w:sectPrChange` in tracked mode and lists the untracked part creation in
  the save report's non-revision manifest.
- A clean save restores the original bytes of every header/footer part that
  only received paragraph ids.

## Impact
- Affected specs: mcp-server
- Affected code: `packages/docx-core/src/primitives/header_footer.ts`,
  `document.ts`; `packages/docx-mcp/src/tools/get_headers_footers.ts`,
  `set_header_footer.ts`, `header_footer_edit.ts`, `replace_text.ts`,
  `insert_paragraph.ts`, `batch_edit.ts`, `tool_catalog.ts`, `server.ts`;
  `packages/safe-docx-mcpb/manifest.json`.
