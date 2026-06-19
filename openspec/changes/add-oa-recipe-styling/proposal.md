# Change: OA recipe styling hooks (cover-terms run styling + signature OA ruled layout)

## Why

The OpenAgreements legal-explainer DOCX renderer (`lib/agreement-docx.ts`) rebuilt
itself onto docx-core generation, but two of its house-style surfaces still build
raw `TableSpec`s by hand because the recipes cannot express the OA look:

- **Cover terms.** `coverTermsTable` (after `add-cover-terms-house-style`) produces
  the horizontal-rule / group / subrow structure, but it hard-codes run styling
  (font, size, color) and offers no way to mark a value as an *unfilled fillable
  placeholder* — the OA cover table renders such values yellow-highlighted and
  bold, e.g. `[Legal name of the employer]`. So the adapter reimplements the whole
  table to control fonts, sizes, per-row colors, non-uniform cell margins, and the
  fillable highlight.
- **Signatures.** `signatureBlock` offers single-column (inline captions) and
  two-column-grid (captions below the line) layouts. The OA signature page uses a
  third layout: per signer, a centered muted-caps party header over a
  *label-column-left / ruled-line-right* table (Signature / Print Name / Title /
  Date), with tall rows for signing room and an optional fillable Print-Name value.
  No recipe mode produces this, so the adapter builds it by hand.

Both adapters duplicate styling logic the recipe layer should own. Closing the gap
lets the consumer call the recipes instead of hand-rolling `TableSpec`s.

## What Changes

- **`coverTermsTable`** gains optional, fully backward-compatible styling hooks:
  - `fontFamily`, `labelSizePt` / `valueSizePt`, and per-row-kind color overrides
    (`labelColorHex`, `valueColorHex`, `groupColorHex`, `subrowColorHex`).
  - A per-entry `fillable?: boolean` on label/value and subrow entries: a fillable
    value renders with `highlight` (default `yellow`) and bold, the OA unfilled-
    placeholder treatment. Configurable via `fillableHighlight`.
  - `cellMarginsTwips` (non-uniform top/right/bottom/left) alongside the existing
    uniform `cellPaddingTwips`.
- **`signatureBlock`** gains a third `layout: 'oa-stacked-ruled'` mode: each party
  renders a centered muted-caps header over a two-column `[label | ruled line]`
  table with configurable tall row height; per-party optional pre-filled (and
  optionally fillable-highlighted) Print Name / Title; ruled lines are
  bottom-bordered cells (no VML), consistent with the existing modes.
- Omitting every new option preserves current output byte-for-byte.
- New scenarios `SDX-GEN-110` (cover-terms run styling + fillable) and `SDX-GEN-111`
  (signature OA ruled layout).

## Impact

- Affected specs: `docx-generation` (two ADDED requirements).
- Affected code: `packages/docx-core/src/generation/recipes.ts` + focused
  generation tests; type additions in `recipes.ts` (no `types.ts` grammar change —
  recipes compose existing `TableSpec`/`ParagraphSpec`/`RunProps`).
- Downstream: enables `legal-explainer` `lib/agreement-docx.ts` to delete its
  hand-built cover/signature `TableSpec` builders and call the recipes (separate PR,
  after a docx-core release that ships this).
- Out of scope: paragraph-grammar or `types.ts` changes; the consumer rewrite and
  the docx-core version bump/release (tracked downstream).
