# Change: Fragment `<w:ins>`/`<w:del>` at field-character boundaries per ECMA-376 Part 4

> **Retracted 2026-08-14.** This change was archived without applying its spec
> delta. Direct Microsoft Word 16.112 and Aspose.Words 25.10 measurements showed
> that complete deleted complex fields place `w:fldChar` below `<w:del>`, and
> the ECMA-376 Transitional schema permits that ancestry. The original proposal
> incorrectly treated a research summary as a normative placement rule. Issue
> #217 was reopened with the measurement record; the replacement behavior keeps
> instruction changes whole and narrows only cached-result changes.

## Why

The current inplace atomizer wraps whole field sequences as a single track-change wrapper, even when a conformant emitter must fragment. ECMA-376 Part 4 is explicit that `w:fldChar` is **strictly barred** from `<w:del>` — Microsoft Word treats violations as fatal and discards the field state machine, falling back to literal-text rendering. The current engine emits deleted complete fields as a single `<w:del>` containing the entire begin/instrText/separate/result/end run sequence (`packages/docx-core/src/baselines/atomizer/inPlaceModifier-deletion.ts`, function `insertDeletedRun`), which violates this rule.

Tracking issue: [#217](https://github.com/UseJunior/safe-docx/issues/217).

PR #220 (merged 2026-05-22) already prepared the Lean side by weakening the `inv_field_001` residual axiom from per-subtree `Tier2.FieldStructure.recursivelyWellformed` to document-level `Tier2.AcceptReject.preservationFriendly`. Fragmented `<w:ins>`/`<w:del>` wrappers containing only `w:instrText`/`w:delInstrText` are NOT `fieldContextNeutral` under `∀ ctx`, but they DO satisfy the weaker `preservationFriendly` predicate. The Lean proof is therefore ready to absorb fragmented engine output with no further Lean changes.

LibreOffice and docx4j already emit fragmented field-edit markup. Pandoc has tracked the equivalent splitting gap for hyperlinks at jgm/pandoc#4609; safe-docx today is in the same non-conformant cohort.

## What Changes

- **Engine: deletion-side field fragmentation.** Within `insertDeletedRun` (`packages/docx-core/src/baselines/atomizer/inPlaceModifier-deletion.ts`), when the atom is a collapsed field (`atom.collapsedFieldAtoms` non-empty), walk the constituent field atoms and emit one cloned run per atom — `w:fldChar` runs at sibling level (unwrapped) and `w:instrText` / result runs wrapped in their own `<w:del>` (with text renamed to `w:delInstrText` / `w:delText`). Per-fieldAtom iteration (not per-source-run) handles both dedicated-run and mixed-run field structures.
- **Engine: insertion- and move-destination handlers UNCHANGED.** ECMA-376 Part 4 bars `w:fldChar` from `<w:del>` only — it permits `w:fldChar` inside `<w:ins>` and `<w:moveTo>`. Fragmenting the inserted side would break the `lean-spec-bridge.test.ts:935` insertion-fixture's wrapper-neutrality over-check AND, more importantly, would destabilize the NVCA regression fixtures that exercise inserted-field paths.
- **Engine: targeted combined-output safety gate.** Extend `pipeline.ts` (which currently validates only `acceptedXml` and `rejectedXml` at line 468) to add a third gate: `hasFldCharInsideDel(combinedXml)` must return false. This is narrower than calling full `validateFieldStructure` on the combined output — it gates only the #217-specific conformance rule. Broader structural validation of the combined output surfaces unrelated legacy non-conformances (e.g., `w:delInstrText` inside `<w:moveFrom>` from `insertMoveFromRun`) that are out of scope for this change.
- **Engine: NO separate field-change classifier needed.** An earlier draft proposed a 5-class `classifyFieldChange` module to distinguish whole-field-insertion from modification. Because we now keep the insertion side unchanged, the only condition the engine needs to check at the deletion site is `atom.collapsedFieldAtoms !== undefined`, which collapses to a one-line predicate. No new module.
- **Tests.** Add `packages/docx-core/src/integration/field-fragmentation.test.ts` with fixtures for FORMCHECKBOX → FORMTEXT (with result change), HYPERLINK target rewrite, PAGEREF instr rewrite, bookmarked field modification, result-only NUMPAGES change, and whole-field deletion. Each asserts (a) no `w:fldChar` appears inside `<w:del>` and (b) `validateFieldStructure` holds on combined + accept + reject. Update `collapsed-field-inplace.test.ts:211` from "multi-run inside one w:del" to "fldChar at sibling level + single-payload w:del wrappers." Update the unit test in `inPlaceModifier.test.ts:1269` similarly. Bridge test deletion fixture stays on `assertFieldInvariant` only.
- **No Lean changes.** PR #220 already weakened the axiom. `inv_field_001` proof path consumes only `preservationFriendly` and `field_structure_preserved_doc`.
- **Whole-field deletion semantics**: Decision recorded in `design.md` Decision 4. The fragmentation produces `[begin][separate][end]` as the accept-state field shell. Phase 9 manual round-trip in Word + LibreOffice will confirm rendering is acceptable; if not, revisit.

## Impact

- **Affected specs:** `docx-comparison` (new requirement: ECMA-376 field-fragmentation conformance).
- **Affected code:**
  - `packages/docx-core/src/baselines/atomizer/inPlaceModifier.ts` — `isCollapsedFieldAtom` predicate, `insertFragmentedDeletedField` helper, rewired `insertDeletedRun`
  - `packages/docx-core/src/baselines/atomizer/pipeline.ts` — `hasFldCharInsideDel` helper + targeted combined-output gate
  - `packages/docx-core/src/integration/field-fragmentation.test.ts` (NEW)
  - `packages/docx-core/src/integration/collapsed-field-inplace.test.ts` (assertion updates)
  - `packages/docx-core/src/baselines/atomizer/inPlaceModifier.test.ts` (unit test updates)
  - `packages/docx-core/src/integration/lean-spec-bridge.test.ts` (deletion-fixture comment refresh)
- **Acceptance criteria (from issue #217):**
  - Output of `compareDocumentsAtomizer` for a field-modification scenario contains unwrapped `w:fldChar` markers at run-sibling level.
  - Output never contains `w:fldChar` inside `<w:del>` (engine-side; the runtime check from PR #211 already enforces it post-hoc).
  - Microsoft Word renders the field result correctly after accept on a modified-field output.
  - LibreOffice round-trips the modified-field DOCX without discarding the field.
