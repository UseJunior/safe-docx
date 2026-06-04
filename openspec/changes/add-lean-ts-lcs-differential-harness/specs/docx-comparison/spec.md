## ADDED Requirements

### Requirement: Executable differential harness establishes Lean↔TS LCS extensional equivalence reproducibly in CI

The system SHALL exercise the genuine Lean LCS definition `LeanSpike.computeAtomLcs` (`verification/lean/LeanSpike/Lcs.lean`) against the production TypeScript `computeAtomLcs` (`packages/docx-core/src/baselines/atomizer/atomLcs.ts`) over shared generated inputs, asserting identical output, as a reproducible CI gate. This replaces the previously un-reproducible "1.19M cases, zero divergence" claim (`verification/ROADMAP.md`), which re-implemented the algorithms in a one-off external exercise rather than executing the compiled Lean definition.

The harness SHALL run the **actual compiled Lean definition**, not a re-implementation: a Lean executable (`verification/lean/Differential.lean`, registered as the `leanDifferential` `lean_exe` target) reads a batched JSON document `{ "cases": [ { "orig": [Atom], "rev": [Atom] } ] }` from stdin, runs `LeanSpike.computeAtomLcs` per case, and emits `{ "results": [ { "matches": [[origIdx, revIdx]], "deletedIndices": [Nat], "insertedIndices": [Nat] } ] }` to stdout, where each `Atom` is the 3-field projection `{ sha1Hash, textContent, tagName }`. The executable SHALL contain no `sorry` and SHALL NOT alter the spike's zero-`sorry` status.

A TypeScript property test (`packages/docx-core/src/integration/lean-differential-lcs.test.ts`) SHALL:

- generate `(orig, rev)` atom-array pairs over a small alphabet via `fast-check`, building for each abstract atom both the Lean JSON object and a typed `ComparisonUnitAtom` stub whose `contentElement` is a real `@xmldom/xmldom` Element carrying the atom's `textContent` and `tagName`, and whose `sha1Hash` matches the Lean atom — with no `as any` cast that could hide future field drift;
- run the TS `computeAtomLcs` in-process per case and spawn the Lean executable **once** for the whole batch (not once per case);
- normalize the TS `LcsResult.matches` (objects `{ originalIndex, revisedIndex }`) to `[originalIndex, revisedIndex]` tuples to match the Lean `Prod`-derived JSON array shape, then assert structural deep-equality of `{ matches, deletedIndices, insertedIndices }` per case;
- run a bounded random sample by default and, under an opt-in environment flag, an exhaustive sweep over all length-≤6 pairs on a 3-symbol alphabet;
- **skip** with a clear message when the Lean executable is absent (so a developer without the Lean toolchain still gets a green `npm test`), while CI builds the executable so the comparison actually runs there.

The harness SHALL assert **strict** output equality by default; any divergence is a genuine finding feeding the deferred formal Lean↔TS DP-equivalence proof, NOT a reason to weaken the assertion to a tie-break-invariant property. This requirement strengthens extensional-equivalence evidence between the existing Lean and TS LCS implementations only; it introduces no production-engine change, does not broaden the `Atom` projection, and does not discharge any residual axiom.

#### Scenario: [LEAN-DIFF-01] Compiled Lean LCS matches the TS LCS on generated atom-array pairs

- **GIVEN** the `leanDifferential` executable built from `verification/lean/Differential.lean` and a `fast-check` arbitrary generating `(orig, rev)` atom-array pairs over a small alphabet
- **WHEN** each pair is run through both the in-process TS `computeAtomLcs` and the spawned Lean executable, with the TS matches normalized to `[originalIndex, revisedIndex]` tuples
- **THEN** `{ matches, deletedIndices, insertedIndices }` is structurally identical between the two on every generated case, asserted strictly

#### Scenario: [LEAN-DIFF-02] Exhaustive sweep reproduces the documented zero-divergence result

- **WHEN** the harness runs under the exhaustive environment flag, enumerating all length-≤6 pairs over a 3-symbol alphabet
- **THEN** every pair produces identical Lean and TS output (reproducing the previously external "1.19M cases, zero divergence" result as an in-repo, re-runnable check)

#### Scenario: [LEAN-DIFF-03] Harness skips cleanly without the Lean toolchain and runs in CI

- **WHEN** the differential test runs in an environment where the `leanDifferential` executable is absent (e.g. a developer without the Lean toolchain or an un-built `.lake`)
- **THEN** the test skips with a message explaining the executable was not found, rather than failing
- **AND** in CI the `lean-build` workflow builds the executable and triggers on the harness file, so the comparison actually runs and gates merges

#### Scenario: [LEAN-DIFF-04] A real divergence is caught, not masked

- **WHEN** one side's output is perturbed (e.g. a tie-break is flipped or an emitted index mutated)
- **THEN** the harness fails with a per-case diff identifying the diverging input and the differing `matches` / `deletedIndices` / `insertedIndices`, demonstrating the equality assertion is load-bearing rather than vacuous
