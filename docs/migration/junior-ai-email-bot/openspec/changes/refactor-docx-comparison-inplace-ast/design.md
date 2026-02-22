# Design: In-Place AST Manipulation for Track Changes

## Problem Analysis

### Current Reconstruction Approach

The current `documentReconstructor.ts` works as follows:

```
1. Group merged atoms by paragraph
2. For each paragraph group:
   a. Extract paragraph properties (w:pPr) from first atom's ancestors
   b. Group atoms into runs by correlation status
   c. Build new paragraph XML string from scratch
3. Extract document structure using regex
4. Concatenate new paragraph XMLs into document body
```

**Pain points:**
- `buildDocument()` uses regex to extract `<w:body>` content
- `buildParagraphXml()` manually reconstructs paragraph structure
- `buildRunContent()` manually rebuilds run content with escaping
- `serializeProperties()` rebuilds property elements
- Lost fidelity: only content atoms are preserved, not all XML structure

### Why Reconstruction Was Chosen

The original WmlComparer C# implementation uses a similar reconstruction approach because:
1. C# `XElement` makes it easy to build new XML trees
2. The .NET ecosystem has mature XML libraries
3. It allowed precise control over output structure

In TypeScript, we initially ported this approach but now have better alternatives.

## Proposed Architecture

### Core Insight

Instead of building a new document, **modify the revised document's AST in place**:

1. The revised document already has the correct final structure
2. We just need to mark what was inserted (wrap with `<w:ins>`)
3. And insert what was deleted (clone from original, wrap with `<w:del>`)

### Data Flow

```
┌─────────────────┐     ┌─────────────────┐
│  Original DOCX  │     │  Revised DOCX   │
└────────┬────────┘     └────────┬────────┘
         │                       │
         v                       v
┌─────────────────┐     ┌─────────────────┐
│ Parse to atoms  │     │ Parse to AST +  │
│ (for comparison)│     │ atoms (linked)  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     v
         ┌───────────────────────┐
         │   LCS Comparison      │
         │   Mark: Equal/Del/Ins │
         └───────────┬───────────┘
                     │
                     v
         ┌───────────────────────┐
         │ Modify Revised AST    │
         │ - Wrap inserted runs  │
         │ - Insert deleted runs │
         │ - Add move markers    │
         └───────────┬───────────┘
                     │
                     v
         ┌───────────────────────┐
         │   Serialize AST       │
         └───────────────────────┘
```

### Key Operations

#### 1. Link Atoms to AST Nodes

When atomizing the revised document, maintain references from atoms to their source `w:r` elements in the full AST:

```typescript
interface ComparisonUnitAtom {
  // Existing fields...

  // NEW: Reference to source run element in full AST
  sourceRunElement?: WmlElement;
}
```

#### 2. Wrap Inserted Content

For atoms marked as `Inserted`, wrap their source run element:

```typescript
function wrapAsInserted(run: WmlElement, author: string, date: string, id: number): void {
  const ins = createElement('w:ins', { 'w:id': String(id), 'w:author': author, 'w:date': date });
  replaceWithWrapper(run, ins);  // run becomes child of ins
}
```

#### 3. Insert Deleted Content

For atoms marked as `Deleted`, clone from original and insert at correct position:

```typescript
function insertDeleted(
  deletedAtom: ComparisonUnitAtom,
  insertAfter: WmlElement | null,
  parentParagraph: WmlElement,
  author: string,
  date: string,
  id: number
): void {
  // Clone the deleted run from original
  const clonedRun = cloneElement(deletedAtom.sourceRunElement);

  // Convert w:t to w:delText
  convertToDelText(clonedRun);

  // Wrap with w:del
  const del = createElement('w:del', { 'w:id': String(id), 'w:author': author, 'w:date': date });
  appendChild(del, clonedRun);

  // Insert at correct position
  if (insertAfter) {
    insertAfterElement(parentParagraph, insertAfter, del);
  } else {
    prependChild(parentParagraph, del);
  }
}
```

#### 4. Handle Paragraph-Level Changes

For entirely new/deleted paragraphs:

```typescript
// Inserted paragraph: wrap entire paragraph content
function wrapParagraphAsInserted(p: WmlElement, ...): void {
  for (const run of getChildrenByTagName(p, 'w:r')) {
    wrapAsInserted(run, ...);
  }
}

// Deleted paragraph: clone and insert before/after
function insertDeletedParagraph(
  deletedParagraph: WmlElement,
  insertAfter: WmlElement | null,
  parentBody: WmlElement,
  ...
): void {
  const cloned = cloneElement(deletedParagraph);
  convertParagraphToDeleted(cloned, ...);
  // Insert at correct position
}
```

### Required New Utilities

Add to `wmlElementUtils.ts`:

```typescript
// Wrap an element with a new parent (element becomes child of wrapper)
function wrapElement(element: WmlElement, wrapper: WmlElement): void;

// Insert element after a sibling
function insertAfterElement(parent: WmlElement, sibling: WmlElement, newElement: WmlElement): void;

// Create a new element
function createElement(tagName: string, attributes?: Record<string, string>): WmlElement;

// Prepend child to beginning of children array
function prependChild(parent: WmlElement, child: WmlElement): void;
```

### Handling Edge Cases

#### Nested Track Changes

If original already has track changes, preserve them:
- Parse existing `w:ins`/`w:del` elements
- Don't double-wrap content that's already marked

#### Empty Paragraphs

When a paragraph becomes empty after deleting all content:
- Keep the paragraph if it had content in original (wrap content as deleted)
- Remove the paragraph if it was entirely inserted

#### Move Detection

For moved content:
1. Mark source with `<w:moveFrom>` and range markers
2. Mark destination with `<w:moveTo>` and range markers
3. Use same move name to link them

## Trade-offs

### Advantages

| Aspect | Reconstruction | In-Place Modification |
|--------|---------------|----------------------|
| Code complexity | ~400 lines | ~150 lines |
| Document fidelity | Atoms only | Full structure |
| Regex usage | Required | None |
| Testability | Integration tests | Unit tests possible |
| Maintenance | Error-prone | Straightforward |

### Disadvantages

| Aspect | Consideration |
|--------|--------------|
| Atom linking | Need to maintain AST references during atomization |
| Insertion ordering | Must carefully track where to insert deleted content |
| Testing | Need to verify output matches reconstruction approach |

## Migration Strategy

1. **Keep both implementations** during migration
2. **Add flag** to select approach: `{ reconstructionMode: 'inplace' | 'rebuild' }`
3. **Run round-trip tests** with both approaches, compare outputs
4. **Remove old code** once new approach passes all tests

## Validation

Success criteria:
1. All 10 round-trip tests pass
2. Output DOCX opens correctly in Word
3. Track changes are visible and can be accepted/rejected
4. No regression in comparison accuracy
