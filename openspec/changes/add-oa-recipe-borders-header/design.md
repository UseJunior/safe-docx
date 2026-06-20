# Design: OA recipe border + header styling hooks

## Context

`coverTermsTable` and `signatureBlock` (`oa-stacked-ruled`) compose existing spec
primitives. Today both draw borders from module-level constants
(`const SINGLE: BorderSpec = { style: 'single' }`), and the `oa-stacked-ruled` party
header is a `paragraph(party, { caps, colorHex, font })` with no weight/size. The OA
consumer needs to set the rule/line **color and weight**, the header **bold + size**,
and a **per-value** fillable decision. All additions are optional and additive — the
defaults reproduce current output (a byte-identity scenario guards this).

## coverTermsTable

Add two options:

```ts
type CoverTermsOptions = {
  // ...existing...
  /** Color (six-hex, no '#') for the table's single-style borders. Default 'auto'. */
  ruleColorHex?: string;
  /** Weight in eighths of a point for the single-style borders. Default 4 (0.5pt). */
  ruleSizeEighthPt?: number;
};
```

Behavior:
- Build the single border from the options instead of the shared `SINGLE` constant:
  `const rule: BorderSpec = { style: 'single', ...(ruleSizeEighthPt !== undefined ? { sizeEighthPt } : {}), ...(ruleColorHex !== undefined ? { colorHex } : {}) }`.
- Use `rule` wherever the border map currently uses `SINGLE` (both `horizontal-rules`
  — top/bottom/insideH — and `grid` — all six). `NONE` is unchanged.
- When neither option is set, `rule` is structurally `{ style: 'single' }`, so the
  emitted `w:sz="4" w:color="auto"` is unchanged → byte-identical.

## signatureBlock — oa-stacked-ruled

Add header, line, and per-value-fillable options:

```ts
type SignatureBlockOptions = {
  // ...existing oa-stacked-ruled fields...
  /** Bold the centered party header. Default false. */
  headerBold?: boolean;
  /** Party-header point size. Default: inherit Normal. */
  headerSizePt?: number;
  /** Color (six-hex) for the ruled signing line. Default 'auto'. */
  lineColorHex?: string;
  /** Ruled signing-line weight in eighths of a point. Default 4. */
  lineSizeEighthPt?: number;
  parties: Array<{
    // ...existing party fields...
    /** Override block `fillable` for this party's Print Name. Default: `fillable`. */
    nameFillable?: boolean;
    /** Override block `fillable` for this party's Title. Default: `fillable`. */
    titleFillable?: boolean;
  }>;
};
```

Behavior:
- Header: extend the header `paragraph(...)` opts with
  `...(headerBold ? { bold: true } : {})` and
  `...(headerSizePt !== undefined ? { sizePt: headerSizePt } : {})`. Defaults unchanged.
- Ruled line: build the bottom border from `lineColorHex` / `lineSizeEighthPt` exactly
  as for cover-terms `rule`; default `{ style: 'single' }` → unchanged.
- Per-value fillable: when deciding whether a value is highlighted, resolve the
  per-field flag — Print Name uses `party.nameFillable ?? options.fillable`, Title uses
  `party.titleFillable ?? options.fillable`. A value is highlighted only when its
  resolved flag is true **and** the value is non-empty (current non-empty guard kept).
  Signature / Date stay blank, never fillable.

## Why options, not a generic border passthrough

A full `borders?: TableBorders` override on `coverTermsTable` would let a caller fight
the `borderMode` map and produce contradictory states (e.g. a left border in
`horizontal-rules` mode). The OA need is precisely color + weight on the *existing*
single rules, so two scalar options keep the recipe's structural guarantee intact
while exposing exactly what the house style varies. Same reasoning for the signature
line.

## Backward compatibility

Every new field is optional; omitting all of them yields the current spec nodes.
Guarded by an explicit "defaults preserved" assertion in each new scenario (no
`w:color`/`w:sz` beyond the current `sz=4`/`auto`, no `w:b`/`w:sz` on the header).
