## 1. docx-primitives: Namespace Constants + Primitive
- [x] 1.1 Add `vertAlign` and `position` constants to `W` object in `namespaces.ts`
- [x] 1.2 Create `prevent_double_elevation.ts` with types and `preventDoubleElevation()` function
- [x] 1.3 Create `prevent_double_elevation.test.ts` with 12 Allure BDD-style scenarios
- [x] 1.4 Export from `index.ts`

## 2. Integration into DocxDocument.normalize()
- [x] 2.1 Extend `NormalizationResult` with `doubleElevationsFixed` field
- [x] 2.2 Call `preventDoubleElevation()` in `normalize()` and write styles.xml if changed
- [x] 2.3 Include `doubleElevationsFixed` in dirty-check and return value

## 3. MCP Stats Reporting
- [x] 3.1 Add `double_elevations_fixed` to `open_document.ts` normalization response (both branches)
- [x] 3.2 Add `double_elevations_fixed` to `get_session_status.ts` normalization response (both branches)
- [x] 3.3 Update `normalization_regression.test.ts` skip-branch assertion to include new field

## 4. Verification
- [ ] 4.1 `npm run build` succeeds in `packages/docx-primitives`
- [ ] 4.2 `npx vitest run` passes in `packages/docx-primitives`
- [ ] 4.3 `npx vitest run` passes in `packages/safe-docx`
