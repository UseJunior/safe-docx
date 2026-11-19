# Change: Running headers, footer layout and first pages in created documents

## Why

`docx-markdoc create` cannot write a running header, and it fixes the
footer's layout: the text is italic and centred, and the page number is a
bare `PAGE` field in its own centred paragraph. A one-page letter needed a
right-aligned header and a centred page number, and a second matter needed
the header to start on page 2. Both were added after `create` with
python-docx, so `<stem>.verification.json` certified a DOCX that no longer
existed (#1223, gaps 1 and 2). docx-core generation already supports
default, first and even headers and footers, `w:titlePg`, paragraph
alignment, tab stops and `PAGE`/`NUMPAGES` fields.

## What Changes

- New running-text keys, the same in the frontmatter (first section) and as
  `{% section %}` attributes (the next section):
  - `header` (text; `header=false` on a section for an empty header),
    `header-align` (`left`, `center` (default), `right`);
  - `footer-align` (`left`, `center`, `right`), `footer-italic`
    (`true` (default) or `false`), `page-number-align`
    (`left`, `center`, `right`), `page-number-format` (`plain` "1" (default),
    `dashed` "- 1 -", `page-of-total` "Page 1 of 3" with a `NUMPAGES`
    field), `footer-layout` (`stacked` (default) or `one-line`: the footer
    text at the left margin, then a right tab stop at the right margin and
    the page number);
  - `header-first` and `footer-first`: the first page's own text, or `none`
    for an empty slot on the first page. Each is independent. First-page
    text alone declares an empty header or footer for the other pages.
- Inheritance follows `footer`: a section that declares no header (no
  `header` or `header-first`) inherits the previous one, its first-page
  variant included; any header key unlinks it. A section whose header or
  footer has a first-page variant gets `w:titlePg`, and both its first-page
  slots are written: the variant where there is one, a copy of the section's
  own header or footer where there is not. Word and LibreOffice show only the
  first-page slots on such a page, so this keeps page 1 from silently losing
  its page number or header. An inheriting section writes its first-page
  slots itself rather than relying on Word's inheritance of first-page
  references.
- A key that shapes text needs that text in the same declaration, so a
  formatting key never formats nothing: `header-align` needs header text
  (the header's or its first page's), `footer-align` and `footer-italic`
  footer text, `page-number-align` and `page-number-format` page numbers,
  `footer-layout: one-line` both (and takes no `footer-align` or
  `page-number-align`), `header-first: none` and `footer-first: none` a
  header or footer. Violations fail with `UNSUPPORTED_CREATION_FRONTMATTER`
  or `INVALID_SECTION` (with its line).
- Verification:
  - read-back reads each section's default header and, under `w:titlePg`,
    its first-page header and footer, and compares them with the lowering's
    projection (`checks.headers`), with a control on the default headers and
    one per first-page slot;
  - the round trip compares the re-imported headers and first-page slots
    with the source oracle, which reads them from the source alone, with
    controls `deletedHeaderText`, `changedFirstPageHeader` and
    `changedFirstPageFooter`; field markers in expected footers match any
    decimal number (`Page 2 of 3`);
  - the PDF word check expects each page's header words, then its footer
    words, at the page head (LibreOffice's order), the first-page variant on
    the first page of each section, and the generated words `Page`, the
    number, `of` and the total;
  - the header text and the literal pieces of the footer lines that each
    section is sure to show are required PDF text: its own header and footer
    without `w:titlePg`, its first-page slots with it (a one-page section
    never shows its other header and footer, which the word check holds to
    each continuation page).
- Exported constants for later CLI help: `CREATION_FRONTMATTER_KEYS`,
  `RUNNING_TEXT_KEYS` (the `{% section %}` attributes, also
  `CREATION_BLOCK_TAGS.section`), `RUNNING_TEXT_ALIGNMENTS`,
  `PAGE_NUMBER_FORMATS`, `FOOTER_LAYOUTS` and `FIRST_PAGE_NONE`.

Not included: even-page headers, header formatting other than alignment,
fields in header text, and a template-free way to edit headers of an
existing document (#1034, #1200).

## Impact

- Affected specs: `docx-markdoc` (ADDED requirement).
- Affected code: `packages/docx-markdoc/src/create/` (`validate.ts`,
  `lower.ts`, `profile.ts`, `readback.ts`, `create.ts`, `oracle.ts`,
  `cli-create.ts`). docx-core is not changed.
- Compatibility: a source without the new keys builds the same DOCX bytes
  and the same certificate. The certificate gains `checks.headers`,
  `headers`, `firstPage`, `roundTrip.headers`, `roundTrip.firstPage` and the
  new controls only when the document has a header or a first-page slot.
  The `UNSUPPORTED_CREATION_FRONTMATTER` message for an unknown key lists the
  new keys.
