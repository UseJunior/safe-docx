# Tasks

## odf-core
- [x] Add `DC` namespace to `ODF_NS` (`http://purl.org/dc/elements/1.1/`)
- [x] Extract `Segment` + `buildSegments` into `shared/odf/text_segments.ts`; skip `office:annotation` / `office:annotation-end` subtrees (B1)
- [x] `collectBlocks` in `document.ts` skips annotation subtrees (no phantom blocks) (B1)
- [x] New `comments.ts`: `addWholeBlockAnnotation` (structural) + `addRangedAnnotation` (single-text-node split, B2); `readAnnotations`; `office:name` id allocation scanning all existing names
- [x] `OdfDocument.addComment` / `getComments` delegating to `comments.ts`; export `OdfComment`
- [x] odf-core `comments.test.ts`: whole-block (incl. spans), ranged, point/empty, id allocation, round-trip read, MATCH_SPANS_MULTIPLE_NODES, B1 no-leak regression

## docx-mcp
- [x] `tools/odf/add_comment.ts` (root + ranged; replies → UNSUPPORTED_FOR_ODF; `author` required; `text` param)
- [x] `tools/odf/get_comments.ts` (maps to McpComment shape; `replies: []`)
- [x] Add `add_comment`, `get_comments` to `ODF_SUPPORTED_TOOLS`; update guard hint + both `session_resolution.ts` hints
- [x] Register handlers in `loadOdfHandlers`; add `isOdfRequest` dispatch branches
- [x] Update `tool_catalog.ts` provider text + regenerate `tool-reference.generated.md`
- [x] Switch `odf_grep_insert.test.ts` OPLR-08 + "two unsupported tools" cases to `compare_documents`; amend `add-odf-grep-insert` spec wording (drop `add_comment` from the unsupported example)

## Tests & verification
- [x] docx-mcp `odf_comments.test.ts`: OPCM-01..05 scenarios + branch tests; `TEST_FEATURE='add-odf-comments'`
- [x] Full CI gate locally + document-shaped `.odt` smoke (add_comment + get_comments on real NVCA .odt, reopen in LibreOffice)
- [x] Coverage ratchet not regressed
