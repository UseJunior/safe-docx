# Tasks: Add definitional `OoxmlDoc` subset, preservation lemma, and close `inv_field_001`

Each task below is sized for a single `/codex-implement` run against its own GitHub issue once this proposal is approved. The sizing reflects two rounds of peer review (codex CLI flagged T5b as too coarse — paperwork now splits off as T6; T1+T2 stay separate because they touch different files with different proof obligations).

## 1. Model

- [ ] 1.1 (T1) Define `Tier2.OoxmlModel` datatypes in `verification/lean/Tier2/OoxmlModel.lean`. No proofs, just the inductive families: `Doc`, `Paragraph`, `Block` (with `Run`, `Ins`, `Del`, `MoveFrom`, `MoveTo` constructors), `Run`, `Atom` (with `Text`, `DelText`, `InstrText`, `DelInstrText`, `FldChar` constructors), `FldCharKind` (`Begin`, `Separate`, `End`). Document the shape with file:line citations to `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts`.

## 2. Predicates

- [ ] 2.1 (T2) Define `Tier2.FieldStructure.validateFieldStructure : Doc → Bool`, `fieldSelfContained : List Block → Prop`, and `recursivelyWellformed : Doc → Prop` in `verification/lean/Tier2/FieldStructure.lean`. The `Bool` predicate mirrors `pipeline.ts:352-402` exactly (two checks). `fieldSelfContained` requires the depth / seenSeparator walk over the block list to start and end at `(0, false)`. `recursivelyWellformed` requires both: whole-doc `validateFieldStructure = true` AND every wrapper subtree (`Ins`/`Del`/`MoveFrom`/`MoveTo` child block lists, transitively) is `fieldSelfContained`. See `design.md > validateFieldStructure and recursivelyWellformed` for why the simpler per-subtree-validateFieldStructure form is too weak. No proofs; only definitions plus helper folds.

## 3. Operations

- [ ] 3.1 (T3a) Define `Tier2.AcceptReject.accept : Doc → Doc` in `verification/lean/Tier2/AcceptReject.lean`. Behaviors required (per `trackChangesAcceptorAst.ts:368-506`): drop `Del`/`MoveFrom` content; unwrap `Ins`/`MoveTo` (keep children); drop paragraphs whose body collapses to empty after the previous rules. No proofs.
- [ ] 3.2 (T3b) Define `Tier2.AcceptReject.reject : Doc → Doc` in the same file. Behaviors required (per `trackChangesAcceptorAst.ts:509-659`): drop `Ins`/`MoveTo`; unwrap `Del`/`MoveFrom`; rewrite `DelText → Text` and `DelInstrText → InstrText` inside the unwrapped subtree. No proofs.

## 4. Preservation lemma — `accept` side

- [ ] 4.1 (T4a) State and prove helper lemmas in `verification/lean/Tier2/InvFieldOne.lean` covering `accept`-output structure: dropping a `fieldSelfContained` `Del`/`MoveFrom` wrapper subtree leaves the outer walk's `(depth, seenSeparator)` state at the wrapper's position unchanged (because the dropped subtree's contribution starts and ends at `(0, false)`); unwrapping a `fieldSelfContained` `Ins`/`MoveTo` wrapper splices its children in and leaves the outer state at that position identical to pre-unwrap; empty-paragraph drops contribute no atoms.
- [ ] 4.2 (T4b) Prove the `accept` half of the preservation lemma `field_structure_preserved`: `∀ d, recursivelyWellformed d → validateFieldStructure (accept d) = true`, using the lemmas from 4.1.

## 5. Preservation lemma — `reject` side

- [ ] 5.1 (T5a) State and prove helper lemmas about `reject`: dropping a `fieldSelfContained` `Ins`/`MoveTo` wrapper subtree leaves the outer walk state at that position unchanged (symmetric to 4.1); unwrapping a `fieldSelfContained` `Del`/`MoveFrom` likewise; the `DelInstrText → InstrText` rewrite occurs only inside a `Del` subtree, which (by `fieldSelfContained`) means the rewritten `InstrText` sits at positive depth with `seenSeparator = false`; `DelText → Text` is irrelevant to the field-structure predicate.
- [ ] 5.2 (T5b) Prove the `reject` half of the preservation lemma `∀ d, recursivelyWellformed d → validateFieldStructure (reject d) = true`, using 5.1; combine 4.2 and 5.2 into the final `field_structure_preserved` theorem.

## 6. `Spec.lean` rewire, axiom, closure, bridge, docs

- [ ] 6.1 (T6) Land the closure in `verification/lean/LeanSpike/Spec.lean`: rewire `OoxmlDoc`, `acceptAllChanges`, `rejectAllChanges`, `validateFieldStructure` from `axiom` to `abbrev` / `def` over the Tier 2 types; add the new `axiom compareDocumentXml_output_recursivelyWellformed`; replace the `sorry` at line 71 with the two-line proof composing the new axiom and `Tier2.InvFieldOne.field_structure_preserved`. Add one field-bearing case to `packages/docx-core/src/integration/lean-spec-bridge.test.ts` exercising the new axiom against a fixture-derived field-bearing input (per codex MEDIUM 4). Add `verification/lean/Tier2/README.md` scaffolding. Extend `verification/lean/README.md` Specification Gap section to record what Tier 2 closes vs. what remains, naming `compareDocumentXml_output_recursivelyWellformed` as the single named residual axiom. Update `verification/ROADMAP.md` Tier 2 section to reflect the "preservation + named residual axiom" framing.

## Out of scope (separate future changes)

- **Full field-bearing fast-check arbitrary** extending `packages/docx-core/src/integration/lean-spec-bridge.test.ts` beyond the single fixture-based case landed in 6.1 — opens as `add-field-bearing-bridge-arbitrary` after this change merges.
- **`inv_rt_001` closure** — opens as `add-inv-rt-001-proof`.
- **Discharge of `compareDocumentXml_output_recursivelyWellformed`** by modeling `compareDocumentXml` definitionally — Tier 3 work, opens as `add-compareDocumentXml-definitional-model`.
- **Lean↔TS extensional equivalence** for `accept`/`reject` — opens as `add-accept-reject-lean-ts-equivalence`.
- **Broader `Atom` projection** and broader `Block` shape (non-wrapper descendants per `trackChangesAcceptorAst.ts:411,456,564`) toward the production `ComparisonUnitAtom` — opens as part of Tier 2.5.
