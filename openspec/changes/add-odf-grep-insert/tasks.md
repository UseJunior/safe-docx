# Tasks

## odf-core
- [x] Add `OdfDocument.insertParagraph(id, text, BEFORE|AFTER)` + `InsertResult` type
- [x] Heading-aware style inheritance (inherit `text:style-name` only from `text:p` anchors)
- [x] Blank-line → multiple `text:p`; single `\n` → `text:line-break`
- [x] Rebuild positional block index; return freshly recomputed new IDs
- [x] Export `InsertResult` from package index

## docx-mcp
- [x] Extract pure `tools/grep_core.ts` (searchParagraphsCore / searchRawXmlCore)
- [x] Refactor `tools/grep.ts` to delegate to the core (no behavior change)
- [x] Add `tools/odf/grep.ts` (session-mode, no locator context)
- [x] Add `tools/odf/insert_paragraph.ts` (ID-invalidation fields in response)
- [x] Add `grep`, `insert_paragraph` to `ODF_SUPPORTED_TOOLS`; update both ODF hint strings
- [x] Register handlers in `loadOdfHandlers`; add `isOdfRequest` dispatch branches
- [x] Update `tool_catalog.ts` provider text + regenerate `tool-reference.generated.md`

## Tests & verification
- [x] odf-core `document.test.ts`: insert BEFORE/AFTER, style inherit + heading guard, ID shift, line-break, ANCHOR_NOT_FOUND
- [x] docx-mcp ODF grep + insert scenarios (OPLR-06/07/08) + branch tests (MISSING_PATTERN, INVALID_POSITION, dedupe, search_xml), `TEST_FEATURE='add-odf-grep-insert'`
- [x] Peer-review fixes: compare_documents two-file `.odt` guard (UNSUPPORTED_FOR_ODF); hoist `.odt` early-return before pending-map (correct tool name) — both with regression tests
- [x] Full CI gate locally + document-shaped `.odt` smoke (grep + insert on real NVCA .odt, reopen in LibreOffice)
- [x] Coverage ratchet not regressed
