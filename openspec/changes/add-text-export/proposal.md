# Change: Add DOCX → plain text export

## Why

safe-docx can read, edit, compare, save, and emit Markdown (`add-markdown-export`), but it
cannot emit a *plain text* rendering — "just give me the text" with no markup, for clipboard,
diffing, indexing, or feeding a model that wants no formatting. This adds the thinnest member
of the export family (epic #307), after Markdown.

The hard part — OOXML parsing — is already done. `DocxDocument.buildDocumentView({ showFormatting: true })`
yields a structured `DocumentViewNode[]` with headings, list metadata, grid-aware table
context, injected `[^n]` footnote markers, and an HTML-shaped inline-tag string. A plain-text
emitter is a **serializer over that existing model** — no new parsing. Where the Markdown
emitter *maps* inline tags to syntax, the plain-text emitter *strips* them and keeps only
block separators.

## What Changes

### docx-primitives (docx-core)
- NEW: `serialize_plaintext.ts` — `serializeToPlainText(nodes, footnotes)`: a block walk
  (headings/paragraphs → blank-line-separated text, lists → `- ` bullets preserving literal
  legal labels, tables → tab-separated rows) that strips every inline/semantic tag via the
  existing `stripAllInlineTags()` and appends `[^n]` footnote definitions.
- MODIFIED: `document.ts` — async `DocxDocument.toPlainText()` convenience wrapper (same
  `showFormatting: true` view as `toMarkdown`, so block structure and `[^n]` markers match).
- MODIFIED: `primitives/index.ts` — export the new serializer.

### safe-docx (MCP)
- MODIFIED: `tools/export.ts` — `format` gains `plaintext` (writes `.txt`); renders via
  `toPlainText()`. The rendered content now returns under a generic `content` field for all
  formats; the legacy `markdown` field is retained for the markdown format only, as a
  deprecated back-compat alias.
- MODIFIED: `tool_catalog.ts` — `format` enum gains `plaintext`; descriptions updated.

## Impact

- Affected specs: `mcp-server` (export tool gains a format + `content` field), `docx-primitives`
  (new serializer).
- New, additive capability. The only change to existing behavior is the response now also
  carries `content`; the `markdown` field is unchanged for markdown exports.
- Plain text is intentionally **lossy** (no round-trip): all formatting, links, merged/nested
  table cells, and layout are discarded.

## Out of scope

Round-trip fidelity, equations/text boxes/charts/layout, the HTML emitter (#304), and Google
Docs as a source.
