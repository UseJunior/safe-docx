# Change: Lean↔TS Tier 2-helper differential harness (Tier 2.5, second increment)

## Why

The first Tier 2.5 increment (`add-lean-ts-lcs-differential-harness`, merged) made the Lean↔TS **LCS** equivalence a reproducible in-CI gate by running the genuine `LeanSpike.computeAtomLcs` against the production TS `computeAtomLcs`. The named successor it deferred is this change: extend the same differential-execution discipline to the **Tier 2 track-change helpers** the spike actually models — `Tier2.AcceptReject.accept` / `.reject` and `Tier2.FieldStructure.validateFieldStructure` (`verification/lean/Tier2/`) — against the production engine `acceptAllChanges` / `rejectAllChanges` / `validateFieldStructure` (`packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts`, `pipeline.ts`).

The Tier 2 definitions claim to "mirror the production engine structurally rather than abstractly" (`Tier2/OoxmlModel.lean:5-7`). Today nothing executes that claim: the only check is the Lean-internal `inv_field_001` proof, which says the *model* is sound, not that the *model matches the code*. The LCS harness closed that gap for one surface; this closes it for the accept/reject/validate surface — the surface the headline `inv_field_001` theorem is actually about.

### What the helper surface needs that LCS did not — the `Doc`→`document.xml` adapter

The TS LCS took a plain atom array, so the harness fed both sides the same JSON. The helpers take a serialized **`document.xml` string** (`acceptAllChanges(documentXml: string): string`). So this increment must add a faithful **`Doc`→`document.xml` renderer**: the same abstract `Tier2.OoxmlModel.Doc` value (paragraphs → blocks → runs → atoms, with `ins`/`del`/`moveFrom`/`moveTo`/`other` wrappers) is encoded as JSON for the Lean executable AND rendered to OOXML for the production engine. Because the Lean helpers return a structured `Doc` while the TS helpers return an XML string, the harness compares on a **canonical token projection** both outputs reduce to deterministically — not fragile string equality.

### Model-vs-engine gaps this surfaced (verified against the running engine)

Dynamic probes against the real engine (and the peer review of this change) confirmed four places where the Lean Tier 2 model and the production engine genuinely disagree — exactly the findings a differential exists to produce:

- **G1 — `w:fldChar` inside `w:del`.** TS `validateFieldStructure` returns **false** (`pipeline.ts:542`, the `insideDelDepth > 0` guard); the Lean `validateFieldStructure` walks transparently through `del` and returns **true** (`FieldStructure.lean:82-90`). The Lean model implements constraints (1) global begin/end balance and (2) instr-inside-open-field, but **not** constraint (3) field-chars-not-inside-`del`.
- **G2 — `w:delInstrText` outside `w:del`.** In an open pre-`separate` field but not inside a `del` wrapper, TS returns **false** (`pipeline.ts:555`); Lean returns **true** (`stepAtom` checks only the separator bit, `FieldStructure.lean:68-71`).
- **G3 — accept paragraph collapse.** A paragraph whose accepted body is empty *but which contained a `w:ins`/`w:moveTo` wrapper* is **kept** as an empty `<w:p>` by TS (the `if (insElements.length > 0) continue` skip, `trackChangesAcceptorAst.ts:399`) but **dropped** by Lean `accept` (`AcceptReject.lean:44`). The common del-only and empty-run cases agree.
- **G4 — reject paragraph collapse.** An `w:ins`-only paragraph is **dropped** by TS `rejectAllChanges` (`trackChangesAcceptorAst.ts:536-578`) but **kept** as an empty `<w:p>` by Lean `reject`, which never drops paragraphs (`AcceptReject.lean:83-85`). This is the reject-side analog of G3; surfaced by the peer review.

These are real characterized limitations of the current Lean model, not harness bugs. This change does **not** fix them in the proved modules (that touches the `inv_field_001` proof and belongs to a later proof increment); it **pins them down**: the strict-equality gate generates within the faithful subset where Lean and TS provably agree, and dedicated **characterization cases** assert each divergence (G1/G2/G3/G4) so the gap is over-disclosed and rot-proof rather than hidden — and becomes the concrete worklist for broadening the model.

## What Changes

- **New Lean executable `verification/lean/DifferentialHelpers.lean`** + `@[default_target] lean_exe leanHelperDifferential` in `verification/lean/lakefile.lean`. It reads a batched JSON document `{ "cases": [ { "doc": <Doc> } ] }` from stdin, runs `Tier2.FieldStructure.validateFieldStructure`, `Tier2.AcceptReject.accept`, and `Tier2.AcceptReject.reject` on each `Doc`, and emits `{ "results": [ { "validate": Bool, "accept": <Doc>, "reject": <Doc> } ] }` to stdout — one spawn amortized over the whole batch. Local `FromJson`/`ToJson` instances for the `OoxmlModel` datatypes keep the proved Tier 2 modules pristine. Plain executable code, no `sorry`; the zero-`sorry` audit stays green.
- **New TS harness `packages/docx-core/src/integration/lean-differential-helpers.test.ts`** (vitest, `.openspec()` tags + `TEST_FEATURE`). It contains:
  - a `fast-check` arbitrary producing `Doc` values **within the faithful subset** (`fldChar`/`instrText` only outside track-change wrappers; `delInstrText` only in its one OOXML-legal home inside `del`, in an open pre-separate field, where both engines agree; every paragraph keeps surviving top-level content so accept-collapse cannot trigger G3);
  - a **`renderDocToXml(doc)`** adapter emitting a real `document.xml` string (parseable by the engine's `@xmldom/xmldom` path) and a parallel JSON encoder for the Lean executable;
  - a **canonical token projection** `docToTokens` / `xmlToTokens` so the Lean output `Doc` and the TS output XML are compared on one normal form;
  - the gate: for each generated `Doc`, assert `validate`, `accept`, and `reject` agree between the spawned Lean exe and the in-process TS helpers;
  - **characterization cases** [G1]/[G2]/[G3]/[G4] asserting the *known* divergences, so the limitations are tested rather than merely documented;
  - a skip-if-exe-absent gate (dev without the Lean toolchain still gets a green `npm test`); CI builds the exe so the gate is live.
- **CI wiring in `.github/workflows/lean-build.yml`.** Add the new harness file (and the production helper sources `trackChangesAcceptorAst.ts`, `pipeline.ts`) to the `push`/`pull_request` `paths:` triggers, and a scoped run of the new test after `lake build`, reusing the Node setup the LCS harness added.

## Scope guardrails

- **Modeled helpers only.** `accept` / `reject` / `validateFieldStructure` — the three the spike actually defines. `extractTextContent` / `extractTextWithParagraphs` / `normalizeText` are **not** modeled in Lean Tier 2; covering them would require new Lean definitions and is deferred to a further increment (named `add-lean-ts-text-extraction-differential`).
- **No production-engine changes and no proof changes.** `trackChangesAcceptorAst.ts` / `pipeline.ts` are read, never edited. The Tier 2 proved modules are not modified; G1/G2/G3/G4 are characterized, not fixed.
- **Strict equality on the faithful subset.** Divergences inside the subset are genuine findings (a real harness failure to investigate), not a reason to weaken the assertion. The four known out-of-subset gaps are asserted explicitly as characterization cases.

## Impact

- **Affected specs:** `docx-comparison` (one new ADDED requirement — see `specs/docx-comparison/spec.md`).
- **Affected code:** `verification/lean/DifferentialHelpers.lean` (new), `verification/lean/lakefile.lean`, `packages/docx-core/src/integration/lean-differential-helpers.test.ts` (new), `.github/workflows/lean-build.yml`. `verification/ROADMAP.md` updated to mark the Tier 2.5 second increment in progress and record G1/G2/G3/G4 as characterized model gaps.
- **No production-engine code changes.**
- **CI:** the new test runs inside the `lean-build` workflow (already provisions elan + the mathlib cache + Node from the LCS increment). `npm run check:spec-coverage` must continue to pass once the new requirement's scenarios are mapped via `.openspec()` tags; the test file declares `const TEST_FEATURE` so the `allure-labels` gate is satisfied.
- **Runtime:** default mode adds one `fast-check` property at ~2,000 random `Doc`s (plus seeds) with the Lean exe spawned once per memory-bounded chunk; `LEAN_DIFF_EXHAUSTIVE=1` widens this to ~50,000 reproducible random `Doc`s — a larger randomized sweep, NOT exhaustive enumeration (the `Doc` grammar makes true enumeration impractical, so it is deliberately not claimed).
