# Change: Reproducible Lean↔TS LCS differential harness (Tier 2.5, first increment)

## Why

The Lean spike is zero-`sorry`: both `inv_field_001` and `inv_rt_001` are closed against a definitional `OoxmlDoc` model, resting on exactly two named residual axioms (both owned by Tier 3). The next roadmap layer is **Tier 2.5 — Lean↔TS extensional equivalence** (`verification/ROADMAP.md:138-149`): the gap between "the Lean model is internally sound" and "the Lean model is faithfully *about the production code*."

The most credibility-bearing hole today: **nothing in the repo executes the genuine Lean definitions against the TS engine.** The only equivalence evidence — the "1.19M cases, zero divergence" claim in `verification/ROADMAP.md:34` and `verification/lean/README.md` — was a one-off external exercise during PR #164 review. It is not reproducible, not in CI, and not run over the actual Lean `def`s; it re-implemented the algorithms rather than executing them.

This change starts Tier 2.5 with its safest, highest-leverage first increment: a **reproducible, in-CI executable differential harness** that runs the genuine Lean `LeanSpike.computeAtomLcs` (`verification/lean/LeanSpike/Lcs.lean:34`) against the TS `computeAtomLcs` (`packages/docx-core/src/baselines/atomizer/atomLcs.ts:45`) on shared generated inputs and asserts identical output. It grounds the extensional-equivalence claim, makes it rot-proof on every PR, and de-risks the later *formal* DP-equivalence proof by surfacing any tie-break/ordering divergence before anyone tries to prove it away.

### Scope decision — LCS surface only

This increment leads with the **LCS surface only**. It has the cleanest projection boundary (the 3-field `LeanSpike.Atom` ↔ `ComparisonUnitAtom`), it is exactly the claim that is currently unreproducible, and its TS counterpart takes a plain atom array (`atomsEqual` at `atomLcs.ts:112-131` reads only `sha1Hash`, `contentElement.textContent`, `contentElement.tagName`). The Tier 2 helpers (`accept` / `reject` / `validateFieldStructure` / `extractText` / `normalizeText`) have a messy TS-input story (real OOXML AST) and are explicitly deferred to a named successor (`add-lean-ts-helper-differential-harness`), which needs a `Doc`→`document.xml` adapter. The formal LCS DP-equivalence proof and the `Atom`-projection broadening are also deferred; this harness de-risks the former.

### What was verified before proposing (load-bearing for the design)

A dynamic review compiled and executed every assumption under the pinned toolchain (Lean `4.29.1`, Lake `5.0.0`):

- Lake exe DSL form `@[default_target] lean_exe NAME where root := \`Module` is exactly what `lake translate-config` emits, and bare `lake build` builds it — no change to the CI build command.
- Lean JSON deriving needs `import Lean.Data.Json.FromToJson` + `open Lean` (NOT `import Lean` / `import Lean.Data.Json`, which leave `FromJson`/`ToJson` unqualified and fail). The 3-field `Atom` derives cleanly; the parser is the typeclass `FromJson.fromJson?`.
- **Shape mismatch the harness must normalize:** Lean's `Match = Nat × Nat` serializes each pair as a JSON **array** (`{"matches":[[0,1]]}`), while TS `LcsResult.matches` is an **object array** (`{"matches":[{"originalIndex":1,"revisedIndex":0}]}`, `atomLcs.ts:16-21`). The keyword field `«matches»` serializes to the clean key `"matches"`. The TS side normalizes its matches to `[origIdx, revIdx]` tuples before comparison.
- The real TS `computeAtomLcs` runs against a minimal typed `ComparisonUnitAtom` stub.
- Strict equality is justified: an exhaustive transcription sweep over all length-≤6 pairs on a 3-symbol alphabet reproduced **1,194,649 pairs, zero divergence**.

## What Changes

- **New Lean executable `verification/lean/Differential.lean`** + `@[default_target] lean_exe leanDifferential` in `verification/lean/lakefile.lean`. It reads a batched JSON document `{ "cases": [ { "orig": [Atom…], "rev": [Atom…] }, … ] }` from stdin, runs the genuine `LeanSpike.computeAtomLcs` per case, and emits `{ "results": [ { "matches": [[o,r]…], "deletedIndices": […], "insertedIndices": […] } … ] }` to stdout — one process spawn amortized over the whole batch, never process-per-case. Plain executable code, no `sorry`; the zero-`sorry` audit stays green.
- **`FromJson`/`ToJson` deriving** added to `LeanSpike.Atom` (`verification/lean/LeanSpike/Atom.lean`), or a local instance in `Differential.lean` if touching the proved module is undesirable.
- **New TS harness `packages/docx-core/src/integration/lean-differential-lcs.test.ts`** (vitest, with `.openspec()` tags + `TEST_FEATURE`). A `fast-check` arbitrary generates `Atom[]` pairs over a small alphabet; per case it builds the Lean JSON and a typed `ComparisonUnitAtom` stub (real `@xmldom/xmldom` Element for `contentElement`); it runs TS `computeAtomLcs` in-process, spawns the Lean exe **once** for the full batch, normalizes TS matches to tuples, and asserts structural deep-equality of each `LcsResult`. Default mode runs a few thousand random cases; an opt-in `LEAN_DIFF_EXHAUSTIVE=1` mode enumerates the full length-≤6 / 3-symbol sweep. If the exe is absent (dev without Lean, or no `.lake` build), the test **skips** with a clear message; CI builds the exe so the gate is not vacuous there.
- **CI wiring in `.github/workflows/lean-build.yml`.** Add the harness file (and any shared atom helper) to the `push`/`pull_request` `paths:` triggers — today the workflow only triggers on `verification/lean/**`, so a harness-only change would not run it. After `lake build`, add pinned `actions/setup-node` (Node 20, `cache: npm`) + the repo's `npm ci`-with-retry pattern + a scoped run of the differential test. Keep the zero-`sorry` audit unchanged.

## Scope guardrails

- **LCS surface only.** No Tier 2-helper differential (deferred to a named successor needing a `Doc`→`document.xml` adapter). No formal DP-equivalence proof. No `Atom`-projection broadening.
- **No new residual-axiom claims and no production-engine changes.** This strengthens extensional-equivalence evidence between the existing Lean LCS and the existing TS LCS; it discharges nothing and changes no engine code. `atomLcs.ts` is read, never edited.
- **Strict equality by default.** Any future divergence is treated as a genuine finding (feeding the deferred formal proof), not a reason to pre-emptively weaken the assertion.

## Impact

- **Affected specs:** `docx-comparison` (one new ADDED requirement — see `specs/docx-comparison/spec.md`).
- **Affected code:** `verification/lean/Differential.lean` (new), `verification/lean/lakefile.lean`, `verification/lean/LeanSpike/Atom.lean` (deriving clause), `packages/docx-core/src/integration/lean-differential-lcs.test.ts` (new), `.github/workflows/lean-build.yml`. `verification/ROADMAP.md` updated to mark the Tier 2.5 first increment in progress and point the "1.19M" claim at the reproducible harness.
- **No production-engine code changes.**
- **CI:** the differential test runs inside the `lean-build` workflow (which already provisions elan + the mathlib cache and now builds the exe via the default target). `npm run check:spec-coverage` must continue to pass once the new requirement's scenarios are mapped via `.openspec()` tags; the new test file declares `const TEST_FEATURE` so the `allure-labels` gate is satisfied.
- **Runtime:** default mode adds one `fast-check` property at a few thousand cases plus a single subprocess spawn; the exhaustive sweep (~1.19M cases) is opt-in via env flag and intended for CI, not the default `npm test`.
