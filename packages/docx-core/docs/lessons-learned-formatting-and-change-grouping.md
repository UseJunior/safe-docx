# Lessons Learned: Formatting Leakage and Change Grouping

This document captures insights from fixing two issues in the document comparison output:
1. Spurious formatting appearing in unchanged content
2. Interleaved deletions/insertions being hard to read

## Issue 1: Formatting Leakage

### Symptom
Underlining (or other formatting) appeared in sections where neither the original nor revised document had it.

### Root Cause
In `documentReconstructor.ts`, run properties (`rPr`) were extracted from atom ancestors without tracking which document the atom came from:

```typescript
const rPr = rAncestor ? findChildByTag(rAncestor, 'w:rPr') : null;
```

The problem: atoms retain references to their original XML tree. When atoms from different documents are merged:
- Deleted atoms have ancestors from the **original** document
- Inserted atoms have ancestors from the **revised** document
- Equal atoms could have ancestors from either document

Without tracking the source, formatting from one document could "leak" into content from the other.

### Solution
1. Added `sourceDocument: 'original' | 'revised'` field to `ComparisonUnitAtom`
2. Set `sourceDocument` during atom merging in `createMergedAtomList()`
3. Validate rPr extraction matches atom status:

```typescript
const shouldUseRPr =
  (atom.sourceDocument === 'original' && atom.correlationStatus === CorrelationStatus.Deleted) ||
  (atom.sourceDocument === 'revised' && atom.correlationStatus !== CorrelationStatus.Deleted);
const rPr = shouldUseRPr && rAncestor ? findChildByTag(rAncestor, 'w:rPr') : null;
```

### Key Insight
**Always track provenance when merging data from multiple sources.** The atom's `ancestorElements` array contains live references to XML nodes, so we need explicit tracking of which document tree they belong to.

---

## Issue 2: Interleaved Changes

### Symptom
Word-level diffing produced alternating deletions and insertions that were hard to read:

```
<del>such</del> <ins>the</ins> <del>Partner's</del> <ins>sum</ins>
```

Users expected grouped changes:
```
<del>such Partner's</del> <ins>the sum</ins>
```

### Root Cause
The initial consolidation logic only merged **adjacent** same-status groups:

```typescript
if (prev && prev.status === current.status) {
  prev.atoms.push(...current.atoms);  // Merge
}
```

But whitespace atoms between changes were marked as `Equal`, breaking the chain:
```
[Del] [Equal:space] [Ins] [Equal:space] [Del] [Equal:space] [Ins]
```

### Approaches Tested

#### Approach 1: Consolidate Across Whitespace
Merge same-status groups that are separated only by whitespace.

**Problem**: Absorbing whitespace into one status (e.g., deletion) means it disappears when you accept/reject. This broke round-trip tests:
- Expected: "sale or other disposition"
- Actual: "sale or otherdisposition" (missing space)

#### Approach 2: Reorder Change Blocks (Selected)
Identify "change blocks" (contiguous regions with Del/Ins/whitespace) and:
1. Collect all deletions together
2. Collect all insertions together
3. **Duplicate** whitespace into both groups

```typescript
// Duplicate whitespace into both deletions and insertions
for (const atom of whitespaceGroup.atoms) {
  deletions.push({ ...atom, correlationStatus: CorrelationStatus.Deleted });
  insertions.push({ ...atom, correlationStatus: CorrelationStatus.Inserted });
}
```

**Why it works**: Whether you accept or reject changes, the whitespace is preserved because it exists in both the deleted and inserted content.

#### Approach 3: Mark Adjacent Whitespace as Changed
Similar concept to Approach 2 but applied incrementally rather than in blocks.

### Solution
Used Approach 2 (`reorderChangeBlocks`). The output becomes:
```
<del>such Partner's</del> <ins>the sum</ins>
```

With whitespace duplicated, accept-all produces "the sum" and reject-all produces "such Partner's" - both correctly spaced.

### Key Insight
**When reordering content for presentation, preserve invariants for all operations.** The accept/reject operations expect certain content to be present. By duplicating whitespace into both del and ins, we ensure it's always available regardless of which operation is performed.

---

## General Lessons

### 1. Track Data Provenance
When merging data from multiple sources (original/revised documents), explicitly track where each piece came from. Don't rely on implicit relationships that may not survive transformation.

### 2. Test Round-Trip Invariants
Any transformation of track changes must preserve:
- Accept all → matches revised document
- Reject all → matches original document

These are strong invariants that catch many subtle bugs.

### 3. Whitespace is Content
In document comparison, whitespace matters. Approaches that "absorb" or "skip" whitespace often break because the whitespace is meaningful content that must be preserved in the output.

### 4. Presentation vs. Semantics
The change grouping is a **presentation** optimization - it doesn't change what was added or removed, just how it's displayed. Such optimizations must not alter the semantic meaning (what accept/reject produces).

---

## Files Modified

| File | Change |
|------|--------|
| `src/core-types.ts` | Added `sourceDocument` field |
| `src/baselines/atomizer/atomLcs.ts` | Set `sourceDocument` during merging |
| `src/baselines/atomizer/documentReconstructor.ts` | rPr validation, `reorderChangeBlocks()` |
| `src/atomizer.ts` | Word-level splitting, punctuation merging |
| `src/baselines/atomizer/hierarchicalLcs.ts` | Use config threshold instead of hardcoded value |

---

## References

- OOXML Track Changes: `w:ins`, `w:del`, `w:delText`
- Run Properties: `w:rPr` contains formatting (bold, italic, underline, etc.)
- Related commit: `d4f8cd2f` - Fix formatting leakage and group consecutive changes
