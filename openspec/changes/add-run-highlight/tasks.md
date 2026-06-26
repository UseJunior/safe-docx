## 1. Spec

- [x] 1.1 Add the `Run highlight` requirement with scenario `SDX-GEN-105` to
      the `docx-generation` delta.

## 2. Types and emitter

- [x] 2.1 Add the closed `HighlightColor` union and `RunProps.highlight`.
- [x] 2.2 Emit `w:highlight` from `buildRunPropsElement` through the existing
      run-property ordering table.

## 3. Tests

- [x] 3.1 Add `packages/docx-core/src/generation/generation-run-highlight.test.ts`
      with `TEST_FEATURE = 'add-run-highlight'` and `.openspec` ID
      `[SDX-GEN-105]`.
- [x] 3.2 Assert authored highlight values are emitted, ordered, well-formed,
      and survive load/save round-trip.

## 4. Verify

- [x] 4.1 `openspec validate add-run-highlight --strict` passes.
- [x] 4.2 Focused package build/test, spec coverage, conformance-citation check,
      workspace lint, and grep confirmation pass.
