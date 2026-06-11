# Change: Native DOCX → ODT conversion (`convertDocxToOdt` + `convert_to_odt`)

## Why
Germany's IT-Planungsrat ODF mandate creates demand for converting existing `.docx` corpora to
`.odt`, and the repo already owns both halves of the problem: `@usejunior/docx-core` parses `.docx`
into a rich semantic model and `@usejunior/odf-core` (#328) packages and edits valid `.odt` files.
Nothing connects them today — converting requires LibreOffice, which violates the repo's
Node/TypeScript-only runtime convention. A native model-to-model converter closes the loop
(issue #331) and gives agents a `convert_to_odt` MCP tool.

## What Changes
- `@usejunior/odf-core`: new `src/convert/` module exporting
  `convertDocxToOdt(docx: Buffer, options?) → Promise<{ odt: Buffer; lossiness: LossinessEntry[] }>`.
  The converter traverses `DocxDocument.buildDocumentView({ showFormatting: true, formattingMode: 'full' })`
  — the same intentionally-lossy semantic path as the markdown/html serializers — and emits:
  - body paragraphs (`text:p`) and Word-style headings (`text:h` with `text:outline-level`, clamped 1–6);
  - bold/italic/underline runs as `text:span` referencing deduped automatic text styles;
  - hyperlinks as `text:a` (href-safety stance shared with the HTML serializer);
  - auto-numbered/bullet lists as nested `text:list` with synthesized `text:list-style`s
    (manual/legal labels stay literal paragraph text — a deliberate divergence from the HTML
    serializer so ODF renderers never double-number legal labels);
  - tables as `table:table` with a complete rectangular grid.
  Every dropped construct is recorded in a lossiness report, never silently.
- `@usejunior/odf-core`: `OdfArchive.create(parts)` static factory for fresh packages
  (mimetype-first + STORED, generated `META-INF/manifest.xml`, `office:version="1.3"` roots);
  `ODF_NS` gains `FO` and `XLINK`.
- `@usejunior/docx-core` (enablers): public `getNumberingModel()` accessor on `DocxDocument`;
  root re-exports for `isSafeHref`, `buildSyntheticDocx`, `buildDocxFromBodyXml`; a
  DOCX-in→ODT-out conversion job shape for the LibreOffice oracle (test-only).
- `@usejunior/docx-mcp`: new `convert_to_odt` tool (`file_path`, optional `output_path`,
  `allow_overwrite`) that converts the resolved DOCX session, validates the output with
  `validateOdfArchiveSafety`, and reports the lossiness summary. odf-core is reached only through
  `loadOdfCore()` (`ODF_UNAVAILABLE` when absent).
- LibreOffice remains test-only: a differential oracle test converts the same `.docx` both ways and
  diffs visible text + structure, gated by a preflight probe (skips when soffice is absent or
  present-but-unusable).

## Impact
- Affected specs: `odf-core` (ADDED: DOCX to ODT conversion, CONV-01..13); `mcp-server`
  (ADDED: `convert_to_odt` tool, OCNV-01..05).
- Affected code: `packages/odf-core/src/convert/*` (new), `packages/odf-core/src/shared/odf/{OdfArchive,namespaces}.ts`,
  `packages/odf-core/src/index.ts`, `packages/docx-core/src/primitives/{document,serialize_html}.ts`,
  `packages/docx-core/src/integration/libreoffice-oracle.ts`, `packages/docx-core/src/index.ts`,
  `packages/docx-mcp/src/tools/convert_to_odt.ts` (new), `packages/docx-mcp/src/{tool_catalog,server}.ts`.
- Out of scope (deferred, per issue #331 phasing): richer style fidelity, tracked changes,
  comments, headers/footers/footnotes, `.ods`/`.odp`. Conversion is semantic, not byte- or
  layout-perfect.
