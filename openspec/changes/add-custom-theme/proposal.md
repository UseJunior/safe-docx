# Change: Add custom theme generation

## Why

`generateDocx` always emits the canonical Office theme, so consumers that need a
single source of brand color must thread literal hex values through every run
and table cell. Issue #492 requires custom theme palette overrides plus
theme-relative authoring fields so downstream templates can map role colors to
theme slots once.

## What Changes

- Add `DocumentSpec.theme` with partial color-slot overrides and optional
  major/minor latin typeface overrides.
- Emit custom theme colors into `word/theme/theme1.xml` while preserving the
  canonical default for unspecified slots and unchanged output when no theme is
  supplied.
- Add theme-relative run color and table-cell shading fields with runtime
  validation.
- Add scenario `SDX-GEN-107` to `docx-generation`.

## Impact

- Affected specs: `docx-generation` (one ADDED requirement).
- Affected code: `packages/docx-core/src/generation/types.ts`,
  `packages/docx-core/src/generation/emit/theme-part.ts`,
  `packages/docx-core/src/generation/emit/properties.ts`,
  `packages/docx-core/src/generation/emit/table.ts`,
  `packages/docx-core/src/generation/validate-spec.ts`, and focused generation
  tests.
