## ADDED Requirements

### Requirement: Run-in legal numbering in created documents

The creation grammar SHALL admit a top-level block tag
`{% run-in-paragraph level="…" heading="…" %}…{% /run-in-paragraph %}`, in its
self-closing, one-line or block form, holding at most one paragraph of body
text. `level` SHALL be `article`, `section`, `clause` or `subclause`;
`heading` SHALL be one line of text, required for an article and a section.
Each tag SHALL become one `BodyText` paragraph numbered through its own
`w:numPr` at that level of one multilevel definition: `%1.` (decimal),
`%1.%2` (the section zero-padded), `(%3)` (lower letter) and `(%4)` (lower
Roman), each followed by a space, so Word restarts each level under the
level above it. The paragraph's text SHALL be its heading (bold for an
article, underlined below it), a period unless the heading ends in
`.`, `:`, `;`, `?` or `!`, a space, and the body text. A run-in article SHALL
keep with the next paragraph.

A level SHALL need the level above it since the last paragraph of that level:
a section an article, a clause a section of the current article, a subclause
a clause of the current section; otherwise the source SHALL fail with
`RUN_IN_SKIPS_LEVEL`. Run-in paragraphs SHALL NOT be combined with
frontmatter `heading-numbers` (`RUN_IN_WITH_HEADING_NUMBERS`).

A `{% #id %}` on the tag SHALL make it a cross-reference target. A full
`{% xref %}` SHALL show "2" for an article, "2.01" for a section, "2.01(a)"
for a clause and "2.01(a)(i)" for a subclause, and `number="paragraph"` the
level's own number ("2", "2.01", "(a)", "(i)"), each as a REF field whose
cached result is that number; `format="section"` SHALL put "Section " before
it. A text or relative reference to a run-in paragraph SHALL fail with
`XREF_RUN_IN_FORM_UNSUPPORTED`. The source oracle SHALL derive every label
and reference number from the source alone, and the read-back, round-trip,
cross-reference and PDF checks SHALL compare them with the DOCX.

#### Scenario: [SDX-MDOC-RUNIN-01] run-in paragraphs are numbered by a real multilevel list with their heading inline
- **GIVEN** a source with two run-in articles, sections under each, a clause and a subclause, each with a heading or body text
- **WHEN** it is created
- **THEN** each paragraph SHALL carry `w:numPr` at its level of one abstract definition whose levels are `%1.`, `%1.%2` (decimalZero), `(%3)` and `(%4)`, and docx-core's label computation SHALL label them "1.", "1.01", "(a)", "(i)", "2.", "2.01"
- **AND** each paragraph's text SHALL be its formatted heading, its period, and its body text, the article's heading bold and the others underlined
- **AND** every check SHALL pass, the emitted document SHALL validate against the transitional schema, and a source without the tag SHALL build as before

#### Scenario: [SDX-MDOC-RUNIN-02] cross-references to run-in paragraphs show the full number Word shows
- **GIVEN** xrefs to a run-in article, section, clause and subclause in full, with `format="section"`, and as paragraph numbers
- **WHEN** the source is created
- **THEN** the REF fields SHALL carry `\w` or `\n` and the cached results "1", "Section 1.01", "1.01(a)", "Section 1.01(a)(i)", "(a)" and "1.01" as the source oracle expects
- **AND** a lowering whose numbering starts the sections at 2 SHALL fail the build, and a DOCX whose cached REF result is edited to a stale number SHALL fail the cross-reference check

#### Scenario: [SDX-MDOC-RUNIN-03] run-in sources that readers would number differently fail closed
- **GIVEN** a section before any article, a clause directly under an article, a subclause directly under a section, run-in paragraphs with `heading-numbers: legal`, a section without a heading, an unknown level, two paragraphs in one tag, and text and relative xrefs to a run-in paragraph
- **WHEN** each is created
- **THEN** each SHALL fail with `RUN_IN_SKIPS_LEVEL`, `RUN_IN_WITH_HEADING_NUMBERS`, `INVALID_RUN_IN_PARAGRAPH` or `XREF_RUN_IN_FORM_UNSUPPORTED` and a source line

### Requirement: Table of contents in created documents

The creation grammar SHALL admit one top-level `{% toc /%}` and an inline
`{% tc level=N %}…{% /tc %}` (N 1, 2 or 3) whose plain, bold, italic or
underlined content shows where it sits and is also a table-of-contents
entry. With a `{% toc /%}`, every `##` and `###` heading SHALL carry a TC
entry at level 1 or 2 whose text is its label and text with
`heading-numbers: legal` ("ARTICLE II Remedies") and its text otherwise, and
every run-in article and section a TC entry at level 1 or 2 whose text is its
number and heading ("2.01 Engagement"). `{% tc %}` entries SHALL be written
whether or not the document has a table of contents.

The `{% toc /%}` SHALL become a TOC field `TOC \f \l "1-3" \n` whose cached
result is written: one paragraph per TC entry in document order, in the
`toc 1` to `toc 3` style of its level, holding the entry's text, which is
what Word and LibreOffice list when they update the field. A table of
contents with no entry SHALL fail with `TOC_WITHOUT_ENTRIES`, a second one
with `DUPLICATE_TOC`, and an entry text holding a cross-reference, double
quote or backslash with `TOC_ENTRY_TEXT_UNSUPPORTED` or `INVALID_TOC_ENTRY`.

The read-back SHALL read the TOC field's cached result as its paragraphs'
text and a TC field as nothing. The source oracle SHALL derive the entries
from the source alone. A `tableOfContents` check SHALL hold the TOC
instruction and each cached paragraph's text and style to the document's TC
entries, with a negative control, so a stale cached result fails the build.

#### Scenario: [SDX-MDOC-TOC-01] a toc tag writes a table of contents with its entries before fields are updated
- **GIVEN** a source with a `{% toc /%}`, run-in articles and sections, and a `{% tc level=1 %}` entry in a body paragraph
- **WHEN** it is created
- **THEN** the TOC field SHALL span one paragraph per entry, "1. Services", "1.01 Engagement", …, each in its `toc n` style, and each heading paragraph SHALL carry its TC entry after its bookmark
- **AND** the `{% tc %}` content SHALL show in its paragraph and list in the table of contents
- **AND** the read-back, round trip, PDF and `tableOfContents` checks SHALL pass

#### Scenario: [SDX-MDOC-TOC-02] numbered and unnumbered headings list in the table of contents
- **GIVEN** a source with `heading-numbers: legal` headings and a `{% toc /%}`, and a source with unnumbered `##` and `###` headings and a `{% toc /%}`
- **WHEN** each is created
- **THEN** the first SHALL list "ARTICLE I …" and "Section 1.01 …" and the second the heading texts at levels 1 and 2
- **AND** a text cross-reference to a heading SHALL still show only the heading's text

#### Scenario: [SDX-MDOC-TOC-03] a stale or malformed table of contents fails closed
- **GIVEN** a created DOCX whose cached table-of-contents entry is edited, a toc without entries, two toc tags, a tc without a level, and a heading listed in a table of contents that holds a double quote
- **WHEN** each is checked or created
- **THEN** the edited DOCX SHALL fail the `tableOfContents` check naming the entry, and each source SHALL fail with its code and line

### Requirement: Roman page numbers and page-number restarts in created documents

`page-number-format` SHALL admit `lower-roman` and `upper-roman`, which show
the page number alone in that numeral, and `{% section %}` SHALL admit
`page-number-start`, a whole number from 1 to 9999. Each section SHALL carry
`w:pgNumType` with `w:fmt` `lowerRoman` or `upperRoman` when the footer it
shows (declared or inherited) is roman, and `w:start` when it declares a
start; a decimal section that numbers on SHALL carry none. A `pageNumbering`
check SHALL hold each section's `w:pgNumType` to the source, with a negative
control, and the PDF check SHALL expect each page's number in its section's
numerals.

#### Scenario: [SDX-MDOC-TOC-04] a roman front-matter section and a body restarting at 1
- **GIVEN** a source whose frontmatter footer is `page-number-format: lower-roman` and whose `{% section page-numbers=true page-number-start=1 /%}` starts the body
- **WHEN** it is created
- **THEN** the first section SHALL carry `w:pgNumType w:fmt="lowerRoman"` and the second `w:start="1"`, the footers SHALL read back as page fields, and the `pageNumbering` check SHALL pass with its negative control detected
- **AND** an invalid `page-number-start` SHALL fail with `INVALID_SECTION`
