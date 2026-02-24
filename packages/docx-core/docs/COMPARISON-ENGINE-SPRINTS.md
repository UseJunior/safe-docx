# Comparison Engine Sprints (docx-comparison-inplace)

Scope: in-house comparison engines (atomizer rebuild + inplace). Aspose `.compare()` is out of scope.

Spec reference: `openspec/changes/refactor-docx-comparison-inplace-ast/specs/docx-comparison-inplace/spec.md`

## Sprint 1: Paragraph-First Matching Baseline

Goal (demoable): unchanged paragraphs produce zero diffs even when run boundaries differ.

Tasks (atomic, testable):
- Implement exact paragraph match handling in hierarchical LCS to skip atom-level diff for those groups; validation: unit test for exact paragraph match classification.
- Add paragraph text normalization rules (whitespace collapse, casing) for similarity checks; validation: unit tests for normalization and similarity thresholds.
- Add regression test for run-boundary-only changes to assert no insertions/deletions; validation: new test in `packages/docx-comparison/src/baselines/atomizer/`.
- Ensure format detection still links revised atoms to original where possible for exact paragraph matches; validation: format-detection unit test with formatting-only change.
- Document paragraph-first behavior in docx-comparison docs; validation: doc updated and referenced in README or status doc.

Demo:
- Run `packages/docx-comparison/src/integration/round-trip.test.ts` on a fixture with identical text and different runs; expect zero diffs.

## Sprint 2: In-Place Track Changes Fidelity

Goal (demoable): generated track changes accept/reject round-trip matches revised/original with preserved structure.

Tasks (atomic, testable):
- Add/expand unit tests for `wrapAsInserted`, `wrapAsDeleted`, and paragraph-level w:ins/w:del wrapping; validation: unit tests in `packages/docx-comparison/src/baselines/atomizer/inPlaceModifier.test.ts`.
- Add unit test for move markers (`w:moveFrom`/`w:moveTo`) with range markers; validation: `inPlaceModifier` tests.
- Add unit test for `rPrChange` generation on format-only changes; validation: `packages/docx-comparison/src/format-detection.test.ts`.
- Add round-trip integration test for accept-all and reject-all correctness in inplace mode; validation: `packages/docx-comparison/src/integration/round-trip.test.ts`.

Demo:
- Produce an inplace comparison docx and run accept/reject using existing test harness; validate paragraph counts and text parity.

## Sprint 3: Rebuild Mode Parity and Fallback

Goal (demoable): rebuild mode uses paragraph-first matching and matches prior behavior without false positives.

Tasks (atomic, testable):
- Ensure hierarchical paragraph-first comparison is shared by rebuild mode; validation: unit test that rebuild uses same LCS results.
- Add regression test for run-boundary-only changes in rebuild mode; validation: integration test with `reconstructionMode: 'rebuild'`.
- Update compare parity tests to reflect reduced false positives; validation: `packages/docx-comparison/src/integration/atomizer-parity.test.ts`.
- Add stats sanity check for modified paragraphs count when no diffs; validation: unit test around `computeStats`.

Demo:
- Run rebuild comparison on run-boundary fixture; confirm no track changes emitted.

## Sprint 4: Cleanup, Docs, and Operational Hardening

Goal (demoable): stable, documented comparison engine with clear fallbacks and diagnostics.

Tasks (atomic, testable):
- Decide on removal or retention of reconstruction code and document rationale; validation: docs update and code references cleaned.
- Add debug logging toggles for paragraph-first decisions (behind a flag); validation: unit test or snapshot of logs.
- Update status docs and OpenSpec tasks checklist to reflect completion; validation: checklist items marked and `openspec validate` clean.
- Add a minimal “comparison checklist” for manual QA (Word accept/reject); validation: doc added to `packages/docx-comparison/docs/`.

Demo:
- Provide a documented comparison checklist and a sample output docx that passes manual QA.

## Subagent Review Prompt

Review this sprint plan for missing tasks, risky assumptions, or insufficient validation. Suggest improvements to make each sprint demoable and the tasks more atomic or testable.

## Review Notes (applied)

- Add a dedicated regression test for “identical paragraph text with different run boundaries” in both inplace and rebuild modes.
- Ensure format-detection mapping is explicitly validated for exact paragraph matches to avoid regressions.
- Include a manual QA checklist for Word accept/reject to catch formatting regressions not covered by unit tests.
