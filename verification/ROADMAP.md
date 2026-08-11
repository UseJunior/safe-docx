# safe-docx Verification — Roadmap

**Status (2026-06-01)**: Stages 1-6 of the Lean 4 verification spike shipped via PR #164 (merged 2026-05-11). Tiers 1, 1.5, and 1.6 are complete. Tier 2 is **complete**: OpenSpec change `add-ooxml-doc-subset-and-inv-field-001-proof` (issue #201) landed the definitional `OoxmlDoc` subset and **closed `inv_field_001`**, and the successor `add-inv-rt-001-proof` **closed `inv_rt_001`** with the same "definitional model + machine-checked lemma + single named residual axiom" shape. The spike is now **zero-`sorry`**, carrying exactly two named residual axioms (`compareDocumentXml_output_preservation_friendly`, `compareDocumentXml_output_text_roundtrip`), both owned by Tier 3. Tier 2.5 / 3 / 3+ remain not started.

**Direction update (2026-07-07)**: rather than treat Tier 3 (universal discharge of the two axioms) as the sole next climb, the work now runs a parallel **verified-checker (translation-validation) architecture** plus a trust/demo packaging track — see "Direction change (2026-07-07)" below. The first OpenSpec change on this track is `add-invariant-registry-and-axiom-audit` (Increment 1: machine-readable invariant registry + a `#print axioms` CI gate that pins the axiom allowlist — the two residual obligations, the `compareDocumentXml` signature axiom, and Lean's standard trusted axioms).

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
- `INV-RT-001` — shipped **sorry'd** in Tier 1.5; **closed in Tier 2** via `add-inv-rt-001-proof` (see below). Paired round-trip text equality under normalization, stated **projection-to-projection** as of #347: accept-all of `combined` recovers accept-all of the revised input, and reject-all of `combined` recovers reject-all of the original input. (The original statement compared against the inputs' *raw* extracted text, which counts both `w:t` and `w:delText` and is neither projection once an input carries its own tracked changes — it was falsified by construction on pre-tracked inputs and forced spurious inplace→rebuild fallbacks, #339.) The TS safety-check baselines in `pipeline.ts`, the Lean axiom/theorem, and the bridge test's assertion surface all encode the corrected law; the law constrains *text* projections only, not the raw mixed-revision markup or author provenance. `Spec.lean`. As of #793 the projection counts `w:t`, `w:delText` **and `w:sym`** (resolved to its `@w:char` codepoint, font excluded); before that a lost `w:sym` glyph left the law satisfied while the glyph was gone, and the two legal spellings of one glyph — literal private-use codepoint versus canonical `w:sym` — falsified it on a purely notational rewrite. The Lean model moved with it: `Tier2.OoxmlModel.Atom` gained a `sym` constructor carrying the resolved character, so `Tier2.RoundTripText.extractText` still mirrors the production projection definitionally. `sym` has no deleted-content counterpart (there is no `w:delSym`), so `renameAtom` leaves it alone and both round-trip lemmas close unchanged — the axiom inventory is identical. Element classes still outside the projection are enumerated in the `INV-RT-001` caveats in `verification/registry/invariants.json`; losing one of those leaves a green round trip, which is what #798 tracks.
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
  With G5 closed, every characterized G-case (G1–G5) agrees between the genuine Lean helpers and the production engine; no KNOWN gap remains in this harness. `extractText` / `normalizeText` are modeled definitionally in `Tier2/RoundTripText.lean` but are **not** yet covered by this executable differential; that increment (`add-lean-ts-text-extraction-differential`) gained weight with #347, which states INV-RT-001 projection-to-projection and makes the engine's safety baselines consume `extractTextWithParagraphs ∘ accept/rejectAllChanges` of the raw inputs — the text helpers now sit on the fallback-decision path for pre-tracked inputs, not just on the check of the candidate. (The #347 bridge relaxation also pinned two engine bug classes on this surface, #358 and #359 — pre-tracked insertion provenance lost across comparison — as G-case-style characterization tests in `lean-spec-bridge.test.ts`.)
- **LibreOffice accept/reject oracle voter — LANDED** (`add-libreoffice-accept-reject-oracle`): the paragraph-collapse cases are now validated against a real reference implementation, not just Lean↔TS self-consistency. A committed helper (`packages/docx-core/src/integration/libreoffice-oracle.ts`) drives LibreOffice headless through the native `.uno:Accept/RejectAllTrackedChanges` dispatches (Basic-macro injection; pyuno is blocked on macOS) and a gated voter (`[LEAN-HELP-09..11]`) asserts LibreOffice agrees with the TS engine on paragraph structure: the untracked-mark paragraph is kept (G3/G4/G5), the clean single-level fixtures collapse identically (G4/G5), and a `PPR-INS`/`PPR-DEL`-marked paragraph is dropped. The comparison is structural (paragraph count + emptiness), not the full token projection — LibreOffice rewrites styles and interprets the contrived nested-revision G3 case differently (it keeps the inserted-then-deleted text), a divergence pinned in `[LEAN-HELP-09]` rather than hidden. **Local-only**: gated on a LibreOffice binary; CI does not install one, so it skips there (like `odf-core`'s LibreOffice round-trip). The oracle's **trust boundary** is itself characterized (`libreoffice-oracle-trust-boundary.test.ts`, `[LO-ORACLE-TRUST-01..04]`, #362): accept/reject text+shape is trustworthy even for stacked multi-author and nested del-in-ins inputs (the dispatch resolves changes BEFORE LibreOffice saves), but the plain save round-trip drops the `<w:ins>` wrapper of a FULLY-deleted insertion (upstream filing tracked in #346) so it must never be used to validate that shape, and the structural projection is formatting-blind by design (formatting fidelity is #363's oracle).

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

## Direction change (2026-07-07): verified-checker architecture + a trust/demo track

Everything above frames assurance as a climb up the tiers: prove more of the engine, discharge the residual axioms, chase the bug-class layer. That climb is real but slow — Tier 3 alone is a 1.5–3 year modeling effort against a moving target, and none of it is visible to a developer or AI lab deciding whether to trust the MCP/CLI tools. This section records a second, parallel direction adopted to maximize assurance-per-effort *and* legibility: a verified-checker (translation-validation) architecture, plus the packaging that turns existing proofs into something an evaluator can see.

Two facts drive it:

1. **The engine already runs closely related checks at runtime — but they are the theorems' *conclusions*, not the axioms' *premises*.** `evaluateSafetyChecks` (`packages/docx-core/src/baselines/atomizer/pipeline.ts`) runs accept-all/reject-all, field-structure validation of the accepted/rejected output, and accept/reject text round-trip comparisons on every inplace candidate. Those are (close to) the conclusions of `inv_field_001`/`inv_rt_001`. What the residual axioms actually assert — `preservationFriendly combined` and the `revisedText`/`originalText` projection equalities (`Spec.lean`) — is **not** currently computed. The checker increment therefore *adds* those premise checks (the plumbing to attach them cheaply exists); it does not merely relabel today's checks. Nothing today connects any runtime check to the machine-checked lemmas.
2. **The MCP edit tools ride a second, unmodeled accept/reject engine.** `packages/docx-core/src/primitives/{accept,reject}_changes.ts` — the paragraph-mark/merge path that `insert_paragraph` and the other MCP write tools actually exercise — is neither in the Lean model nor differentially tested against it. The tools most agents call sit outside the verified surface.

### The verified checker (translation validation)

Rather than model `compareDocumentXml` definitionally (Tier 3 as conceived above), prove an **axiom-free** theorem about a small executable checker and run it on every real output:

> `checker_sound : ∀ (a b combined : Doc), comparisonCheckerB a b combined = true → validateFieldStructure (accept combined) ∧ validateFieldStructure (reject combined) ∧ normalizeText (extractText (accept combined)) = normalizeText (extractText (accept b)) ∧ normalizeText (extractText (reject combined)) = normalizeText (extractText (reject a))`

`comparisonCheckerB` is a decidable `Bool`-valued conjunction of exactly the axioms' premises: `preservationFriendly combined` (its conjuncts in `Tier2/AcceptReject.lean` are already decidable equalities over `walkBlocks`/`countBlocks`) and the two `revisedText`/`originalText` projection equalities from `Spec.lean` (decidable). Note these premise checks are **new runtime work** — today's `evaluateSafetyChecks` computes the theorems' conclusions, not these premises (see fact 1 above). The proof composes already-closed lemmas (`field_structure_preserved_doc`, `extractText_reject`, `extractText_accept_normalized`), so `#print axioms checker_sound` shows **no residual-obligation axiom**. Running the checker on a real output replaces the two axioms, *for that document*, with the runtime check actually passing. This delivers per-document instances of exactly what Tier 3 would prove universally — and covers wild documents the definitional model would never parse — at a fraction of the cost. Discharging the axioms universally (Tier 3) is not abandoned; it is demoted below the checker, and the honest residual the checker does *not* guard (the rebuild-fallback path) is called out as its own future checker.

### The honest four-tier taxonomy

Every generated trust artifact carries this taxonomy verbatim; no artifact may collapse tiers. It is itself the differentiator against competitors who say "battle-tested."

1. **Proven** (model-internal, no assumptions beyond Lean+mathlib): the LCS family + DP equivalence.
2. **Proven modulo one named axiom**: INV-FIELD-001, INV-RT-001 — or, once the checker ships, "proven, with the premise established per-document at runtime."
3. **Empirically validated** (deterministic differential / property test): Lean↔TS extensional equivalence (the 1.19M-pair sweep, the helper differential with G1–G5 closed, the fast-check bridge, the local-only LibreOffice oracle).
4. **Tested-only / unverified**: rebuild-fallback mode, ancillary parts (bookmarks/comments/footnotes), formatting, rendering (Tier 3/3+ above).

### Interleaved increment sequence

Proof and packaging interleave so every public artifact ships with the strongest proof backing available at that point, and the demo lands mid-sequence. Each increment is one OpenSpec change + PR.

- **Inc 1 — LANDED — Invariant registry + `#print axioms` CI gate** (packaging; no new proofs). `verification/registry/invariants.json` (mirroring `spec-compliance/registry/`) as the source of truth — per invariant: ID, plain-English statement, tier, exact Lean theorem name + file, production surface mirrored, residual axioms, scope caveats, and the **falsifier** (the CI job/test that fails if the claim breaks). A new `verification/lean/AxiomAudit.lean` + a `lean-build.yml` step that runs `#print axioms` on the flagship theorems and diffs the observed union against a committed allowlist `verification/lean/expected-axioms.txt` — the two residual-obligation axioms, the uninterpreted signature axiom `LeanSpike.compareDocumentXml` (the engine function itself is declared as an `axiom`; verified by running `#print axioms` on the current spike), and Lean's `propext`/`Classical.choice`/`Quot.sound` — closing the gap where a future PR could silently add another axiom; plus a `schedule:` trigger, since the workflow is path-filtered today. Generated `verification/INVARIANTS.md` via a `scripts/generate_invariants_doc.mjs` cloned from `scripts/generate_conformance_doc.mjs`, drift-checked by `check:invariants-doc`. **This is the first OpenSpec change spun up: `add-invariant-registry-and-axiom-audit`.**
- **Inc 2 — Verified comparison checker** (proof). `Tier2/Checker.lean` (`comparisonCheckerB` + axiom-free `checker_sound`); a compiled `leanChecker` exe on the `DifferentialHelpers.lean` wire pattern; a TS mirror in `evaluateSafetyChecks` emitting a `certificate` field on `CompareResult`, differential-validated against the exe.
- **Inc 3 — Per-save verification certificate** (packaging; needs 1+2). A `verification` block on the `save` tool response (`packages/docx-mcp/src/tools/save.ts`) and the compare CLI: which runtime checks ran, `engine_mode`, and per-invariant `{ tier, applies, note }` where `applies` is *computed* from `trackedReconstructionMode === 'inplace'`, not asserted. No `verified: true` boolean anywhere.
- **Inc 4 — One-command red-team demo** (packaging; needs 3). `packages/docx-mcp/src/cli/commands/verify_demo.ts`: a silent edit is refused by the AI-revision guard; the tracked edit lands and prints the certificate; a Node-only replay of INV-RT-001 on the demo's own redline; the invariant table + repro commands. Best single demo for an AI-lab audience.
- **Inc 5 — MCP no-silent-mutation certificate + primitives-engine differential** (proof; the flagship product law). Add `PPr.mark` to `Tier2/OoxmlModel.lean` (paragraph-mark revisions `insert_paragraph` emits), extend `accept`/`reject`, re-prove the preservation and round-trip lemmas (paragraph-merge shown walk-invariant is the one real new obligation); run the primitives-side engine against the same Lean spec three-way alongside the atomizer helpers; a runtime `tokenProjection(rejectAll(after)) = tokenProjection(rejectAll(before))` certificate in `preflightAiRevisionMutation` (`packages/docx-mcp/src/tools/ai_revision_guard.ts`).
- **Inc 6 — Flagship theorem INV-EDIT-001** (proof; needs 5). `Tier2/EditOps.lean` models the MCP edit ops and proves perfect revertability (`tokenProjection (reject (applyOps ops d)) = tokenProjection (reject d)`), by construction per-op then folded over sequences.
- **Inc 7 — Trust surface** (packaging; needs 1, generates from it). `site/src/trust/verification.njk` + a card, fed from the registry via a `generate_trust_metrics.mjs` sibling (lead with the G4/G5 "verification found real engine bugs" narrative); an `AUTO-GENERATED` "Machine-checked invariants" README block synced by `scripts/sync_readme_blocks.mjs`; `verification/AUDIT.md` ("verify this in 10 minutes"). Problem-first, undersell — state the unverified Tier 3/3+ remainder in the same breath.

**Deferred, gated on data:** definitional `compareDocumentXml` (Tier 3 above) and broad OOXML model widening. Model-coverage telemetry from Incs 2–5 (parse-into-`Doc` rate, checker pass rate on the real-doc corpus) turns "widen toward bookmarks/comments/footnotes next?" into a measured decision; those invariants should enter as decidable checker conjuncts with small preservation lemmas (e.g. `checkRangePairs` in `validate_ai_revisions.ts` is already the runtime half), not deep model widenings.

Dependency graph:

```
Inc1 (registry + axiom gate) ─► Inc2 (verified checker) ─► Inc3 (save certificate) ─► Inc4 (verify-demo)
Inc1 ───────────────────────────────────────────────────────────────────────────────► Inc7 (site/README/audit)
Inc2 ─► Inc5 (pPr marks + 3-way differential + no-silent-mutation cert) ─► Inc6 (INV-EDIT-001)
Deferred: definitional compareDocumentXml, broad model widening — gated on corpus/telemetry data
```

This direction keeps the OpenSpec-per-work-item discipline the rest of the roadmap already assumes: Inc 1 is scaffolded as `add-invariant-registry-and-axiom-audit`, and each later increment gets its own change when its work begins.

## How estimates were calibrated

- The original spike was time-boxed at 6 weeks.
- Stages 1-5 actually shipped in roughly 5-6 elapsed days of intermittent agent-driven work.
- That pace surprise may not generalize.

Why it may not generalize:

- Tier 1 hit a well-trodden mathlib path: list sublist soundness plus a classical Wagner-Fischer style result.
- Tier 2 and Tier 3 do not have the same shape; they are dominated by modeling choices that can be either elegant or disastrous depending on boundary decisions.
- AI agent capability is improving, so any estimate beyond a few months is partly a forecast about tooling, not just about the repo.

The roadmap therefore uses wide error bars such as **4-12 months** instead of point predictions. Those ranges are meant to communicate uncertainty, not precision.

## Why this roadmap is not itself an OpenSpec change

This file stays a lightweight engineering-internal tracker; OpenSpec change proposals are the per-work-item vehicle. That pattern has already run its course once — Tier 2 was scoped and closed through `add-ooxml-doc-subset-and-inv-field-001-proof` and `add-inv-rt-001-proof`, exactly as the original version of this section predicted — and it continues under the 2026-07-07 direction change: each increment gets its own OpenSpec change when its work begins, starting with `add-invariant-registry-and-axiom-audit` (Increment 1). The roadmap records direction and status; the changes carry the reviewable scope.
