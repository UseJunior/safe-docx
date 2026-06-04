# Change: Add DOCX → HTML export

## Why

safe-docx can read, edit, compare, save, and (since #310) export `.docx` to **Markdown** — but
not to HTML. HTML is the most useful *structural* target for previews, web rendering, and
content extraction; it completes the read → edit → compare → **export** loop (epic #307)
alongside Markdown.

The hard part — OOXML parsing — is already done. `DocxDocument.buildDocumentView({ showFormatting: true })`
yields a structured `DocumentViewNode[]` with headings (level + source), list metadata,
grid-aware table context, injected `[^n]` footnote markers, and an HTML-shaped inline-tag
string (`tagged_text`). An HTML emitter is a **serializer over that existing model** — a sibling
of `serialize_markdown.ts` that renders the *same* inline tokens via the shared
`tokenizeToonInline()` core, so the two serializers never re-derive the tag grammar and drift
from the emitter in `formatting_tags.ts`.

Where Markdown is lossy, HTML is richer: it carries `<mark>` for highlighting and
`<span style>` for font color/size/face that Markdown drops, and it renders genuine nested
`<ul>/<ol>` rather than indented text. This is the **semantic** tier (mammoth.js-style), not
pixel-faithful HTML+CSS (docx-preview-style), which stays out of scope.

## What Changes

### docx-primitives (docx-core)
- NEW: `serialize_html.ts` — `inlineTagsToHtml()` (the shared inline tokenizer → HTML mapping)
  and `serializeToHtml(nodes, footnotes, opts)` (block walk: headings, nested lists, tables,
  footnote anchors + definitions; full `<!DOCTYPE html>` document by default, `fragment` opt
  for body-only).
- MODIFIED: `formatting_tags.ts` — export the existing `escapeHtmlAttribute` helper so the
  serializer reuses one attribute-escaper instead of duplicating it.
- MODIFIED: `document.ts` — async `DocxDocument.toHtml()` convenience wrapper, mirroring
  `toMarkdown()`.
- MODIFIED: `primitives/index.ts` — explicit barrel export for `serialize_html.js`.

### safe-docx (MCP)
- MODIFIED: `export` tool (`tools/export.ts`) — `format` enum gains `html`; `.html` default
  extension; branches to `toHtml()`; returns the rendering under a new format-agnostic
  `content` key (keeping the legacy `markdown` key for the Markdown format). DOCX only.
- MODIFIED: `tool_catalog.ts` — `format` enum adds `html`; descriptions updated.

## Impact

- Affected specs: `docx-primitives` (new serializer), `mcp-server` (export tool gains HTML).
- New, additive capability. No behavior change to existing tools; the Markdown path is unchanged
  and still returns `markdown`.
- HTML is the **semantic** tier and intentionally lossy on exact look: it does not reproduce
  pixel layout. Constructs without a clean semantic mapping are downgraded as documented.

## Out of scope

- Images / embedded media (`<img>`) — no media-extraction infrastructure exists yet; a focused
  follow-up.
- True `colspan`/`rowspan` — the view model discards `gridSpan`/`vMerge` span width, so tables
  use a gap-filled grid (as Markdown does); real spans need a view-model extension.
- Nesting of *manually*-labelled lists — manual labels are pinned to list level 0 upstream, so
  only auto-numbered lists nest (same as Markdown).
- Equations, text boxes, charts, fields, comments-as-`<aside>`, high-fidelity HTML+CSS,
  round-trip fidelity, and Google Docs as a source.
