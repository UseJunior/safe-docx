# Tasks

## Foundations (odf-core)
- [x] Add `FO` and `XLINK` to `ODF_NS` in `shared/odf/namespaces.ts`
- [x] `OdfArchive.create(parts)` static factory: mimetype-first + STORED, generated `META-INF/manifest.xml`, output round-trips `OdfArchive.load()`
- [x] `convert/package.ts`: content.xml / styles.xml / meta.xml templates with `office:version="1.3"`; named styles `Standard`, `Heading`, `Heading_20_1..6`, `Text_20_body`; `text:s`/`text:tab` whitespace writer

## Converter (odf-core)
- [x] `convert/inline.ts`: `tokenizeToonInline` format-stack → deduped automatic `T*` styles; `text:a` with `isSafeHref` + href unescape; `<font>` tags dropped with lossiness
- [x] `convert/docx_to_odt.ts` + `convert/types.ts`: orchestrator over `buildDocumentView({ showFormatting: true, formattingMode: 'full' })`; paragraphs, `word_style` headings (clamped 1–6), lossiness plumbing; export `convertDocxToOdt` from `src/index.ts`
- [x] `convert/lists.ts`: ListBuilder-style level stack → nested `text:list`; per-`num_id` `text:list-style` synthesis from the numbering model; manual/legal labels as literal `text:p`
- [x] `convert/tables.ts`: `(row,col)` bucketing, grid-gap filling, multi-paragraph cells, `table:table-header-rows`, shared bordered cell style

## Enablers (docx-core)
- [x] Public `DocxDocument.getNumberingModel(): NumberingModel | null`
- [x] Export `isSafeHref` from `serialize_html.ts`; re-export `buildSyntheticDocx` and the new parts-based `buildDocxFromParts` from the package root (`src/testing/**` is build-excluded, so `buildDocxFromBodyXml` itself cannot be re-exported)
- [x] LibreOffice oracle: DOCX-in→ODT-out conversion job (`writer8` filter) in `libreoffice-oracle.ts`

## MCP tool (docx-mcp)
- [x] `tools/convert_to_odt.ts`: `file_path`-first resolution, default output = source with `.odt`, source-clobber + overwrite guards, `loadOdfCore()` / `ODF_UNAVAILABLE`, `validateOdfArchiveSafety` before write
- [x] Register in `tool_catalog.ts` ("semantic, intentionally lossy") + `server.ts` dispatch; regenerate tool docs
- [x] Fix stale "private/unpublished" comment in `odf_loader.ts`

## Tests & verification
- [x] `convert_basics.test.ts` (CONV-01..05, 10, 11), `convert_lists.test.ts` (CONV-06..08), `convert_tables.test.ts` (CONV-09)
- [x] `convert_real_documents.test.ts` (CONV-12): NVCA + open-agreements fixtures → safety → reopen → visible-text equivalence
- [x] `lo_convert_differential.test.ts` (CONV-13): preflight-probe gate (skip when soffice absent or unusable), text + structure diff vs LibreOffice reference
- [x] `add_docx_to_odf_conversion.test.ts` (docx-mcp): `TEST_FEATURE = 'add-docx-to-odf-conversion'`, single-line `.openspec()` tags for OCNV-01..05
- [x] Full local gates: `npm run build && npm run test:run && npm run preflight:ci`; document-shaped smoke (convert real NVCA `.docx`, open `.odt` in LibreOffice)
