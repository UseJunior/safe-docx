# Change: Fragment `<w:ins>`/`<w:del>` at field-character boundaries per ECMA-376 Part 4

## Why

The current inplace atomizer wraps whole field sequences as a single track-change wrapper, even when a conformant emitter must fragment. ECMA-376 Part 4 is explicit that `w:fldChar` is **strictly barred** from `<w:del>` — Microsoft Word treats violations as fatal and discards the field state machine, falling back to literal-text rendering. The current engine emits deleted complete fields as a single `<w:del>` containing the entire begin/instrText/separate/result/end run sequence (`packages/docx-core/src/baselines/atomizer/inPlaceModifier.ts:923`, function `insertDeletedRun`), which violates this rule.

Tracking issue: [#217](https://github.com/UseJunior/safe-docx/issues/217).

PR #220 (merged 2026-05-22) already prepared the Lean side by weakening the `inv_field_001` residual axiom from per-subtree `Tier2.FieldStructure.recursivelyWellformed` to document-level `Tier2.AcceptReject.preservationFriendly`. Fragmented `<w:ins>`/`<w:del>` wrappers containing only `w:instrText`/`w:delInstrText` are NOT `fieldContextNeutral` under `∀ ctx`, but they DO satisfy the weaker `preservationFriendly` predicate. The Lean proof is therefore ready to absorb fragmented engine output with no further Lean changes.

LibreOffice and docx4j already emit fragmented field-edit markup. Pandoc has tracked the equivalent splitting gap for hyperlinks at jgm/pandoc#4609; safe-docx today is in the same non-conformant cohort.

## What Changes

- **Engine: field-modification fragmentation.** For an existing field whose `w:instrText` (or result) is rewritten under tracked changes, emit `w:fldChar begin/separate/end` runs at sibling level (unwrapped) and wrap only `w:instrText` / `w:delInstrText` / result payloads in `<w:ins>` / `<w:del>` / `<w:moveTo>`. This is the FORMCHECKBOX→FORMTEXT canonical fixture from ECMA-376 Part 4.
- **Engine: whole-field deletion fragmentation.** Deleting an entire complex field also must keep `w:fldChar` runs out of `<w:del>`. Exact representation is gated on a research spike (see `design.md`).
- **Engine: whole-field INSERTION remains unfragmented.** A newly added field wrapped in a single `<w:ins>` containing `begin..end` is permitted by ECMA-376 (only `<w:del>` bars `w:fldChar`) and currently passes the strong wrapper-neutrality check at `lean-spec-bridge.test.ts:935`. Fragmenting it would break the verification over-check without conformance benefit.
- **Engine: new field-change classifier.** A new module `packages/docx-core/src/baselines/atomizer/fieldChangeClassifier.ts` distinguishes `whole-field-insertion` / `whole-field-deletion` / `instr-modification` / `result-modification` / `no-change` by comparing the original and revised collapsed-field atoms. Needed because `ComparisonUnitAtom.collapsedFieldAtoms` carries only ONE `correlationStatus` (set from the first field atom at `atomizer.ts:780`), so the per-constituent comparison status isn't directly available at handler call sites.
- **Engine: combined-output safety gate.** Extend `pipeline.ts` (currently validates only `acceptedXml` and `rejectedXml` at line 468) to also call `validateFieldStructure(combinedXml)` so any future regression that re-emits `w:fldChar` inside `<w:del>` in the combined output is caught at the engine layer.
- **Tests.** Add `packages/docx-core/src/integration/field-fragmentation.test.ts` with fixtures for FORMCHECKBOX→FORMTEXT, HYPERLINK target rewrite, PAGEREF instr rewrite, bookmarked field, result-only change, nested field, no-separator edge case, and (after research) whole-field deletion. Update `collapsed-field-inplace.test.ts` helpers and assertions for fragmented output. Leave `lean-spec-bridge.test.ts` deletion fixture on `assertFieldInvariant` only — fragmented `<w:del><w:delInstrText>…</w:delInstrText></w:del>` is NOT field-context-neutral under `∀ ctx`, so `assertRecursivelyWellformed` stays disabled there.
- **Documentation.** Update `verification/lean/README.md` stale references to the legacy `recursivelyWellformed` axiom to point at `preservationFriendly`.
- **No Lean changes.** PR #220 already weakened the axiom. `inv_field_001` proof path consumes only `preservationFriendly` and `field_structure_preserved_doc`.

## Impact

- **Affected specs:** `docx-comparison` (new requirement: ECMA-376 field-fragmentation conformance).
- **Affected code:**
  - `packages/docx-core/src/baselines/atomizer/inPlaceModifier.ts` (fragmentation helper + handler dispatch)
  - `packages/docx-core/src/baselines/atomizer/fieldChangeClassifier.ts` (NEW)
  - `packages/docx-core/src/baselines/atomizer/pipeline.ts` (combined-output gate)
  - `packages/docx-core/src/integration/field-fragmentation.test.ts` (NEW)
  - `packages/docx-core/src/integration/collapsed-field-inplace.test.ts` (assertion updates)
  - `verification/lean/README.md` (doc cleanup)
- **Acceptance criteria (from issue #217):**
  - Output of `compareDocumentsAtomizer` for a field-modification scenario contains unwrapped `w:fldChar` markers at run-sibling level.
  - Output never contains `w:fldChar` inside `<w:del>` (engine-side; the runtime check from PR #211 already enforces it post-hoc).
  - Microsoft Word renders the field result correctly after accept on a modified-field output.
  - LibreOffice round-trips the modified-field DOCX without discarding the field.
