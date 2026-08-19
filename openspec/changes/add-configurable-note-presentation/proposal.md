# Change: Add Configurable Note Presentation

## Why

Lawyers disagree about whether drafting communications belong in Word comment
bubbles or footnotes, and the choice may differ for internal and external
audiences. Authors should record what a note means once and select its DOCX
presentation when producing an artifact. Existing comments also need a safe
bulk-conversion path that does not conflate drafting notes with substantive
footnotes.

## What Changes

- Add structured note-presentation options for comments, footnotes, and omission.
- Configure external and internal note audiences independently in Markdoc.
- Support independently styled footnote prefix, separator, and body runs.
- Add transactional selected comment-to-footnote conversion with deterministic
  range-end placement and machine-readable reporting.
- Preserve substantive footnotes and reject threaded comments unless explicit
  lossy flattening is enabled.
- Keep reverse generated-footnote-to-comment conversion and complete Markdoc
  audience projection as later tasks within this approved change.
- Track canonical paragraph coordinate indexing separately in issue #904.

## Impact

- Affected specs: `docx-primitives` in this implementation slice;
  `docx-markdoc` remains planned work.
- Affected code: comment/footnote primitives, `DocxDocument`, and the Markdoc CLI.
- Compatibility: additive; existing comment and footnote APIs remain valid.
- Conformance: comment ranges, footnote references/definitions, and run
  properties require ECMA-376 citations and structural tests.
- Privacy: conversion is local and this change commits no customer documents.
