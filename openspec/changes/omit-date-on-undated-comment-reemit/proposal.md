# Change: Re-emit undated source comments without a `w:date`

## Why

A source comment with no `w:date` gained one when `compileMarkdoc` re-emitted
it (after an author, initials, anchor or thread-parent change). The value was
the compile time, so the output claimed the comment was written today. Dated
source comments kept their date; only undated ones were affected, because
`addComment` / `addCommentReply` fill an omitted date from the process clock
and the re-emit path passed `date: undefined` for them.

## What Changes

- `compileMarkdoc` re-emits a source comment or reply that had no `w:date`
  with no `w:date` in the output.
- `DocxDocument.addComment` and `addCommentReply` (and the docx-core
  primitives beneath them) accept `date: null` as an explicit "write no
  `w:date`" signal. Omitting `date` keeps the existing default, so other
  callers are unchanged.

## Impact

- Affected specs: docx-markdoc
- Affected code: `packages/docx-core/src/primitives/comments.ts`,
  `packages/docx-core/src/primitives/document.ts`,
  `packages/docx-markdoc/src/presentation.ts`, tests
- Related issue: #1103
