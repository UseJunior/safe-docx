# Tasks: OA recipe styling hooks

## 1. coverTermsTable styling + fillable
- [x] 1.1 Extend `CoverTermsOptions` (fontFamily, labelSizePt/valueSizePt, label/value/group color overrides, fillableHighlight, cellMarginsTwips) and add `fillable?` to row/subrow entry types in `packages/docx-core/src/generation/recipes.ts`.
- [x] 1.2 Apply run styling to label/value/group cells; render a `fillable` value with bold + `highlight` (default `yellow`).
- [x] 1.3 Honor `cellMarginsTwips` (non-uniform) with subrow indent added to `left`; keep `cellPaddingTwips` as the uniform fallback.
- [x] 1.4 Ensure all new options are optional and omitting them is a no-op (defaults unchanged).

## 2. signatureBlock oa-stacked-ruled
- [x] 2.1 Add `'oa-stacked-ruled'` to the `layout` union + the OA fields (labelColumnTwips, ruledRowHeightTwips, fields, fillable) to `SignatureBlockOptions`.
- [x] 2.2 Implement the per-party centered muted-caps header + `[label | ruled line]` two-column table with tall rows; reuse the bottom-bordered-cell rule from the existing modes.
- [x] 2.3 Pre-fill Print Name / Title from party data; mark fillable values with highlight + bold.
- [x] 2.4 Leave single-column / two-column code paths untouched.

## 3. Tests + spec coverage
- [x] 3.1 Add scenario `SDX-GEN-110` (cover-terms run styling + fillable + byte-identity-when-omitted) wired to its requirement via `testAllure.openspec`.
- [x] 3.2 Add scenario `SDX-GEN-111` (signature oa-stacked-ruled) likewise.
- [x] 3.3 Assert `checkGeneratedPackage(...).issues == []` for both.
- [x] 3.4 Assert a byte-identity baseline: existing recipe calls with no new options produce unchanged output.
- [x] 3.5 `npm run check:spec-coverage -w @usejunior/docx-core -- --strict` passes.

## 4. Validate
- [x] 4.1 `openspec validate add-oa-recipe-styling --strict` passes.
- [x] 4.2 `npm run test:run -w @usejunior/docx-core` green.
