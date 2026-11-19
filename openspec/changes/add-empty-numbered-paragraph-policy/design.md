## Context

#740's original report proposed a post-edit warning scoped to the touched
paragraph and a four-value policy. #740 itself was narrowed to the untracked
full-blank fix (PR #1059); this change settles the remaining contract
(#1047).

## Goals / Non-Goals

- Goals: tell the caller when its edit leaves a bare list label; let it
  refuse such an edit or have the paragraph removed instead.
- Non-Goals: changing which blanked paragraphs `replaceParagraphTextRange`
  removes (bookmark-holding numbered paragraphs are #1222 / PR #1352); a
  document-wide lint of empty numbered paragraphs.

## Decisions

### Values and default

`warn | error | remove_paragraph | ignore`, default `warn`. A warning is
additive (callers that ignore `warnings` are unaffected), so `warn` is a safe
default. `remove_paragraph` turns `replace_text` from editing text into
deleting structure, so it is opt-in. The parameter is per call: on
`replace_text`, and once per `batch_edit` call for all of its steps.

### The predicate judges the accepted view

The issue's predicate says "count `w:delText` as text". Read literally, the
check could never fire in tracked mode, which is the server default: every
tracked edit that empties a paragraph keeps the old text in `w:delText`.
The purpose of that rule in #740 was that a correctly tracked
whole-paragraph deletion must not fire. The predicate therefore judges the
paragraph as it reads once its tracked changes are accepted:

- content inside `w:del` / `w:moveFrom` does not count, inserted text does;
- a paragraph whose mark is a tracked deletion that accept-all resolves by
  merging or removing the paragraph does not fire, so a whole-paragraph
  tracked deletion stays quiet;
- a tracked edit that deletes the text but keeps a live paragraph mark (a
  bookmark holds it, or whitespace is left) fires, because accept-all leaves
  the bare label.

Visible content is non-whitespace `w:t` text (including field results), a
`w:sym` glyph (#1444 counts it as text), `w:drawing`, `w:pict`, `w:object`,
math, a footnote or endnote reference, or a non-breaking hyphen. Whitespace,
tabs, breaks, range markers, field instructions and comment reference marks
are not. Numbering is `resolveParagraphNumbering` (direct `w:numPr` or the
style chain, as the document view labels it), restricted to a `w:num` the
numbering part defines.

### `remove_paragraph` reuses the full-blank path

It deletes the paragraph's remaining whitespace with
`replaceParagraphTextRange` over the whole remaining text, the same call a
full-text blank makes. Untracked, the paragraph is then removed by the
existing rules; tracked, the whitespace and the paragraph mark are deleted
as tracked changes, so accept-all removes the list item and reject-all
restores the paragraph. Paragraphs those rules keep (section properties, a
bookmark or comment anchor, a field, a table cell's only paragraph) are not
removed, and the response names the reason. `remove_paragraph` therefore
does not duplicate the existing auto-removal (which already handles a
full-text blank of an unanchored paragraph); its own reach is the
whitespace-left cases, and it does not override the anchor-preservation
rules.

### `remove_paragraph` in `batch_edit`: deferred to the end of the batch

Options considered:

1. Remove immediately after the step. A later step that targets or inserts
   next to the removed paragraph then fails mid-batch with
   `ANCHOR_NOT_FOUND`, after earlier steps were applied (batch execution is
   partial on failure). Validation, which resolves every anchor against the
   document before any step runs, would have accepted that step.
2. Defer to the end of the batch (chosen). Every step's anchors resolve
   against the paragraphs the caller validated. A later step can still
   insert before or after the emptied paragraph, or fill it again, in which
   case it is not removed and nothing is reported. After the last step, the
   paragraphs that are still empty numbered paragraphs are removed in one
   mutation, and each outcome is reported with the `step_id` of the step
   that emptied the paragraph.

The same end-state rule applies to `warn` (no warning for a paragraph a
later step refills) and to `error`: the batch is first run on a copy of the
document, and if its end state has an empty numbered paragraph the batch is
refused with `EMPTY_NUMBERED_PARAGRAPH` before any step touches the session
document. If a batch stops on a failing step, nothing is removed or refused
at its end; the empty numbered paragraphs the completed steps left are
reported as warnings.

### Table cell's only paragraph

The survey found that a full blank of a table cell's only paragraph removed
it, because `canSafelyRemoveEmptyParagraph` counted the cell's `w:tcPr` as a
remaining block. A `w:tc` must end with a paragraph (ECMA-376 Part 1
§ 17.4.65), so `w:tcPr` is now skipped like a trailing `w:sectPr`. The same
helper guards accept-all and reject-all, which had the same defect for a
tracked deletion of that paragraph's mark.

## Risks / Trade-offs

- The warning text names the list label, computed by numbering the whole
  body once. This runs only when the check fires.
- The `error` preview for `batch_edit` re-runs the steps on a copy through
  the batch preview executor; it costs one extra pass and only under
  `error`.

## Open Questions

- None blocking. If #1352 lands first, the bookmark scenario's paragraph is
  removed by the blanking rules and that warning no longer fires.
