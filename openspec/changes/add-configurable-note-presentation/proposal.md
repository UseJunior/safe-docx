# Change: Add Configurable Note Presentation

## Why

Lawyers disagree about whether drafting communications belong in Word comment
bubbles or footnotes, and the choice may differ for internal and external
audiences. Authors should record what a note means once and select its DOCX
presentation when producing an artifact. Brownfield comments and footnotes must
also remain visible and editable in canonical Markdoc; otherwise the most
important negotiation context disappears during import.

## What Changes

- Add structured note-presentation options for comments, footnotes, and omission.
- Import Word comments and footnotes as first-class canonical Markdoc
  annotations with editable bodies, source metadata, source presentation, and
  explicit range-or-point anchor geometry.
- Preserve comment ranges exactly and preserve footnotes as point anchors; do
  not invent a selected range for a footnote.
- Distinguish drafting notes from substantive footnotes so audience profiles do
  not convert or omit substantive content without an explicit annotation choice.
- Configure external, internal, and unspecified note audiences independently in
  Markdoc, with per-annotation presentation overrides.
- Support independently styled footnote prefix, separator, and body runs.
- Add transactional selected comment-to-footnote conversion with deterministic
  range-end placement and machine-readable reporting.
- Preserve substantive footnotes and reject threaded comments unless explicit
  lossy flattening is enabled.
- Export canonical annotations as preserved source presentation, comments,
  styled footnotes, or omission without rewriting the canonical annotation.
- Default an imported footnote exported as a comment to a transparent point
  comment unless a range is later supplied explicitly.
- Keep direct primitive conversion as an interoperability path while making
  Markdoc the durable, editable intermediate representation.
- Track canonical paragraph coordinate indexing separately in issue #904.

## Impact

- Affected specs: `docx-primitives` and `docx-markdoc`.
- Archive ordering: `add-brownfield-markdoc-authoring` establishes the
  `docx-markdoc` capability and MUST archive before this delta.
- Related change: `add-footnote-support` covers general footnote CRUD and MCP
  tools; this change covers annotation import, provenance, and presentation
  projection and does not replace that work.
- Affected code: comment/footnote primitives, canonical Markdoc IR/import/compiler,
  `DocxDocument`, verification certificates, and the Markdoc CLI.
- Compatibility: additive; existing comment and footnote APIs remain valid.
- Conformance: comment ranges, footnote references/definitions, and run
  properties require ECMA-376 citations and structural tests.
- Privacy: conversion is local and this change commits no customer documents.
