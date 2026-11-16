## 1. Generation

- [x] 1.1 Add the `tableOfContentsEntry` inline (TC field, trailing its paragraph, after its bookmark) and `ParagraphSpec.tableOfContents` (TOC field over consecutive paragraphs), with validation (`SDX-GEN-137`).

## 2. Run-in numbering

- [x] 2.1 Admit `{% run-in-paragraph %}` with `level`, `heading` and `#id`; refuse skipped levels and mixing with `heading-numbers` (`SDX-MDOC-RUNIN-01`, `-03`).
- [x] 2.2 Number run-in paragraphs with the run-in definition and render the heading inline (`SDX-MDOC-RUNIN-01`).
- [x] 2.3 Resolve `{% xref %}` to run-in paragraphs in the lowering and the source oracle; refuse text and relative forms (`SDX-MDOC-RUNIN-02`, `-03`).

## 3. Table of contents and page numbering

- [x] 3.1 Admit `{% toc /%}` and `{% tc %}`; emit TC entries for headings, run-in articles and sections, and tc tags; write the cached result (`SDX-MDOC-TOC-01`, `-02`).
- [x] 3.2 Read a TOC as its cached paragraphs and TC fields as nothing; check the cached result against the TC entries with a negative control (`SDX-MDOC-TOC-03`).
- [x] 3.3 Admit `lower-roman`, `upper-roman` and `page-number-start`; write `w:pgNumType`; check it against the source; accept section numerals in the PDF (`SDX-MDOC-TOC-04`).

## 4. Documentation and validation

- [x] 4.1 Document the tags in the docx-markdoc README, CLI help and changelog; add ECMA-376 registry entries for §17.16.5.63 and §17.16.5.68.
- [x] 4.2 Build realistic agreements through `create --require-pdf`, run the emitted-schema gate, and update fields in LibreOffice headless to compare the cached TOC and REF results with the updated ones.
- [x] 4.3 Run focused package tests, `openspec validate --strict` and the repository pre-submit chain.
