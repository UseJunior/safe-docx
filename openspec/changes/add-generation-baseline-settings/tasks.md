## 1. Spec

- [x] 1.1 Add the `Baseline settings part` requirement with scenario
      `SDX-GEN-094` to the `docx-generation` delta.

## 2. Emitter

- [x] 2.1 Add `compat` / `compatSetting` local names to the `W` namespace map.
- [x] 2.2 Generalize `emitSettingsPartIfNeeded` → `emitSettingsPart` in
      `emit/settings-part.ts`: always emit `word/settings.xml`, always append a
      `w:compat` → `compatibilityMode=15` compatSetting, fold the existing
      `evenAndOddHeaders` / `clrSchemeMapping` logic in (still conditional).
- [x] 2.3 Update the call site in `compile.ts`.

## 3. Tests

- [x] 3.1 Add
      `packages/docx-core/src/generation/generation-baseline-settings.test.ts`
      with `TEST_FEATURE = 'add-generation-baseline-settings'` and `.openspec`
      ID `[SDX-GEN-094]`.
- [x] 3.2 Assert `word/settings.xml` is present on every package, carries a
      content-type Override and a resolving relationship, contains the
      `compatibilityMode=15` compatSetting, is registered exactly once, and that
      even/odd headers still emit alongside the compat block.

## 4. Matrix

- [x] 4.1 Bump the emitter revision in
      `generation-manual-compat-checklist.md`; reset the manual Word-for-Mac
      cells to `—` pending a fresh Compatibility-Mode-banner observation.

## 5. Verify

- [x] 5.1 `openspec validate add-generation-baseline-settings --strict` passes.
- [x] 5.2 Regenerate output fixtures (`SDX_WRITE_OUTPUT_FIXTURES=1`).
- [x] 5.3 `npm run build`, `npm run test:run`, `npm run check:spec-coverage`
      (incl. `check:spec-coverage-generation` for this feature) pass.
