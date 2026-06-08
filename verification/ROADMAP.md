# safe-docx Verification — Roadmap

**Status (2026-06-01)**: Stages 1-6 of the Lean 4 verification spike shipped via PR #164 (merged 2026-05-11). Tiers 1, 1.5, and 1.6 are complete. Tier 2 is **complete**: OpenSpec change `add-ooxml-doc-subset-and-inv-field-001-proof` (issue #201) landed the definitional `OoxmlDoc` subset and **closed `inv_field_001`**, and the successor `add-inv-rt-001-proof` **closed `inv_rt_001`** with the same "definitional model + machine-checked lemma + single named residual axiom" shape. The spike is now **zero-`sorry`**, carrying exactly two named residual axioms (`compareDocumentXml_output_preservation_friendly`, `compareDocumentXml_output_text_roundtrip`), both owned by Tier 3. Tier 2.5 / 3 / 3+ remain not started.

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
- The Lean `Atom` projects the LCS-relevant fields of the broader `ComparisonUnitAtom` shape in `packages/docx-core/src/core-types.ts` (`sha1Hash`, `textContent`, `tagName`) and now also carries an LCS-irrelevant field (`correlationStatus`) so the model is faithful: `atomsEqual` correlates atoms *up to their relevant projection*, not up to structural identity.

**Caveats** (already documented in `README.md`):

- Properties of the Lean model, not the TS code. Extensional equivalence Lean ↔ TS is validated empirically (1,194,649 cases on sequences ≤ 6 over a 3-symbol alphabet, zero divergence) but not formally proven. As of the Tier 2.5 first increment this sweep is **reproducible in CI** over the genuine compiled Lean definition — see `add-lean-ts-lcs-differential-harness` and Tier 2.5 below — rather than a one-off external exercise.
- `atomsEqual_implies_eq` (which concluded full `a = b`) has been **retired** by the projection broadening; the soundness proof now uses the weaker `atomsEqual_implies_relevant_eq` (matched atoms agree on `Atom.relevant`, not structurally). See Tier 2.5.

This tier is the tooling-validation layer. It shows that Lean 4 plus mathlib can carry a real proof in this repo without forcing the whole comparison engine into a formal model up front.

## Tier 1.5 — Specification targets + falsifiability layer (COMPLETE)

Specification targets are stated over an uninterpreted Lean signature plus an empirical bridge against the live TS engine. Lives in `verification/lean/LeanSpike/Spec.lean` and `packages/docx-core/src/integration/lean-spec-bridge.test.ts`.

- `INV-FIELD-001` — shipped **sorry'd** in Tier 1.5; **closed in Tier 2** (see below). `Spec.lean`.
- `INV-RT-001` — shipped **sorry'd** in Tier 1.5; **closed in Tier 2** via `add-inv-rt-001-proof` (see below). Paired round-trip text equality under normalization. `Spec.lean`.
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

**Status: COMPLETE.** `inv_field_001` and `inv_rt_001` are both closed; the spike is zero-`sorry` under two named residual axioms.

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
  `pastSeparatorAtDepth: number[]` at `pipeline.ts:525-560`) threaded with a
  structural del-ancestry depth, definitional `validateFieldStructure`
  (`pipeline.ts:496-565`) that now enforces the DeletedFieldCode locality
  constraint (`w:fldChar` barred from `w:del`, `w:delInstrText` confined to it —
  `add-lean-deleted-field-code-constraint`), `fieldContextNeutral`, and the
  recursive precondition `recursivelyWellformed`.
- `Tier2/AcceptReject.lean` — definitional `accept` / `reject` mirroring
  `trackChangesAcceptorAst.ts:368-659`.
- `Tier2/InvFieldOne.lean` — **closed** document-level preservation lemma
  `field_structure_preserved_doc` (zero `sorry`). (The earlier per-subtree
  `field_structure_preserved` and the standalone `WalkLemmas.lean` were retired
  when the DeletedFieldCode constraint falsified their per-step rename-safety
  lemmas; the document-level theorem is non-load-bearing-equivalent and is the
  sole headline.)
- `LeanSpike/Spec.lean` — `OoxmlDoc` / `acceptAllChanges` / `rejectAllChanges` /
  `validateFieldStructure` rewired from `axiom` to the Tier 2 definitions;
  `inv_field_001` closed (after the PR #220 weakening) by composing the
  document-level `field_structure_preserved_doc` with the single named residual
  axiom `compareDocumentXml_output_preservation_friendly`.

The residual axiom asserts that this repo's inplace atomizer output is
`preservationFriendly` (PR #220 weakened it from per-subtree
`recursivelyWellformed`). Discharging it by modeling `compareDocumentXml`
definitionally is Tier 3 work.

`inv_rt_001` (round-trip text equality) was subsequently closed by the successor
change `add-inv-rt-001-proof`, reusing the same shape:

- `Tier2/RoundTripText.lean` — definitional `extractText` / `normalizeText` (per-paragraph
  text as `List Char`) plus `revisedText` / `originalText` projections, and the
  closed lemmas `text_rename_invariant`, `extractText_reject`, and
  `extractText_accept_normalized` (`accept` keeps empty-collapsing paragraphs, whose
  empty text entry is absorbed by `normalizeText`).
- `LeanSpike/Spec.lean` — `extractTextWithParagraphs` / `normalizeText` rewired from
  `axiom` to the Tier 2 definitions; `inv_rt_001` closed by composing those lemmas
  with the single named residual axiom `compareDocumentXml_output_text_roundtrip`.

The spike is now zero-`sorry`. Two named residual axioms remain, both Tier 3:
`compareDocumentXml_output_preservation_friendly` and
`compareDocumentXml_output_text_roundtrip`.

Delivered follow-ups:

- A full field-bearing fast-check arbitrary for the bridge test shipped in
  `add-field-bearing-bridge-arbitrary`.

Still open / deferred:

- Intra-line whitespace-collapse fidelity and Lean↔TS extensional equivalence of
  the text helpers — Tier 2.5.

Tier 2 is the first place where the roadmap becomes specification-heavy enough to deserve an OpenSpec change on start.

## Tier 2.5 — Lean ↔ TS equivalence + projection broadening

**Status: IN PROGRESS** (LCS sub-item CLOSED; three increments landed: reproducible LCS differential harness, the Tier 2-helper accept/reject/validate differential harness, and the formal LCS DP-equivalence proof + `atomsEqual`-level optimality).

This tier sits between "the Lean model is sound" and "the Lean model is faithfully about the production code." It closes the two biggest remaining abstraction gaps from Tier 1.

- **Extensional equivalence LCS Lean ↔ TS DP**: the previously un-reproducible "1.19M cases, zero divergence" brute-force is now a **reproducible, in-CI executable differential harness** (`add-lean-ts-lcs-differential-harness`). The genuine `LeanSpike.computeAtomLcs` is compiled to the `leanDifferential` exe (`verification/lean/Differential.lean`) and run against the production TS `computeAtomLcs` over shared generated inputs by `packages/docx-core/src/integration/lean-differential-lcs.test.ts`; the exhaustive length-≤6 / 3-symbol sweep (1,194,649 pairs, zero divergence) runs in the `lean-build` workflow. The *formal* closure is now **landed** (`add-lean-ts-lcs-dp-equivalence`): `LeanSpike/LcsDP.lean` defines a functional Wagner-Fischer DP — a length recurrence `lcsLen` (`dp[i][j]`) plus a backtracker `dpMatches` — and proves it produces a **byte-identical** `LcsResult` to the recursive `computeAtomLcs` on every input (`computeAtomLcsDP_eq_computeAtomLcs`, via `lcsLen_eq_rawMatches_length` and `dpMatches_eq_rawMatches`), zero-`sorry`. The two tie-break rules reconcile because `(rawMatches _ _).length` satisfies the Wagner-Fischer length recurrence *definitionally*, so the backtracker's length comparison is the same boolean `rawMatches` tests. The differential exe (`Differential.lean`) now also runs `computeAtomLcsDP` and the test asserts DP↔recursive identity across the full 1.19M-pair sweep, a runtime guard over the exact proven functions. This made the alternative "refactor the TS to match the recursive Lean" route unnecessary.
- **Broaden `Atom` projection toward the real `ComparisonUnitAtom`** — **landed**. `LeanSpike.Atom` now carries an LCS-irrelevant field (`correlationStatus`) alongside the relevant `sha1Hash`/`textContent`/`tagName`, with a `Atom.relevant` projection. The overfit `atomsEqual_implies_eq` (`a = b`) is retired in favour of `atomsEqual_implies_relevant_eq` (`a.relevant = b.relevant`); `commonSubseq_drop_equal_heads` was generalized to `commonSubseq_drop_heads` (head-agnostic length bound); and the soundness theorems `rawMatches_subsequence` / `lcs_matches_are_common_subsequence` (INV-LCS-001) now state matched-atom agreement as `.map Atom.relevant` equality. The full spike stays zero-`sorry`. This was the structural prerequisite for the formal DP-equivalence proof (now landed, above). The scope note this surfaced (peer review) is also **resolved**: `rawMatches_are_longest` (INV-LCS-002) bounded only *structural* common subsequences (`s <+ orig ∧ s <+ rev`), strictly weaker than optimality under `atomsEqual` after broadening; `rawMatches_are_longest_relevant` (`LeanSpike/LcsDP.lean`) now strengthens optimality to the `atomsEqual` / `Atom.relevant` level — it bounds every common subsequence of the relevant projections (`orig.map Atom.relevant`, `rev.map Atom.relevant`), using the converse `atomsEqual_of_relevant_eq` to make the projection-equality ↔ `atomsEqual` correspondence exact.

- **Extensional equivalence helpers Lean ↔ TS**: the Tier 2 *helper* differential (`add-lean-ts-helper-differential-harness`) is now **landed** for the three modeled helpers. The genuine `Tier2.AcceptReject.accept`/`.reject` and `Tier2.FieldStructure.validateFieldStructure` compile to the `leanHelperDifferential` exe (`verification/lean/DifferentialHelpers.lean`) and run against the production `acceptAllChanges`/`rejectAllChanges`/`validateFieldStructure` over shared generated `Doc`s by `packages/docx-core/src/integration/lean-differential-helpers.test.ts`, via a `Doc`→`document.xml` adapter and a canonical token projection. The harness surfaced five characterized model gaps (G1–G5); **all five are now closed** to agreement (broadening the Lean `accept` to close G3 surfaced the symmetric engine gap G5, since closed by making the engine accept mark-based — the mirror of the G4 reject fix):
  - **G1 — CLOSED** (`add-lean-deleted-field-code-constraint`): `w:fldChar` inside `w:del`. The Lean field-context walk now carries a structural del-ancestry depth and rejects any `w:fldChar` at depth > 0 (`pipeline.ts:542`), so Lean and TS `validateFieldStructure` both return `false` — agreement.
  - **G2 — CLOSED** (same increment): `w:delInstrText` outside `w:del` is rejected by both (`pipeline.ts:555`); `delInstrText` is confined to a `w:del` ancestor in the Lean model. Closing G1/G2 strengthened `validateFieldStructure` toward the engine's constraint (3) and retired the legacy `field_structure_preserved` whose precondition the constraint vacated.
  - **G3 — CLOSED** (`broaden-lean-accept-keep-empty-paragraphs`, a **Lean** fidelity fix): accept of an `ins`-wrappered paragraph that collapses to empty. The old Lean `accept` over-dropped the paragraph; the TS engine, LibreOffice, and Word all keep an empty `<w:p>` (an untracked paragraph mark is a pre-existing paragraph). Lean `accept` was broadened to never drop (symmetric with `reject`), so the two agree. The inverse of G4.
  - **G4 — CLOSED** (`make-reject-paragraph-collapse-mark-based`, an **engine** fidelity fix): reject of an `ins`-only untracked-mark paragraph. Lean `reject` always kept the empty `<w:p>` (faithful); the TS engine over-deleted it via a content-based heuristic. Reject is now purely mark-based (drop iff the paragraph mark is `PPR-INS`), matching Lean/LibreOffice/Word.
  - **G5 — CLOSED** (`make-accept-paragraph-collapse-mark-based`, an **engine** fidelity fix): accept of a `del`-only untracked-mark paragraph. Lean `accept` always kept the empty `<w:p>` (faithful, once broadened by G3); the TS engine over-deleted it via a content-based heuristic on **both** accept paths (`acceptAllChanges` and the primitive `acceptChanges`). Accept is now purely mark-based (drop iff the paragraph mark is `PPR-DEL`), matching Lean/LibreOffice/Word — the symmetric accept-side mirror of the G4 reject fix. Confirmed by `[LEAN-HELP-08]` (now agreement) plus a targeted both-paths-agree regression over four shapes.
  With G5 closed, every characterized G-case (G1–G5) agrees between the genuine Lean helpers and the production engine; no KNOWN gap remains in this harness. `extractText` / `normalizeText` are **not** modeled in Lean Tier 2 and are deferred to a further increment (`add-lean-ts-text-extraction-differential`).
- **LibreOffice accept/reject oracle voter — LANDED** (`add-libreoffice-accept-reject-oracle`): the paragraph-collapse cases are now validated against a real reference implementation, not just Lean↔TS self-consistency. A committed helper (`packages/docx-core/src/integration/libreoffice-oracle.ts`) drives LibreOffice headless through the native `.uno:Accept/RejectAllTrackedChanges` dispatches (Basic-macro injection; pyuno is blocked on macOS) and a gated voter (`[LEAN-HELP-09..11]`) asserts LibreOffice agrees with the TS engine on paragraph structure: the untracked-mark paragraph is kept (G3/G4/G5), the clean single-level fixtures collapse identically (G4/G5), and a `PPR-INS`/`PPR-DEL`-marked paragraph is dropped. The comparison is structural (paragraph count + emptiness), not the full token projection — LibreOffice rewrites styles and interprets the contrived nested-revision G3 case differently (it keeps the inserted-then-deleted text), a divergence pinned in `[LEAN-HELP-09]` rather than hidden. **Local-only**: gated on a LibreOffice binary; CI does not install one, so it skips there (like `odf-core`'s LibreOffice round-trip).

Rough effort: **2-6 months** combined (the harness above is the first slice).

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
