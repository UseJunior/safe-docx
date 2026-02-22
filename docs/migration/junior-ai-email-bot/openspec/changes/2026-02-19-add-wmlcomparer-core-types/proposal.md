# Change: Add WmlComparer Core Data Structures

## Why

The docx-comparison package needs TypeScript equivalents of WmlComparer's core C# data structures (`ComparisonUnit`, `ComparisonUnitAtom`) to enable a pure TypeScript implementation of document comparison. These types form the foundation for the atomization pipeline that flattens OOXML into comparable units.

## What Changes

- Add `CorrelationStatus` enum for tracking comparison states (Equal, Inserted, Deleted, MovedSource, MovedDestination, etc.)
- Add abstract `WmlElement` and `OpcPart` interfaces to replace C# `XElement` and `OpenXmlPart` without runtime .NET dependencies
- Add `ComparisonUnit` base interface for any comparison unit (atom or group)
- Add `ComparisonUnitAtom` interface representing the atomic leaf-node unit used in LCS comparison
- Add `createComparisonUnitAtom()` factory function to replicate C# constructor logic

### Move Detection

- Add `detectMovesInAtomList()` algorithm to identify relocated content after LCS comparison
- Add `jaccardWordSimilarity()` for matching deleted/inserted blocks
- Add native Word move markup generation (`w:moveFrom`, `w:moveTo`, range markers)
- Add configurable settings: `detectMoves`, `moveSimilarityThreshold`, `moveMinimumWordCount`

### Format Change Detection

- Add `FormatChanged` to `CorrelationStatus` enum for text equal but formatting differs
- Add `FormatChangeInfo` interface to store old/new run properties and changed property names
- Add `formatChange` property to `ComparisonUnitAtom` for storing format change details
- Add `detectFormatChangesInAtomList()` algorithm to analyze Equal atoms for rPr differences
- Add native Word format change markup generation (`w:rPrChange`, `w:pPrChange`)
- Add configurable setting: `detectFormatChanges` (default: true)

### OOXML Corner Cases for Legal Documents

- Add legal numbering "continuation pattern" detection to correctly render orphan list items (e.g., "4." instead of "3.4" when list jumps levels)
- Add `FootnoteNumberingTracker` for sequential footnote numbering by document order (not raw XML IDs)

## Impact

- Affected specs: docx-comparison (new capability)
- Affected code:
  - `packages/docx-comparison/src/core-types.ts` - Core interfaces and enums
  - `packages/docx-comparison/src/atomizer.ts` - Atom factory function
  - `packages/docx-comparison/src/move-detection.ts` - Move detection algorithm
  - `packages/docx-comparison/src/format-detection.ts` - Format change detection algorithm
  - `packages/docx-comparison/src/numbering.ts` - Legal numbering corner cases
  - `packages/docx-comparison/src/footnotes.ts` - Footnote numbering tracker
- Dependencies: None (pure TypeScript types)
- **Non-breaking**: New types added, existing types unchanged
- **Critical for lawyers**: Fixes document fidelity issues in legal templates (e.g., NVCA Model COI)
- **Critical for format tracking**: Enables detection of formatting-only changes (bold, italic, font size) that would otherwise be invisible in document comparison

## References

- [WmlComparer.cs (GitHub)](https://github.com/OpenXmlDev/Open-Xml-PowerTools/blob/536ca1fb4bcdce1f4c920658bd66807b970393d7/OpenXmlPowerTools/WmlComparer.cs)
- C# `ComparisonUnitAtom` class: lines 2305-2350
- C# `ComparisonUnit` abstract class: lines 2230-2270
- C# `CorrelationStatus` enum: line 2264
- C# `DetectMovesInAtomList()`: line 3811
- C# move detection settings: `DetectMoves`, `MoveSimilarityThreshold`, `MoveMinimumWordCount`
- ECMA-376 `w:rPrChange` (Run Property Change): Part 1, Section 17.3.2.28
- ECMA-376 `w:pPrChange` (Paragraph Property Change): Part 1, Section 17.3.1.29
