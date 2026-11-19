## ADDED Requirements

### Requirement: Running headers, footer layout and first pages in created documents

`docx-markdoc create` SHALL admit running-text keys in the frontmatter (for
the first section) and as `{% section %}` attributes (for the next section):
`header`, `header-align`, `header-first`, `footer`, `footer-align`,
`footer-italic`, `footer-layout`, `footer-first`, `page-numbers`,
`page-number-align` and `page-number-format`. A section that declares no
header or footer SHALL inherit the previous one with its first-page variant.
A section whose header or footer has a first-page variant SHALL get
`w:titlePg` and both first-page slots: the variant, or a copy of the
section's own header or footer. The read-back, round-trip and PDF checks
SHALL hold headers, first-page slots and generated page words to the
source, each with negative controls. A source without the new keys SHALL
build the same DOCX and certificate as before.

#### Scenario: [SDX-MDOC-RUNHEAD-01] a running header is declared in the frontmatter or on a section and inherits like the footer
- **GIVEN** a frontmatter `header` with `header-align: right`, a section that declares nothing, a section with its own left-aligned header and a section with `header=false`
- **WHEN** the source is created
- **THEN** the declaring sections SHALL reference header parts holding one Header-style paragraph with that text and a direct `w:jc` (`center` by default), the empty header SHALL hold an empty paragraph, and the inheriting section SHALL reference no header
- **AND** the read-back, the certificate and the round trip SHALL record each section's header, the `deletedHeaderText` control SHALL be detected, and the header text SHALL be required PDF text

#### Scenario: [SDX-MDOC-RUNHEAD-02] footer text and page numbers take an alignment, a format, an upright choice and a one-line layout
- **GIVEN** footers with `footer-align`, `footer-italic: false`, `page-number-align`, `page-number-format` `dashed` and `page-of-total`, and `footer-layout: one-line`
- **WHEN** each is created
- **THEN** the paragraphs SHALL carry the declared `w:jc`, upright or italic text, `- PAGE -` or `Page PAGE of NUMPAGES` runs, and for one line a left-aligned paragraph with a right tab stop at the right margin, the text, a tab and the number
- **AND** the oracle SHALL match a field marker with any decimal number and nothing else

#### Scenario: [SDX-MDOC-RUNHEAD-03] first-page header and footer variants are independent and the other first-page slot copies its default
- **GIVEN** `header-first: none` alone, `footer-first` text alone, both variants, first-page header text alone, and sections inheriting and replacing variants
- **WHEN** each is created
- **THEN** each section with a variant in effect SHALL have `w:titlePg` and both first-page slots, the slot without a variant holding a copy of the section's header or footer, so a first page keeps its page number
- **AND** an inheriting section SHALL write its first-page slots itself, a section that declares a header without a variant SHALL drop `w:titlePg` unless its footer has one, and a source without variants SHALL have no `w:titlePg`
- **AND** a section with `w:titlePg` SHALL require only its first-page header and footer text, so a one-page section whose other header or footer never shows still builds with `--require-pdf`

#### Scenario: [SDX-MDOC-RUNHEAD-04] verification catches a lost header, a lost first-page slot and wrong generated page words
- **GIVEN** lowerings corrupted in the spec and projection alike (a shortened header, a first-page footer without its page number, the header shown on a first page that drops it) and PDF page texts with a missing, wrong or misplaced header or page word
- **WHEN** each is verified
- **THEN** the round trip SHALL fail on the header or the first-page slot, and the PDF word check SHALL fail on each wrong page text while passing the right ones

#### Scenario: [SDX-MDOC-RUNHEAD-05] malformed running-text keys fail closed
- **GIVEN** unknown values, a formatting key without the text it formats, `none` without a header or footer, one-line footers without both parts or with an alignment, and a boolean header in the frontmatter
- **WHEN** each is created
- **THEN** creation SHALL fail before writing output with `UNSUPPORTED_CREATION_FRONTMATTER`, or `INVALID_SECTION` with the tag's line

#### Scenario: [SDX-MDOC-RUNHEAD-06] a source without the new keys builds what it built before
- **GIVEN** a source with a footer and page numbers and no new key
- **WHEN** it is created
- **THEN** the DOCX SHALL have no header part, no `w:titlePg` and no Header style, the footer SHALL be the italic centred text and a bare `PAGE` field, and the certificate SHALL carry no header check, control or projection

#### Scenario: [SDX-MDOC-RUNHEAD-07] the synthetic letters build with create --require-pdf and every check passes
- **GIVEN** a one-page letter with a right-aligned header, a centred `Page 1 of 1` and a bold Re: line, and a two-page letter with `header-first: none`
- **WHEN** each is built with `create --require-pdf`, with no post-processing
- **THEN** every check SHALL pass, the first PDF SHALL show the header and `Page 1 of 1`, and the second SHALL show no header and the number 1 on page 1 and the header and the number 2 on page 2
