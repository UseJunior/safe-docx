# Change: Add numbering level justification

## Why

The numbering generator hardcodes `<w:lvlJc w:val="left"/>` on every list level,
and the `NumberingSpec` level type exposes no justification field, so a consumer
cannot produce right-aligned numbering. `<w:lvlJc w:val="right"/>` right-aligns
the number against the text indent so labels of differing widths line up on
their right edge (`1.` vs `10.`, `1.1` vs `1.10`) — the standard convention for
legal-document outline numbering. With forced left alignment a downstream
legal-agreement renderer cannot match standard/NVCA-style numbering. Issue #502
tracks this gap.

## What Changes

- Add a closed `NumberingLevelJustification` union (the transitional ST_Jc
  subset `left`/`center`/`right`) and an optional `lvlJc` to the `NumberingSpec`
  level type.
- Emit `level.lvlJc ?? 'left'` for `w:lvlJc` instead of the hardcoded `'left'`,
  preserving current behavior when the field is omitted.
- Reject an out-of-enum `lvlJc` (e.g. from a JSON/JS caller bypassing the type)
  with a validation error before emission.
- Add a `Numbering level justification` requirement to `docx-generation` with
  scenario `SDX-GEN-063`.

## Impact

- Affected specs: `docx-generation` (one ADDED requirement).
- Affected code: `packages/docx-core/src/generation/types.ts`,
  `packages/docx-core/src/generation/emit/numbering-part.ts`,
  `packages/docx-core/src/generation/validate-spec.ts`, the
  `spec-compliance` conformance registry entry for `w:lvlJc`, and a focused
  generation test.
- Backward-compatible additive field → patch/minor release.
- Out of scope: the full `CT_Jc`/`ST_Jc` value space (only the
  `left`/`center`/`right` subset the generator emits), recipe-helper wiring, and
  read-side list-label computation (justification is purely visual and does not
  change label text).
