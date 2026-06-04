## Context

Tier 2.5 (`verification/ROADMAP.md:138-149`) closes the abstraction gap between the Lean model and the production TypeScript. Its LCS sub-item states the closure "requires either a proof that the recursive Lean LCS and the iterative TS Wagner-Fischer DP produce the same output set, or a refactor of the TS." Before either, the empirical equivalence claim ("1.19M cases, zero divergence") needs to become a reproducible, in-CI artifact run over the **genuine** Lean definition rather than a one-off external re-implementation. This change builds that harness as the first Tier 2.5 increment.

## Goals / Non-Goals

- **Goal:** Execute the real `LeanSpike.computeAtomLcs` against the real TS `computeAtomLcs` on shared inputs, in CI, with strict output equality. Make the equivalence claim reproducible and rot-proof.
- **Goal:** De-risk the future formal DP-equivalence proof by surfacing any tie-break/ordering divergence empirically first.
- **Non-Goal:** A formal Lean proof of LCS equivalence (deferred — this harness precedes it).
- **Non-Goal:** Differential coverage of the Tier 2 helpers (`accept`/`reject`/`validateFieldStructure`/`extractText`/`normalizeText`) — deferred to `add-lean-ts-helper-differential-harness`; needs a `Doc`→`document.xml` adapter.
- **Non-Goal:** Broadening the `Atom` projection or touching `atomsEqual_implies_eq`.

## Decisions

- **Differential execution over re-implementation.** The harness runs the *actual* Lean `def` compiled to a native executable, not a JS/Lean port. This is what makes it evidence about the Lean code rather than about a transcription.
- **Batched JSON stdin→stdout protocol.** One `{cases:[…]}` document in, one `{results:[…]}` document out, a single subprocess spawn for the whole run. Process-per-case would dominate wall-clock at thousands of cases.
- **JSON via `import Lean.Data.Json.FromToJson` + `open Lean`.** Verified by compilation under v4.29.1: bare `import Lean` / `import Lean.Data.Json` leave `FromJson`/`ToJson` unqualified and fail to elaborate. The 3-field `Atom` derives cleanly; the parser is the typeclass `FromJson.fromJson?`, not `Atom.fromJson?`.
- **Canonical wire shape + `matches` normalization.** Lean's `Match = Nat × Nat` serializes each pair as a JSON array, so the exe emits `"matches": [[origIdx, revIdx], …]`. TS `LcsResult.matches` is `[{originalIndex, revisedIndex}, …]`. The harness maps the TS side to `[origIdx, revIdx]` tuples before deep-equality; `deletedIndices`/`insertedIndices` already match shape. The Lean keyword field `«matches»` serializes to the clean key `"matches"`.
- **Typed `ComparisonUnitAtom` stub with a real xmldom Element.** `atomsEqual` reads only `sha1Hash`, `contentElement.textContent`, `contentElement.tagName`, but the stub is fully typed (`sha1Hash`, `correlationStatus`, `contentElement`, `ancestorElements`, `ancestorUnids`, `part`) with no `as any`, so future field drift surfaces as a type error. `contentElement` is a real `@xmldom/xmldom` Element (the house XML lib; `WmlElement` aliases xmldom's `Element` at `core-types.ts:70`).
- **Strict equality, two modes.** Default mode runs a few thousand random `fast-check` cases (fast `npm test`); `LEAN_DIFF_EXHAUSTIVE=1` enumerates all length-≤6 / 3-symbol pairs (~1.19M). A dynamic transcription sweep already reproduced 1,194,649 pairs with zero divergence, so strict `toEqual` is the right default rather than a weaker tie-break-invariant property (e.g. equal length + valid common subsequence).
- **Skip-if-exe-missing gate.** A new gate (NOT the `reconstructionModeUsed === 'inplace'` gate that `lean-spec-bridge.test.ts` uses — that file has no exe-availability gate). Devs without Lean still get a green `npm test`; CI builds the exe so the gate runs there.
- **CI in `lean-build.yml`, inline.** Extends the existing job (already provisions elan + mathlib cache; `lake build` now builds the exe via the default target) rather than a sibling job, to reuse the already-built `.lake`. Trigger `paths:` must gain the harness file or harness-only changes won't run it.

## Risks / Trade-offs

- **Tie-break divergence under future broadening.** The reversed-recursion (Lean) vs forward-backtrack (TS) tie-breaks coincide today (1.19M-pair evidence). A broader projection or alphabet could surface a divergence → handled as a finding feeding the formal proof, not by weakening the assertion.
- **CI couples Node + Lean in one job.** Acceptable: the differential test is meaningless without both toolchains, and inlining reuses the warm `.lake` cache. If ownership/cache boundaries become awkward, split into a `needs: lean-build` sibling job later.
- **Exhaustive mode cost.** ~1.19M cases is opt-in via env flag, intended for CI, not the default `npm test` (which runs the bounded random sample).

## Migration Plan

Additive only. New Lean module + exe target, new test file, CI step, one deriving clause. No existing Lean proof, engine code, or test changes. Rollback = revert the additions; the spike returns to its current zero-`sorry` state untouched.

## Open Questions

- Inline the CI steps in `lean-build` vs a `needs: lean-build` sibling job — start inline; revisit only if cache/ownership boundaries bite.
- Whether the shared `Atom`-pair arbitrary is worth extracting into `packages/docx-core/src/testing/` for reuse with the bridge test, or kept local to the harness — decide during implementation based on actual reuse.
