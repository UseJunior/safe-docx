## 1. Spec

- [x] 1.1 Add the custom theme requirement with scenario `SDX-GEN-107` to the
      `docx-generation` delta.

## 2. Types and emitters

- [x] 2.1 Add `ThemeColorSlot`, `DocumentThemeSpec`, `DocumentSpec.theme`,
      run theme-color fields, and cell theme-fill fields.
- [x] 2.2 Emit partial color/font theme overrides into `word/theme/theme1.xml`
      while preserving the no-theme default output.
- [x] 2.3 Emit run `w:color` theme attributes and cell `w:shd` theme-fill
      attributes.

## 3. Validation and tests

- [x] 3.1 Validate theme slots, theme color hex values, tint/shade hex values,
      and mutual exclusivity with existing hex fields.
- [x] 3.2 Add `packages/docx-core/src/generation/generation-custom-theme.test.ts`
      with `TEST_FEATURE = 'add-custom-theme'` and `.openspec` ID
      `[SDX-GEN-107]`.

## 4. Verify

- [x] 4.1 Run focused package build/test, spec coverage, conformance-citation
      check, workspace lint, and `openspec validate add-custom-theme --strict`.
- [x] 4.2 Generate sample documents and verify theme-relative colors convert
      through LibreOffice.
