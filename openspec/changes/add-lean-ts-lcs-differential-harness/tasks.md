# Tasks: Lean↔TS LCS differential harness

## 1. Lean executable

- [x] 1.1 Add `deriving FromJson, ToJson` to `LeanSpike.Atom` in `verification/lean/LeanSpike/Atom.lean` (or a local instance in `Differential.lean`). Use `import Lean.Data.Json.FromToJson` + `open Lean`.
- [x] 1.2 Add `verification/lean/Differential.lean`: define `CasesIn` / `ResultsOut` JSON shapes, parse `{cases:[{orig,rev}]}` from stdin, run `LeanSpike.computeAtomLcs` per case, emit `{results:[{matches,deletedIndices,insertedIndices}]}`. `main : List String → IO UInt32` over `IO.getStdin`/`IO.print`.
- [x] 1.3 Register `@[default_target] lean_exe leanDifferential where root := \`Differential` in `verification/lean/lakefile.lean`.
- [x] 1.4 `lake build` succeeds; zero-`sorry` audit (`find ... -print0 | xargs -0 grep -nwH sorry`) finds nothing.
- [x] 1.5 Smoke the exe: a one-case batch returns the expected `matches`/`deletedIndices`/`insertedIndices`.

## 2. TS differential harness

- [x] 2.1 Add `packages/docx-core/src/integration/lean-differential-lcs.test.ts` with `const TEST_FEATURE` and `.openspec()` tags.
- [x] 2.2 `fast-check` arbitrary producing `Atom[]` pairs over a small alphabet; per atom build the Lean JSON object and a typed `ComparisonUnitAtom` stub with a real `@xmldom/xmldom` Element for `contentElement` (no `as any`).
- [x] 2.3 Resolve the exe path (`verification/lean/.lake/build/bin/leanDifferential`); if absent, `skip` with a clear message.
- [x] 2.4 Run TS `computeAtomLcs` per case in-process; spawn the exe **once** (`spawnSync`) with the full batch; parse results.
- [x] 2.5 Normalize TS matches to `[originalIndex, revisedIndex]` tuples; assert structural deep-equality of `{matches, deletedIndices, insertedIndices}` per case.
- [x] 2.6 Default mode = a few thousand random cases; `LEAN_DIFF_EXHAUSTIVE=1` mode enumerates all length-≤6 / 3-symbol pairs. On divergence, fail with a per-case diff.

## 3. CI wiring

- [x] 3.1 Add the harness file path to both `push` and `pull_request` `paths:` in `.github/workflows/lean-build.yml`.
- [x] 3.2 After the build step, add pinned `actions/setup-node` (Node 20, `cache: npm`) + the `npm ci`-with-retry pattern (copy from `ci.yml`) + a scoped run: `npm run test:run -w @usejunior/docx-core -- src/integration/lean-differential-lcs.test.ts` (consider `LEAN_DIFF_EXHAUSTIVE=1`).
- [x] 3.3 Leave the zero-`sorry` audit step unchanged.

## 4. Docs

- [x] 4.1 Update `verification/ROADMAP.md`: mark the Tier 2.5 first increment as in progress and point the "1.19M cases" claim at the reproducible harness.

## 5. Verify

- [x] 5.1 `cd verification/lean && lake build` green; `leanDifferential` present.
- [x] 5.2 `npm run test:run -w @usejunior/docx-core -- src/integration/lean-differential-lcs.test.ts` green (default mode), then `LEAN_DIFF_EXHAUSTIVE=1 …` green.
- [x] 5.3 Negative control: temporarily flip a tie-break (or mutate one emitted index) and confirm the harness fails with a per-case diff; revert.
- [x] 5.4 `npm run build && npm run lint:workspaces`.
- [x] 5.5 `npm run check:spec-coverage` — the new `[LEAN-DIFF-*]` scenarios map to the tagged property.
- [x] 5.6 `openspec validate add-lean-ts-lcs-differential-harness --strict`.
