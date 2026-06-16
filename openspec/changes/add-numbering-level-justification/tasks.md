## 1. Spec

- [ ] 1.1 Add the `Numbering level justification` requirement with scenario
      `SDX-GEN-063` to the `docx-generation` delta.

## 2. Types, emitter, and validation

- [ ] 2.1 Add the closed `NUMBERING_LEVEL_JUSTIFICATIONS` array,
      `NumberingLevelJustification` union, and `NumberingSpec` level `lvlJc`.
- [ ] 2.2 Emit `w:lvlJc` from `buildLevel` as `level.lvlJc ?? 'left'`.
- [ ] 2.3 Reject out-of-enum `lvlJc` in `validateNumbering` via a runtime set.

## 3. Conformance registry

- [ ] 3.1 Update the `[ECMA-PART1-17-9-7]` registry prose (no longer "always
      left") and regenerate `spec-compliance/CONFORMANCE.md`.

## 4. Tests

- [ ] 4.1 Add `packages/docx-core/src/generation/generation-numbering-level-justification.test.ts`
      with `TEST_FEATURE = 'add-numbering-level-justification'` and `.openspec`
      ID `[SDX-GEN-063]`.
- [ ] 4.2 Assert `right`/`center`/default-`left` emission, double-render
      determinism, package well-formedness, and out-of-enum rejection.

## 5. Verify

- [ ] 5.1 `openspec validate add-numbering-level-justification --strict` passes.
- [ ] 5.2 Focused package build/test, spec-coverage, conformance-doc and
      conformance-citation checks, workspace lint, and coverage ratchet pass.
