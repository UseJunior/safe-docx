# Capability: docx-comparison-inplace

## ADDED Requirements

### Requirement: In-place AST modification for track changes generation

The docx-comparison pipeline MUST generate track changes by modifying the revised document's AST in place, rather than reconstructing the document from scratch.

#### Scenario: Inserted content is wrapped with w:ins

Given: A revised document with content that was added (not in original)
When: The comparison pipeline generates track changes
Then: The inserted runs are wrapped with `<w:ins>` elements containing author and date attributes
And: The original run content is preserved inside the wrapper

#### Scenario: Deleted content is inserted as w:del

Given: Content that exists in the original but not in the revised document
When: The comparison pipeline generates track changes
Then: The deleted runs are cloned from the original document
And: Text elements (`w:t`) are converted to deleted text elements (`w:delText`)
And: The cloned runs are wrapped with `<w:del>` elements
And: The deleted content is inserted at the correct position in the output

#### Scenario: Document structure is preserved

Given: A revised document with headers, footers, styles, and section properties
When: The comparison pipeline generates track changes
Then: All document structure elements are preserved in the output
And: Only content within `w:body` is modified for track changes
And: No regex extraction is used for document structure manipulation

#### Scenario: Moved content generates move markers

Given: Content that was moved from one location to another
When: The comparison pipeline detects and marks moves
Then: The source location is wrapped with `<w:moveFrom>` and range markers
And: The destination location is wrapped with `<w:moveTo>` and range markers
And: Both locations share the same move name attribute

#### Scenario: Format changes generate rPrChange elements

Given: Content where text is identical but formatting differs
When: The comparison pipeline detects format changes
Then: The `<w:rPrChange>` element is added to the run properties
And: The old formatting is preserved in the change element

### Requirement: Paragraph-first comparison for in-house diff engines

The docx-comparison pipeline MUST compare at paragraph level first and MUST only run atom-level
diffs for paragraphs identified as changed. This applies to all in-house comparison engines
(inplace and rebuild) and excludes Aspose `.compare()`.

#### Scenario: Unchanged paragraph skips atom-level diff

Given: Two documents with identical paragraph text but differing run boundaries
When: The comparison pipeline generates track changes
Then: The paragraph is treated as unchanged at paragraph level
And: No insertions or deletions are produced within that paragraph

#### Scenario: Changed paragraph receives atom-level diff

Given: Two documents with a paragraph whose text differs
When: The comparison pipeline generates track changes
Then: The paragraph is atomized and diffed
And: The resulting insertions/deletions are included in the output

### Requirement: Atom-to-AST linking during atomization

Atoms MUST maintain references to their source elements in the full AST to enable in-place modification.

#### Scenario: Atoms reference source run elements

Given: A document being atomized for comparison
When: The atomization process creates ComparisonUnitAtom objects
Then: Each atom stores a reference to its source `w:r` element in the full AST
And: The reference can be used to locate the element for modification

#### Scenario: Atom references survive comparison

Given: Atoms with source element references
When: The LCS comparison marks atoms as Equal, Inserted, or Deleted
Then: The source element references remain valid
And: Inserted atoms can be traced to their source runs for wrapping

## MODIFIED Requirements

### Requirement: Pipeline supports in-place modification mode

The comparison pipeline MUST support switching between reconstruction and in-place modification approaches.

#### Scenario: Default behavior uses in-place modification

Given: A comparison request with default options
When: The pipeline generates track changes
Then: The in-place modification approach is used
And: The output passes round-trip validation (accept all = revised, reject all = original)

#### Scenario: Rebuild mode available for compatibility

Given: A comparison request with `reconstructionMode: 'rebuild'` option
When: The pipeline generates track changes
Then: The original reconstruction approach is used
And: The output matches previous behavior
