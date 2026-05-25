# safe-docx Verification — Roadmap

**Status (2026-05-15)**: Stages 1-6 of the Lean 4 verification spike shipped via PR #164 (merged 2026-05-11). Tiers 1, 1.5, and 1.6 are complete. Tier 2 is **in progress**: OpenSpec change `add-ooxml-doc-subset-and-inv-field-001-proof` (issue #201) lands the definitional `OoxmlDoc` subset and **closes `inv_field_001`** as "preservation lemma + single named residual axiom". `inv_rt_001` remains `sorry`'d (deferred to `add-inv-rt-001-proof`); Tier 2.5 / 3 / 3+ remain not started.

## How to use this document

This file is an engineering-internal tracker for verification work next to `verification/lean/`. Updates land through normal PRs. The tiers below are roadmap buckets, not formal release gates, and the estimates are wide error bars against a moving target whose dominant cost is modeling scope rather than theorem-prover keystrokes.

It intentionally sits outside OpenSpec for now. The spike already has a concrete README and a bounded branch; this file tracks what is complete, what remains open, and where the unknowns actually are. When Tier 2 starts for real, the right next artifact is a scoped OpenSpec change for that specific work, not continued expansion of this roadmap.

## Tier 1 — LCS subroutine soundness (COMPLETE)

Zero-sorry, machine-checked. Lives in `verification/lean/LeanSpike/`.

- `INV-ATOMSEQ-001` — hash-collision safety. `AtomsEqual.lean`.
- `INV-LCS-001` — value-level subsequence soundness. `Lcs.lean`.
- `INV-LCS-002` — optimality. `Lcs.lean`.
- `INV-LCS-003` — strict index monotonicity. `Lcs.lean`.
- `INV-LCS-004` — partition completeness. `Lcs.lean`.

What this tier establishes:

- The Lean model of the atom-level LCS is internally sound on its own terms.
- The Stage 1-3 proof modules remain the zero-sorry part of the spike.
- The proof surface is deliberately narrow: atom equality plus the inner LCS subroutine, not the surrounding OOXML reconstruction engine.

Relevant implementation framing already lives in `verification/lean/README.md`.

- The Lean LCS is an alternate executable specification of `packages/docx-core/src/baselines/atomizer/atomLcs.ts:45-104`, not a line-for-line port of the TS DP table and backtracking logic.
- The current Lean `Atom` is a 3-field projection of the broader `ComparisonUnitAtom` shape in `packages/docx-core/src/core-types.ts`.

**Caveats** (already documented in `README.md`):

- Properties of the Lean model, not the TS code. Extensional equivalence Lean ↔ TS is validated empirically (1.19M cases on sequences ≤ 6 over a 3-symbol alphabet, zero divergence) but not formally proven.
- `atomsEqual_implies_eq` holds only because `Atom` is projected to 3 fields; it would break under a broader projection toward the real `ComparisonUnitAtom`.

This tier is the tooling-validation layer. It shows that Lean 4 plus mathlib can carry a real proof in this repo without forcing the whole comparison engine into a formal model up front.

## Tier 1.5 — Specification targets + falsifiability layer (COMPLETE)

Specification targets are stated over an uninterpreted Lean signature plus an empirical bridge against the live TS engine. Lives in `verification/lean/LeanSpike/Spec.lean` and `packages/docx-core/src/integration/lean-spec-bridge.test.ts`.

- `INV-FIELD-001` — shipped **sorry'd** in Tier 1.5; **closed in Tier 2** (see below). `Spec.lean`.
- `INV-RT-001` — **sorry'd**. Paired round-trip text equality under normalization. `Spec.lean`.
- fast-check bridge — empirically exercises both invariants at 100 runs/property against the live TS engine, gated on `reconstructionModeUsed === 'inplace'`. 0 falsifications to date. Tier 2 adds one field-bearing fixture case as a falsifiability layer for the Tier 2 residual axiom.

This tier is intentionally not a proof claim about the production engine. It is a named specification surface plus a falsifiability layer over live runtime behavior. The TS evidence motivates the targets, but it does not justify universal Lean theorems while `Spec.lean` is still an uninterpreted axiom surface.

Current code surfaces mirrored by the Tier 1.5 targets:

- `validateFieldStructure` in `packages/docx-core/src/baselines/atomizer/pipeline.ts:352-402`.
- `acceptAllChanges` and `rejectAllChanges` in `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:368-659`.
- `extractTextWithParagraphs` in `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:660-688`.
- `normalizeText` in `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:701-711`.

Coverage limits:

- field-free synthetic inputs only
- inplace-mode comparison output only
- empirical evidence only, not a closed proof
- small-edit and run-boundary behavior still relies on fixture coverage in `packages/docx-core/src/integration/round-trip-inplace.test.ts` and `packages/docx-core/src/integration/nvca-coi-regression.test.ts`

Tier 1.5 is useful because it gives future Tier 2 work precise named targets. It should not be described as more than that.

## Tier 1.6 — CI gate (COMPLETE)

`lean-build` GitHub Actions job invoking `lake build` in `verification/lean/`. Purpose: prevent silent rot on Lean toolchain or mathlib bumps.

Status: Stage 6 of the spike shipped on PR #164. Single workflow file at `.github/workflows/lean-build.yml`, mathlib build-cache via `actions/cache` keyed on `lean-toolchain` + `lake-manifest.json` (no OS-only prefix fallback — see workflow comment for the rationale), `lake exe cache get` is treated as authoritative rather than best-effort. First green run on the GitHub runner: 5m14s cold cache. Currently informational; flip to required via Settings → Branches → main after merge.

This tier is operational, not mathematical. It does not expand proof scope; it preserves the value of Tier 1 and Tier 1.5 by making toolchain regressions visible in normal PR flow.

## Tier 2 — Definitional `OoxmlDoc` model + closed proof of `inv_field_001`

**Status: IN PROGRESS.** `inv_field_001` is closed; `inv_rt_001` deferred.

OpenSpec change `add-ooxml-doc-subset-and-inv-field-001-proof` (issue #201)
replaces the uninterpreted document-level axioms with a definitional Lean model
of a tractable OOXML subset and **closes `inv_field_001`**. The closure is framed
as **"machine-checked preservation lemma + single named residual axiom"**, not a
discharge of the comparison engine: the proof is honest about exactly one
remaining assumption rather than hiding it in a hand-wave.

Delivered:

- `Tier2/OoxmlModel.lean` — definitional datatypes for a tree-structured OOXML
  subset: paragraphs, runs, `ins`/`del`/`moveFrom`/`moveTo` wrappers, and
  `w:fldChar` / `w:instrText` / `w:delInstrText` field atoms.
- `Tier2/FieldStructure.lean` — the stack-valued field-context walk (mirroring
  `pastSeparatorAtDepth: number[]` at `pipeline.ts:374-389`), definitional
  `validateFieldStructure` (`pipeline.ts:352-402`), `fieldContextNeutral`, and
  the recursive precondition `recursivelyWellformed`.
- `Tier2/WalkLemmas.lean` — generic walk lemmas (`walkBlocks_append`,
  context-neutral no-op, `neutral_balanced`, `delInstrText` rewrite-safety).
- `Tier2/AcceptReject.lean` — definitional `accept` / `reject` mirroring
  `trackChangesAcceptorAst.ts:368-659`.
- `Tier2/InvFieldOne.lean` — **closed** preservation lemma
  `field_structure_preserved` (zero `sorry`).
- `LeanSpike/Spec.lean` — `OoxmlDoc` / `acceptAllChanges` / `rejectAllChanges` /
  `validateFieldStructure` rewired from `axiom` to the Tier 2 definitions;
  `inv_field_001` closed by composing `field_structure_preserved` with the single
  named residual axiom `compareDocumentXml_output_recursivelyWellformed`.

The residual axiom asserts that this repo's inplace atomizer output is
`recursivelyWellformed`. Discharging it by modeling `compareDocumentXml`
definitionally is Tier 3 work.

Still open in Tier 2 / deferred:

- `inv_rt_001` — paragraph round-trip text equality. Deferred to the
  `add-inv-rt-001-proof` successor change (`extractTextWithParagraphs` and
  `normalizeText` stay axiomatic until then).
- A full field-bearing fast-check arbitrary for the bridge test — only one
  fixture case ships here; the arbitrary opens as `add-field-bearing-bridge-arbitrary`.

Tier 2 is the first place where the roadmap becomes specification-heavy enough to deserve an OpenSpec change on start.

## Tier 2.5 — Lean ↔ TS equivalence + projection broadening

**Status: NOT STARTED.**

This tier sits between "the Lean model is sound" and "the Lean model is faithfully about the production code." It closes the two biggest remaining abstraction gaps from Tier 1.

- **Extensional equivalence LCS Lean ↔ TS DP**: currently validated only by exhaustive brute-force on small inputs. Closing this requires either a proof that the recursive Lean LCS and the iterative TS Wagner-Fischer DP produce the same output set, or a refactor of the TS to a structure where equivalence is direct.
- **Broaden `Atom` projection toward the real `ComparisonUnitAtom`**: the current 3-field model is enough for Tier 1 but narrower than production. Once broadened, `atomsEqual_implies_eq` breaks and must be replaced by a weaker lemma keyed on the LCS-relevant subset; the LCS proof's equality branch then has to be rewired around that weaker result.

Rough effort: **2-6 months** combined.

This tier is optional from the perspective of "Lean proves something." It is not optional from the perspective of "Lean proves the right thing about the right implementation surface."

## Tier 3 — Reconstruction invariants (the bug-class layer)

**Status: NOT STARTED.**

The bug classes from issues #106, #110, #111, #76, and #65 live in the reconstruction path, not the LCS subroutine. Tier 3 is the verification layer that would actually prevent those bug classes by stating and proving invariants over the reconstruction pipeline itself.

Likely sub-invariants:

- bookmark preservation through accept/reject (relates to #106)
- comment thread preservation including ancillary parts (`comments.xml`, `commentsExtended.xml`, `people.xml`) (relates to #108)
- footnote balance preservation (relates to #110 and #111)
- numbering reference validity post-reconstruction
- field-structure preservation under broader inputs than the Tier 2 `INV-FIELD-001` surface, which is inplace-mode only

Production-side code under verification:

- `packages/docx-core/src/baselines/atomizer/pipeline.ts` — top-level pipeline and safety checks
- `packages/docx-core/src/baselines/atomizer/inPlaceModifier.ts` — inplace reconstruction
- `packages/docx-core/src/baselines/atomizer/documentReconstructor.ts` — rebuild reconstruction
- `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts` — accept/reject of tracked changes

Why Tier 3 is hard:

- The hard part is OOXML modeling and auxiliary-parts merge semantics, not whether Lean can express an inductive proof.
- The invariants cross file boundaries and output artifacts rather than staying inside a small pure subroutine.
- The code surface is broader and more stateful than the atom-level LCS model.

Rough effort: **1.5-3 years.** None of it is Lean-hard in the narrow sense; the work scales with document-shape semantics and merge logic more than with proof script length.

## Tier 3+ — Full engine verification

**Status: NOT STARTED.**

Covers the parts of the engine the spike never touched: hierarchical paragraph-level LCS, the atomizer pipeline, ancillary-parts merge logic, and the engine's continuing feature surface. At this point verification is chasing a live production system, not a bounded spike artifact.

Rough additional effort beyond Tier 3: **2-4 years.**

The cost driver here is engine evolution. Even a correct proof target today can drift as new comparison features or document-shape repairs are added.

## How estimates were calibrated

- The original spike was time-boxed at 6 weeks.
- Stages 1-5 actually shipped in roughly 5-6 elapsed days of intermittent agent-driven work.
- That pace surprise may not generalize.

Why it may not generalize:

- Tier 1 hit a well-trodden mathlib path: list sublist soundness plus a classical Wagner-Fischer style result.
- Tier 2 and Tier 3 do not have the same shape; they are dominated by modeling choices that can be either elegant or disastrous depending on boundary decisions.
- AI agent capability is improving, so any estimate beyond a few months is partly a forecast about tooling, not just about the repo.

The roadmap therefore uses wide error bars such as **4-12 months** instead of point predictions. Those ranges are meant to communicate uncertainty, not precision.

## Why this is not (yet) an OpenSpec change

OpenSpec change proposals are the right vehicle once Tier 2 is actually being worked on. They force scope clarity and design review around a concrete definitional model. Right now Tier 2 is still not started, and the spike itself is already bounded and documented in `verification/lean/README.md`.

For the current state, a lightweight roadmap is sufficient. The natural next OpenSpec artifact is not "verification roadmap"; it is something closer to "build a definitional `OoxmlDoc` subset and close `INV-FIELD-001` against it."
