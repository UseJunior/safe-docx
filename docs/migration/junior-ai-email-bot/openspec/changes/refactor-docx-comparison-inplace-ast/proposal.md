# Change: Refactor docx-comparison to In-Place AST Manipulation

## Why

The current docx-comparison pipeline **reconstructs documents from scratch** using string concatenation and regex extraction, which has caused bugs and is difficult to maintain:

1. **Fragile regex patterns**: The `buildDocument()` function uses regex like `/<w:body[^>]*>([\s\S]*?)(<\/w:body>)/` to extract document structure. A regex bug with `sectPr` extraction caused 2x text duplication in large documents.

2. **Loss of document fidelity**: Reconstructing paragraphs from atoms loses non-content elements (bookmarks, comments, custom XML) that weren't atomized.

3. **Complex atom-to-XML mapping**: `buildParagraphXml()` and `buildRunContent()` manually rebuild OOXML structure, requiring careful handling of properties, attributes, and nesting.

4. **Maintenance burden**: 400+ lines of reconstruction code vs. what could be simple tree modifications.

We now have **AST manipulation utilities** (`wmlElementUtils.ts`) that enable reliable in-place tree operations. This change leverages those utilities to replace reconstruction with in-place modification.

The current comparison also matches at atom granularity across the whole document. This causes false
positive insertions/deletions when run boundaries differ but paragraph text is unchanged. We need a
paragraph-first comparison pass to avoid spurious diffs in all in-house comparison engines.

## What Changes

Replace document reconstruction with in-place modification of the **revised document's AST**:

### Current Flow (Reconstruction)
```
Original XML ──┐
               ├──> atomize ──> compare ──> reconstruct new XML from scratch
Revised XML  ──┘
```

### New Flow (In-Place Modification)
```
Original XML ──> atomize ─┐
                          ├──> compare ──> modify revised AST ──> serialize
Revised XML ──> parse ────┘
```

### Key Architectural Changes

1. **Parse revised document to WmlElement tree** (keep full structure, not just atoms)

2. **Modify revised tree in-place**:
   - For inserted atoms: wrap parent `w:r` with `<w:ins>` element
   - For deleted atoms: clone from original, wrap with `<w:del>`, insert at correct position
   - For moves: wrap with `<w:moveFrom>`/`<w:moveTo>` and add range markers
   - For format changes: add `<w:rPrChange>` to run properties

3. **Serialize modified tree** using existing `serializeToXml()`

4. **Compare at paragraph level first**:
   - Identify unchanged paragraphs with normalized text comparison
   - Run atom-level diff only for changed/replaced paragraphs
   - Apply to all in-house comparison engines (inplace and rebuild), excluding Aspose `.compare()`

### Benefits

- **Preserves document structure**: Headers, footers, styles, sectPr, bookmarks all preserved naturally
- **No regex extraction**: Tree operations replace string manipulation
- **Simpler code**: ~400 lines of reconstruction → ~150 lines of tree modification
- **More testable**: Can unit test individual tree operations
- **Matches modern XML tooling patterns**: DOM manipulation vs. string templating
- **Fewer false positives**: Paragraph-level matching avoids noisy changes from run boundary shifts

## Impact

- Affected code:
  - `packages/docx-comparison/src/baselines/atomizer/documentReconstructor.ts` - Major refactor
  - `packages/docx-comparison/src/baselines/atomizer/pipeline.ts` - Update to use new flow
  - `packages/docx-comparison/src/baselines/atomizer/wmlElementUtils.ts` - Add insertion helpers
  - `packages/docx-comparison/src/baselines/atomizer/xmlToWmlElement.ts` - May need clone-with-parent
  - `packages/docx-comparison/src/baselines/atomizer/hierarchicalLcs.ts` - Paragraph-first comparison
  - `packages/docx-comparison/src/baselines/atomizer/atomizer.ts` - Limit atomization to changed paragraphs
- Affected tests:
  - `test/integration/round-trip.test.ts` - Existing tests validate correctness
  - New unit tests for in-place modification operations
- Dependencies: None (uses existing utilities)
- **Non-breaking**: Same output format, just different internal implementation
- **Risk mitigation**: Keep old reconstruction code until new approach passes all tests
