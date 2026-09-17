# Change: Repair paragraph-merge formatting without losing numbering

## Why

PR #980 exposes a default-path numbered-paragraph regression when note-bearing moves are represented as deletion/insertion. The whole-paragraph deletion normalizer moves the deleted break to the preceding paragraph and emits a synthetic paragraph-format revision. LibreOffice 26.2.5.2 rejects that format revision by removing numbering before restoring properties; the resulting heading can retain `text:is-list-header="true"` and lose its visible number.

A public-document control retaining the exact original paragraph properties, without that synthetic format revision, matches LibreOffice's source/revised text, note bindings, paragraph count, heading styles, outline levels and numbering flags on both projections. However, native Accept assigns the following paragraph's style to the surviving predecessor. Merely deleting the format revision would therefore fail the existing native formatting gate. Moving the deletion mark back to its original paragraph instead leaves an extra empty paragraph in LibreOffice Accept.

## What Changes

- Establish an independently checked paragraph-merge formatting decision table before changing the current following-mark formatting rule.
- Separate the decision to remove a paragraph break from the decision about the surviving paragraph's formatting. Preserve the existing mark-based, not content-only, removal contract.
- Correct comparison and core projection implementations only for cases justified by normative and reader evidence. Do not assume that LibreOffice alone defines Word behavior.
- Replace the synthetic formatting compensation where the corrected, verified merge rule makes it unnecessary. Remove superseded local numbering-snapshot experiments rather than maintaining two competing repairs.
- Add reader regressions that distinguish normal renumbering after a move from missing numbering, and verify both original and revised formatting, including neighboring paragraphs.
- Preserve independent release verification; do not import the production projector into its verifier to make checks agree.
- Owner-approved extension (September 15, 2026, "yes, extend it"): repair field-aware tracked-paragraph emission where deletion leaves field controls alive and transfers deleted formatting onto a surviving paragraph. Characterize complete, multiple, nested and partial field boundaries; preserve field and bookmark semantics and do not weaken native or reader gates.
- Owner-approved blocker extension (September 17, 2026, "fix the blocker and then ship the fixes"): repair the interaction between retained live section properties and paragraph-mark merging in #984. Characterize alignment, page setup, bindings and mixed histories independently. Base-format restoration must not be silently suppressed by an existing section boundary; do not represent reader evidence about alignment as full section-layout or Word verification.

## Impact

- Specs: `docx-comparison`, `docx-primitives`.
- Expected code: comparison serializer and AST projector, core accept/reject primitives, focused regression tests. Audit release-verifier structural projection but do not expand its claimed formatting coverage without separate evidence.
- Potential behavior change: formatting of paragraphs merged by accepting deleted or rejecting inserted paragraph marks. Existing tests explicitly assert following-paragraph formatting, so this is broader than a note-ID repair and requires owner approval.
- Existing mark-based proposals and the LibreOffice oracle trust-boundary work remain authoritative for paragraph removal and evidence limitations.
- No hosted API, runtime renderer dependency, private fixtures, force push or primary-worktree mutation. Word remains UNVERIFIED unless fresh Word evidence is actually obtained.

## Approval and delivery gate

This proposal is not implementation approval. PR #980 stays on hold. After approval, establish the decision table first; if normative evidence and reader behavior cannot be reconciled, stop with the conflicting cases instead of silently adopting LibreOffice behavior or weakening formatting checks. Repeat Claude Opus 5 dynamic review, full local/corpus/schema gates and shipping smoke only after the repair passes.
