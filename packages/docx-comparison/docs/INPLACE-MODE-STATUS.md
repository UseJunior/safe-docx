# INPLACE Mode Implementation Status

## Overview

The docx-comparison module has two reconstruction modes:
- **REBUILD mode**: Reconstructs the document from scratch using atom data (working correctly)
- **INPLACE mode**: Modifies the revised document's AST in-place, inserting track changes markup (partially working)

## Current State

### What's Working

1. **Text Content Round-Trip**: Both accept and reject produce correct text content
   - Accept all changes → `Normalized identical: true` with revised document
   - Reject all changes → `Normalized identical: true` with original document
   - All 19 round-trip tests pass

2. **Core Track Changes Markup**:
   - `<w:ins>` wrappers for inserted content
   - `<w:del>` wrappers for deleted content
   - `<w:moveFrom>` / `<w:moveTo>` for moved content
   - Proper revision IDs and author/date attributes

3. **Position Tracking**:
   - Equal atoms correctly reference the revised tree (not original)
   - Empty paragraph atoms properly reset position tracking
   - Unified paragraph indices map correctly between original/revised

### Known Issues

#### 1. Formatting Loss on Reject

**Symptom**: When rejecting all changes in Word, the text content is correct but formatting is disrupted.

**Likely Causes**:
- When inserting deleted content from original, we clone the run element but may lose:
  - Paragraph-level formatting (`<w:pPr>`)
  - Section properties
  - Style references that don't exist in revised document
  - Numbering/list definitions
- The `<w:del>` wrapper strips some formatting context

**Files involved**:
- `src/baselines/atomizer/inPlaceModifier.ts` - `insertDeletedRun()`, `cloneRunForInsertion()`
- `src/baselines/atomizer/trackChangesAcceptorAst.ts` - `rejectAllChanges()`

#### 2. Excessive Track Changes (False Positives)

**Symptom**: Insertions and deletions appear where the before/after text is identical.

**Likely Causes**:

a) **Atom-level granularity issues**:
   - The LCS operates at the atom (text run) level
   - Minor structural differences (run boundaries, whitespace) cause mismatches
   - Two identical paragraphs with different internal run structure appear as "delete old + insert new"

b) **Similarity threshold behavior**:
   - `hierarchicalLcs.ts` uses a 0.25 similarity threshold for paragraph matching
   - Low-similarity matches (< 0.25) treat entire paragraphs as replaced
   - This is intentional to avoid spurious atom matches, but may be too aggressive

c) **Hash-based paragraph grouping**:
   - Paragraphs are grouped by content hash
   - Minor differences (whitespace, run structure) create different hashes
   - Semantically identical paragraphs may not match

**Files involved**:
- `src/baselines/atomizer/hierarchicalLcs.ts` - `computeGroupLcs()`, similarity threshold
- `src/baselines/atomizer/atomLcs.ts` - atom-level LCS
- `src/baselines/atomizer/atomizer.ts` - how atoms are created from runs

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      compareDocuments()                          │
│                         (index.ts)                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    atomizerCompare()                             │
│              (baselines/atomizer/atomizer.ts)                    │
│                                                                  │
│  1. Parse both documents to WmlElement AST                       │
│  2. Extract atoms (text runs) from each document                 │
│  3. Run hierarchical LCS to find matches/deletions/insertions    │
│  4. Mark correlation status on each atom                         │
│  5. Detect moves (deleted content that appears as inserted)      │
│  6. Assign unified paragraph indices                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│    REBUILD Mode         │     │    INPLACE Mode         │
│  (documentReconstructor │     │  (inPlaceModifier.ts)   │
│        .ts)             │     │                         │
│                         │     │  Modifies revised AST:  │
│  Builds new document    │     │  - Wrap inserted runs   │
│  from scratch using     │     │    in <w:ins>           │
│  atom data              │     │  - Clone & insert       │
│                         │     │    deleted runs with    │
│                         │     │    <w:del>              │
│                         │     │  - Handle moves with    │
│                         │     │    <w:moveFrom/To>      │
└─────────────────────────┘     └─────────────────────────┘
```

## Key Data Structures

### ComparisonUnitAtom
```typescript
interface ComparisonUnitAtom {
  contentElement: WmlElement;      // The w:t, w:br, etc.
  sourceRunElement?: WmlElement;   // Parent w:r element
  sourceParagraphElement?: WmlElement;  // Parent w:p element
  correlationStatus: CorrelationStatus;
  paragraphIndex?: number;         // Unified paragraph index
  moveName?: string;               // For moved content
  ancestorElements: WmlElement[];  // Chain from root to content
}
```

### CorrelationStatus
```typescript
enum CorrelationStatus {
  Equal,           // Content exists in both documents
  Deleted,         // Content only in original (will be wrapped in w:del)
  Inserted,        // Content only in revised (will be wrapped in w:ins)
  MovedSource,     // Content moved FROM here (w:moveFrom)
  MovedDestination,// Content moved TO here (w:moveTo)
  FormatChanged,   // Same content, different formatting
}
```

## Future Directions

### 1. Improve Formatting Preservation

**Approach A: Smarter Run Cloning**
- When cloning runs for `<w:del>`, also preserve paragraph properties
- Ensure style IDs referenced in cloned content exist in the document
- Copy numbering definitions if needed

**Approach B: Paragraph-Level Track Changes**
- For paragraphs that are entirely deleted, use paragraph-level `<w:del>` wrapping
- Preserves paragraph formatting better than run-level wrapping

**Files to modify**:
- `inPlaceModifier.ts`: `insertDeletedRun()`, `insertDeletedParagraph()`

### 2. Reduce False Positive Changes

**Approach A: Normalize Before Comparison**
- Normalize run boundaries before atomization
- Merge adjacent runs with identical formatting
- Strip insignificant whitespace differences

**Approach B: Tune Similarity Thresholds**
- Experiment with different thresholds in `hierarchicalLcs.ts`
- Consider content-aware thresholds (stricter for short paragraphs)

**Approach C: Post-Processing Cleanup**
- After marking changes, merge adjacent same-status atoms
- Collapse `<w:del>text</w:del><w:ins>text</w:ins>` to plain text if content matches

**Files to modify**:
- `atomizer.ts`: Add normalization step
- `hierarchicalLcs.ts`: Adjust `similarityThreshold`
- New file for post-processing cleanup

### 3. Investigate Specific Cases

**Debug Strategy**:
1. Find a minimal example with false positives
2. Extract the specific paragraphs from original/revised
3. Trace through atomization and LCS to see why they don't match
4. Check atom content, hashes, and similarity scores

**Useful Debug Scripts**:
- `debug-ilpa-inplace-reject.mjs` - Tests reject roundtrip
- `debug-atom-indices.mjs` - Inspects unified paragraph indices

### 4. Consider Alternative Approaches

**Paragraph-First Comparison**:
- Compare paragraphs first (by normalized text content)
- Only do atom-level diff within changed paragraphs
- Would reduce false positives for unchanged paragraphs

**Hybrid Mode**:
- Use REBUILD for the track changes structure
- But preserve original document's styles/formatting as base
- Best of both worlds but more complex

## Threshold Calibration Note (2026-02-19)

To reduce paragraph-level delete/insert false positives in real DOCX edits, we calibrated
the paragraph-group Jaccard threshold against both synthetic examples and a real
certificate-of-incorporation document edit.

### Why threshold changed

- Prior default (`0.5`) classified some natural "replace + insertion" paragraph edits as
  low-similarity, causing whole-paragraph replacement markup.
- In the real test document, two changed paragraphs had Jaccard scores around:
  - Title paragraph: `0.25` (group text extraction), `0.333` (visible text with line breaks as separators)
  - Main edited paragraph: `0.35`
- At `0.5`, both paragraphs were treated as deleted+inserted groups.
- At `0.25`, both paragraphs aligned as matched groups and atom-level comparison ran,
  producing more readable redlines.

### Experiment summary

- Synthetic calibration set covered: identical, punctuation/case, single-token replace,
  insertion-heavy edits, deletion, reorder, synonym rewrite, and complete replacement.
- Observed behavior:
  - Insertions frequently land in `~0.5-0.65`
  - Heavy synonym rewrites tend to be `<0.2`
  - Real legal "replace + additional detail" paragraph scored `~0.35`
- Threshold sweep on the real certificate edit:
  - `0.50`: neither key paragraph matched
  - `0.40`: neither key paragraph matched
  - `0.35`: main paragraph matched; title did not
  - `0.30`: main paragraph matched; title did not
  - `0.25`: both matched

### Decision

- Set `DEFAULT_PARAGRAPH_SIMILARITY_THRESHOLD = 0.25` in
  `src/baselines/atomizer/hierarchicalLcs.ts`.
- Keep threshold centralized as a single constant for maintainability.

## Test Files

- `src/integration/round-trip.test.ts` - Main round-trip tests (19 tests)
- `src/testing/fixtures/` - Simple test documents
- Test documents: `tests/test_documents/redline/ILPA-*.docx`

## Commands

```bash
# Run all round-trip tests
npx vitest run src/integration/round-trip.test.ts

# Run with verbose output
npx vitest run --reporter=verbose src/integration/round-trip.test.ts

# Run specific test
npx vitest run -t "inplace reject"

# Build after changes
npm run build

# Generate comparison for manual inspection
node run-ilpa-comparison.mjs
open ILPA-comparison-result.docx
```

## Summary

The INPLACE mode correctly preserves text content in both directions (accept → revised, reject → original). The main issues are:

1. **Formatting loss** - Cloned deleted content loses some formatting context
2. **False positives** - Identical content sometimes marked as changed due to structural differences

These are quality-of-life issues rather than correctness issues - the core algorithm is working. Future work should focus on formatting preservation and reducing noise in the diff output.
