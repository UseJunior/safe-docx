## 1. Spec

- [x] 1.1 Add the `Cover-terms table house style` requirement with scenario
      `SDX-GEN-106` to the `docx-generation` delta.

## 2. Recipe

- [x] 2.1 Add optional `borderMode`, `rowHeightTwips`, and `cellPaddingTwips`
      controls to `coverTermsTable`.
- [x] 2.2 Add group-row and subrow term entry support without changing the
      default label/value behavior.
- [x] 2.3 Compose the new behavior only from the existing table, paragraph, and
      run grammar.

## 3. Tests

- [x] 3.1 Add `packages/docx-core/src/generation/generation-cover-terms-house-style.test.ts`
      with `TEST_FEATURE = 'add-cover-terms-house-style'` and `.openspec`
      scenario `[SDX-GEN-106]`.
- [x] 3.2 Assert horizontal-rule borders, group-row span and bold styling,
      subrow italic/soft-ink/indent styling, authored row height, structural
      validity, and default full-grid compatibility.

## 4. Verify

- [x] 4.1 Focused package build/test, spec coverage, conformance-citation check,
      workspace lint, and strict OpenSpec validation pass.
