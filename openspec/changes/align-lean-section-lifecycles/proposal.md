# Change: Verify inserted-section relationship stories

## Why

The compiled verifier aligns selected header/footer stories by equal raw
section ordinals. A valid in-place redline that inserts a paragraph-boundary
section cannot satisfy that rule even when production accept/reject is exact:
rejecting compared recovers the original section inventory, while accepting it
recovers the revised inventory. The verifier consequently emits
`SECTION_COUNT_MISMATCH` before checking the inserted footer and then reports a
cascading incomplete comment-source partition.

Production currently supplies positive tracked evidence for inserted sections.
It does not yet supply symmetric tracked deletion evidence for removed
header/footer stories; that separate comparison-engine gap is tracked by #754.
This increment therefore certifies insertion only and remains fail-closed for
deleted or ambiguous boundaries.

## What Changes

- Modify the existing relationship-story alignment requirement with protocol
  v8 after the pending protocol-v7 comment-range change, rather than
  introducing a parallel selector contract.
- Classify only one exact direct paragraph-mark insertion shape and reject
  duplicate, misplaced, deleted, or contradictory lifecycle markers.
- Project compared sections under reject and accept semantics, aligning the
  reject projection to original and the accept projection to revised.
- Represent every slot/story side with an exact present/absent discriminated
  union; only the original side of a proven inserted section may be absent.
- Treat that proven-absent original story as zero tokens without resolving,
  extracting, parsing, or charging it to resource budgets.
- Make each package's note reference-source partition a bijection over main
  plus present relationship stories, and its comment source set that same
  partition plus present footnotes/endnotes.
- Add exact per-side work/resource evidence so absence and present-work charges
  are observable to the strict bridge.
- Add compiled proof/audit coverage and an end-to-end regression derived from
  an already checked-in, redistributable CC BY 4.0 Common Paper Word document.

## Impact

- Affected spec: `docx-comparison`
- Affected code:
  - `verification/lean/Tier2/RelationshipStorySelector.lean`
  - `verification/lean/LeanDocxChecker.lean`
  - `verification/lean/Tier2/CommentReferenceIntegrity/**`
  - `packages/docx-compare/src/baselines/atomizer/leanXmlVerifier.ts`
  - `packages/docx-compare/src/compare-types.ts`
  - focused real-DOCX integration test and fixture provenance manifest
  - compiled-verifier tests, audits, and coverage ledgers
- Related issues: #747, #754, #718
- Dependencies/non-goals:
  - implement only after `verify-lean-comment-range-topology` establishes
    protocol v7; this proposal is its protocol-v8 successor;
  - no new ZIP syntax (#745), XML syntax (#714), or rebuild certification;
  - no deletion-side certificate success until #754 provides production
    tracked deletion evidence.
