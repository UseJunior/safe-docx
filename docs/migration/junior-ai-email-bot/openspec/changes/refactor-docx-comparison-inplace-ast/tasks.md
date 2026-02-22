# Tasks: Refactor docx-comparison to In-Place AST Manipulation

Sprint plan reference: `packages/docx-comparison/docs/COMPARISON-ENGINE-SPRINTS.md`

## Phase 1: Foundation (Utilities)

- [x] Add `wrapElement()` utility to wrap an element with a new parent
- [x] Add `insertAfterElement()` utility for sibling insertion
- [x] Add `insertBeforeElement()` utility for sibling insertion
- [x] Add `prependChild()` utility for prepending children
- [x] Add `createElement()` factory for creating new elements
- [x] Add unit tests for all new utilities
- [x] Add `sourceRunElement` reference to `ComparisonUnitAtom` interface

## Phase 2: Atom-AST Linking

- [x] Update `atomizeTree()` to store reference to source `w:r` element on each atom
- [x] Update pipeline to parse revised document as full AST (not just atoms)
- [x] Verify atoms correctly reference their source elements with unit tests

## Phase 3: Core Modification Operations

- [x] Implement `wrapAsInserted()` - wrap run element with `<w:ins>`
- [x] Implement `wrapAsDeleted()` - wrap run element with `<w:del>` and convert `w:t` to `w:delText`
- [x] Implement `insertDeletedRun()` - clone deleted run from original and insert
- [x] Implement `insertDeletedParagraph()` - clone entire deleted paragraph and insert
- [x] Add unit tests for each modification operation

## Phase 4: Move and Format Change Handling

- [x] Implement `wrapAsMoveFrom()` - wrap with `<w:moveFrom>` and add range markers
- [x] Implement `wrapAsMoveTo()` - wrap with `<w:moveTo>` and add range markers
- [x] Implement `addFormatChange()` - add `<w:rPrChange>` to run properties
- [x] Add unit tests for move and format change operations

## Phase 5: In-Place Modifier

- [x] Create `inPlaceModifier.ts` with main `modifyRevisedDocument()` function
- [x] Implement insertion ordering logic (track position for deleted content insertion)
- [x] Implement paragraph-level change handling
- [x] Handle empty paragraph removal (when all content was inserted)

## Phase 6: Pipeline Integration

- [x] Add `reconstructionMode` option: `'inplace' | 'rebuild'`
- [x] Update `compareDocumentsAtomizer()` to support both modes
- [x] Default to `'rebuild'` initially for backward compatibility

## Phase 7: Validation

- [x] Run all 10 round-trip tests with `'inplace'` mode
- [x] Compare output with `'rebuild'` mode for ILPA documents
- [x] Manually verify output DOCX in Microsoft Word
- [x] Verify track changes can be accepted/rejected in Word

## Phase 8: Cleanup

- [x] Set `'inplace'` as default mode
- [ ] Remove reconstruction code (`buildDocument`, `buildParagraphXml`, `buildRunContent`)
- [ ] Update documentation and comments
- [ ] Remove dead code and unused utilities

## Phase 9: Paragraph-First Comparison (All In-House Engines)

- [ ] Add paragraph-level normalization and matching pass in hierarchical LCS flow
- [ ] Identify unchanged paragraphs and skip atom-level diff for those ranges
- [ ] Limit atomization/diff to changed paragraph pairs
- [ ] Preserve existing output for unchanged paragraphs in both `inplace` and `rebuild` modes
- [ ] Add unit tests for paragraph-level matching decisions
- [ ] Add regression test covering run-boundary-only changes
- [ ] Add format-detection mapping test for exact paragraph matches

## Phase 10: Rebuild Parity and Stats Validation

- [ ] Add regression test for run-boundary-only changes in rebuild mode
- [ ] Update atomizer parity tests to reflect reduced false positives
- [ ] Add stats sanity check for modified paragraphs count when no diffs

## Phase 11: Manual QA + Documentation

- [ ] Add manual QA checklist for Word accept/reject validation

## Dependencies

- Phase 2 depends on Phase 1 (utilities)
- Phase 3-4 depend on Phase 2 (atom linking)
- Phase 5 depends on Phase 3-4 (core operations)
- Phase 6 depends on Phase 5 (modifier)
- Phase 7 depends on Phase 6 (integration)
- Phase 8 depends on Phase 7 (validation)

## Parallelizable Work

- Phase 1 tasks can be done in parallel
- Phase 3 and Phase 4 can be done in parallel

## Summary

All implementation work (Phases 1-7) is complete. The inplace mode is now the **default**
and has been verified to work correctly in Microsoft Word with both simple fixtures
and the large ILPA documents. Track changes can be accepted/rejected in Word.

Phase 8 cleanup (removing reconstruction code) is deferred - the rebuild mode is
retained for backward compatibility and as a fallback option.

### Files Changed

- `src/core-types.ts` - Added `sourceRunElement` and `sourceParagraphElement` to `ComparisonUnitAtom`
- `src/atomizer.ts` - Updated to populate source element references
- `src/baselines/atomizer/wmlElementUtils.ts` - Added `wrapElement`, `insertAfterElement`, `insertBeforeElement`, `prependChild`, `createElement`
- `src/baselines/atomizer/inPlaceModifier.ts` - NEW: Core in-place modification operations
- `src/baselines/atomizer/pipeline.ts` - Added `reconstructionMode` option and in-place mode support
- `src/index.ts` - Added `reconstructionMode` option to `CompareOptions`
- `test/baselines/atomizer/wmlElementUtils.test.ts` - Tests for new utilities
- `test/baselines/atomizer/inPlaceModifier.test.ts` - NEW: Tests for in-place operations
- `test/atomizer.test.ts` - Tests for atom-AST linking
- `test/integration/round-trip.test.ts` - Added inplace mode round-trip tests
