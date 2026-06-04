# Tasks: Add DOCX → HTML export

## 1. docx-core serializer primitive
- [x] 1.1 Export `escapeHtmlAttribute` from `formatting_tags.ts`.
- [x] 1.2 Add `serialize_html.ts`: `inlineTagsToHtml()` (`<b>/<i>/<u>/<a>` passthrough,
      `<highlight>`→`<mark>`, `<font>`→sanitized `<span style>`, `[^n]`→`<sup>` anchor).
- [x] 1.3 Add `serializeToHtml()`: headings → `<hN>`; robust nested `<ul>/<ol>` stack
      (`<ol>` from `is_auto_numbered`); tables → `<table><thead><tbody>` (gap-filled grid);
      footnotes → `<section>` definitions; full-document wrap with `fragment` opt.
- [x] 1.4 Add async `DocxDocument.toHtml()`; add explicit `serialize_html.js` barrel export.

## 2. docx-mcp export tool
- [x] 2.1 `export.ts`: add `html` format, `.html` extension, branch to `toHtml()`, add `content` key.
- [x] 2.2 Update `tool_catalog.ts` `format` enum + descriptions.

## 3. Tests (mapped to spec scenarios)
- [x] 3.1 `serialize_html.test.ts` in docx-core (docx-primitives scenarios + list edge cases + CSS sanitization).
- [x] 3.2 `export_html.test.ts` in docx-mcp (mcp-server scenarios).

## 4. Validation
- [x] 4.1 `openspec validate add-html-export --strict`.
- [x] 4.2 Build, lint, and run both packages' tests (incl. spec-coverage).
- [x] 4.3 Real-document smoke: export NVCA COI / ILPA LPA / Bonterms NDA to HTML; output is valid
      XHTML5 (0 XML errors), footnote anchors resolve, tables/lists/links/highlight render.
