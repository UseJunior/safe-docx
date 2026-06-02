# Tasks — field-bearing fast-check arbitrary for the Lean spec bridge

## 1. Field-bearing arbitrary (`lean-spec-bridge.test.ts`, with `ooxml-fixtures.ts` helpers)

- [ ] 1.1 Add a `paragraphWithField(text, field)` body-XML helper to `ooxml-fixtures.ts` (only if the arbitrary needs more than the existing `COMPLETE_*` constants); otherwise compose inline from the constants. Do not re-derive field XML inline in the test (issue #221 drift rule).
- [ ] 1.2 Define a `FieldOperation` union `{ field-insert, field-delete, field-stable, text-only }` and a `FieldType` over the three constants `COMPLETE_NUMPAGES_FIELD` / `COMPLETE_PAGE_FIELD` / `COMPLETE_PAGEREF_FIELD`.
- [ ] 1.3 Define `fieldBearingPairArb`: generates a clean `(originalBodyXml, revisedBodyXml)` pair (via `buildDocxFromBodyXml`) realizing one `FieldOperation` with one `FieldType`, with ordinary `<w:t>` runs around the field. Clean inputs only (no pre-tracked markup) — the engine generates all tracking. Carry the `operation` and `fieldType` on the generated value for per-run dispatch and coverage.
- [ ] 1.4 Add a `FieldBearingCoverage` map + `createFieldBearingCoverage` / `recordFieldBearingHit` / `assertFieldBearingCoverage` mirroring the `TrackedScenarioCoverage` helpers (`:364-393`), keyed by operation (and field type).

## 2. Property tests

- [ ] 2.1 `INV-FIELD-001: field structure preserved on field-bearing inplace comparison output` — `fc.assert(fc.asyncProperty(fieldBearingPairArb, …), { numRuns: NUM_RUNS })`: build + compare buffers, `assertInplaceResult`, `assertFieldInvariant`; additionally `assertRecursivelyWellformed` **iff** `operation !== 'field-delete'`. Record coverage; assert full coverage in `finally`.
- [ ] 2.2 `INV-RT-001: paired round-trip text equality on field-bearing inplace comparison output` — `assertInplaceResult` + `assertRoundTripInvariant` on every run; record + assert coverage. Confirm the round-trip accounts for field **result** text (`<w:t>`) on both sides and that `instrText` / `fldChar` contribute none.
- [ ] 2.3 (Optional) Allure JSON attachment of the coverage map per property, mirroring `allureJsonAttachment('tracked-input-family-hits-…', coverage)` (`:849`, `:886`).

## 3. Header / comment accuracy (asymmetry-of-rot)

- [ ] 3.1 Extend the "Coverage surfaces" comment (`:8-21`) to list the field-bearing arbitrary and its operation families.
- [ ] 3.2 Scope the "Fallback semantics" comment (`:23-44`): the "field-free ⇒ no `ContainerResolutionError`" claim now applies to the two original generators; document the field-bearing arbitrary's narrower inplace-safe operation set and that fallback there is still treated as falsification.
- [ ] 3.3 Update the "Coverage limitations" note (`:46-52`) so it no longer implies *all* field-bearing input families live only in `collapsed-field-inplace.test.ts`.

## 4. Verify locally (AGENTS.md pre-submit)

- [ ] 4.1 `npm run build`
- [ ] 4.2 `npm run lint:workspaces`
- [ ] 4.3 `npm run test:run` (confirm the new properties pass at `numRuns: 100`, full operation/field-type coverage reported, no inplace fallback observed; if any run falls back, triage `engine-bug` vs. generator-shape before suppressing).
- [ ] 4.4 `npm run check:spec-coverage`
- [ ] 4.5 `npm run check:conformance-citations && npm run check:conformance-doc`

## 5. Spec coverage mapping

- [ ] 5.1 Map the new `docx-comparison` requirement's `[LEAN-FBA-*]` scenarios to the new bridge property tests in `packages/docx-core/src/testing/DOCX_COMPARISON_OPENSPEC_TRACEABILITY.md` per repo convention, so `check:spec-coverage` passes for them once the change is applied.

## 6. Validate

- [ ] 6.1 `openspec validate add-field-bearing-bridge-arbitrary --strict` passes.

## 7. Documentation follow-through

- [ ] 7.1 Update `verification/ROADMAP.md` to mark the `add-field-bearing-bridge-arbitrary` follow-up as delivered (it is currently listed as an open follow-up at `:128-129`).
