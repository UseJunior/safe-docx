# Change: Add DOCX → Markdown export

## Why

The safe-docx suite can read, grep, edit, compare, and save `.docx`, but it cannot emit a
portable text rendering. Agents and downstream tooling routinely need a document's content
as Markdown — to summarize, diff, feed another model, or hand to a human. This adds the
**export** leg of the read → edit → compare → export loop (epic #307).

The hard part — OOXML parsing — is already done. `DocxDocument.buildDocumentView({ showFormatting: true })`
yields a structured `DocumentViewNode[]` with headings (level + source), list metadata,
grid-aware table context, injected `[^n]` footnote markers, and an HTML-shaped inline-tag
string. A Markdown emitter is a **serializer over that existing model** — no new parsing.

Per the epic, Markdown/HTML/text are "thin emitters over a shared structured-export core."
This change builds the Markdown emitter and factors the **inline-tag tokenizer** as the
reusable core piece (HTML #304 will render the same tokens).

## What Changes

### docx-primitives (docx-core)
- NEW: `serialize_markdown.ts` — `inlineTagsToMarkdown()` (the reusable inline tokenizer →
  Markdown mapping) and `serializeToMarkdown(nodes, footnotes)` (block walk: headings, lists,
  GFM tables, footnote definitions).
- NEW: `tokenizeToonInline()` + exported `TOON_INLINE_TAG_RE` in `document_view.ts` — the
  shared inline-tag tokenizer, so serializers never re-derive the tag grammar.
- MODIFIED: `document.ts` — async `DocxDocument.toMarkdown()` convenience wrapper.
- FIXED: `injectFootnoteMarkers` in `document_view.ts` is now tag-aware (uses
  `findTaggedTextInsertionIndex`, like the comment-marker path). Previously a visible-offset
  marker was spliced into the *tagged* string by raw index, so `[^n]` could land inside a
  formatting tag once `show_formatting` was on. This corrects `read_file` output too.

### safe-docx (MCP)
- NEW: `export` tool (`tools/export.ts`) — `format` enum (`markdown` now), writes an output
  file (default: source path with `.md`), guards overwrite, returns path + byte count +
  rendered Markdown (suppressible via `include_markdown: false`). DOCX only.
- MODIFIED: `tool_catalog.ts` — add `export` catalog entry.
- MODIFIED: `server.ts` — add import + dispatch case.

## Impact

- Affected specs: `mcp-server` (new export tool), `docx-primitives` (new serializer).
- New, additive capability. No behavior change to existing tools except the footnote-marker
  placement fix, which makes `read_file` output more correct for formatted footnoted text.
- Markdown is intentionally **lossy** (no round-trip): highlighting, font runs, merged/nested
  table cells, and pixel layout are downgraded as documented.

## Out of scope

Round-trip fidelity, equations/text boxes/charts/layout, HTML/text/PDF emitters
(#304/#305/#306), and Google Docs as a source.
