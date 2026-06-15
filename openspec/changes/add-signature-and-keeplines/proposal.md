# Change: Add two-column signature block and paragraph keep-lines

## Why

OpenAgreements execution pages need a two-column signing grid (two signers per
row, each a centered uppercase muted party header over ruled Signature / Print
Name / Title / Date lines) and a way to keep a multi-line signer block from
splitting across a page. Today `signatureBlock` is single-column, so the
OpenAgreements DOCX adapter hand-rolls the grid from raw `TableSpec`s, and
`ParagraphSpec` exposes `keepNext` but not `keepLines`, so consumers chain
`keepNext` across paragraphs as a keep-together workaround. These are the two
remaining items of #488 (items 1 and 4 landed in #497).

## What Changes

- Add an optional `layout: 'two-column'` mode to `signatureBlock` that renders
  the parties as a paired signing grid — two signers per row with a center
  gutter column, each signer cell a centered uppercase muted header over four
  ruled fields with Print Name and Title pre-filled from the party data and
  Signature/Date left blank, plus an empty padding cell when the signer count is
  odd. Omitting `layout` preserves the existing single-column block.
- Add a first-class `keepLines?: boolean` to `ParagraphSpec`, emitted as
  `w:keepLines` in `w:pPr` (it already sits after `keepNext` in `PPR_ORDER`).
  Because the paragraph-property builder is shared, `keepLines` is also honored
  on `StyleSpec.paragraph`.
- Add scenarios `SDX-GEN-108` (keep-lines) and `SDX-GEN-109` (two-column
  signature) covering recipe output, emitted XML, and default compatibility.

## Impact

- Affected specs: `docx-generation` (two ADDED requirements).
- Affected code: `packages/docx-core/src/generation/recipes.ts`,
  `.../generation/types.ts`, `.../primitives/namespaces.ts`,
  `.../generation/emit/properties.ts`, `.../generation/emit/paragraph.ts`, and
  two focused generation tests.
- Out of scope: paragraph-level borders (ruled lines reuse the existing
  bottom-bordered-cell grammar via nested tables) and any change to the
  single-column signature output.
