# Change: Cross-references in generated documents

## Why

A generated document cannot refer to its own provisions. `FieldSpec` allows
only `PAGE` and `NUMPAGES`. There is no bookmark spec, and the creation
grammar has no reference tag. "As provided in Section 2.06(b)" therefore has
to be typed as literal text, and it goes stale when a section is inserted
above it. Agreements carry hundreds of these references (#1236).

## What Changes

- `ParagraphSpec` gains `bookmark?: string`. The paragraph's content is
  wrapped in `w:bookmarkStart`/`w:bookmarkEnd`, after its properties and
  around any comment range. A bookmark's `w:id` comes from the same sequence
  as comment ids, so no annotation id repeats in the document part. A name
  must pass Word's Bookmark dialog: at most 40 characters, starting with a
  letter, using only letters, digits and underscores. Names must be unique
  without regard to case. Only body paragraphs (table cells included) may
  carry one.
- `InlineSpec` gains `{ kind: 'crossReference', bookmark, number?: 'fullContext' | 'paragraph' }`
  with run formatting. It emits a five-run complex field ` REF <name> \w \h `
  (full context, the default) or ` REF <name> \n \h ` (paragraph number).
  These are the instructions Word itself writes from Insert → Cross-reference
  with "Include hyperlink" checked. A cross-reference may sit in the body,
  table cells and footnotes, not in headers or footers. It must name a
  declared bookmark.
- Each cached result is the number Word shows after updating fields. It is
  computed from the generated body with the existing list-label read
  side. The new `renderReferenceNumber` follows Word, as recorded with Word
  16.114 in `scripts/oracle/word/evidence/issue-1236-word-16.114.json` (97
  fields). A full-context number joins the target level's text to its
  ancestors' level texts, up to level 0. One trailing period is removed, and
  so is a period before a part that starts with `(`. So `2.` + `(b)` gives
  `2(b)` and `Section %1.%2` + `(%3)` gives `Section 2.06(b)`. A paragraph
  number is the target level's text with one trailing period removed.
  Generation refuses a target whose result Word would not show as a number:
  an unnumbered paragraph (Word shows `0`), a number that depends on a level
  no earlier paragraph uses (Word shows the level's start value), a level
  text that names a deeper level (Word shows no number; § 17.9.11 says to
  ignore the placeholder), or an empty rendering.
- The list-label read side numbers letters past `z` as Word and § 17.18.59
  do (`aa`, `bb`, …, `zz`, `aaa`). It used to give `ab` for 28, which would
  have been cached in a REF result.
- `bookmarkNameForSlug` and `bookmarkNamesForSlugs` map readable kebab-case
  ids to bookmark names. Hyphens become underscores. An id longer than 40
  characters keeps 31 characters plus `_` and 8 hex digits of its SHA-256.
  Ids that map to the same name, compared without regard to case, fail.
- The generated-package structural check verifies bookmark pairing: unique
  ids and names, each start before its end, and no bookmark id equal to a
  comment-range id.
- The creation grammar adds Markdoc's `{% #id %}` annotation on headings and
  list items, which becomes a bookmark, and an inline self-closing
  `{% xref to="id" /%}` with `number="full" | "paragraph"` and
  `format="section"`. `format="section"` writes `Section ` as literal text
  before the field. A created document numbers only ordered list items, so an
  xref must name a numbered list item. Errors carry a code and a line:
  `INVALID_ID`, `ID_PLACEMENT`, `DUPLICATE_ID`, `ID_COLLISION`,
  `INVALID_CROSS_REFERENCE`, `XREF_UNKNOWN_ID` (naming the missing id) and
  `XREF_TARGET_NOT_NUMBERED`.
- Create's verification covers cross-references. The read-back reads a REF
  field as its cached result. The source projection numbers the targets
  itself, so the round trip catches a reference that shows the wrong number.
  A new cross-reference check compares each REF instruction (bookmark name
  and switch) and where it sits with its `{% xref /%}`, and each named
  bookmark's paragraph with the item marked with that id. Every xref tag in
  the source's syntax tree must be placed, so one the text walker never
  reaches fails the build. A source holding a C0 control character that XML
  cannot carry now fails with `INVALID_CHARACTER`. It catches a field that points at
  another item showing the same number. LibreOffice recalculates REF fields when it loads a document and keeps
  the period of `1.` before `(` (`2.(b)`), so the PDF checks expect that form.
- `docx-markdoc import` admits REF fields in footnotes and reads them as
  their cached result text. Any other field, a second separator or
  instruction text in a field's result still fails closed.

Not included:

- `\r` (relative number). Word computes it from where the field sits, which
  differs between a reference in clause 2.06(a) and one in 2.06(b)(iii).
- Numbered headings in `create`. Its headings are unnumbered, so an id on a
  heading is a bookmark that no xref can name yet.
- Text references (`REF` without a number switch) and page references
  (`PAGEREF`).
- Re-importing a REF field as `{% xref %}`. Import keeps its number as text.

## Impact

- Affected specs: `docx-generation` (ADDED requirement), `docx-markdoc`
  (ADDED requirement).
- Affected code: in `packages/docx-core/src/generation/`, the types, the
  validation, `bookmark-names.ts`, the compile step, the emit context, and the
  paragraph, run, document-part and footnotes-part emitters, plus the
  structural checks. `src/primitives/numbering.ts` gets
  `renderReferenceNumber`. In `packages/docx-markdoc/src/create/`: the
  validate, theme, lower, readback, oracle and cli-create modules, plus
  `src/import.ts`.
- Compatibility: additive. Specs and sources without bookmarks or
  cross-references produce the same bytes as before.
