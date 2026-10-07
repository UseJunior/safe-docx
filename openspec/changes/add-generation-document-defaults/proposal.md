# Change: Add document defaults and the East Asian font slot to generation

## Why

`generateDocx` writes a fixed Calibri 11pt `w:docDefaults` and an empty
`w:pPrDefault`, and it refuses a `Normal` style declaration as a duplicate. A
document that needs a house style, such as Times New Roman 11pt with 8pt after
and 1.15 line spacing, therefore has to repeat those properties on a custom
style or on every paragraph. A from-scratch legal instrument also needs all four
`w:rFonts` slots pinned to one typeface. `RunProps.font` writes `ascii`,
`hAnsi` and `cs`, so East Asian characters fall back to a different face.

Matter work currently builds these documents with a per-matter python-docx
renderer because safe-docx could not declare the house style once (#1162).

## What Changes

- Add `DocumentSpec.defaults` with optional `run` (any `RunProps`, merged over
  the Calibri 11pt baseline) and `paragraph` (the style paragraph subset),
  emitted as `w:rPrDefault` and `w:pPrDefault` through the shared property
  builders.
- Make `RunProps.font` write all four `w:rFonts` channels (`ascii`, `hAnsi`,
  `eastAsia`, `cs`) wherever generation emits it: direct runs, styles,
  numbering levels and document defaults (the generation half of #786).
  Generation writes no theme-font attributes, so this fully pins the face.
- Reject empty typeface names.
- Add scenario `SDX-GEN-110`.

## Impact

- Affected specs: `docx-generation` (one ADDED requirement).
- Affected code: `packages/docx-core/src/generation/types.ts`,
  `emit/styles-part.ts`, `emit/properties.ts`, `validate-spec.ts`, the type
  re-exports, and `generation-document-defaults.test.ts`.
- Every generated package changes by one attribute: `w:eastAsia` now
  accompanies each explicit font, including the Calibri baseline. Nothing else
  in output without `defaults` changes.
