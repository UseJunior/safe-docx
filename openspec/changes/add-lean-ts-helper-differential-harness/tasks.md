# Tasks: Lean↔TS Tier 2-helper differential harness

## 1. Lean executable

- [x] 1.1 Add `verification/lean/DifferentialHelpers.lean`: `import Lean.Data.Json` + `import Tier2.AcceptReject` (transitively brings `FieldStructure`/`OoxmlModel`), `open Lean Tier2.OoxmlModel Tier2.FieldStructure Tier2.AcceptReject`.
- [x] 1.2 Hand-write `FromJson`/`ToJson` instances for `FldCharKind`, `Atom`, `Run`, `Block`, `Paragraph`, and the `Doc` alias, matching the tagged-union wire grammar in `design.md` (single-tag objects). Keep them local so the proved Tier 2 modules are untouched.
- [x] 1.3 Define `CaseIn := { doc : Doc }`, `Input := { cases : List CaseIn }`, and a result encoder `{ validate := validateFieldStructure d, accept := accept d, reject := reject d }`.
- [x] 1.4 `main : IO Unit` reads stdin, `Json.parse`, `fromJson?`, maps each case, emits `{ "results": [...] }` via `IO.println out.compress` (mirror `Differential.lean`).
- [x] 1.5 Register `@[default_target] lean_exe leanHelperDifferential where root := \`DifferentialHelpers` in `verification/lean/lakefile.lean`.
- [x] 1.6 `cd verification/lean && lake build` succeeds; zero-`sorry` audit finds nothing (no proof-hole keyword in comments or code).
- [x] 1.7 Smoke the exe: a one-case batch round-trips `validate`/`accept`/`reject` for a simple `Doc`.

## 2. TS harness — adapter + projection

- [x] 2.1 Add `packages/docx-core/src/integration/lean-differential-helpers.test.ts` with `const TEST_FEATURE` and `.openspec()` tags (single-line, per the coverage-parser constraint).
- [x] 2.2 Define the TS `WireDoc` types mirroring the wire grammar and a `fast-check` arbitrary generating `Doc`s within the **faithful subset** (Decision 5: no field-context atoms inside wrappers; `delInstrText` only inside `del`; every paragraph keeps surviving top-level content).
- [x] 2.3 Implement `renderDocToXml(doc)` → a `document.xml` string parseable by `parseDocumentXml`, entity-escaping text; `other` tags from a transparent-container allowlist.
- [x] 2.4 Implement `docToTokens(wireDoc)` and `xmlToTokens(xml)` producing the same canonical token grammar (Decision 4).
- [x] 2.5 Resolve the exe path (`verification/lean/.lake/build/bin/leanHelperDifferential`); if absent, `skip` with a clear message.
- [x] 2.6 Run the TS helpers in-process per case (`validateFieldStructure(xml)`, `acceptAllChanges(xml)`, `rejectAllChanges(xml)`); spawn the Lean exe **once per memory-bounded chunk**; parse results.
- [x] 2.7 Assert per case: `validate` booleans equal; `xmlToTokens(acceptAllChanges(xml))` deep-equals `docToTokens(leanAccept)`; same for reject. On divergence, fail with a per-case diff (input doc + both token streams).

## 3. Characterization + negative control

- [x] 3.1 Add fixed characterization cases [G1] (`fldChar` in `del`), [G2] (`delInstrText` outside `del`), [G3] (accept drops vs keeps empty `w:ins` paragraph) asserting the documented divergence on each.
- [x] 3.2 Add a negative-control self-test (perturb one helper's output) confirming the gate fails with a per-case diff.

## 4. CI wiring

- [x] 4.1 Add `packages/docx-core/src/integration/lean-differential-helpers.test.ts`, `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts`, and `packages/docx-core/src/baselines/atomizer/pipeline.ts` to both `push` and `pull_request` `paths:` in `.github/workflows/lean-build.yml`.
- [x] 4.2 After the build step, add a scoped run: `npm run test:run -w @usejunior/docx-core -- src/integration/lean-differential-helpers.test.ts`, reusing the Node setup the LCS increment added (extend the existing run rather than duplicating the setup-node block).
- [x] 4.3 Leave the zero-`sorry` audit step unchanged.

## 5. Docs

- [x] 5.1 Update `verification/ROADMAP.md`: mark the Tier 2.5 second increment in progress; record G1/G2/G3 as characterized model gaps and the worklist for the model-broadening proof increment.

## 6. Verify

- [x] 6.1 `cd verification/lean && lake build` green; `leanHelperDifferential` present.
- [x] 6.2 `npm run test:run -w @usejunior/docx-core -- src/integration/lean-differential-helpers.test.ts` green (default + characterization + negative control).
- [x] 6.3 Negative control flips red when armed, green when reverted.
- [x] 6.4 `npm run build && npm run lint:workspaces`.
- [x] 6.5 `npm run check:spec-coverage` — the new scenarios map to the tagged property.
- [x] 6.6 `openspec validate add-lean-ts-helper-differential-harness --strict`.
