# Tasks: Add definitional `OoxmlDoc` subset, preservation lemma, and close `inv_field_001`

Each task below is sized for a single `/codex-implement` run against its own GitHub issue once this proposal is approved. The sizing reflects three rounds of peer review:

- Round 1 (codex CLI) flipped framing to "preservation + named residual axiom."
- Round 2 (codex CLI) caught the `Begin, Separate, Ins(Del(End, Begin), InstrText), End` counterexample and forced per-subtree strengthening.
- Round 3 (codex + gemini CLI) caught three further counterexample families (`DelInstrText` unchecked; subtree consumes outer state via leading `End`/`Separate`; single-boolean `seenSeparator` reset). The fix promoted the per-subtree predicate to **stack-valued context-neutrality** (`fieldContextNeutral`) and pulled the shared "walk-over-append + context-extension + DelInstrText rewrite" lemmas out into a new task **T0**, ahead of T4/T5, so both halves consume the same generic results rather than rediscovering them.

## 0. Generic walk lemmas (round-3 split)

- [x] 0.1 (T0) Define and prove the shared walk lemmas in `verification/lean/Tier2/WalkLemmas.lean`. (a) `walkBlocks_append`: `walkBlocks r (l ++ m) = walkBlocks (walkBlocks r l) m` (fold-over-append specialized to `stepBlock`; mathlib's `List.foldl_append` likely lands this directly). (b) Context-extension lemma: `fieldContextNeutral bs → ∀ ctx, walkBlocks (.ok ctx) bs = .ok ctx`, plus the corollary that for any prior valid prefix that ends at `.ok ctx`, splicing or deleting `bs` at that position leaves every later state observation identical (uses (a)). (c) `DelInstrText → InstrText` rewrite lemma: under `fieldContextNeutral bs`, replacing any `DelInstrText` atom inside `bs` with `InstrText` yields a `bs'` that is still context-neutral AND, when later spliced into an outer document at the same position, the renamed atom passes `stepAtom` (the locally-pushed stack at that atom's position is non-empty with top bit `false`, so its top bit dominates whatever the outer context's top bit is). These three lemmas are the load-bearing generic results consumed by T4b and T5b. No `accept`/`reject`-specific reasoning here — the file is purely about the stack-valued walk over `List Block`.

## 1. Model

- [x] 1.1 (T1) Define `Tier2.OoxmlModel` datatypes in `verification/lean/Tier2/OoxmlModel.lean`. No proofs, just the inductive families: `Doc`, `Paragraph`, `Block` (with `Run`, `Ins`, `Del`, `MoveFrom`, `MoveTo` constructors), `Run`, `Atom` (with `Text`, `DelText`, `InstrText`, `DelInstrText`, `FldChar` constructors), `FldCharKind` (`Begin`, `Separate`, `End`). Document the shape with file:line citations to `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts`.

## 2. Predicates

- [x] 2.1 (T2) Define `Tier2.FieldStructure.FieldCtx := List Bool`, `WalkResult`, `stepAtom`, `stepBlock`, `walkBlocks`, `validateFieldStructure : Doc → Bool`, `fieldContextNeutral : List Block → Prop`, and `recursivelyWellformed : Doc → Prop` in `verification/lean/Tier2/FieldStructure.lean`. The walk uses a depth-indexed stack of "separator-seen" bits exactly mirroring `pipeline.ts:374-389` (`pastSeparatorAtDepth: number[]`): `Begin` pushes `false`; `Separate` sets the top bit to `true` (no-op when stack is empty, matching `pipeline.ts:387`'s `if (depth > 0)` guard); `End` pops the stack (no-op when empty, matching `pipeline.ts:389`'s guard); `InstrText` and `DelInstrText` produce `WalkResult.invalid` when the stack is empty or its top bit is `true`. `validateFieldStructure` checks (a) global `Begin` count = global `End` count AND (b) `walkBlocks (.ok []) (paragraphs.bind body) ≠ .invalid`. `fieldContextNeutral bs := ∀ ctx, walkBlocks (.ok ctx) bs = .ok ctx`. `recursivelyWellformed d := validateFieldStructure d = true ∧ ∀ subtree ∈ allWrapperSubtrees d, fieldContextNeutral subtree`. See `design.md > validateFieldStructure, FieldCtx, and recursivelyWellformed` for the round-3 counterexamples that drove this exact shape; no proofs in this task, only definitions plus helper folds.

## 3. Operations

- [x] 3.1 (T3a) Define `Tier2.AcceptReject.accept : Doc → Doc` in `verification/lean/Tier2/AcceptReject.lean`. Behaviors required (per `trackChangesAcceptorAst.ts:368-506`): drop `Del`/`MoveFrom` content; unwrap `Ins`/`MoveTo` (keep children); drop paragraphs whose body collapses to empty after the previous rules. No proofs.
- [x] 3.2 (T3b) Define `Tier2.AcceptReject.reject : Doc → Doc` in the same file. Behaviors required (per `trackChangesAcceptorAst.ts:509-659`, noting that the TS engine unwraps both `w:del` AND `w:moveFrom` *before* renaming `w:delInstrText → w:instrText` over the whole tree at lines 602-616): drop `Ins`/`MoveTo`; unwrap `Del`/`MoveFrom`; then rewrite `DelText → Text` and `DelInstrText → InstrText` over the resulting tree. The rewrite is global at the operation level — the precondition that `DelInstrText` only originates inside a wrapper that `reject` will unwrap is enforced by `recursivelyWellformed` on the *input*, NOT by the bare datatype. No proofs.

## 4. Preservation lemma — `accept` side

- [x] 4.1 (T4a) State the `accept`-specific helper lemmas in `verification/lean/Tier2/InvFieldOne.lean` *consuming* T0's generic results: dropping a `fieldContextNeutral` `Del`/`MoveFrom` wrapper subtree leaves every later observation of the outer walk identical (direct application of T0(b) to the wrapper's child block list, since `stepBlock` of a wrapper is `walkBlocks` over its children); unwrapping a `fieldContextNeutral` `Ins`/`MoveTo` wrapper at the wrapper's position is a no-op for state observations outside the children's span (also T0(b)); empty-paragraph drops contribute no `FldChar` / `InstrText` / `DelInstrText` atoms (trivial). Do NOT redo the walk-over-append / context-extension reasoning here — that is T0's job.
- [x] 4.2 (T4b) Prove the `accept` half of the preservation lemma `field_structure_preserved`: `∀ d, recursivelyWellformed d → validateFieldStructure (accept d) = true`, using 4.1 (which uses T0).

## 5. Preservation lemma — `reject` side

- [x] 5.1 (T5a) State the `reject`-specific helper lemmas: dropping a `fieldContextNeutral` `Ins`/`MoveTo` wrapper subtree leaves the outer walk state at that position unchanged (symmetric to 4.1, again via T0(b)); unwrapping a `fieldContextNeutral` `Del`/`MoveFrom` likewise; the `DelInstrText → InstrText` rewrite is safe at every rewrite position (direct application of T0(c) — note the rewrite is global at the operation level after both unwraps complete, but `recursivelyWellformed` constrains the input shape so only `DelInstrText` atoms that originated inside a `Del` or `MoveFrom` wrapper ever existed); `DelText → Text` is irrelevant to the field-structure predicate.
- [x] 5.2 (T5b) Prove the `reject` half of the preservation lemma `∀ d, recursivelyWellformed d → validateFieldStructure (reject d) = true`, using 5.1 (which uses T0); combine 4.2 and 5.2 into the final `field_structure_preserved` theorem.

## 6. `Spec.lean` rewire, axiom, closure, bridge, docs

- [x] 6.1 (T6) Land the closure in `verification/lean/LeanSpike/Spec.lean`: rewire `OoxmlDoc`, `acceptAllChanges`, `rejectAllChanges`, `validateFieldStructure` from `axiom` to `abbrev` / `def` over the Tier 2 types; add the new `axiom compareDocumentXml_output_recursivelyWellformed` (with the engine-specific, fixture-only docstring from `design.md`); replace the `sorry` at line 71 with the two-line proof composing the new axiom and `Tier2.InvFieldOne.field_structure_preserved`. Add one field-bearing case to `packages/docx-core/src/integration/lean-spec-bridge.test.ts` exercising the new axiom against a fixture-derived field-bearing input. Add `verification/lean/Tier2/README.md` scaffolding. Extend `verification/lean/README.md` Specification Gap section to record what Tier 2 closes vs. what remains, naming `compareDocumentXml_output_recursivelyWellformed` as the single named residual axiom. Update `verification/ROADMAP.md` Tier 2 section to reflect the "preservation + named residual axiom" framing.

## Out of scope (separate future changes)

- **Full field-bearing fast-check arbitrary** extending `packages/docx-core/src/integration/lean-spec-bridge.test.ts` beyond the single fixture-based case landed in 6.1 — opens as `add-field-bearing-bridge-arbitrary` after this change merges.
- **`inv_rt_001` closure** — opens as `add-inv-rt-001-proof`. (Not opportunistically closable here: `extractTextWithParagraphs` and `normalizeText` remain axiomatic, and modeling the field-instruction-vs-result text-display split is a separate complexity cliff.)
- **Discharge of `compareDocumentXml_output_recursivelyWellformed`** by modeling `compareDocumentXml` definitionally — Tier 3 work, opens as `add-compareDocumentXml-definitional-model`.
- **Lean↔TS extensional equivalence** for `accept`/`reject` — opens as `add-accept-reject-lean-ts-equivalence`.
- **Broader `Atom` projection** and broader `Block` shape (non-wrapper descendants per `trackChangesAcceptorAst.ts:411,456,564`) toward the production `ComparisonUnitAtom` — opens as part of Tier 2.5.
