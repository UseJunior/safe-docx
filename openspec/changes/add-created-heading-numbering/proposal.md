# Change: Numbered headings in created documents

## Why

`docx-markdoc create` writes `##` and `###` headings as unnumbered Heading
paragraphs. A legal form numbers its headings ("ARTICLE II", "Section
2.04"), and most of its cross-references point at those headings. Because
the headings carry no number, `{% xref %}` to one fails with
`XREF_TARGET_NOT_NUMBERED`. Only ordered-list items can be cross-reference
targets today (#1250).

docx-core generation already supports what is needed: legal multilevel
numbering with `w:isLgl`, `decimalZero` and heading-style links (#1235), and
REF fields whose cached result is the number Word shows (#1236, #1254).

## What Changes

- New frontmatter key `heading-numbers: legal`. With it, each `##` heading
  is numbered `ARTICLE I`, `ARTICLE II`, … and each `###` heading
  `Section 1.01`, `Section 1.02`, …, restarting under each Article. The
  title (`#`) is never numbered. Without the key, nothing changes, and
  literal heading numbers (`## 2.04 Purchase Price`) remain plain text.
- One abstract numbering definition holds the heading levels
  (`ARTICLE %1` upper Roman; `Section %1.%2` legal and zero-padded) and
  three clause levels (`(%3)`, `(%4)`, `(%5)`: `(a)`, `(i)`, `(A)`). The
  heading levels link to the Heading 1 and Heading 2 styles (`w:pStyle`), so
  a heading is numbered by its style, and a paragraph a Word user sets to
  Heading 2 becomes the next Section.
- Ordered lists under a numbered heading are the clause levels of that
  definition (option (a) of PR #1271): `1.` is `(a)`, a nested list `(i)`,
  then `(A)`. They restart under each heading. `placeTopLevelList` returns a
  `heading-level` decision for them. Lists before the first numbered heading,
  and bullet lists, keep their own definitions as before.
- `{% xref %}` may name a numbered heading. Both number forms show the
  heading's whole label ("Section 2.04"). For a clause, the full form shows
  "Section 2.04(b)(i)" and the paragraph form "(i)". `format="section"` is
  refused for these targets, because their number already includes the word.
- The lowering's REF projection counts style-linked headings on their
  levels, per definition, with overrides applied at first use. The source
  oracle numbers headings and clauses from the source, projects the heading
  labels as generated text (two words each in the PDF word check), and
  checks that each heading bookmark holds the heading's text.
- New refusals, each with a code and a line:
  - `heading-numbers` set to anything other than `legal`:
    `UNSUPPORTED_CREATION_FRONTMATTER`.
  - A `###` heading before any `##`: `HEADING_NUMBER_SKIPS_LEVEL`.
  - A heading that repeats its generated number (`## ARTICLE IV …`,
    `### Section 2.04 …`): `DUPLICATE_HEADING_NUMBER`.
  - A list under a numbered heading whose first marker is neither 1 (for the
    first list under the heading) nor the number continuing the previous
    list under the same heading: `HEADING_LIST_START`. This keeps the numbers
    Word shows equal to the markers.
  - A Section that follows clauses placed directly under its Article:
    `SECTION_AFTER_ARTICLE_CLAUSES`. Word counts those clauses as the
    Article's first Section and numbers the Section N.02.
  - A full-form xref to a clause directly under an Article:
    `XREF_FULL_NUMBER_UNDER_ARTICLE`. Word shows "ARTICLE II(a)" and
    LibreOffice "Section 2.01(a)". The paragraph form is admitted.

Not included:

- Other numbering schemes (for example `1.` / `1.1` decimal outlines) and
  custom level texts. The frontmatter value is an enum so that schemes can be
  added later.
- Unnumbered `##` headings in a numbered document. Use `{% center %}` or a
  bold paragraph for an Exhibit or Recitals heading.
- Text-form cross-references (#1259) and relative `\r` references (#1258).
  The validator's target model (`TargetSite` with `headingNumbered` and
  `articleClause`) records where a target's number comes from, so these can
  add their own rules.

## Impact

- Affected specs: `docx-markdoc` (ADDED requirement).
- Affected code: `packages/docx-markdoc/src/create/` (`list-numbering.ts`,
  `theme.ts`, `lower.ts`, `oracle.ts`, `validate.ts`). docx-core is not
  changed.
- Evidence: `scripts/oracle/word/evidence/issue-1250-word-16.114.json`.
- Compatibility: sources without `heading-numbers` produce the same
  output.
