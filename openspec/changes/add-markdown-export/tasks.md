# Tasks: Add DOCX → Markdown export

## 1. docx-core serializer primitive
- [x] 1.1 Export `TOON_INLINE_TAG_RE` and add `tokenizeToonInline()` in `document_view.ts`.
- [x] 1.2 Make `injectFootnoteMarkers` tag-aware (reuse `findTaggedTextInsertionIndex`).
- [x] 1.3 Add `serialize_markdown.ts`: `inlineTagsToMarkdown()` + `serializeToMarkdown()`.
- [x] 1.4 Add async `DocxDocument.toMarkdown()`; export from the primitives barrel.

## 2. docx-mcp export tool
- [x] 2.1 Add `tools/export.ts` (session resolution, path policy, overwrite guard, default `.md`).
- [x] 2.2 Register in `tool_catalog.ts` and `server.ts`.

## 3. Tests (mapped to spec scenarios)
- [x] 3.1 `serialize_markdown.test.ts` in docx-core (docx-primitives scenarios).
- [x] 3.2 `export.test.ts` in docx-mcp (mcp-server scenarios).

## 4. Validation
- [x] 4.1 `openspec validate add-markdown-export --strict`.
- [x] 4.2 Build, lint, and run both packages' tests (incl. spec-coverage).
- [x] 4.3 Real-document smoke: export a real `.docx` and visually confirm the `.md`.
