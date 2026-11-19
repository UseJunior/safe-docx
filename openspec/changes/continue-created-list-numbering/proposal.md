# Change: Continuous list numbering across headings in created documents

## Why

`docx-markdoc create` gives every top-level list its own numbering
definition, and a later list starts from a `w:start` value. So numbered
lists split by `##` headings ("1. 2." under Purchase, "3. 4." under Closing)
are unrelated Word lists. They look right when generated. But a clause
inserted in Word in the first list does not renumber the later lists, so two
clauses end up numbered 3. Cross-references keep pointing at the right
paragraphs, which makes the duplicate harder to see (#1252).

## What Changes

- Every ordered list in a created document uses one abstract numbering
  definition (`1.`, `(a)`, `(i)`). Word keeps one running count for all
  instances of a definition, so the lists count as one.
- A top-level ordered list whose first marker is the previous ordered list's
  last number plus one continues that list: it uses the same `w:numId` and
  writes no start value or override.
- Any other first marker restarts the count. The list gets a new `w:num` over
  the same definition with a level-0 `w:lvlOverride/w:startOverride` set to
  its marker, the markup Word itself writes to restart numbering. A list that
  follows a restarted list continues or restarts relative to that list.
- The document's first ordered list sets the definition's level-0 start to
  its first marker, as before. Bullet lists keep one definition each and do
  not affect the ordered count.
- The numbers Word shows still equal the Markdoc markers, so the source
  projection, read-back, round-trip, cross-reference and PDF checks are
  unchanged. The lowering's own REF projection counts per definition and
  applies each instance's start override at its first paragraph, as Word
  does.
- The decision lives in one place, `create/list-numbering.ts`, so numbered
  headings (#1250) can extend it.

Not included:

- Resuming a list that an intervening restart interrupted (main clauses
  1–4, a schedule 1–2, then `5.`). All lists share one running count, so `5.`
  restarts at 5 and does not follow insertions in the first list.
- Numbered headings (#1250).

## Impact

- Affected specs: `docx-markdoc` (ADDED requirement).
- Affected code: `packages/docx-markdoc/src/create/` (`list-numbering.ts`
  added; `theme.ts` and `lower.ts`). docx-core generation already emits
  additional numbering instances with start overrides; it is not changed.
- Compatibility: a document with one ordered list produces the same
  `word/numbering.xml`. Documents with several ordered lists now have one
  ordered abstract definition plus instances, in place of one definition per
  list; the visible numbers are unchanged.
