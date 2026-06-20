# Change: OA recipe border + header styling hooks

## Why

`add-oa-recipe-styling` (SDX-GEN-110/111) gave `coverTermsTable` and
`signatureBlock` the run-styling, fillable, and `oa-stacked-ruled` layout hooks the
OpenAgreements DOCX renderer (`lib/agreement-docx.ts`) needs — but integration
revealed three remaining surfaces the recipes still cannot express, so the consumer
would have to keep hand-rolling raw `TableSpec`s (or regress its canonical match):

- **Border color + weight.** The OA cover table draws its horizontal rules in a
  light gray (`C7C7C7`) at 0.5pt; the OA signature line is a darker gray (`494A4B`)
  at 0.75pt. Both recipe paths emit a bare `{ style: 'single' }` border, which
  serializes to `w:color="auto"` (black). There is no option to set the rule/line
  color or weight, so consuming the recipe turns gray rules black — a visible
  regression against the canonical template.
- **Signature party-header weight + size.** The `oa-stacked-ruled` header renders
  `paragraph(party, { caps, colorHex, font })` with no bold and no size, so it
  inherits Normal (~11pt). The OA header is 9pt **bold**. No option exposes either.
- **Per-value fillable.** `oa-stacked-ruled` exposes a single block-level
  `fillable` flag that highlights *every* non-empty Print Name / Title. The OA
  renderer highlights a value **only when it is an unfilled placeholder**, so a
  filled assignment must not be highlighted — which the block-level flag cannot
  express.

Closing these lets `lib/agreement-docx.ts` delete its hand-built cover/signature
`TableSpec` builders and call the recipes while staying byte-for-byte on the
canonical house style.

## What Changes

- **`coverTermsTable`** gains optional, backward-compatible border hooks:
  - `ruleColorHex` — color (six-hex, no `#`) for the table's single-style borders
    (the horizontal rules, or the full grid in `grid` mode). Default `auto`.
  - `ruleSizeEighthPt` — weight in eighths of a point for those borders. Default 4.
- **`signatureBlock` `oa-stacked-ruled`** gains:
  - `headerBold` (default `false`) and `headerSizePt` (default: inherit) on the
    party header.
  - `lineColorHex` (default `auto`) and `lineSizeEighthPt` (default 4) on the ruled
    signing line.
  - Per-party `nameFillable?` / `titleFillable?` that override the block-level
    `fillable` for that party's Print Name / Title value (default: fall back to
    `fillable`), so an unfilled placeholder can be highlighted while a filled value
    is not.
- Omitting every new option preserves current output byte-for-byte.
- New scenarios `SDX-GEN-112` (cover-terms rule color/weight) and `SDX-GEN-113`
  (signature header weight/size + ruled-line color/weight + per-value fillable).

## Impact

- Affected specs: `docx-generation` (two ADDED requirements carrying the new
  SDX-GEN-112/113 scenarios — mirroring how `add-oa-recipe-styling` added 110/111
  rather than modifying the base recipe requirement).
- Affected code: `packages/docx-core/src/generation/recipes.ts` + focused
  generation tests. No `types.ts` grammar change — recipes still compose existing
  `BorderSpec` / `ParagraphSpec` / `TableSpec`.
- Downstream: unblocks the `legal-explainer` `lib/agreement-docx.ts` rewire onto the
  recipes (separate PR, after a docx-core release that ships this — 0.14.0).
- Out of scope: paragraph-grammar / `types.ts` changes; the consumer rewrite and the
  version bump/release (tracked downstream).
