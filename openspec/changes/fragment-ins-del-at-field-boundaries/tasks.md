## 1. OpenSpec scaffold

- [x] 1.1 Scaffold `openspec/changes/fragment-ins-del-at-field-boundaries/` with `proposal.md`, `design.md`, `tasks.md`, and `specs/docx-comparison/spec.md` (ADDED requirement for ECMA-376 field-fragmentation conformance).

## 2. Phase 0 — Red fixtures

- [ ] 2.1 Create `packages/docx-core/src/integration/field-fragmentation.test.ts`.
- [ ] 2.2 Add fixture: FORMCHECKBOX → FORMTEXT instr-text rewrite. Assert `w:fldChar` runs are unwrapped siblings; `w:instrText`/`w:delInstrText` runs are inside `<w:ins>`/`<w:del>`; `validateFieldStructure(combined) === true`.
- [ ] 2.3 Add fixture: HYPERLINK target rewrite.
- [ ] 2.4 Add fixture: PAGEREF instr-text rewrite.
- [ ] 2.5 Add fixture: bookmarked field instr modification.
- [ ] 2.6 Add fixture: result-text-only change (field structure preserved).
- [ ] 2.7 Add fixture: nested field modification.
- [ ] 2.8 Add fixture: field-without-separator edge case.
- [ ] 2.9 Verify all fixtures FAIL against current main (red baseline).

## 3. Phase 1 — Research whole-field deletion representation

- [ ] 3.1 Consult ECMA-376 Part 4 § DeletedFieldCode and § fldChar topics (c-rex.net mirror).
- [ ] 3.2 Inspect LibreOffice `sw/source/filter/ww8/wrtw8nds.cxx` and adjacent — record how a tracked field deletion is emitted.
- [ ] 3.3 Inspect docx4j field-deletion handling.
- [ ] 3.4 Round-trip a Word-tracked field deletion (PAGEREF + NUMPAGES) and inspect XML.
- [ ] 3.5 Record decision in `design.md` § "Phase 1 Outcome" with evidence trail (file references, screenshots).

## 4. Phase 1.5 — Field-change classifier

- [ ] 4.1 Create `packages/docx-core/src/baselines/atomizer/fieldChangeClassifier.ts` exporting `FieldChangeClass` type and `classifyFieldChange(originalAtom, revisedAtom)` function.
- [ ] 4.2 Implement classification logic by walking `collapsedFieldAtoms` of both sides and comparing instr/result content. Returns one of: `whole-field-insertion`, `whole-field-deletion`, `instr-modification`, `result-modification`, `no-change`.
- [ ] 4.3 Create `packages/docx-core/src/baselines/atomizer/fieldChangeClassifier.test.ts` with unit tests for each class.
- [ ] 4.4 No behavior change yet — classifier is dormant until Phase 2.

## 5. Phase 2 — Modification-case fragmentation

- [ ] 5.1 Add `fragmentModifiedField(atom, wrapperKind)` helper near `getAtomRuns:721` in `inPlaceModifier.ts`. Walks `collapsedFieldAtoms`; emits each `w:fldChar` run at sibling level (unwrapped); wraps `w:instrText` / `w:delInstrText` / result payloads inside one wrapper per contiguous run group of the target kind.
- [ ] 5.2 Rewire `handleInserted:1957` to call `classifyFieldChange`. `whole-field-insertion` → existing single-wrapper behavior. `instr-modification` / `result-modification` → `fragmentModifiedField(atom, 'w:ins')`.
- [ ] 5.3 Rewire `handleMovedDestination:2300` analogously with `'w:moveTo'`.
- [ ] 5.4 Rewire `insertDeletedRun:923` for the `instr-modification` subcase → `fragmentModifiedField(atom, 'w:del')`. Whole-field deletion deferred to Phase 3.
- [ ] 5.5 Verify Phase 0 fixtures 2.2–2.7 now pass.

## 6. Phase 3 — Whole-field deletion fragmentation

- [ ] 6.1 Apply Phase-1 decision to `insertDeletedRun:923` for the `whole-field-deletion` subcase.
- [ ] 6.2 Add fixture for whole-field deletion to `field-fragmentation.test.ts`.
- [ ] 6.3 Verify the new fixture passes.

## 7. Phase 4 — Gates, test updates, docs

- [ ] 7.1 Add combined-output `validateFieldStructure(combinedXml)` call alongside accept/reject in `pipeline.ts:468`.
- [ ] 7.2 Update `lean-spec-bridge.test.ts` deletion fixture TODO at lines 962–970: clarify that the engine is now conformant but the per-wrapper check still over-asserts (fragmented `<w:del>` payloads are not neutral under ∀ ctx). Keep `assertFieldInvariant` only; do NOT re-enable `assertRecursivelyWellformed`.
- [ ] 7.3 Update `collapsed-field-inplace.test.ts` helpers (`:125–195`) and assertions (`:211`, `:478–510`): add fragmented-shape variants of `countRunsInTrackedChangeWrappers`, `hasSingleRunPackedField`, `hasLeakedInstrText`. Tests for instr-modification scenarios assert fragmented output; whole-field cases unchanged.
- [ ] 7.4 Update `verification/lean/README.md`: replace stale references to `recursivelyWellformed` axiom with `preservationFriendly`; link PR #220.
- [ ] 7.5 Run full pre-submit: `npm run build && npm run lint:workspaces && npm run test:run && npm run check:spec-coverage`.

## 8. Lean verification (no code changes)

- [ ] 8.1 Run `cd verification/lean && lake build`. Confirm zero sorries and green build.
- [ ] 8.2 Verify `#print axioms LeanSpike.inv_field_001` lists `compareDocumentXml_output_preservation_friendly` and NOT `compareDocumentXml_output_recursivelyWellformed`.

## 9. Acceptance & merge

- [ ] 9.1 Manual round-trip in Microsoft Word: open a FORMCHECKBOX-modified output; verify the field renders correctly and accept/reject produce the expected document state.
- [ ] 9.2 Manual round-trip in LibreOffice: open the same document; verify the field is preserved (not discarded to literal text).
- [ ] 9.3 Open PR referencing `Closes: #217`.
- [ ] 9.4 Post-merge: archive this change via `openspec archive fragment-ins-del-at-field-boundaries --yes` and update `openspec/specs/docx-comparison/spec.md`.
