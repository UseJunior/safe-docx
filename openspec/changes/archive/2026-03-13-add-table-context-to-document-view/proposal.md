# Change: Add table structure context to document view

## Why
Table cell paragraphs in `read_file` output appear as disconnected paragraphs with no structural markers. LLM consumers cannot tell where tables start/end, which cells share a row, or distinguish table content from body text. This limits the ability to understand and edit tabular data in DOCX files.

## What Changes
- Add `TableContext` type with row/column coordinates, header text, and grid-aware column positions
- Augment `buildDocumentView()` to derive table context by walking up DOM ancestry from each paragraph
- Add `#TABLE`/`#END_TABLE` markers and `th(r,c)`/`td(r,c)` styles to toon/simple output formats
- Include `table_context` field in JSON output format
- Update budget-aware renderers to handle table boundary markers
- Preserve empty table cell paragraphs for structural completeness

## Impact
- Affected specs: docx-primitives, mcp-server
- Affected code: `document_view.ts`, `document.ts`, `dom-helpers.ts`, `tables.ts`, `read_file.ts`
- **Not breaking**: Existing paragraph IDs, ordering, and edit operations are unchanged
- `extractTables()` remains independent — this change is additive to the document view pipeline
