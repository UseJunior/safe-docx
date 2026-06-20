# Tasks: OA recipe border + header styling hooks

## 1. coverTermsTable rule color + weight
- [x] 1.1 Add `ruleColorHex` / `ruleSizeEighthPt` to `CoverTermsOptions` in `packages/docx-core/src/generation/recipes.ts`.
- [x] 1.2 Build the single border from those options and use it wherever `borderMode` currently uses the shared `SINGLE` constant (horizontal-rules + grid).
- [x] 1.3 Ensure omitting both options yields `{ style: 'single' }` (byte-identical to today).

## 2. signatureBlock oa-stacked-ruled header + line + per-value fillable
- [x] 2.1 Add `headerBold` / `headerSizePt` / `lineColorHex` / `lineSizeEighthPt` to `SignatureBlockOptions` and `nameFillable?` / `titleFillable?` to the party entry.
- [x] 2.2 Apply header bold/size to the centered party header paragraph.
- [x] 2.3 Build the ruled signing-line bottom border from `lineColorHex` / `lineSizeEighthPt`.
- [x] 2.4 Resolve highlight per value: Print Name uses `party.nameFillable ?? fillable`, Title uses `party.titleFillable ?? fillable`; keep the non-empty guard; Signature/Date never fillable.
- [x] 2.5 Leave single-column / two-column code paths untouched; omitting all new options is a no-op.

## 3. Tests + spec coverage
- [x] 3.1 Add scenario `SDX-GEN-112` (cover-terms rule color/weight + byte-identity-when-omitted) wired via `testAllure.openspec`.
- [x] 3.2 Add scenario `SDX-GEN-113` (signature header weight/size + ruled-line color/weight + per-value fillable) likewise.
- [x] 3.3 Assert `checkGeneratedPackage(...).issues == []` for both.
- [x] 3.4 Assert defaults preserved: with no new options, the cover rule emits no `colorHex` beyond `auto` and the header carries no `w:b`/`w:sz`.
- [x] 3.5 `npm run check:spec-coverage -w @usejunior/docx-core -- --strict` passes.

## 4. Validate
- [x] 4.1 `openspec validate add-oa-recipe-borders-header --strict` passes.
- [x] 4.2 `npm run test:run -w @usejunior/docx-core` green.
