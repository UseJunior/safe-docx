## 1. Spec

- [x] 1.1 Add the `## REMOVED Requirements` delta for `Legal-document recipes`
      (SDX-GEN-070/071) under `specs/docx-generation/spec.md`.
- [x] 1.2 Excise `Legal-document recipes` from the archived foundational delta
      `changes/archive/2026-06-11-add-docx-generation/specs/docx-generation/spec.md`
      (validator-mandated; see design.md).
- [x] 1.3 Delete recipe-only active deltas `add-cover-terms-house-style`,
      `add-oa-recipe-styling`, `add-oa-recipe-borders-header`; trim
      `add-signature-and-keeplines` to keep-lines only (SDX-GEN-108).

## 2. Code

- [x] 2.1 Delete `packages/docx-core/src/generation/recipes.ts`.
- [x] 2.2 Remove the recipe re-exports from `generation/index.ts` and
      `src/index.ts`.
- [x] 2.3 Delete the six recipe tests; trim SDX-GEN-070/071 + the phase-5
      scenario from `generation-numbering-recipes.test.ts`.
- [x] 2.4 Rewrite `generation-ancillary-parts`, `generation-compare-roundtrip`,
      and `table-heavy-run-fragmented-inplace` onto plain `TableSpec` literals,
      preserving their `.openspec(...)` tags.
- [x] 2.5 Remove the recipe mentions from the five READMEs.

## 3. Guardrail

- [ ] 3.1 Add the "Library scope" SSOT to `CONTRIBUTING.md` and
      `openspec/project.md`.
- [ ] 3.2 Add the advisory LLM-gate checklist item + system-prompt note.

## 4. Verify

- [ ] 4.1 `openspec validate remove-agreement-domain-recipes --strict`.
- [ ] 4.2 Workspace lint, typecheck, full test suite, and
      `check:spec-coverage` (strict) pass.
- [ ] 4.3 Archive in-PR so canonical is consistent with the test set.
