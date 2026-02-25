## 1. Specification
- [ ] 1.1 Write mcp-server spec deltas for `apply_plan` tool (validate-then-apply, single mode).
- [ ] 1.2 Write mcp-server spec deltas for `style_source_id` on `insert_paragraph`.
- [ ] 1.3 Write docx-primitives spec deltas for `styleSourceId` on `insertParagraph` primitive.

## 2. Phase A: `style_source_id` on insert_paragraph
- [ ] 2.1 Add `styleSourceId?: string` parameter to `DocxDocument.insertParagraph()` in docx-core.
- [ ] 2.2 When provided, use style source paragraph for `cloneParagraphShell()` and template run selection instead of anchor.
- [ ] 2.3 Fall back to anchor with `styleSourceFallback: true` flag when style source ID is not found.
- [ ] 2.4 Accept and pass through `style_source_id` in `packages/docx-mcp/src/tools/insert_paragraph.ts`.
- [ ] 2.5 Add `style_source_id` to the insert_paragraph schema in `tool_catalog.ts`.

## 3. Phase B: `apply_plan` tool
- [ ] 3.1 Create `packages/docx-mcp/src/tools/apply_plan.ts` with validate-then-apply logic.
- [ ] 3.2 Implement step normalization: accept both raw top-level fields and `merge_plans` output (fields in `step.arguments`). Extract only known fields into fresh objects (`__proto__` safe).
- [ ] 3.3 Implement validation pass: check target IDs exist, old_strings match uniquely, style sources exist, operations supported, legacy aliases rejected.
- [ ] 3.4 Implement execution pass: call existing `replaceText()` / `insertParagraph()` in a loop, stop on first error.
- [ ] 3.5 Return `completed_step_ids`, `failed_step_id`, `failed_step_index` on execution failure.
- [ ] 3.6 Implement `plan_file_path`: `enforceReadPathPolicy()`, max 1MB, `.json` extension, error if both `steps` and `plan_file_path` supplied.
- [ ] 3.7 Register `apply_plan` in MCP tool catalog and server dispatcher.

## 4. Phase C: Tests
- [ ] 4.1 Test: successful apply executes all steps and returns results.
- [ ] 4.2 Test: validation failure returns all errors without applying any steps.
- [ ] 4.3 Test: partial apply failure stops on first error, returns completed_step_ids and failed_step_id.
- [ ] 4.4 Test: step normalization handles raw format (top-level fields).
- [ ] 4.5 Test: step normalization handles merged format (fields in `step.arguments`).
- [ ] 4.6 Test: `__proto__` in step fields is rejected or ignored.
- [ ] 4.7 Test: unsupported operation is rejected during validation.
- [ ] 4.8 Test: legacy aliases (`smart_edit`, `smart_insert`) are rejected during validation.
- [ ] 4.9 Test: `plan_file_path` reads steps from JSON file on disk.
- [ ] 4.10 Test: `plan_file_path` rejects non-.json extension.
- [ ] 4.11 Test: `plan_file_path` rejects files exceeding 1MB.
- [ ] 4.12 Test: error when both `steps` and `plan_file_path` are supplied.
- [ ] 4.13 Test: `style_source_id` clones pPr and template run from specified paragraph.
- [ ] 4.14 Test: `style_source_id` falls back to anchor with warning when ID not found.
- [ ] 4.15 Test: `insert_paragraph` without `style_source_id` behaves identically to before.

## 5. Verification
- [ ] 5.1 `npm run build -w @usejunior/docx-mcp`
- [ ] 5.2 `npm run test:run -w @usejunior/docx-mcp -- src/tools/apply_plan.test.ts`
- [ ] 5.3 `npm run test:run -w @usejunior/docx-core -- test-primitives/document.test.ts`
- [ ] 5.4 `openspec validate add-apply-plan-and-style-source --strict`
