# Tasks: Add DOCX → plain text export

## 1. docx-core serializer primitive
- [x] 1.1 Add `serialize_plaintext.ts`: `serializeToPlainText()` (block walk, tag stripping, tab tables, footnote defs).
- [x] 1.2 Add async `DocxDocument.toPlainText()`; export from the primitives barrel.

## 2. docx-mcp export tool
- [x] 2.1 Extend `tools/export.ts`: `plaintext` format (`.txt`), render via `toPlainText()`, return `content` (keep `markdown` alias for md).
- [x] 2.2 Update the `format` enum + descriptions in `tool_catalog.ts`.

## 3. Tests (mapped to spec scenarios)
- [x] 3.1 `serialize_plaintext.test.ts` in docx-core (docx-primitives scenarios).
- [x] 3.2 `export_plaintext.test.ts` in docx-mcp (mcp-server scenarios; separate file — one TEST_FEATURE per file).

## 4. Validation
- [x] 4.1 `openspec validate add-text-export --strict`.
- [x] 4.2 Build, lint, and run both packages' tests (incl. spec-coverage).
- [x] 4.3 Real-document smoke: export a real `.docx` to `.txt` and visually confirm.
