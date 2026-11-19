## 1. Spec

- [x] 1.1 Add the `Running headers, footer layout and first pages in created
      documents` requirement with scenarios `SDX-MDOC-RUNHEAD-01`–`-07`.

## 2. Implementation

- [x] 2.1 Admit and validate the running-text keys in the frontmatter and on
      `{% section %}` (`create/validate.ts`).
- [x] 2.2 Lower headers, footer alignment, formats, the one-line layout and
      first-page variants to `SectionSpec.headers`/`footers`/`titlePg`, with a
      Header style only when a header exists (`create/lower.ts`,
      `create/profile.ts`).
- [x] 2.3 Read back headers and first-page slots and check them against the
      projection with negative controls (`create/readback.ts`, `create/create.ts`).
- [x] 2.4 Project headers, formats and first pages in the source oracle and
      the round trip; model header and first-page regions and the generated
      page words in the PDF word check; require header text in the PDF
      (`create/oracle.ts`, `create/cli-create.ts`).
- [x] 2.5 Document the keys in the README.

## 3. Verification

- [x] 3.1 Tests: package shape, inheritance, formats, first-page variants,
      negative controls, refusals, unchanged output without the keys, and
      real LibreOffice PDFs of a one-page and a two-page letter.
- [x] 3.2 Compare DOCX bytes and certificates with main for every creation
      source the test suite builds.
