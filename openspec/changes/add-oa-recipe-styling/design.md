# Design: OA recipe styling hooks

## Context

`coverTermsTable` and `signatureBlock` are pure functions that compose existing
spec primitives (`TableSpec`, `ParagraphSpec`, `RunProps`). The OA consumer needs
run-level styling control and a fillable-placeholder treatment the current options
don't expose, plus a signature layout the current modes don't produce. All
additions are optional and additive — the recipes keep their current defaults so
existing callers are unaffected (verified by a byte-identity scenario).

## coverTermsTable

Extend `CoverTermsOptions` and the entry types:

```ts
type FillableValue = { fillable?: boolean };           // mixed into row/subrow entries
type CoverTermRow = { label: string; value: string } & FillableValue;
type CoverTermSubrow = { label: string; value: string; subrow: true } & FillableValue;

type CoverTermsOptions = {
  // ...existing...
  /** Body font for every label/value/group cell (default: inherit / Calibri). */
  fontFamily?: string;
  /** Point sizes; default to the current implicit size when omitted. */
  labelSizePt?: number;
  valueSizePt?: number;
  /** Per-row-kind colors (six-hex, no '#'); default to current behavior. */
  labelColorHex?: string;
  valueColorHex?: string;
  groupColorHex?: string;
  // subrowColorHex already exists.
  /** Highlight applied to a fillable value (default 'yellow'). */
  fillableHighlight?: HighlightColor;
  /** Non-uniform cell margins; takes precedence over cellPaddingTwips when set. */
  cellMarginsTwips?: { top?: number; right?: number; bottom?: number; left?: number };
};
```

Behavior:
- A value with `fillable: true` renders bold + `highlight: fillableHighlight ?? 'yellow'`.
  This is the OA unfilled-placeholder treatment (`[Legal name of the employer]`).
- `fontFamily` / size / color props are applied to the relevant cell runs; when
  omitted the recipe emits exactly what it does today.
- `cellMarginsTwips`, when present, sets per-cell `marginsTwips` (subrow label
  indent still adds on top of `left`); `cellPaddingTwips` remains the uniform
  shorthand and is used when `cellMarginsTwips` is absent.

## signatureBlock — `layout: 'oa-stacked-ruled'`

```ts
type SignatureBlockOptions = {
  // ...existing single-column / two-column fields...
  layout?: 'single-column' | 'two-column' | 'oa-stacked-ruled';
  /** oa-stacked-ruled only: */
  labelColumnTwips?: number;     // default 1800
  ruledRowHeightTwips?: number;  // default ~620 (signing room)
  headerColorHex?: string;       // muted caps party header (reuses existing field)
  fields?: Array<'signature' | 'printName' | 'title' | 'date'>; // default all four
  /** Mark pre-filled values (printName/title) as fillable -> highlight + bold. */
  fillable?: boolean;
};
```

Each party renders:
1. A centered, uppercase, muted (`headerColorHex`) party header paragraph
   (`keepNext`, generous space-before so it groups with its block).
2. A borderless two-column `[labelColumnTwips | rest]` table. One row per selected
   field: left cell = bold label ("Signature"/"Print Name"/"Title"/"Date"); right
   cell = a bottom-bordered ruled line carrying the optional pre-filled value
   (Print Name / Title from party data), highlighted when `fillable`. Rows carry
   `ruledRowHeightTwips` as `heightRule: 'atLeast'` so there is room to sign.

Single-column and two-column modes are untouched.

## Why not a new `types.ts` primitive

Everything here composes existing `TableSpec`/`ParagraphSpec`/`RunProps`. No new
emitter or grammar is needed, so `validate-spec.ts` and the compiler are unchanged;
the surface stays at the recipe layer where styling presets belong.

## Risks

- **Backward compatibility**: mitigated by an explicit byte-identity scenario —
  omitting all new options must reproduce current output.
- **Highlight enum**: `fillableHighlight` reuses the existing `HighlightColor`
  whitelist, so no out-of-enum `w:highlight` is authorable.
