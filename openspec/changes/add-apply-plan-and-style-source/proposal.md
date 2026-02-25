# Change: Add `apply_plan` Tool and `style_source_id` Parameter

## Why
The current edit pipeline requires N individual `replace_text` / `insert_paragraph` calls after merge, making it chatty for documents with 10-20 surgical edits. Additionally, `insert_paragraph` always clones formatting from the positional anchor, so inserting body text after a heading produces incorrectly styled paragraphs.

## What Changes
- Add an `apply_plan` tool that validates all steps up front, then applies sequentially if valid.
  - If validation fails, returns all errors without applying any steps.
  - If a step fails during execution, stops immediately and returns completed_step_ids, failed_step_id, and failed_step_index so the agent can reapply to the original DOCX.
  - Accepts steps inline or from a `plan_file_path` (enforceReadPathPolicy, max 1MB, .json extension).
  - Normalizes both raw top-level step fields and `merge_plans` output (fields nested in `step.arguments`). Normalization extracts only known fields into fresh objects (`__proto__` safe).
  - Rejects unsupported operations and legacy aliases (`smart_edit`, `smart_insert`).
- Add `style_source_id` optional parameter to `insert_paragraph`.
  - When provided, paragraph properties (`w:pPr`) and template run formatting are cloned from the style source paragraph instead of the positional anchor.
  - Falls back to anchor with a warning when the style source ID is not found.
- Add `styleSourceId` to the `insertParagraph` primitive in docx-core.

## Impact
- Affected specs: `mcp-server`, `docx-primitives`
- Affected code:
  - `packages/docx-core/src/primitives/document.ts` (add `styleSourceId` param)
  - `packages/docx-mcp/src/tools/apply_plan.ts` (new file)
  - `packages/docx-mcp/src/tools/insert_paragraph.ts` (accept `style_source_id`)
  - `packages/docx-mcp/src/server.ts` (register `apply_plan`)
  - `packages/docx-mcp/src/tool_catalog.ts` (add schemas)
