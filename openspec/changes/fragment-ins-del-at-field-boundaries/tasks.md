## 1. OpenSpec scaffold

- [x] 1.1 Scaffold `openspec/changes/fragment-ins-del-at-field-boundaries/` with `proposal.md`, `design.md`, `tasks.md`, and `specs/docx-comparison/spec.md` (ADDED requirement for ECMA-376 field-fragmentation conformance).

## 2. Phase 0 — Red fixtures

- [x] 2.1 Create `packages/docx-core/src/integration/field-fragmentation.test.ts`.
- [x] 2.2 Add fixture: FORMCHECKBOX → FORMTEXT (with result change). Assert no `w:fldChar` inside `<w:del>`; `validateFieldStructure(combined/accept/reject) === true`.
- [x] 2.3 Add fixture: HYPERLINK target rewrite (with link-text change).
- [x] 2.4 Add fixture: PAGEREF rewrite (with result-page change).
- [x] 2.5 Add fixture: bookmarked field modification (with result change).
- [x] 2.6 Add fixture: result-text-only NUMPAGES 3 → 4 change.
- [x] 2.7 Add `.skip` placeholder: nested field modification.
- [x] 2.8 Add `.skip` placeholder: field-without-separator edge case.
- [x] 2.9 Verify all enabled fixtures FAIL against pre-Phase-2 main (red baseline confirmed — see commit message of test fixture commit).

## 3. Phase 1 — Research whole-field deletion representation

- [x] 3.1 Consult ECMA-376 Part 4 § DeletedFieldCode and § fldChar topics (Microsoft Learn / c-rex.net mirror).
- [x] 3.2 Decision recorded in design.md Decision 4: extend the canonical FORMCHECKBOX→FORMTEXT modification pattern to whole-field deletion (fldChar unwrapped, instrText→delInstrText and result→delText wrapped in `<w:del>`).
- [ ] 3.3 Empirical follow-up (gated on Phase 9 manual round-trip): if Word or LibreOffice rejects the empty-shell accept-state, revisit Decision 4 and inspect LibreOffice source / docx4j to find an alternative.

## 4. Phase 1.5 — Field-change classifier (DROPPED per design Decision 1)

Per Steven's #217 comment, fragmentation is uniform across all three handlers — fldChar runs are always emitted unwrapped at sibling level when handling a collapsed-field atom. The yes/no predicate "is this a collapsed field?" reduces to `atom.collapsedFieldAtoms !== undefined` and does not warrant a separate module. The 5-class classifier was a leftover from an earlier draft that proposed keeping whole-field insertion unfragmented.

- [x] 4.1 SKIPPED — superseded by Decision 1.

## 5. Phase 2+3 — Deletion-side fragmentation (modification + whole-field deletion)

- [x] 5.1 Add `isCollapsedFieldAtom(atom)` predicate near `getAtomRuns:721` in `inPlaceModifier.ts`.
- [x] 5.2 Add `insertFragmentedDeletedField` helper: iterates `collapsedFieldAtoms` and emits one cloned run per atom; `w:fldChar` runs at sibling level, payload runs wrapped in their own `<w:del>` with `convertToDelText` rename.
- [x] 5.3 Rewire `insertDeletedRun:923` to dispatch on `isCollapsedFieldAtom(deletedAtom)` and call the fragmentation helper.
- [x] 5.4 Leave `handleInserted:1957` and `handleMovedDestination:2300` UNCHANGED. ECMA-376 permits `w:fldChar` inside `<w:ins>` / `<w:moveTo>` — fragmenting them would regress NVCA fixtures and the bridge-test insertion `assertRecursivelyWellformed`.
- [x] 5.5 Verify Phase 0 deletion + modification fixtures pass; full docx-core test suite (1259 tests + 3 skipped) green.

## 7. Phase 4 — Gates, test updates, docs

- [x] 7.1 Add targeted combined-output gate in `pipeline.ts`: introduce `hasFldCharInsideDel(xml)` helper and require `!hasFldCharInsideDel(candidateXml)` alongside the existing accept/reject `validateFieldStructure` checks. Narrower than full `validateFieldStructure(combinedXml)` because the latter surfaces unrelated legacy non-conformances (e.g. `w:delInstrText` inside `<w:moveFrom>` from `insertMoveFromRun`) out of #217 scope.
- [x] 7.2 Refresh `lean-spec-bridge.test.ts` deletion-fixture comment (lines 962–970 region): clarify that the engine now satisfies the no-fldChar-in-del rule but the per-wrapper recursive check still over-asserts (fragmented `<w:del>` payloads are not neutral under ∀ ctx — that's the predicate-strength gap PR #220 weakened the axiom around). Keep `assertFieldInvariant` only.
- [x] 7.3 Update `collapsed-field-inplace.test.ts:211`: replace the "multi-run inside one w:del" assertion with "fldChar at sibling level + single-payload w:del wrappers."
- [x] 7.4 Update unit test in `inPlaceModifier.test.ts:1269`: contract change — `insertDeletedRun` now returns the last inserted sibling (a `<w:r>` for fldChar end), not the `<w:del>` wrapper. Assert structural shape of the fragmented sequence instead.
- [ ] 7.5 (Optional) Update `verification/lean/README.md` stale references to legacy axiom names. Defer — README inspection is the follow-up if Lean docs are referenced by other PRs.
- [ ] 7.6 Run full pre-submit: `npm run build && npm run lint:workspaces && npm run test:run && npm run check:spec-coverage`.

## 8. Lean verification (no code changes)

- [ ] 8.1 Run `cd verification/lean && lake build`. Confirm zero sorries and green build.
- [ ] 8.2 Verify `#print axioms LeanSpike.inv_field_001` lists `compareDocumentXml_output_preservation_friendly` and NOT `compareDocumentXml_output_recursivelyWellformed`.

## 9. Acceptance & merge

- [ ] 9.1 Manual round-trip in Microsoft Word: open a FORMCHECKBOX-modified output; verify the field renders correctly and accept/reject produce the expected document state.
- [ ] 9.2 Manual round-trip in LibreOffice: open the same document; verify the field is preserved (not discarded to literal text).
- [ ] 9.3 Open PR referencing `Closes: #217`.
- [ ] 9.4 Post-merge: archive this change via `openspec archive fragment-ins-del-at-field-boundaries --yes` and update `openspec/specs/docx-comparison/spec.md`.
