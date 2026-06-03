# Tasks: Fragmented-field fast-check arbitrary

## 1. Fixture primitives (only if needed)

- [x] 1.1 Confirm `FRAGMENTED_NUMPAGES_MODIFICATION` and `paragraphWithField` in `packages/docx-core/src/testing/ooxml-fixtures.ts` cover the three operations; if a parameterized builder is needed (e.g. `fragmentedFieldModification(instr, result)` or a `fieldWithResult(result)` helper), add it to `ooxml-fixtures.ts` per the AGENTS.md fixture-home rule — do NOT inline OOXML in the test.

## 2. Arbitrary

- [x] 2.1 Add `FragmentedFieldOperation` union (`result-edit` | `pretracked-fragmented-to-clean` | `clean-to-pretracked-fragmented`) and `FragmentedFieldPair` type.
- [x] 2.2 Add `buildFragmentedFieldPair(operation, fieldType, shape)` mirroring `buildFieldBearingPair`, producing `{ operation, fieldType, originalBodyXml, revisedBodyXml }`.
- [x] 2.3 Add seeded `fragmentedFieldExamples` (one deterministic pair per operation) and `fragmentedFieldPairArb` (`fc.record(...).map(buildFragmentedFieldPair)`), matching the `fieldBearingPairArb` construction.

## 3. Property test + coverage floor

- [x] 3.1 Add `assertFragmentedFieldCoverage` recording `(operation, mode-or-fallback)` and asserting both modes + every operation observed.
- [x] 3.2 Add the INV-FIELD-001 + INV-RT-001 mode-independent property over `fragmentedFieldPairArb`: assert `validateFieldStructure` on accept and reject, and normalized accept==revised / reject==original; do NOT assert `assertInplaceResult` or `validateFieldStructure(combined)`. Run at `numRuns: NUM_RUNS + fragmentedFieldExampleArgs.length` with seeded `examples`.
- [x] 3.3 Tag the property with `.openspec('[LEAN-FRAG-01] ...')`, `[LEAN-FRAG-02]`, `[LEAN-FRAG-03]` per the existing chained-`testAllure` idiom (file already declares `const TEST_FEATURE`).

## 4. Header comment

- [x] 4.1 Extend the "Coverage surfaces" block to list `fragmentedFieldPairArb` and its operations.
- [x] 4.2 Extend the "Fallback semantics" block to record that the fragmented-field arbitrary treats fallback as a legitimate, coverage-floored outcome (not falsification), distinguishing it from the other arbitraries — and reference `[LEAN-FRAG-04]`.

## 5. Validate

- [x] 5.1 `npm run test:run --workspace=@usejunior/docx-core` (or the bridge test alone) — new property passes, no regression in existing bridge properties.
- [x] 5.2 `npm run build && npm run lint:workspaces`.
- [x] 5.3 `npm run check:spec-coverage` — the new `[LEAN-FRAG-*]` scenarios map to the tagged property; matrix regenerates clean.
- [x] 5.4 `npm run check:conformance-citations && npm run check:conformance-doc`.
- [x] 5.5 `openspec validate add-fragmented-field-bridge-arbitrary --strict`.
