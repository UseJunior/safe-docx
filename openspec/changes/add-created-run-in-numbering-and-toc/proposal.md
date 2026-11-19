# Change: Run-in legal numbering, a table of contents and roman page numbers in created documents

## Why

Many agreements number their sections in the run-in house style: the number
and the heading start the body paragraph ("2.01 Engagement. The Manager is
appointed …", then "(a) Scope. …"). `docx-markdoc create` numbers headings
only as stand-alone lines (`heading-numbers: legal`, #1250), so the only way
to write this style was to type the labels, and every cross-reference had to
be typed too ("under Section 2.01(a)"). Renumbering a section then meant
rewriting every reference, with nothing in the build to catch a stale one
(#1417).

The same agreements need a table of contents and a front-matter section
numbered i, ii, iii (#1426). `create` had no TOC field, no way to mark a
run-in heading as a TOC entry, and `page-number-format` admitted only
`plain`, `dashed` and `page-of-total`, with no restart on `{% section %}`.

## What Changes

- Add a block tag `{% run-in-paragraph level="…" heading="…" %}…{% /run-in-paragraph %}`.
  Each tag is one body paragraph numbered by a real Word multilevel list
  (the run-in definition): `article` "2.", `section` "2.01" (zero-padded,
  restarting under each article), `clause` "(a)" and `subclause` "(i)". The
  heading runs in after the number, bold for an article and underlined below
  it, followed by a period unless it ends in punctuation, then the body
  text. A `{% #id %}` on the tag is an xref target: `{% xref %}` shows
  "2", "2.01", "2.01(a)" or "2.01(a)(i)" in full (`format="section"` adds
  "Section "), and the level's own number with `number="paragraph"`, as a
  REF field whose cached result is what Word and LibreOffice show.
- Refuse run-in sources Word and LibreOffice would number differently or
  that `create` does not model: a level without the level above it
  (`RUN_IN_SKIPS_LEVEL`), run-in paragraphs mixed with `heading-numbers`
  (`RUN_IN_WITH_HEADING_NUMBERS`), and text or relative references to a run-in
  paragraph (`XREF_RUN_IN_FORM_UNSUPPORTED`).
- Add `{% toc /%}`: a TOC field (`TOC \f \l "1-3" \n`) whose cached result
  is already written, one paragraph per entry in the `toc 1`–`toc 3` styles,
  so the contents show before fields are updated. Its entries are TC fields:
  each `##`/`###` heading (after its number with `heading-numbers: legal`),
  each run-in article and section ("2.01 Engagement"), and each explicit
  `{% tc level=N %}…{% /tc %}`, whose content also shows in place. Without
  page numbers, the cached result is exactly what an update lists.
- Add `page-number-format: lower-roman` and `upper-roman` and
  `{% section page-number-start=N %}`, written as `w:pgNumType w:fmt` and
  `w:start` on every section that shows that footer.
- Verify all of it: the source oracle derives run-in labels, xref numbers and
  TOC entries from the source alone; the read-back reads a TOC's cached result
  as its paragraphs and TC fields as nothing; a new `tableOfContents` check
  holds the cached result to the document's TC entries (a stale entry fails),
  and a new `pageNumbering` check holds each section's `w:pgNumType` to the
  source; the PDF check accepts a roman or restarted page number in each
  section's numerals. Each has a negative control.
- docx-core generation gains `ParagraphSpec.tableOfContents` (the paragraphs
  that hold a TOC field's cached result) and the `tableOfContentsEntry`
  inline (a TC field).

## Impact

- Affected specs: `docx-markdoc` (ADDED requirements), `docx-generation`
  (ADDED requirement).
- Affected code: `packages/docx-core/src/generation/{types,validate-spec}.ts`,
  `emit/{run,paragraph}.ts`; `packages/docx-markdoc/src/create/{validate,
  list-numbering,theme,lower,profile,oracle,readback,create}.ts`,
  `src/cli-help.ts`.
- Compatibility: additive. A source without the new tags and values builds
  the same bytes as before.
- Not included: page numbers in the table of contents (their cached values
  depend on page layout, which `create` cannot know before a reader lays the
  document out); `pull` of edits inside run-in paragraphs or the table of
  contents (reported as unmapped paragraphs); a run-in TOC built from
  outline levels or the style separator.
