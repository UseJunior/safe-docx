# Tasks: Add WmlComparer Core Types

## 1. Core Type Definitions

- [x] 1.1 Create `src/core-types.ts` with `CorrelationStatus` enum
- [x] 1.2 Add `OpcPart` interface for package part identification
- [x] 1.3 Add `WmlElement` interface for abstract XML element representation
- [x] 1.4 Add `ComparisonUnit` base interface
- [x] 1.5 Add `ComparisonUnitAtom` interface extending `ComparisonUnit`
- [x] 1.6 Export all types from `src/index.ts`

## 2. Factory Function

- [x] 2.1 Create `src/atomizer.ts` module
- [x] 2.2 Implement `createComparisonUnitAtom()` factory function
- [x] 2.3 Add revision tracking element detection (`w:ins`, `w:del`)
- [x] 2.4 Add ancestor Unid extraction logic
- [x] 2.5 Integrate with existing `sha1()` utility for hash calculation

## 3. Utility Integration

- [x] 3.1 Add SHA1 hashing utility if not exists (or import from existing)
- [x] 3.2 Add helper for determining if element is leaf node

## 4. Testing

- [x] 4.1 Add unit tests for `CorrelationStatus` usage
- [x] 4.2 Add unit tests for `createComparisonUnitAtom()` with mock elements
- [x] 4.3 Add tests for revision tracking detection (inserted/deleted)
- [x] 4.4 Add tests for ancestor Unid extraction

## 5. Legal Numbering Corner Cases

- [x] 5.1 Add `ContinuationInfo` type for tracking continuation state per paragraph
- [x] 5.2 Add `ListLevelInfo` interface for numbering level properties
- [x] 5.3 Implement continuation pattern detection logic
- [x] 5.4 Add `getEffectiveLevel()` helper that returns level 0 for continuation patterns
- [x] 5.5 Add tests for orphan list item detection (e.g., 1., 2., 3., then 4. at ilvl=1)
- [x] 5.6 Add tests for proper nested lists (1., 1.1, 1.2, 2.)
- [x] 5.7 Add tests for `isLgl` (legal numbering) behavior

## 6. Footnote Numbering

- [x] 6.1 Add `FootnoteNumberingTracker` class
- [x] 6.2 Implement document scan for `footnoteReference` elements in order
- [x] 6.3 Implement document scan for `endnoteReference` elements in order
- [x] 6.4 Build XML ID to display number mapping
- [x] 6.5 Add `getDisplayNumber(xmlId)` lookup method
- [x] 6.6 Handle reserved IDs (0, 1) for separator types
- [x] 6.7 Handle `customMarkFollows` attribute
- [x] 6.8 Add tests for sequential numbering vs XML ID ordering
- [x] 6.9 Add tests for documents with 90+ footnotes

## 7. Move Detection

- [x] 7.1 Add `MovedSource` and `MovedDestination` to `CorrelationStatus` enum
- [x] 7.2 Add `moveGroupId` and `moveName` properties to `ComparisonUnitAtom`
- [x] 7.3 Add `MoveDetectionSettings` interface with configurable options
- [x] 7.4 Add `AtomBlock` interface for grouping consecutive atoms
- [x] 7.5 Implement `groupIntoBlocks()` helper function
- [x] 7.6 Implement `jaccardWordSimilarity()` function
- [x] 7.7 Implement `detectMovesInAtomList()` main algorithm
- [x] 7.8 Add move markup generation for `w:moveFrom` / `w:moveTo`
- [x] 7.9 Add range marker generation (`w:moveFromRangeStart`, etc.)
- [x] 7.10 Implement `fixUpRevisionIds()` for proper ID pairing

## 8. Move Detection Testing

- [x] 8.1 Add tests for `jaccardWordSimilarity()` function
- [x] 8.2 Add tests for move detection with similar blocks
- [x] 8.3 Add tests for move detection below threshold
- [x] 8.4 Add tests for short blocks (below minimum word count)
- [x] 8.5 Add tests for move detection disabled setting
- [x] 8.6 Add tests for move markup structure validation
- [x] 8.7 Add tests for range ID pairing
- [x] 8.8 Add tests for `w:name` attribute linking source/destination

## 9. Format Change Detection

- [x] 9.1 Add `FormatChanged` to `CorrelationStatus` enum
- [x] 9.2 Add `FormatChangeInfo` interface with old/new properties and changed names
- [x] 9.3 Add `formatChange` property to `ComparisonUnitAtom` interface
- [x] 9.4 Create `src/format-detection.ts` module
- [x] 9.5 Implement `getRunPropertiesFromAtom()` to extract w:rPr from ancestors
- [x] 9.6 Implement `normalizeRunProperties()` for comparison preparation
- [x] 9.7 Implement `areRunPropertiesEqual()` for normalized comparison
- [x] 9.8 Implement `getChangedPropertyNames()` to list differing properties
- [x] 9.9 Add property name mapping (w:b → "bold", w:i → "italic", etc.)
- [x] 9.10 Implement `detectFormatChangesInAtomList()` main algorithm
- [x] 9.11 Add `detectFormatChanges` setting to `WmlComparerSettings`

## 10. Format Change Markup Generation

- [x] 10.1 Add `w:rPrChange` element generation with old properties
- [x] 10.2 Add author and date attributes to format change elements
- [x] 10.3 Add unique ID assignment for format change elements
- [x] 10.4 Integrate format change markup into `MarkContentAsDeletedOrInsertedTransform()`
- [x] 10.5 Handle coalescing of FormatChanged status in `CoalesceRecurse()`

## 11. Format Change Testing

- [x] 11.1 Add tests for `getRunPropertiesFromAtom()` with various ancestors
- [x] 11.2 Add tests for `normalizeRunProperties()` with null input
- [x] 11.3 Add tests for `normalizeRunProperties()` removing w:rPrChange
- [x] 11.4 Add tests for `areRunPropertiesEqual()` identical properties
- [x] 11.5 Add tests for `areRunPropertiesEqual()` different order (should be equal)
- [x] 11.6 Add tests for `areRunPropertiesEqual()` different properties
- [x] 11.7 Add tests for `getChangedPropertyNames()` single change
- [x] 11.8 Add tests for `getChangedPropertyNames()` multiple changes
- [x] 11.9 Add tests for `detectFormatChangesInAtomList()` with bold change
- [x] 11.10 Add tests for `detectFormatChangesInAtomList()` with no change
- [x] 11.11 Add tests for `detectFormatChangesInAtomList()` skipping non-Equal atoms
- [x] 11.12 Add tests for format detection disabled setting
- [x] 11.13 Add tests for `w:rPrChange` markup structure
- [x] 11.14 Add Word compatibility tests for format change output

## 12. Format Change Revision Reporting

- [x] 12.1 Add `FormatChanged` to `WmlComparerRevisionType` enum
- [x] 12.2 Add `FormatChangeDetails` interface for revision output
- [x] 12.3 Extend `GetRevisions()` to detect `w:rPrChange` elements
- [x] 12.4 Extract author, date, text, and format change details
- [x] 12.5 Add tests for format change revision extraction

## 13. Documentation

- [x] 13.1 Add JSDoc comments to all exported types
- [x] 13.2 Update README with new type documentation
- [x] 13.3 Document OOXML corner cases in package README
- [x] 13.4 Document move detection algorithm and configuration
- [x] 13.5 Document format change detection algorithm and configuration
- [x] 13.6 Add examples of format change markup output
