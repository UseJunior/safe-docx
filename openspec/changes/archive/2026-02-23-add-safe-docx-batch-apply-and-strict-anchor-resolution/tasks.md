## 1. Specification
- [x] 1.1 Narrow `mcp-server` deltas to shipped, behavioral MCP surface guarantees.
- [x] 1.2 Keep scenario language aligned to canonical names and file-first entry behavior.

## 2. Implementation
- [x] 2.1 Keep canonical handlers (`replace_text`, `insert_paragraph`) as the only advertised edit/insert names.
- [x] 2.2 Keep `smart_edit`/`smart_insert` unavailable in the MCP catalog.
- [x] 2.3 Keep `merge_plans` rejecting legacy smart operation aliases.
- [x] 2.4 Keep `open_document` absent from MCP tool registration and unknown at dispatch time.

## 3. Validation
- [x] 3.1 Add scenario-mapped OpenSpec traceability tests for canonical naming enforcement.
- [x] 3.2 Add scenario-mapped OpenSpec traceability tests for file-first entry and `open_document` rejection behavior.

## 4. Verification
- [x] 4.1 `npm run test:run -w @usejunior/safe-docx -- src/tools/add_safe_docx_batch_apply_and_strict_anchor_resolution.allure.test.ts`
- [x] 4.2 `npm run check:spec-coverage -w @usejunior/safe-docx -- --strict`
- [x] 4.3 `openspec validate add-safe-docx-batch-apply-and-strict-anchor-resolution --strict`
