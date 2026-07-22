# Change: Single-call body + footnotes retrieval via structured `read_file` footnotes

## Why

`read_file` returns body paragraphs with inline `[^N]` footnote markers, but the
footnote BODIES live in `word/footnotes.xml` and require a separate
`get_footnotes` call plus manual stitching. The existing inline
`include_footnotes` (#158) attaches only a flattened `{id, display_number, text}`
per node — it loses multi-paragraph structure and run-level formatting, and its
per-node placement can't be the authoritative full enumeration. A full-fidelity
ingest should be one call.

## What Changes

- Upgrade the core `Footnote` model (docx-primitives) to RETAIN paragraph-node
  structure and run-level formatting, ADDITIVELY: keep `text`/`displayNumber`/
  `anchoredParagraphId`, ADD `paragraphs: FootnoteParagraph[]` (each with `text`,
  run-formatting-preserving `tagged_text`, and `style`) and `refParagraphIds:
  string[]` (every referencing paragraph, not just the first — a malformed DOCX
  can reuse one footnote id from multiple paragraphs).
- Extend `read_file`'s `include_footnotes` so that when true and `format="json"`
  the response gains a document-wide TOP-LEVEL `footnotes` array in the richer
  shape, kept OUT of `content[]` to preserve the 1:1 content[] index invariant.
  The existing per-node inline attachment (#158) is retained for backward
  compatibility.
- Add a trailing `#FOOTNOTES` toon sidecar block when `include_footnotes=true`
  and `format="toon"`, symmetric with the existing `#COMMENTS` block.
- Default / `include_footnotes=false` output remains BYTE-IDENTICAL to today.

## Impact

- Affected specs: `mcp-server` (read_file footnote output), `docx-primitives`
  (Footnote model).
- Affected code: `packages/docx-core/src/primitives/footnotes.ts`,
  `document.ts`, `document_view-toon.ts`, `document_view.ts`;
  `packages/docx-mcp/src/tools/read_file.ts`, `tool_catalog.ts`.
- Out of scope: endnotes, comments, modifying footnotes via read_file, grep
  inside footnote bodies.
