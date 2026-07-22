# Change: Add `style_source_id` Parameter to `insert_paragraph`

> Note: this change originally also added a batch-apply tool. That tool is superseded by
> `batch_edit` (see change `replace-plan-tools-with-batch-edit`), so that scope has been
> removed here; only the `style_source_id` work remains.

## Why
`insert_paragraph` always clones formatting from the positional anchor, so inserting body text after a heading produces incorrectly styled paragraphs. Callers need to decouple the formatting source from the positional anchor.

## What Changes
- Add `style_source_id` optional parameter to `insert_paragraph`.
  - When provided, paragraph properties (`w:pPr`) and template run formatting are cloned from the style source paragraph instead of the positional anchor.
  - Falls back to anchor with a warning when the style source ID is not found.
- Add `styleSourceId` to the `insertParagraph` primitive in docx-core.

## Impact
- Affected specs: `mcp-server`, `docx-primitives`
- Affected code:
  - `packages/docx-core/src/primitives/document.ts` (add `styleSourceId` param)
  - `packages/docx-mcp/src/tools/insert_paragraph.ts` (accept `style_source_id`)
  - `packages/docx-mcp/src/tool_catalog.ts` (add schema)
