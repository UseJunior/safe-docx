## 1. Engine: always-mark insertions

- [x] 1.1 `wrapParagraphAsInserted` (`inPlaceModifier-wrappers.ts`): always emit `PPR-INS`; remove the
      `hasSubstantiveContent` early-return and the uncited "Google Docs compat" rationale.

## 2. Engine: mark-based reject (both paths, in lockstep)

- [x] 2.1 `rejectAllChanges` (`trackChangesAcceptorAst.ts:533-579`): remove the content-based
      all-`w:ins`/`w:moveTo` paragraph-drop heuristic; keep only the `PPR-INS` mark-based drop.
- [x] 2.2 `rejectChanges` (`primitives/reject_changes.ts`): remove `paragraphHasOnlyInsertedContent` and its
      drop branch; keep only the `paragraphHasParaMarker(p, 'ins')` mark-based drop.
- [x] 2.3 Remove the now-dead helpers/constants left behind (`runHasVisibleContent` +
      `RUN_VISIBLE_CONTENT_TAGS` in `trackChangesAcceptorAst.ts`; `containsRun`, `paragraphHasOnlyInsertedContent`,
      `INSERTED_LOCALS`/`KEPT_LOCALS`/`RANGE_MARKER_LOCALS`, `isWElement` in `reject_changes.ts`). `tsc` clean.

## 3. Tests

- [x] 3.1 `inPlaceModifier.test.ts`: reverse the "no-op for substantive runs" test to assert the `PPR-INS`
      marker IS added.
- [x] 3.2 `lean-differential-helpers.test.ts`: flip `[LEAN-HELP-06]` (G4) from documented divergence to
      strict agreement (both keep an empty `P[ ]`); update the file header comment (G4 closed, G3 remains).
- [x] 3.3 Full `@usejunior/docx-core` suite green (1338 passed); helper differential green 7/7 with the exe.

## 4. Oracle validation (Stage 0/1 evidence)

- [x] 4.1 LibreOffice headless accept/reject confirms keep-empty for `ins`-only / `del`-only / `moveTo`-only
      untracked-mark paragraphs, and drop for the `PPR-INS`-marked control.
- [x] 4.2 Google Docs confirms `PPR-INS` renders inserted runs and rejects cleanly (no leftover empty
      paragraph); the "Google Docs hides w:ins runs" claim is debunked.

## 5. Specs / docs

- [x] 5.1 Add the `docx-comparison` ADDED requirement (this change) + scenarios `[REJECT-MARK-01..04]`.
- [x] 5.2 Revise the pending `add-lean-ts-helper-differential-harness` G4 scenario (`[LEAN-HELP-06]`) from
      documented divergence to agreement.
- [ ] 5.3 Ship: peer-review (codex + agy), open PR, `/automerge-smoke`.
