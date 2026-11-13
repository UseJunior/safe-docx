## 1. Proposal
- [x] 1.1 Measure on main which edits still leave an empty numbered paragraph after #740
- [x] 1.2 Settle the values, the default, and `remove_paragraph` in `batch_edit` (design.md)

## 2. Implementation
- [x] 2.1 docx-core: empty-numbered-paragraph predicate (`paragraphHasVisibleContent`, `isEmptyNumberedParagraph`, `resolveDisplayedListNumbering`)
- [x] 2.2 docx-core: keep a table cell's only paragraph in `canSafelyRemoveEmptyParagraph`
- [x] 2.3 docx-mcp: policy module and `replace_text` parameter
- [x] 2.4 docx-mcp: `batch_edit` parameter, end-state tracking with `step_id`, deferred removal, `error` preview
- [x] 2.5 Tool catalog descriptions and generated tool reference

## 3. Tests
- [x] 3.1 One test per scenario in `specs/mcp-server/spec.md`
- [x] 3.2 docx-core unit tests for the predicate and the table-cell rule
