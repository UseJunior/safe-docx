# Change: Add Section Page Numbering Formatting

## Why

Safe DOCX can preserve and audit section properties, but callers cannot discover
the document's ordered sections or restart page numbering without editing
`word/document.xml` directly. Direct XML edits bypass session safeguards,
tracked-change attribution, and preservation checks around page layout and
header/footer relationships.

## What Changes

- Add a DOCX-only `get_sections` MCP tool that returns main-document sections in
  document order, including their boundary location and existing page-number,
  page-size, margin, and header/footer-reference metadata.
- Add a DOCX-only `format_section` MCP tool that targets one section by its
  zero-based `section_index` and sets `page_number_start`.
- Represent an effective restart as `w:pgNumType w:start` and record the prior
  section properties in a native `w:sectPrChange`.
- Preserve all untargeted `w:sectPr` children and attributes, including page
  size, margins, page-number format, columns, and header/footer references.
- Make an already-matching restart a deterministic no-op and reject invalid
  section indexes or values before live-session mutation.

## Impact

- Affected specs:
  - `docx-primitives`
  - `mcp-server`
- Affected code:
  - `packages/docx-core/src/primitives/` and `DocxDocument`
  - `packages/docx-mcp/src/tools/`, `server.ts`, and `tool_catalog.ts`
  - generated tool documentation and support matrices
  - unit, integration, conformance, and real-DOCX regression tests

## Non-Goals

- Inserting, removing, splitting, or reordering sections.
- Changing section-break type, page size, orientation, margins, columns, or
  line numbering.
- Creating, deleting, or editing headers, footers, or their relationships.
- Changing page-number format or chapter-number settings.
- Editing sections in headers, footers, notes, ODT, or Google Docs.
