# Change: Report or resolve an edit that leaves an empty numbered paragraph

## Why

An edit can leave the paragraph it touched numbered but empty. Word then
shows a bare list label, for example `(b)` followed by nothing, and no text
extraction shows it. `replace_text` and `batch_edit` return `success: true`
with no warning (#1047, split from #740).

#740 (PR #1059) already removes a paragraph whose whole text an untracked
edit blanks, and a tracked edit deletes its paragraph mark. Measured on main
@ 228ebc41, the edits that still leave an empty numbered paragraph, in both
tracked and untracked mode, are:

- a partial edit that leaves only whitespace: `old_string` without the
  paragraph's trailing space or leading tab, or a whitespace `new_string`;
- a full-text blank of a paragraph the blanking rules keep: one that holds a
  bookmark (#1222, handled separately by PR #1352), a comment anchor, or a
  field with no visible result, and, untracked, one that carries `w:sectPr`;
- a full-text blank of a table cell's only paragraph. On main this paragraph
  was removed outright, leaving a `w:tc` without a paragraph, which is not
  valid; this change keeps it (see design.md).

## What Changes

- `replace_text` and `batch_edit` gain an optional
  `on_empty_numbered_paragraph` parameter: `"warn"` (default), `"error"`,
  `"remove_paragraph"` or `"ignore"`.
- The check applies only to the paragraph an edit touched. It fires when that
  paragraph had visible content before the edit, has none after it once
  tracked changes are accepted, and still displays a list label, directly or
  through its paragraph style. A whole-paragraph tracked deletion (text in
  `w:delText` and a deleted paragraph mark) and an image-only list item do
  not fire it, and neither does an empty numbered paragraph the input
  already had.
- `"warn"` adds a warning naming the paragraph id, its list label, its text
  before the edit, and either how to delete it or what keeps it in place.
- `"error"` refuses the edit with `EMPTY_NUMBERED_PARAGRAPH` and leaves the
  document unchanged.
- `"remove_paragraph"` deletes the paragraph's remaining whitespace through
  the existing full-blank path, so an untracked edit removes the paragraph
  and a tracked edit deletes the text and the paragraph mark. A paragraph
  the blanking rules keep is not removed; the response says why.
- `batch_edit` applies the policy to the end state of the batch. Each warning
  carries the `step_id` of the step that emptied the paragraph,
  `remove_paragraph` runs once after the last step, and `error` refuses the
  whole batch before any step is applied.
- `canSafelyRemoveEmptyParagraph` (docx-core) no longer counts a cell's
  `w:tcPr` as a block sibling, so a table cell keeps its only paragraph.

## Impact

- Affected specs: `mcp-server`
- Affected code: `packages/docx-core/src/primitives/empty_numbered_paragraph.ts`
  (new), `packages/docx-core/src/primitives/paragraph_structure.ts`,
  `packages/docx-core/src/primitives/errors.ts`,
  `packages/docx-mcp/src/tools/empty_numbered_paragraph.ts` (new),
  `packages/docx-mcp/src/tools/replace_text.ts`,
  `packages/docx-mcp/src/tools/batch_edit.ts`,
  `packages/docx-mcp/src/tool_catalog.ts`
- Overlap: PR #1352 (#1222) changes which bookmark-holding numbered paragraphs
  a full blank removes. This change does not alter the blanking rules in
  `text.ts`; once #1352 lands, those paragraphs are removed and the check
  stops firing for them without further changes here.
