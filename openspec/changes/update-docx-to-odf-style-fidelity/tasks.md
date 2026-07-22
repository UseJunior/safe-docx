## 1. docx-core enrichments

- [x] 1.1 `formatting_tags.ts`: carry `highlightVal` in active tag state; emit `<highlight color="…">` in full mode only; keep compact-mode merge behavior
- [x] 1.2 `document_view-comments.ts`: extend `TOON_INLINE_TAG_RE` to accept attributed highlight opens
- [x] 1.3 `semantic_tags.ts`: `hasHighlightTags`/`stripHighlightTags` accept the attributed form; `serialize_html.ts` tolerates it
- [x] 1.4 `styles.ts`: export `extractStyleRunFormatting` (tri-state chain resolution); `document.ts`: add `DocxDocument.getStylesModel()`
- [x] 1.5 docx-core tests for 1.1–1.4

## 2. odf-core converter

- [x] 2.1 `inline.ts`: font color/size/face + highlight color state from TOON tags; extended `TextStyleRegistry`; ECMA-376 highlight palette map
- [x] 2.2 `package.ts`: `office:font-face-decls` in content skeleton; `FontFaceRegistry`; `svg` namespace
- [x] 2.3 New `paragraph_styles.ts`: `ParagraphStyleRegistry`; wire into `docx_to_odt.ts` for body/heading/cell/manual-label paragraphs (alignment-only for list items)
- [x] 2.4 `package.ts`: `buildStylesXml` seeded from source `Heading1..6`/`Normal` via `extractStyleRunFormatting`; styles.xml font-face decls
- [x] 2.5 `tables.ts`: per-table cell border style from `w:tblBorders`; column-width styles from `w:tblGrid`
- [x] 2.6 `docx_to_odt.ts`: preserve text-empty body-level paragraphs via bookmark correlation; keep in-table drops reported

## 3. Tests and acceptance

- [x] 3.1 `convert_style_fidelity.test.ts` covering CONV-14..CONV-19
- [x] 3.2 Update CONV-02/CONV-04/CONV-10 expectations for preserved empty paragraphs and removed font lossiness
- [x] 3.3 `convert_real_documents.test.ts`: assert in-scope lossiness classes are absent on the bundled real fixtures
- [x] 3.4 Full local gate: build, lint, tests, spec-coverage, conformance checks
