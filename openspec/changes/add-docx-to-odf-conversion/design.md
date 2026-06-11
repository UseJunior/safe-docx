# Design: Native DOCX → ODT conversion

## Context
Issue #331. Two viable approaches were weighed: (1) native model-to-model mapping, (2) shelling out
to LibreOffice headless. (2) is rejected for the shipped path — it violates the Node/TS-only
runtime convention and is not viable for the local-first MCP distribution — but is retained as a
**test oracle**: the differential test converts the same `.docx` via both paths and diffs visible
text + structure (never bytes).

## Goals / Non-Goals
- Goals: valid `.odt` output (opens cleanly in LibreOffice, passes `validateOdfArchiveSafety`);
  visible text + paragraph/heading/list/table structure preserved; bold/italic/underline and
  hyperlinks preserved; explicit lossiness reporting; no new runtime dependency.
- Non-Goals: pixel/byte fidelity; tracked changes; comments; headers/footers/footnotes; richer
  style mapping (fonts, colors, spacing); `.ods`/`.odp`.

## Decisions
- **Traverse `DocumentViewNode[]`, not raw OOXML DOM.** The view model already computes headings,
  list metadata, grid-aware table context, and an inline-tag string (`tagged_text`); the markdown,
  plaintext, and HTML serializers all traverse it. Re-deriving from `w:p`/`w:r` would duplicate
  heading/list/table/hyperlink logic. Tokenize `tagged_text` with the shared `tokenizeToonInline`
  so the converter never re-derives the tag grammar.
- **`formattingMode: 'full'`.** The default `'compact'` mode suppresses modal (document-dominant)
  formatting, which would silently drop bold/italic/underline on documents whose body is mostly
  bold. The `<font …>` tags full mode additionally emits are recognized-and-dropped with lossiness
  entries (b/i/u-only is the confirmed scope).
- **Manual/legal list labels become plain `text:p` with the literal label.** Deliberate divergence
  from the HTML serializer (which wraps them in `<ul><li>` with the label prepended): an ODF
  renderer applies list numbering itself, so wrapping a "Section 2.1(a)" paragraph in `text:list`
  would render a second, conflicting number next to the legal label.
- **Tables: fill grid gaps, don't claim merge detection.** `table_context` exposes no
  `gridSpan`/`vMerge`, so merged cells are indistinguishable from empty grid positions; the
  lossiness entry says "table grid gaps filled with empty cells". One shared bordered cell style is
  applied (the view model carries no border info; most Word tables are bordered).
- **Fresh package assembly via `OdfArchive.create()`** reusing `save()`'s proven mimetype-first +
  STORED rebuild; roots carry `office:version="1.3"` (strict validators reject packages without
  it). `create()` output must round-trip `OdfArchive.load()`.
- **Numbering access**: `DocxDocument` gains a public `getNumberingModel()` (wrapping
  `parseNumberingXml`) because `DocumentViewNode.numbering` only carries `num_id`/`ilvl` and the
  converter needs `numFmt`/`lvlText`/`start` to synthesize `text:list-style`s.
- **MCP tool is `file_path`-first only** (no `session_id`): `resolveSessionForTool` is
  file-path-keyed; declaring an unresolved `session_id` param (as `export.ts` does) would be a
  contract lie.
- **Hyperlink hrefs are XML-unescaped before `setAttributeNS`** (the TOON attribute value is
  escaped by `emitFormattingTags`; assigning it raw would double-escape `&amp;`), and unsafe
  schemes degrade to plain text via the shared `isSafeHref`.

## Risks / Trade-offs
- LibreOffice rejects the package (mimetype order, manifest media-types) → `create()` reuses the
  proven rebuild discipline; the differential oracle test catches regressions.
- soffice installed but unusable (observed: `Abort trap: 6` on the dev machine) → oracle tests gate
  on a trivial preflight probe and skip with a logged warning, not just `resolveSoffice()`.
- `tagged_text` grammar drift → tokenizer is shared with the docx-core emitters; unknown tags
  degrade to text + lossiness entry, never throw.
- ODF whitespace collapsing → dedicated `text:s`/`text:tab` writer; equivalence tests compare
  through `OdfDocument`'s segment expansion which already decodes these.
- Numbering continuation across interleaved content is not preserved (each contiguous list run
  restarts) → accepted lossy, recorded in the report.

## Migration Plan
Purely additive — no existing API or tool changes shape. Rollback is deleting the new module/tool.

## Open Questions
- None blocking. Richer style mapping (phase 3 of #331) will follow as its own change.
