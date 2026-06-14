## 1. Specification
- [ ] 1.1 Write mcp-server spec deltas for `style_source_id` on `insert_paragraph`.
- [ ] 1.2 Write docx-primitives spec deltas for `styleSourceId` on `insertParagraph` primitive.

## 2. `style_source_id` on insert_paragraph
- [ ] 2.1 Add `styleSourceId?: string` parameter to `DocxDocument.insertParagraph()` in docx-core.
- [ ] 2.2 When provided, use style source paragraph for `cloneParagraphShell()` and template run selection instead of anchor.
- [ ] 2.3 Fall back to anchor with `styleSourceFallback: true` flag when style source ID is not found.
- [ ] 2.4 Accept and pass through `style_source_id` in `packages/docx-mcp/src/tools/insert_paragraph.ts`.
- [ ] 2.5 Add `style_source_id` to the insert_paragraph schema in `tool_catalog.ts`.

## 3. Tests
- [ ] 3.1 Test: `style_source_id` clones pPr and template run from specified paragraph.
- [ ] 3.2 Test: `style_source_id` falls back to anchor with warning when ID not found.
- [ ] 3.3 Test: `insert_paragraph` without `style_source_id` behaves identically to before.

## 4. Verification
- [ ] 4.1 `npm run build -w @usejunior/docx-mcp`
- [ ] 4.2 `npm run test:run -w @usejunior/docx-core -- test-primitives/document.test.ts`
- [ ] 4.3 `openspec validate add-apply-plan-and-style-source --strict`
