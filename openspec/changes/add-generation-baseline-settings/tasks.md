## 1. Spec

- [x] 1.1 Add the `Baseline settings part` requirement with scenario
      `SDX-GEN-094` to the `docx-generation` delta.

## 2. Emitter

- [x] 2.1 Add `compat` / `compatSetting` local names to the `W` namespace map.
- [x] 2.2 Generalize `emitSettingsPartIfNeeded` → `emitSettingsPart` in
      `emit/settings-part.ts`: always emit `word/settings.xml`, always append a
      `w:compat` → `compatibilityMode=15` compatSetting, fold the existing
      `evenAndOddHeaders` / `clrSchemeMapping` logic in (still conditional),
      and preserve their `CT_Settings` order around `w:compat`.
- [x] 2.3 Update the call site in `compile.ts`.
- [x] 2.4 Add ECMA-376 Part 1 §§11.3.3 and 17.15.3.4 traceability while
      attributing mode-15 semantics separately to MS-DOCX §2.3.5.

## 3. Tests

- [x] 3.1 Add
      `packages/docx-core/src/generation/generation-baseline-settings.test.ts`
      with `TEST_FEATURE = 'add-generation-baseline-settings'` and `.openspec`
      ID `[SDX-GEN-094]`.
- [x] 3.2 Assert `word/settings.xml` is present on every package, carries a
      content-type Override and a resolving relationship, contains the
      `compatibilityMode=15` compatSetting, is registered exactly once, and that
      even/odd headers still emit alongside the compat block.
- [x] 3.4 Force both conditional settings with an independent custom-theme test
      and assert the exact direct-child sequence around `w:compat`.
- [x] 3.3 Label the settings behavior with structured ECMA-376 conformance
      metadata in the Allure test factory.

## 4. Neutral DPT integration

- [x] 4.1 Implement `composeDocumentWithCompatibilityMode` through the real
      generation API, validating `compatibilityMode` and `bodyText`, supporting
      mode 15, and declining unsupported requested modes.
- [x] 4.2 Pin the suite to merged DPT commit
      `19f051ed645cbc8613a5967e02d7f87ef7824454` and require supported-operation
      scenarios plus `composeCompatibilityMode15WritesCompatSetting` to pass.
- [x] 4.3 Derive support dynamically from operation descriptors and input
      package shape; require unsupported operations and table-row revision
      shapes to remain explicit `unsupported` outcomes without scenario-ID
      whitelists.

## 5. Capability projection

- [x] 5.1 Vendor the capability registry, schemas, profile, mapping, and
      summary byte-for-byte from DPT commit `19f051e`; update all hashes.
- [x] 5.2 Add `word.settings.compatibility-mode` projection rows without using
      local tests as positive evidence. Keep all rows `untested` because the
      pinned neutral result marks the scenario unmeasured.
- [x] 5.3 Regenerate projection reports and pass projection mutation checks.

## 6. Matrix

- [x] 6.1 Bump the emitter revision in
      `generation-manual-compat-checklist.md`; reset the manual Word-for-Mac
      cells to `—` pending a fresh Compatibility-Mode-banner observation.

## 7. Verify

- [x] 7.1 `openspec validate add-generation-baseline-settings --strict` passes.
- [x] 7.2 Regenerate output fixtures (`SDX_WRITE_OUTPUT_FIXTURES=1`) and verify
      a second regeneration is byte-identical.
- [x] 7.3 Run the exact pinned DPT scenario and full adapter suite.
- [x] 7.4 `npm run build`, `npm run lint:workspaces`, `npm run test:run`,
      `npm run check:spec-coverage`, `npm run check:conformance-citations`,
      `npm run check:conformance-doc`, and `npm run check:capability-projection`
      (incl. `check:spec-coverage-generation` for this feature) pass.

## 8. Reviewer reconciliation

- [x] 8.1 Correct conditional settings to the vendored `CT_Settings` child
      sequence and add direct-child-order coverage using a custom theme.
- [x] 8.2 Replace scenario-ID support lists with operation/input-shape
      classification and cover equivalent renamed row shapes.
- [x] 8.3 Restrict external conformance labels to the live assertions that
      inspect revision and compatibility output.
- [x] 8.4 Regenerate fixtures twice and rerun the exact pinned DPT suite,
      structural/schema checks, and repository pre-submit gates.
- [x] 8.5 Make the live DPT expected-status oracle independent of production
      support declarations and prove simulated production narrowing is caught.
