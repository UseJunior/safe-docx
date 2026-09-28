# Change: Make Markdoc import output depend only on the input bytes

## Why

`importDocxToMarkdoc` hashes the anchored package it serializes itself, and
`DocxZip.toBuffer()` let JSZip stamp every rewritten part with the current
time. ZIP timestamps have 2-second resolution, so importing the same `.docx`
twice produced a different `{% source sha256 %}` whenever the two imports fell
on either side of a tick. An agent that imports a document, keeps the Markdoc,
and imports again later got a different hash for the same file, and
`[SDX-MDOC-150]` failed the v0.21.0 release preflight on exactly that tick.

## What Changes

- `DocxZip.toBuffer()` and `DocxDocument.toBuffer()` accept a `fileDate`; when
  set, every entry is written with that date instead of the wall clock, and the
  in-memory dates are restored afterwards. Saves that do not pass it are
  unchanged.
- `ZIP_EPOCH` (2006-01-01T00:00:00Z, already used by document generation) is
  exported from `@usejunior/docx-core` and shared by generation and import.
- Import serializes both the body-anchored package and the story-anchored copy
  with `fileDate: ZIP_EPOCH`, so the anchored source, its `source sha256` and
  the emitted Markdoc are byte-identical across runs.
- The hash still names the anchored bytes that `compileMarkdoc` receives, so
  compile is untouched and Markdoc/anchored pairs produced by earlier versions
  keep compiling.

## Impact

- Affected specs: docx-markdoc
- Affected code: `packages/docx-core/src/primitives/zip.ts`,
  `packages/docx-core/src/primitives/document.ts`,
  `packages/docx-core/src/generation/compile.ts`,
  `packages/docx-markdoc/src/import.ts`,
  `packages/docx-markdoc/src/story-inventory.ts`, tests
- Related issue: #1110
