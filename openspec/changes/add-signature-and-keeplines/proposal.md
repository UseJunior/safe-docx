# Change: Add paragraph keep-lines

> Note: this change originally also added a two-column `signatureBlock` layout
> (`SDX-GEN-109`). That signature recipe was removed in
> `remove-agreement-domain-recipes` — agreement-specific signature assembly now
> lives in the downstream consumer, not in this general library — so only the
> general keep-lines capability remains here.

## Why

`ParagraphSpec` exposes `keepNext` but not `keepLines`, so consumers chain
`keepNext` across paragraphs as a keep-together workaround. A first-class
`keepLines` keeps a multi-line block from splitting across a page.

## What Changes

- Add a first-class `keepLines?: boolean` to `ParagraphSpec`, emitted as
  `w:keepLines` in `w:pPr` (it sits after `keepNext` in `PPR_ORDER`).
  Because the paragraph-property builder is shared, `keepLines` is also honored
  on `StyleSpec.paragraph`.
- Add scenario `SDX-GEN-108` (keep-lines) covering emitted XML and default
  compatibility.

## Impact

- Affected specs: `docx-generation` (one ADDED requirement).
- Affected code: `.../generation/types.ts`, `.../primitives/namespaces.ts`,
  `.../generation/emit/properties.ts`, `.../generation/emit/paragraph.ts`, and
  `generation-keep-lines.test.ts`.
