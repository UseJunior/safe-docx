# Tasks

## Phase 1: Tool Implementation

- [x] 1.1 Implement `get_document_outline` projection
  - Build the document view, project paragraphs whose `heading` is set into outline entries
  - Each entry: `paragraph_id` (`_bk_*`), `text`, `level`, `source`
  - Default to Word-style headings only; include heuristic headings only when `include_heuristic_headings=true`
  - File: `packages/docx-mcp/src/tools/get_document_outline.ts`

- [x] 1.2 Support `format` output
  - `json` (default): structured `outline` array plus `total_headings` / `total_paragraphs`
  - `markdown`: indented Markdown outline string under `content`

## Phase 2: Wiring

- [x] 2.1 Add `get_document_outline` to the tool catalog with a read-only annotation and input schema
  - File: `packages/docx-mcp/src/tool_catalog.ts`

- [x] 2.2 Dispatch `get_document_outline` in the server (DOCX only; `.odt` paths are rejected with `UNSUPPORTED_FOR_ODF`)
  - File: `packages/docx-mcp/src/server.ts`

## Phase 3: Tests

- [x] 3.1 Add traceability tests covering each scenario
  - Word-style headings are projected with level and `_bk_*` id
  - Heuristic headings are excluded by default and included on opt-in
  - Markdown format renders an indented outline
  - File: `packages/docx-mcp/src/tools/get_document_outline.test.ts`
