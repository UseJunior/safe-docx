## 1. Spec

- [x] 1.1 Add the `Numbered headings in created documents` requirement
      with scenarios `SDX-MDOC-HEADNUM-01`–`SDX-MDOC-HEADNUM-04` to the
      `docx-markdoc` delta, and record the design choice in `design.md`.

## 2. Implementation

- [x] 2.1 Parse frontmatter `heading-numbers: legal` and validate numbered
      headings, the clause lists under them and xrefs to them.
- [x] 2.2 Declare the style-linked heading definition at the first numbered
      heading and place lists under a numbered heading on its clause levels
      (`heading-level` decision in `create/list-numbering.ts`).
- [x] 2.3 Count style-linked headings in the lowering's REF projection.
- [x] 2.4 Number headings and their clauses in the source oracle: markers,
      xref texts and bookmark targets, with heading labels as two PDF words.
- [x] 2.5 Document the key, the labels and the refusals in the README.

## 3. Verification

- [x] 3.1 Tests: the definition and style links, read-side labels, REF
      results, oracle projections, negative controls, the refusals, and a
      real LibreOffice PDF.
- [x] 3.2 Word oracle: update fields on a generated agreement, then insert a
      Section in Article II, a Section in Article I and an Article, and
      record the labels and REF results, with the two controls behind the
      refusals (`scripts/oracle/word/evidence/issue-1250-word-16.114.json`).
