# Change: Add definitional `OoxmlDoc` subset, preservation lemma, and close `inv_field_001`

## Why

PR #164 (Lean 4 verification spike Stages 1–6) merged 2026-05-11, shipping zero-sorry atom-level LCS proofs (Tier 1), a sorry'd `Spec.lean` with two specification targets (Tier 1.5), and the `lean-build` CI gate (Tier 1.6). The in-repo tracker `verification/ROADMAP.md` records Tier 2 as the next step and is explicit that Tier 2 is the first verification step that warrants an OpenSpec change on start:

> "Tier 2 is the first place where the roadmap becomes specification-heavy enough to deserve an OpenSpec change on start."
> "The natural next OpenSpec artifact is not 'verification roadmap'; it is something closer to 'build a definitional `OoxmlDoc` subset and close `INV-FIELD-001` against it.'"

`Spec.lean:66-71` states `inv_field_001` as: for any `(a, b)` with `compareDocumentXml a b = some combined`, `validateFieldStructure` holds on both `acceptAllChanges combined` and `rejectAllChanges combined`. The theorem currently sits over fully uninterpreted axioms.

Peer review (gemini + codex CLI, 2026-05-12) flagged a correctness issue with the naive "close the sorry" framing: the theorem has **no precondition that `validateFieldStructure combined` holds**, so the proof has to either model `compareDocumentXml`'s output structure or carry a well-formedness obligation about it. Independently, `accept`/`reject` can break global `fldChar` balance when a `Del` wrapper subtree carries field-char atoms that have matching partners outside the wrapper. The proposal therefore does the following, in this order:

1. Add a definitional Lean `OoxmlDoc` subset and definitional `accept` / `reject` / `validateFieldStructure`.
2. Define a *recursive* well-formedness predicate `recursivelyWellformed` that the model can reason about per-subtree.
3. Prove a **preservation lemma**: for any `Doc` `d` with `recursivelyWellformed d`, `validateFieldStructure (accept d)` and `validateFieldStructure (reject d)` both hold. This is the core machine-checked content this change ships.
4. Introduce a single, named, load-bearing residual axiom `compareDocumentXml_output_recursivelyWellformed`: for any `(a, b)` with `compareDocumentXml a b = some combined`, `recursivelyWellformed combined`. This axiom is what subsequent Tier 3 work will eventually discharge by modeling `compareDocumentXml` definitionally. The honest empirical support for it in this PR is **one new field-bearing bridge case** added to `packages/docx-core/src/integration/lean-spec-bridge.test.ts` — the existing 100-runs/property bridge cases at `lean-spec-bridge.test.ts:42` explicitly exclude field-bearing inputs and only check the consequence (`validateFieldStructure (accept/reject combined)`), not the stronger recursive precondition itself. The new fixture-based case is a falsifiability layer, NOT a basis for treating the universal axiom as empirically grounded.
5. Use 3 + 4 to **close the `Spec.lean:71` sorry**. `inv_field_001` is no longer `sorry` after this change; the residual obligation lives in a single explicitly-named axiom in `Spec.lean`, not in a hidden hand-wave.

The successor invariant `inv_rt_001` (sorry at `Spec.lean:95`) is explicitly deferred to a future change so this one stays bounded. Tier 2.5 (Lean↔TS extensional equivalence, broader `Atom` projection) and Tier 3 (discharge `compareDocumentXml_output_recursivelyWellformed` by modeling the comparison engine) likewise get their own proposals.

Tracking issue: [#201](https://github.com/UseJunior/safe-docx/issues/201).

## What Changes

- **New `verification/lean/Tier2/` module hierarchy** with:
  - `Tier2/OoxmlModel.lean` — definitional Lean datatypes for a small tree-structured OOXML subset (paragraph list of block list, with `w:ins` / `w:del` / `w:moveFrom` / `w:moveTo` wrappers nested per OOXML; `w:fldChar` / `w:instrText` / `w:delInstrText` modeled as logical atoms inside runs). See `design.md` for the exact shape and rejected alternatives.
  - `Tier2/AcceptReject.lean` — definitional `accept` and `reject` operations mirroring `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:368-659`.
  - `Tier2/FieldStructure.lean` — definitional `validateFieldStructure : Doc → Bool` mirroring `pipeline.ts:352-402` (two checks), plus a recursive `recursivelyWellformed : Doc → Prop` that ALSO requires every `Ins` / `Del` / `MoveFrom` / `MoveTo` wrapper subtree to be `fieldSelfContained` — i.e., when its block list is interpreted as a standalone Doc, the depth / seenSeparator walk both enters and exits at `(depth = 0, seenSeparator = false)`. Codex review caught (in round 1) that without per-subtree balance the preservation lemma is false, and (in round 2) that even per-subtree `validateFieldStructure` is too weak — the counterexample `Begin, Separate, Ins(Del(End, Begin), InstrText), End` passes both whole-doc and per-subtree validation but accepts to invalid output. `fieldSelfContained` rules out wrappers that straddle field boundaries; design.md walks through this.
  - `Tier2/InvFieldOne.lean` — closed proof of the preservation lemma `∀ d, recursivelyWellformed d → validateFieldStructure (accept d) = true ∧ validateFieldStructure (reject d) = true`, plus the corollary that closes `Spec.lean:71`.
  - `Tier2/README.md` — scope, modeling decisions, residual obligations (the new axiom), CI links.
- **`verification/lean/LeanSpike/Spec.lean` rewires:**
  - `axiom OoxmlDoc` becomes `abbrev OoxmlDoc := Tier2.OoxmlModel.Doc`.
  - `axiom acceptAllChanges`, `axiom rejectAllChanges`, `axiom validateFieldStructure` become `def` aliases of the `Tier2` definitions.
  - `axiom compareDocumentXml` **remains axiomatic** (modeling it is Tier 3).
  - `axiom extractTextWithParagraphs`, `axiom normalizeText` **remain axiomatic** (Tier 2.5 / `inv_rt_001` successor change owns them).
  - **NEW** `axiom compareDocumentXml_output_recursivelyWellformed : ∀ a b combined, compareDocumentXml a b = some combined → Tier2.FieldStructure.recursivelyWellformed combined`. This is the single named residual obligation; it is the precise property that subsequent Tier 3 work discharges.
  - The `sorry` at line 71 (`inv_field_001`) is replaced by a proof that composes the new axiom with the Tier 2 preservation lemma.
  - The `sorry` at line 95 (`inv_rt_001`) is untouched.
- **`verification/lean/LeanSpike.lean`** — add `import LeanSpike.Tier2` (or equivalent root re-export from `Tier2/`).
- **`verification/lean/README.md`** — extend the "Specification Gap" / Tier 1.5 sections to record what Tier 2 closes vs. what remains. Explicitly call out `compareDocumentXml_output_recursivelyWellformed` as the new named residual axiom.
- **New field-bearing bridge test** in `packages/docx-core/src/integration/lean-spec-bridge.test.ts` (a single case, not a full fast-check arbitrary) exercising `compareDocumentXml_output_recursivelyWellformed` empirically on a fixture-derived field-bearing input. Codex review (MEDIUM 4) flagged that deferring all field-bearing bridge work leaves the riskiest surface unfalsified.
- **`verification/ROADMAP.md`** — flip the line-3 status block to reflect PR #164 merged and this change in progress; update the Tier 2 section to reflect the "preservation + named residual axiom" framing (so future readers know the closure is honest, not a hand-wave).

## Scope guardrails

- **Inplace-mode comparison output only.** Matches the `Spec.lean:66` precondition and the Tier 1.5 framing in `verification/lean/README.md`.
- **Theorem domain matches `Spec.lean:66` exactly.** Same quantification over `(a b combined : OoxmlDoc)` and the same `compareDocumentXml a b = some combined` premise — no narrower precondition.
- **No `inv_rt_001` closure.** Deferred to a successor change `add-inv-rt-001-proof`.
- **No definitional `compareDocumentXml` and no closure of the new well-formedness axiom.** That work is Tier 3 and will discharge `compareDocumentXml_output_recursivelyWellformed` by modeling the comparison engine. Until then, the axiom is the single named, location-stable residual obligation.
- **No Tier 2.5 work.** Lean↔TS extensional equivalence and broader `Atom` projection get separate proposals.
- **No hierarchical paragraph-level LCS, no reconstruction beyond accept/reject.** `inPlaceModifier.ts` and `documentReconstructor.ts` stay out of scope.
- **No full field-bearing fast-check arbitrary in this change.** Only a single fixture-based field-bearing bridge case — enough to falsify the new axiom if the production engine ever drifts. The full arbitrary is a separate follow-up.

## Impact

- **Affected specs:** `docx-comparison` (one new requirement added — see `specs/docx-comparison/spec.md`).
- **Affected code:** `verification/lean/Tier2/` (new), `verification/lean/LeanSpike/Spec.lean` (axiom rewires + sorry closure), `verification/lean/LeanSpike.lean` (import), `verification/lean/README.md` (docs), `verification/ROADMAP.md` (status + framing), `packages/docx-core/src/integration/lean-spec-bridge.test.ts` (one new test case).
- **No production-engine code changes.** All work is inside `verification/lean/` and the test layer.
- **CI:** the existing `.github/workflows/lean-build.yml` already runs `lake build` and a sorry audit; this change adds new modules to that surface and keeps the audit zero-sorry outside `Spec.lean:95` (`inv_rt_001`, which remains the only remaining sorry). The new field-bearing bridge case runs in the standard workspace-test job.
