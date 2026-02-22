# Design: WmlComparer Core Types

## Context

The WmlComparer algorithm (Open-Xml-PowerTools) is implemented in C# and relies heavily on `System.Xml.Linq.XElement` and `DocumentFormat.OpenXml.Packaging.OpenXmlPart`. To port this to pure TypeScript without .NET dependencies, we need abstract interfaces that capture the essential operations while integrating with `fast-xml-parser` output.

## Goals / Non-Goals

**Goals:**
- Define TypeScript interfaces that match the semantic structure of C# `ComparisonUnit` and `ComparisonUnitAtom`
- Enable the atomization algorithm to work identically to the C# implementation
- Support tree traversal (ancestors, parent relationships) needed for revision tracking
- Provide clear mapping documentation for developers porting additional WmlComparer logic

**Non-Goals:**
- Full parity with `XElement` API (only subset needed for comparison)
- Runtime compatibility with .NET (pure TypeScript)
- Handling of complex OOXML features beyond footnotes in v1 (comments, content controls)

## Decisions

### Decision 1: Abstract Element Interface (`WmlElement`)

`fast-xml-parser` returns plain JS objects without parent references. We define `WmlElement` with optional `parent` property that gets backfilled during tree walking.

```typescript
interface WmlElement {
  tagName: string;
  attributes: Record<string, string>;
  children?: WmlElement[];
  textContent?: string;
  parent?: WmlElement;
}
```

**Alternatives considered:**
- Use raw `fast-xml-parser` output directly: Rejected because we need `.parent` navigation for revision tracking
- Create full XElement wrapper class: Rejected as over-engineering; interface with backfilled parent is sufficient

### Decision 2: Factory Function vs Class Constructor

C# `ComparisonUnitAtom` has constructor logic (lines 2314-2343) that:
1. Finds revision tracking elements in ancestors
2. Sets `CorrelationStatus` based on revision type
3. Calculates SHA1 hash

TypeScript interfaces are data-only. We move this logic to a `createComparisonUnitAtom()` factory function in `atomizer.ts`.

**Rationale:** Keeps types pure for serialization and testing. Factory function is more explicit and testable.

### Decision 3: Ancestor Stack Management

The C# code uses `XElement.Ancestors()` to navigate up the tree. In our approach, the atomizer maintains an explicit `ancestors: WmlElement[]` stack during tree traversal and passes it to the factory function.

**Implementation pattern:**
```typescript
function atomizeTree(node: WmlElement, ancestors: WmlElement[], part: OpcPart): ComparisonUnitAtom[] {
  const atoms: ComparisonUnitAtom[] = [];
  if (isLeafNode(node)) {
    atoms.push(createComparisonUnitAtom(node, ancestors, part));
  } else {
    for (const child of node.children ?? []) {
      atoms.push(...atomizeTree(child, [...ancestors, node], part));
    }
  }
  return atoms;
}
```

### Decision 4: Part Identification via `OpcPart`

`OpenXmlPart` in C# provides URI and content type. We define a minimal `OpcPart` interface sufficient for tracking which file a node came from:

```typescript
interface OpcPart {
  uri: string;       // "word/document.xml"
  contentType: string;
}
```

This integrates with the existing `DocxArchive` class that handles ZIP extraction.

### Decision 5: Legal Numbering Continuation Pattern Detection

Word exhibits behavior where "orphan" list items (those at `ilvl > 0` without proper parent-child nesting) render differently than the format string suggests. For example, with format strings `%1.` (level 0) and `%1.%2` (level 1):

```
Para 1: ilvl=0 → "1."
Para 2: ilvl=0 → "2."
Para 3: ilvl=0 → "3."
Para 4: ilvl=1, start=4 → Word displays "4." (NOT "3.4")
```

**Detection criteria:**
A paragraph is in a "continuation pattern" when:
1. It's the first paragraph at this level in the current sequence, AND
2. The level's `start` value equals the parent level's counter + 1

**Implementation:**
```typescript
interface ContinuationInfo {
  isContinuation: boolean;
  effectiveLevel: number;  // Level 0 for continuation patterns
}

function detectContinuationPattern(
  ilvl: number,
  startValue: number,
  levelNumbers: number[]
): ContinuationInfo {
  if (ilvl > 0 && startValue === levelNumbers[ilvl - 1] + 1) {
    return { isContinuation: true, effectiveLevel: 0 };
  }
  return { isContinuation: false, effectiveLevel: ilvl };
}
```

**Why this matters for lawyers:** Legal documents (e.g., NVCA Model COI) frequently use this pattern. Incorrect rendering of "3.4" instead of "4." breaks document fidelity.

### Decision 6: Footnote Numbering via Document Order Scan

Per ECMA-376, `w:id` on `footnoteReference` is a reference identifier, NOT the display number. Display numbers are sequential based on document order.

**Problem:**
- Document has 91 footnotes with XML IDs 2-92 (IDs 0, 1 are reserved)
- Incorrect: Display as 2, 3, 4, ..., 92
- Correct: Display as 1, 2, 3, ..., 91

**Implementation:**
```typescript
class FootnoteNumberingTracker {
  private xmlIdToDisplayNumber: Map<string, number> = new Map();

  constructor(documentRoot: WmlElement) {
    let displayNum = 1;
    for (const ref of this.findFootnoteRefsInOrder(documentRoot)) {
      const xmlId = ref.attributes['w:id'];
      if (!this.xmlIdToDisplayNumber.has(xmlId)) {
        this.xmlIdToDisplayNumber.set(xmlId, displayNum++);
      }
    }
  }

  getDisplayNumber(xmlId: string): number | undefined {
    return this.xmlIdToDisplayNumber.get(xmlId);
  }
}
```

**Key considerations:**
- Reserved IDs (0 = separator, 1 = continuationSeparator) are excluded
- `w:customMarkFollows` suppresses automatic numbering
- Same approach applies to endnotes

### Decision 7: Move Detection as Post-LCS Phase

Move detection runs AFTER the LCS algorithm, not during it. This preserves the core comparison logic and treats moves as a secondary classification of already-identified deletions and insertions.

**Pipeline position:**
```
LCS() → MarkRowsAsDeletedOrInserted() → FlattenToAtomList() → detectMovesInAtomList() → CoalesceRecurse()
```

**Algorithm (from WmlComparer.cs:3811):**
```typescript
interface AtomBlock {
  status: CorrelationStatus;  // Deleted or Inserted
  atoms: ComparisonUnitAtom[];
  text: string;  // Joined content from atoms
  wordCount: number;
}

function detectMovesInAtomList(
  atoms: ComparisonUnitAtom[],
  settings: MoveDetectionSettings
): void {
  if (!settings.detectMoves) return;

  // 1. Group consecutive atoms by status
  const blocks = groupIntoBlocks(atoms);

  // 2. Filter by minimum word count
  const deletedBlocks = blocks.filter(b =>
    b.status === CorrelationStatus.Deleted &&
    b.wordCount >= settings.moveMinimumWordCount
  );
  const insertedBlocks = blocks.filter(b =>
    b.status === CorrelationStatus.Inserted &&
    b.wordCount >= settings.moveMinimumWordCount
  );

  // 3. Find best matches using Jaccard similarity
  let moveGroupId = 1;
  for (const deleted of deletedBlocks) {
    const bestMatch = findBestMatch(deleted, insertedBlocks, settings);
    if (bestMatch && bestMatch.similarity >= settings.moveSimilarityThreshold) {
      // 4. Convert to moves
      const moveName = `move${moveGroupId}`;
      markAsMove(deleted.atoms, CorrelationStatus.MovedSource, moveGroupId, moveName);
      markAsMove(bestMatch.block.atoms, CorrelationStatus.MovedDestination, moveGroupId, moveName);
      moveGroupId++;
    }
  }
}
```

**Why post-LCS:** The LCS algorithm is mathematically elegant and well-tested. Adding move detection during LCS would complicate the algorithm and risk introducing bugs. Post-processing is simpler and matches the C# implementation.

### Decision 8: Jaccard Word Similarity for Move Matching

We use Jaccard index on word sets (not character-level or edit distance) because:
1. It's efficient: O(n) where n = total words
2. It's order-independent: "fox quick brown" matches "brown quick fox"
3. It handles insertions/deletions well: adding one word to a 10-word block only slightly reduces similarity
4. It matches the C# implementation

**Implementation:**
```typescript
function jaccardWordSimilarity(
  text1: string,
  text2: string,
  caseInsensitive: boolean
): number {
  const normalize = caseInsensitive
    ? (s: string) => s.toLowerCase()
    : (s: string) => s;

  const words1 = new Set(normalize(text1).split(/\s+/).filter(Boolean));
  const words2 = new Set(normalize(text2).split(/\s+/).filter(Boolean));

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return union.size === 0 ? 0 : intersection.size / union.size;
}
```

**Default threshold (0.8):** Empirically chosen to catch genuine moves while avoiding false positives from coincidentally similar text.

### Decision 9: OpenXML Move Markup Generation

Moves require range markers that Word uses to display "Move" in Track Changes panel:

**Source markup:**
```xml
<w:moveFromRangeStart w:id="1" w:name="move1" w:author="Author" w:date="..."/>
<w:moveFrom w:id="2" w:author="Author" w:date="...">
  <w:r><w:t>moved text</w:t></w:r>
</w:moveFrom>
<w:moveFromRangeEnd w:id="1"/>
```

**Destination markup:**
```xml
<w:moveToRangeStart w:id="3" w:name="move1" w:author="Author" w:date="..."/>
<w:moveTo w:id="4" w:author="Author" w:date="...">
  <w:r><w:t>moved text</w:t></w:r>
</w:moveTo>
<w:moveToRangeEnd w:id="3"/>
```

**Key implementation notes:**
- `w:name` MUST match between source and destination (e.g., "move1")
- Range start/end elements share the same `w:id`
- Each `w:moveFrom`/`w:moveTo` gets its own unique `w:id`
- All elements need `w:author` and `w:date` attributes

### Decision 10: Format Change Detection as Post-LCS Phase

Like move detection, format change detection runs AFTER the LCS algorithm, specifically after move detection. This preserves the core comparison logic and treats format changes as a refinement of "Equal" content.

**Pipeline position:**
```
LCS() → FlattenToAtomList() → detectMovesInAtomList() → detectFormatChangesInAtomList() → CoalesceRecurse()
```

**Algorithm overview:**
```typescript
function detectFormatChangesInAtomList(
  atoms: ComparisonUnitAtom[],
  settings: WmlComparerSettings
): void {
  if (!settings.detectFormatChanges) return;

  for (const atom of atoms) {
    // Only check Equal atoms that have a "before" reference
    if (atom.correlationStatus !== CorrelationStatus.Equal) continue;
    if (!atom.comparisonUnitAtomBefore) continue;

    // Extract rPr from both documents
    const oldRPr = getRunPropertiesFromAtom(atom.comparisonUnitAtomBefore);
    const newRPr = getRunPropertiesFromAtom(atom);

    // Compare run properties
    if (!areRunPropertiesEqual(oldRPr, newRPr)) {
      atom.correlationStatus = CorrelationStatus.FormatChanged;
      atom.formatChange = {
        oldRunProperties: oldRPr,
        newRunProperties: newRPr,
        changedProperties: getChangedPropertyNames(oldRPr, newRPr)
      };
    }
  }
}
```

**Key insight:** We already have both document's data. When atoms are marked as Equal, `contentElement` comes from the modified document (doc2) and `comparisonUnitAtomBefore` provides full atom from original (doc1), including `ancestorElements` which contains the `w:r` run element with `w:rPr` properties.

### Decision 11: Run Property Extraction from Ancestor Elements

The `ancestorElements` array on each atom includes the `w:r` (run) element, which contains `w:rPr` (run properties). We extract these for comparison.

**Implementation:**
```typescript
function getRunPropertiesFromAtom(atom: ComparisonUnitAtom): WmlElement | null {
  // Find the w:r ancestor element
  const runElement = atom.ancestorElements?.find(a => a.tagName === 'w:r');
  if (!runElement) return null;

  // Get the rPr child element
  return runElement.children?.find(c => c.tagName === 'w:rPr') ?? null;
}
```

### Decision 12: Run Property Normalization for Comparison

When comparing `w:rPr` elements, we must:
1. Handle null as equivalent to empty `w:rPr`
2. Remove existing revision tracking elements (`w:rPrChange`) before comparison
3. Sort child elements by tag name for deterministic comparison

**Implementation:**
```typescript
function normalizeRunProperties(rPr: WmlElement | null): WmlElement {
  if (!rPr) return { tagName: 'w:rPr', attributes: {}, children: [] };

  return {
    tagName: 'w:rPr',
    attributes: {},
    children: (rPr.children ?? [])
      .filter(e => e.tagName !== 'w:rPrChange')
      .sort((a, b) => a.tagName.localeCompare(b.tagName))
      .map(e => ({
        tagName: e.tagName,
        attributes: Object.fromEntries(
          Object.entries(e.attributes).sort(([a], [b]) => a.localeCompare(b))
        )
      }))
  };
}
```

### Decision 13: FormatChangeInfo Data Structure

We store detailed information about format changes for later use in markup generation and revision reporting.

**Implementation:**
```typescript
interface FormatChangeInfo {
  /** Run properties from the original document (before changes) */
  oldRunProperties: WmlElement | null;

  /** Run properties from the modified document (after changes) */
  newRunProperties: WmlElement | null;

  /** List of property names that changed (e.g., "bold", "italic", "fontSize") */
  changedProperties: string[];
}
```

**Property name mapping:**
```typescript
const PROPERTY_FRIENDLY_NAMES: Record<string, string> = {
  'w:b': 'bold',
  'w:i': 'italic',
  'w:u': 'underline',
  'w:strike': 'strikethrough',
  'w:sz': 'fontSize',
  'w:szCs': 'fontSizeComplex',
  'w:rFonts': 'font',
  'w:color': 'color',
  'w:highlight': 'highlight',
  'w:vertAlign': 'verticalAlign',
  'w:caps': 'allCaps',
  'w:smallCaps': 'smallCaps',
};
```

### Decision 14: OpenXML Format Change Markup Generation

Format changes use native Word revision tracking elements that display in Track Changes.

**Run property change (`w:rPrChange`):**
```xml
<w:r>
  <w:rPr>
    <w:b/>                    <!-- New: bold -->
    <w:i/>                    <!-- New: italic -->
    <w:rPrChange w:id="1" w:author="Author" w:date="2025-01-15T10:30:00Z">
      <w:rPr>
        <!-- Old: original properties (empty = no formatting) -->
      </w:rPr>
    </w:rPrChange>
  </w:rPr>
  <w:t>formatted text</w:t>
</w:r>
```

**Paragraph property change (`w:pPrChange`) - future enhancement:**
```xml
<w:p>
  <w:pPr>
    <w:jc w:val="center"/>    <!-- New: centered -->
    <w:pPrChange w:id="2" w:author="Author" w:date="2025-01-15T10:30:00Z">
      <w:pPr>
        <w:jc w:val="left"/>  <!-- Old: left aligned -->
      </w:pPr>
    </w:pPrChange>
  </w:pPr>
  <w:r><w:t>text</w:t></w:r>
</w:p>
```

**Key implementation notes:**
- `w:rPrChange` is a child of `w:rPr`, containing the OLD properties
- The CURRENT `w:rPr` children (outside `w:rPrChange`) are the NEW properties
- Each change element needs unique `w:id`, `w:author`, and `w:date` attributes

### Decision 15: Format Change vs Text Change Precedence

When the same content has BOTH text changes (ins/del) AND format changes, the text change takes precedence. Format detection only applies to `Equal` atoms.

**Rationale:** If text is inserted or deleted, the formatting is inherently different. We track format changes only when the text content is identical but the styling differs.

## C# to TypeScript Mapping Table

| C# Member | TypeScript Implementation |
|-----------|--------------------------|
| `XElement` (System.Xml.Linq) | `WmlElement` interface with `parent` backfill |
| `OpenXmlPart` | `OpcPart` interface (uri + contentType) |
| `ComparisonUnit.Contents` | `ComparisonUnit.contents: ComparisonUnit[]` |
| `ComparisonUnit.SHA1Hash` | `ComparisonUnit.sha1Hash: string` |
| `ComparisonUnit.CorrelationStatus` | `ComparisonUnit.correlationStatus: CorrelationStatus` |
| `ComparisonUnitAtom.AncestorElements` | `ComparisonUnitAtom.ancestorElements: WmlElement[]` |
| `ComparisonUnitAtom.AncestorUnids` | `ComparisonUnitAtom.ancestorUnids: string[]` |
| `ComparisonUnitAtom.ContentElement` | `ComparisonUnitAtom.contentElement: WmlElement` |
| `ComparisonUnitAtom.Part` | `ComparisonUnitAtom.part: OpcPart` |
| `ComparisonUnitAtom.RevTrackElement` | `ComparisonUnitAtom.revTrackElement?: WmlElement` |
| `ComparisonUnitAtom.MoveGroupId` | `ComparisonUnitAtom.moveGroupId?: number` |
| `ComparisonUnitAtom.MoveName` | `ComparisonUnitAtom.moveName?: string` |
| `CorrelationStatus.MovedSource` | `CorrelationStatus.MovedSource` |
| `CorrelationStatus.MovedDestination` | `CorrelationStatus.MovedDestination` |
| Constructor logic (line 2314) | `createComparisonUnitAtom()` factory |
| `GetRevisionTrackingElementFromAncestors()` | Inline search in factory function |
| `DetectMovesInAtomList()` (line 3811) | `detectMovesInAtomList()` function |
| `WmlComparerSettings.DetectMoves` | `MoveDetectionSettings.detectMoves` |
| `WmlComparerSettings.MoveSimilarityThreshold` | `MoveDetectionSettings.moveSimilarityThreshold` |
| `WmlComparerSettings.MoveMinimumWordCount` | `MoveDetectionSettings.moveMinimumWordCount` |
| `CorrelationStatus.FormatChanged` | `CorrelationStatus.FormatChanged` |
| `FormatChangeInfo` | `FormatChangeInfo` interface |
| `ComparisonUnitAtom.FormatChange` | `ComparisonUnitAtom.formatChange` |
| `WmlComparerSettings.DetectFormatChanges` | `WmlComparerSettings.detectFormatChanges` |
| `GetRunPropertiesFromAtom()` | `getRunPropertiesFromAtom()` |
| `AreRunPropertiesEqual()` | `areRunPropertiesEqual()` |
| `NormalizeRunProperties()` | `normalizeRunProperties()` |
| `DetectFormatChangesInAtomList()` | `detectFormatChangesInAtomList()` |

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| `parent` backfill adds complexity | Document clearly; only needed during atomization phase |
| Ancestors array copied on each recursive call | Acceptable for document sizes; optimize if profiling shows issues |
| Missing C# features we discover later | Types use optional properties; extend as needed |
| Format change detection increases comparison output size | Configurable via `detectFormatChanges` setting |
| Run property normalization may miss edge cases | Comprehensive test suite with real-world documents; iteratively expand property handling |
| `w:pPrChange` for paragraph formatting not in v1 | Scoped to run-level changes first; paragraph properties tracked for future enhancement |

## Migration Plan

1. Add `src/core-types.ts` with interfaces and enum
2. Add `createComparisonUnitAtom()` stub to `src/atomizer.ts`
3. Add unit tests for factory function with mock elements
4. Integrate with existing `DocxArchive` for part tracking
5. Build atomization tree walker in subsequent change

## Open Questions

- Should `WmlElement.children` use a specific order guarantee? (C# `XElement.Elements()` returns document order)
- Do we need to track namespaces on `WmlElement` or just prefixed tag names?
