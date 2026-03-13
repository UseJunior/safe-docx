# Fix: Premerge-Enabled Inplace Safety Check Failure (Issue #35)

## Problem

When `premergeRuns: true` (the default since v0.3), the ILPA corpus comparison with `reconstructionMode: 'inplace'` fails the round-trip safety check and falls back to rebuild. All four adaptive inplace passes (`inplace_word_split`, `inplace_run_level`, `inplace_word_split_cross_run`, `inplace_run_level_cross_run`) fail the `rejectText` check — meaning `rejectAllChanges(reconstructedXml)` does not match `extractTextWithParagraphs(originalXml)`.

## What Has Been Ruled Out

- **Baseline timing**: The safety check baseline (`originalTextForRoundTrip`) is extracted at `pipeline.ts:496` from raw XML *before* any trees are parsed or premerged. This is correct.
- **Collapsed field multi-run packing** (Issue #34, now fixed): The fix to `insertDeletedRun`/`insertMoveFromRun` does not resolve this failure.
- **Text-neutrality of premerge**: Verified empirically — premerge does not add, remove, or reorder text. Pre-premerge and post-premerge `extractTextWithParagraphs` are identical.

## Architecture You Need to Understand

### Pipeline flow (pipeline.ts:500-592)

```
1. Extract baseline text from raw XML                    (line 496-497)
2. Parse fresh DOM trees from raw XML                    (line 512-513)
3. IF premergeRuns: merge adjacent identically-formatted runs  (line 521-523)
4. Atomize both trees (with cloneLeafNodes: true)        (line 526-527)
5. LCS → mark status → move/format detection             (line 540-558)
6. Create merged atom list                               (line 561)
7. Inplace: modifyRevisedDocument(revisedTree, ...)      (line 570-576)
8. Safety check: acceptAll/rejectAll vs. baseline text   (line 585-592)
```

### PremergeRuns (premergeRuns.ts)

Merges adjacent `<w:r>` siblings that have identical `w:rPr` formatting and identical element attributes. Only merges runs whose children are all in `{w:rPr, w:t, w:tab, w:br, w:cr, w:delText}`. Mutates the DOM in-place: moves children from the second run into the first, then removes the second run. Conservative — no semantic change to text.

### preSplitMixedStatusRuns (inPlaceModifier.ts:1292-1409)

After comparison, revised-tree runs may contain atoms with mixed statuses (e.g., part Equal, part Inserted). This function splits those runs at status boundaries so each fragment can be wrapped independently. Has a cross-run safety guard: if atom lengths exceed run visible length (indicating a cross-run merged atom), the run is skipped. Skips collapsed field atoms and field character elements entirely.

### The key interaction

Premerge creates larger runs. Atomization then creates atoms anchored to these larger runs. When atoms get mixed statuses during LCS alignment, `preSplitMixedStatusRuns` must split these larger runs back. If the split doesn't perfectly align with the original run boundaries, the reconstructed output has text in the wrong position after `rejectAllChanges`.

## Investigation Steps

### Step 1: Capture the exact failure diagnostics

Run the ILPA comparison with premerge enabled and dump the `fallbackDiagnostics` from all four failed attempts. The diagnostics contain per-attempt `failureDetails.rejectText` with:
- `firstDifferingParagraphIndex` — which paragraph first diverges
- `expectedParagraph` / `actualParagraph` — the text that should match vs. what was produced
- `differenceSample` — first 3 diff hunks

Write a one-off vitest that runs the comparison and logs these diagnostics as a JSON attachment. Check whether the failure is consistent across all four passes or varies. Look at `firstDifferingParagraphIndex` — is it always the same paragraph? Is it near a field sequence? Near a list/numbering paragraph?

### Step 2: Locate the exact text mismatch

From the diagnostics, identify the first differing paragraph. Then:
1. Parse the reconstructed XML for that attempt
2. Find the paragraph at that index
3. Run `rejectAllChanges` and find the same paragraph
4. Compare the rejected paragraph text to the original paragraph text
5. Determine what text is extra, missing, or reordered

### Step 3: Trace the atom/run topology for that paragraph

For the paragraph identified in Step 2:
1. Run with premerge disabled — does the same paragraph have different atom boundaries?
2. Run with premerge enabled — how many runs exist in that paragraph after premerge vs. before?
3. Check if `preSplitMixedStatusRuns` was invoked for any run in that paragraph (add a debug log or counter)
4. Check if the split points align correctly or if a split happens at a word boundary that doesn't correspond to an original run boundary

### Step 4: Narrow the root cause

The failure is likely one of these scenarios:

**Scenario A: preSplitMixedStatusRuns produces incorrect fragments.** A premerged run gets split at an offset that doesn't match the original run boundary. The fragment's text content doesn't match what the atoms expect, causing `handleInserted`/`handleDeleted` to produce wrong output.

**Scenario B: Atom sourceRunElement points to a premerged run that was not split but should have been.** The cross-run safety guard (`sumAtomLengths > runVisibleLength`) prevents a necessary split. The entire merged run gets wrapped as one status when part of it should be Equal and part Inserted.

**Scenario C: Collapsed field interaction with premerged runs.** When premerge merges a run adjacent to a field sequence, the field atom's `sourceRunElement` (resolved via `findAncestorByTag`) may point to the wrong (merged) run, causing `getAtomRuns` to return incorrect results.

**Scenario D: `visibleLengthForEl` / `atomContentVisibleLength` mismatch.** After premerge, the run's DOM children have been rearranged. If `splitRunAtVisibleOffset` counts differently than atom offset tracking, splits land at wrong positions.

### Step 5: Implement the fix

Based on what you find:

- **If Scenario A**: Fix the split offset calculation in `preSplitMixedStatusRuns` to account for premerged text correctly.
- **If Scenario B**: Relax the cross-run safety guard for non-cross-run atoms in premerged runs, or compute `sumAtomLengths` differently.
- **If Scenario C**: Ensure `attachSourceElementPointers` runs after premerge so atoms point to the correct merged runs.
- **If Scenario D**: Audit `splitRunAtVisibleOffset` vs. `atomContentVisibleLength` for edge cases with `w:tab`, `w:br`, `w:cr` in merged runs.

### Step 6: Validate the fix

1. The ILPA test in `reconstruction-metadata.test.ts` should pass with `reconstructionModeUsed: 'inplace'` and `fallbackReason: undefined` (revert the workaround from commit `82eb861`)
2. The stability-invariants determinism test should pass with inplace mode (revert workaround)
3. The bookmark-semantic-regression ILPA test should pass with inplace mode (revert workaround)
4. All 803 existing docx-core tests should pass
5. The collapsed-field-inplace tests should still pass

### Step 7: Clean up workarounds

Update the three test files that were modified in commit `82eb861` to restore inplace expectations:
- `reconstruction-metadata.test.ts:92-102`: Expect `inplace`, `fallbackReason: undefined`
- `inplace-bookmark-semantic-regression.test.ts:293-296`: Expect `inplace`, `fallbackReason: undefined`
- `stability-invariants.test.ts:201-218`: Expect `inplace`, `failedChecks: []`

Remove the `#35` comments added in those files.

## Key Files

| File | What to look at |
|------|----------------|
| `packages/docx-core/src/baselines/atomizer/pipeline.ts` | Lines 496-592: baseline capture, premerge call, safety check, adaptive passes |
| `packages/docx-core/src/baselines/atomizer/premergeRuns.ts` | Full file (160 lines): run merging logic |
| `packages/docx-core/src/baselines/atomizer/inPlaceModifier.ts` | Lines 1292-1409: `preSplitMixedStatusRuns`; Lines 1549-1580: `handleInserted` |
| `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts` | `rejectAllChanges` (line 496), `extractTextWithParagraphs` (line 629) |
| `packages/docx-core/src/integration/reconstruction-metadata.test.ts` | ILPA inplace test (line 84) |
| `packages/docx-core/src/integration/stability-invariants.test.ts` | ILPA determinism test (line 193) |
| `packages/docx-core/src/integration/inplace-bookmark-semantic-regression.test.ts` | ILPA bookmark test (line 283) |
| `tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx` | Original fixture |
| `tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx` | Revised fixture |

## Constraints

- Do NOT move the baseline text extraction (line 496) — it is correct where it is.
- Do NOT disable premerge as a workaround — it is the correct default for reducing diff noise.
- The fix must not regress any of the 803 existing tests or the 11 collapsed-field tests.
- Prefer the smallest possible code change. The inplace modifier is complex; surgical fixes are safer than refactors.
