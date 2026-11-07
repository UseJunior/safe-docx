# Change: Coalesce projection-equivalent bookmark splits

## Why
Comparing the NVCA Stock Purchase Agreement with a one-paragraph deletion lost bookmark `_Ref146362505` on Reject All (#1280). The bookmark starts inside the deleted paragraph in the original, and at the opening of the next paragraph in the revision. Publication split it into an original-side and a revised-side range, then resolved the resulting duplicate name by renaming the original side to `_safe_docx_original_1`, so Reject All no longer reproduced the original name. Yet the original range, left where it is, already lands on the revised range once Accept All removes the deleted paragraph: the split was redundant.

The same split also left an empty `<w:del/>` behind when bookmark hoisting lifted the only marker out of the deletion alternative (#1281).

## What Changes
- Publication collapses a split bookmark back to its single source range when that range, verified against both projections, reproduces the original range under Reject All and the revised range under Accept All. The collision-safe rename still applies to every split that cannot be collapsed.
- Bookmark hoisting removes a revision wrapper it leaves with no content.
- A real-corpus gate asserts the bookmark inventory under both projections and the absence of empty `w:ins`/`w:del` across the NVCA corpus.

## Impact
- Affected specs: docx-comparison
- Affected code: `packages/docx-compare/src/tagged/bookmarkSplitCoalescing.ts`, `pipeline.ts`, `consumerCompatibility.ts`
