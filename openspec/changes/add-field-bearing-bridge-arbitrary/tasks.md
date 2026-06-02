# Tasks — field-bearing fast-check arbitrary for the Lean spec bridge

## 1. Field-bearing arbitrary (`lean-spec-bridge.test.ts`, with `ooxml-fixtures.ts` helpers)

- [x] 1.1 Added `paragraphWithText` + `paragraphWithField(prefix, field, suffix)` body-XML helpers (with `escapeXmlText`) to `ooxml-fixtures.ts`; the arbitrary sources field XML from the `COMPLETE_*` constants via these helpers — no inline re-derivation (issue #221 drift rule).
- [x] 1.2 Defined `FieldOperation` union `{ field-insert, field-delete, field-stable, text-only }` and `FieldType` over `COMPLETE_NUMPAGES_FIELD` / `COMPLETE_PAGE_FIELD` / `COMPLETE_PAGEREF_FIELD` (`FIELD_FIXTURES`).
- [x] 1.3 Defined `fieldBearingPairArb` (+ `buildFieldBearingPair`, `compareFieldBearingPair`): clean `(originalBodyXml, revisedBodyXml)` pairs realizing one operation × field type, ordinary `<w:t>` runs around the field, engine generates all tracking. Carries `operation` / `fieldType` for per-run dispatch and coverage.
- [x] 1.4 Added `FieldBearingCoverage` map + `createFieldBearingCoverage` / `recordFieldBearingHit` / `assertFieldBearingCoverage`, keyed by operation × field type.

## 2. Property tests

- [x] 2.1 `INV-FIELD-001: field structure preserved on field-bearing inplace comparison output` at `numRuns: NUM_RUNS`: `assertInplaceResult` + `assertFieldInvariant`; `assertRecursivelyWellformed` **iff** `operation !== 'field-delete'`. Coverage recorded; full coverage asserted in `finally`. Seeded with all 12 operation×type combos via `examples` so the coverage floor is deterministic on top of the 100 random runs.
- [x] 2.2 `INV-RT-001: paired round-trip text equality on field-bearing inplace comparison output`: `assertInplaceResult` + `await assertRoundTripInvariant` per run; coverage recorded + asserted. Round-trip exercises the live `extractTextWithParagraphs` / `normalizeText` (field result `<w:t>` counted; `instrText` / `fldChar` contribute none).
- [x] 2.3 Allure JSON coverage attachment per property (`field-bearing-operation-type-hits-inv-field-001` / `…-inv-rt-001`).

## 3. Header / comment accuracy (asymmetry-of-rot)

- [x] 3.1 Extended the "Coverage surfaces" comment to list the field-bearing arbitrary and its four operation families.
- [x] 3.2 Scoped the "Fallback semantics" comment: the "field-free ⇒ no `ContainerResolutionError`" claim now applies to the two original generators (`pairArb`, `trackedPairArb`); documented the field-bearing arbitrary's narrower complete-field-at-run-boundary operation set and that fallback there is still falsification. Also de-scoped the `fallbackError` message ("under the bridge generator").
- [x] 3.3 Updated the "Coverage limitations" note so it no longer implies all field-bearing input families live only in `collapsed-field-inplace.test.ts` (fragmented/nested/paragraph-spanning families are what remain outside this surface).

## 4. Verify locally (AGENTS.md pre-submit)

- [x] 4.1 `npm run build -w @usejunior/docx-core` — clean.
- [x] 4.2 `npm run lint -w @usejunior/docx-core` (`tsc --noEmit`, typechecks tests incl. `.openspec()` tags) — clean.
- [x] 4.3 Full docx-core suite (`npm run test:run -w @usejunior/docx-core`) — 1290 passed, 3 skipped, 87 files. Both new properties pass at `numRuns: 100` with full operation×type coverage and no inplace fallback.
- [x] 4.4 `npm run check:spec-coverage` — PASS (both workspaces).
- [x] 4.5 `npm run check:conformance-citations && npm run check:conformance-doc` — OK.

## 5. Spec coverage mapping

- [x] 5.1 Mapped via `.openspec('[LEAN-FBA-NN] …')` tags on the two new property tests. The traceability matrix `DOCX_COMPARISON_OPENSPEC_TRACEABILITY.md` is **auto-generated** by `validate_openspec_coverage.mjs` from canonical-spec scenarios + these tags — the rows for `[LEAN-FBA-*]` populate automatically when the delta is applied to the canonical spec on archive. No hand-edit of the matrix (a manual edit is overwritten by the generator).

## 6. Validate

- [x] 6.1 `openspec validate add-field-bearing-bridge-arbitrary --strict` passes.

## 7. Documentation follow-through

- [x] 7.1 Updated `verification/ROADMAP.md`: moved the field-bearing arbitrary from "still open / deferred" to a new "Delivered follow-ups" section.
