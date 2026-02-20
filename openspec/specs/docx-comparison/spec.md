# docx-comparison Specification

## Purpose
TBD - created by archiving change add-wmlcomparer-core-types. Update Purpose after archive.
## Requirements
### Requirement: Correlation Status Enumeration

The system SHALL provide a `CorrelationStatus` enum with the following values: `Nil`, `Normal`, `Unknown`, `Inserted`, `Deleted`, `Equal`, `Group`, `MovedSource`, `MovedDestination`, `FormatChanged`.

#### Scenario: Status assigned during comparison

- **WHEN** an atom is correlated with another atom during LCS comparison
- **THEN** its `correlationStatus` is set to `Equal`

#### Scenario: Status for unmatched atoms

- **WHEN** an atom exists only in the revised document
- **THEN** its `correlationStatus` is set to `Inserted`

#### Scenario: Status for deleted content

- **WHEN** an atom exists only in the original document
- **THEN** its `correlationStatus` is set to `Deleted`

#### Scenario: Status for moved source content

- **WHEN** deleted content is detected as relocated elsewhere in the document
- **THEN** its `correlationStatus` is set to `MovedSource`

#### Scenario: Status for moved destination content

- **WHEN** inserted content is detected as relocated from elsewhere in the document
- **THEN** its `correlationStatus` is set to `MovedDestination`

#### Scenario: Status for format-changed content

- **WHEN** an atom's text content is equal but run properties differ
- **THEN** its `correlationStatus` is set to `FormatChanged`

### Requirement: Abstract XML Element Representation

The system SHALL provide a `WmlElement` interface that abstracts OOXML XML elements with properties for `tagName`, `attributes`, `children`, `textContent`, and optional `parent` reference.

#### Scenario: Element with text content

- **WHEN** a `<w:t>` element is parsed
- **THEN** a `WmlElement` is created with `tagName: "w:t"` and `textContent` containing the text value

#### Scenario: Element with attributes

- **WHEN** an element has attributes like `pt14:Unid="abc123"`
- **THEN** the `WmlElement.attributes` contains `{ "pt14:Unid": "abc123" }`

### Requirement: Package Part Identification

The system SHALL provide an `OpcPart` interface with `uri` (e.g., `"word/document.xml"`) and `contentType` properties to identify the source location of content within the DOCX ZIP structure.

#### Scenario: Part from main document

- **WHEN** content is extracted from `word/document.xml`
- **THEN** the `OpcPart.uri` is `"word/document.xml"`

### Requirement: Comparison Unit Base Interface

The system SHALL provide a `ComparisonUnit` interface with `contents` array, `sha1Hash` string, and `correlationStatus` property as the base for all comparison units.

#### Scenario: Hash calculation for content identity

- **WHEN** a comparison unit is created
- **THEN** a SHA1 hash is calculated from its content for identity comparison

### Requirement: Comparison Unit Atom Interface

The system SHALL provide a `ComparisonUnitAtom` interface extending `ComparisonUnit` with:
- `ancestorElements`: Array of ancestor `WmlElement` nodes from root to parent
- `ancestorUnids`: Array of `pt14:Unid` values extracted from ancestors
- `contentElement`: The leaf `WmlElement` this atom represents
- `contentElementBefore`: Optional reference to corresponding original element
- `comparisonUnitAtomBefore`: Optional reference to correlated atom in original document
- `part`: The `OpcPart` identifying the source file
- `revTrackElement`: Optional revision tracking container (`w:ins` or `w:del`)
- `moveGroupId`: Optional numeric ID linking moved source and destination atoms
- `moveName`: Optional string name for the move (used in `w:name` attribute)
- `formatChange`: Optional `FormatChangeInfo` storing old/new run properties when format differs

#### Scenario: Atom from inserted revision

- **WHEN** an atom's ancestry includes a `w:ins` element
- **THEN** `revTrackElement` references that `w:ins` element and `correlationStatus` is `Inserted`

#### Scenario: Atom from deleted revision

- **WHEN** an atom's ancestry includes a `w:del` element
- **THEN** `revTrackElement` references that `w:del` element and `correlationStatus` is `Deleted`

#### Scenario: Atom with ancestor tracking

- **WHEN** an atom is created from a `<w:t>` nested inside `<w:p>` and `<w:r>` elements
- **THEN** `ancestorElements` contains references to the `<w:p>` and `<w:r>` elements in order

#### Scenario: Atom marked as moved source

- **WHEN** move detection identifies an atom as relocated content source
- **THEN** `correlationStatus` is `MovedSource`
- **AND** `moveGroupId` is set to a unique numeric ID
- **AND** `moveName` is set (e.g., "move1")

#### Scenario: Atom marked as moved destination

- **WHEN** move detection identifies an atom as relocated content destination
- **THEN** `correlationStatus` is `MovedDestination`
- **AND** `moveGroupId` matches the corresponding source atom
- **AND** `moveName` matches the corresponding source atom

#### Scenario: Atom marked as format-changed

- **WHEN** format detection identifies an atom with different run properties
- **THEN** `correlationStatus` is `FormatChanged`
- **AND** `formatChange.oldRunProperties` contains the original document's `w:rPr`
- **AND** `formatChange.newRunProperties` contains the modified document's `w:rPr`
- **AND** `formatChange.changedProperties` lists the property names that differ

### Requirement: Atom Factory Function

The system SHALL provide a `createComparisonUnitAtom()` factory function that:
1. Accepts a content element, ancestor stack, and part reference
2. Searches ancestors for revision tracking elements (`w:ins`, `w:del`)
3. Sets initial `correlationStatus` based on revision context
4. Extracts `pt14:Unid` values from ancestor elements
5. Calculates SHA1 hash from content

#### Scenario: Creating atom with revision detection

- **WHEN** `createComparisonUnitAtom()` is called with ancestors containing `w:ins`
- **THEN** the returned atom has `correlationStatus: Inserted` and `revTrackElement` set

#### Scenario: Creating atom without revision context

- **WHEN** `createComparisonUnitAtom()` is called with no revision ancestors
- **THEN** the returned atom has `correlationStatus: Equal` and `revTrackElement: null`

### Requirement: Legal Numbering Continuation Pattern Detection

The system SHALL detect "continuation patterns" in legal numbering where a paragraph at `ilvl > 0` continues a flat sequence rather than creating a nested hierarchy. When detected, the system SHALL use the effective level (level 0) properties instead of the declared level.

A continuation pattern exists when:
1. The paragraph is the first at this level in the current sequence, AND
2. The level's `start` value equals the parent level's counter + 1

#### Scenario: Orphan list item renders with parent format

- **GIVEN** a list with format strings `%1.` (level 0) and `%1.%2` (level 1)
- **AND** paragraphs 1-3 are at `ilvl=0` numbered 1, 2, 3
- **WHEN** paragraph 4 is at `ilvl=1` with `start=4`
- **THEN** the display number is `4.` (using level 0 format with level 1 counter)
- **AND** NOT `3.4` (which would result from literal `%1.%2` evaluation)

#### Scenario: Proper nested list renders hierarchically

- **GIVEN** a list with format strings `%1.` (level 0) and `%1.%2` (level 1)
- **AND** paragraph 1 is at `ilvl=0` numbered 1
- **WHEN** paragraph 2 is at `ilvl=1` with `start=1`
- **THEN** the display number is `1.1` (proper hierarchy)

#### Scenario: Continuation pattern inherits formatting

- **WHEN** a continuation pattern is detected
- **THEN** the effective level's run properties (bold, underline, etc.) are applied
- **AND** the effective level's paragraph properties (tab stops, indentation) are applied

### Requirement: Footnote Sequential Numbering

The system SHALL calculate footnote display numbers sequentially based on document order, NOT using raw XML `w:id` attribute values. The `w:id` is a reference identifier linking `footnoteReference` to footnote definitions; display numbers are determined by the order footnotes appear in the document flow.

#### Scenario: First footnote displays as 1

- **GIVEN** a document with footnotes having XML IDs 2, 5, 3 (in document order)
- **WHEN** the first `footnoteReference` is encountered in document flow
- **THEN** it displays as footnote `1`

#### Scenario: Sequential numbering ignores XML IDs

- **GIVEN** a document with 91 footnotes having XML IDs 2-92
- **WHEN** footnotes are rendered
- **THEN** they display as 1, 2, 3, ..., 91 (sequential)
- **AND** NOT as 2, 3, 4, ..., 92 (raw XML IDs)

#### Scenario: Reserved footnote IDs excluded from numbering

- **GIVEN** XML IDs 0 and 1 are reserved for `separator` and `continuationSeparator` types
- **WHEN** footnote numbering is calculated
- **THEN** reserved IDs are excluded from the sequential count

### Requirement: Footnote Numbering Tracker

The system SHALL provide a `FootnoteNumberingTracker` that:
1. Scans the document for all `footnoteReference` and `endnoteReference` elements in document order
2. Builds a mapping from XML ID to sequential display number (1, 2, 3...)
3. Provides lookup method `getDisplayNumber(xmlId): number`

#### Scenario: Building footnote mapping

- **WHEN** a document is processed
- **THEN** a mapping is built before any rendering occurs
- **AND** the mapping preserves document order

#### Scenario: Custom footnote marks respected

- **WHEN** a `footnoteReference` has `w:customMarkFollows` attribute
- **THEN** automatic numbering is suppressed for that footnote

### Requirement: Move Detection Algorithm

The system SHALL provide a `detectMovesInAtomList()` function that identifies relocated content after LCS comparison. The algorithm:
1. Groups consecutive atoms by `correlationStatus` into blocks (Deleted blocks, Inserted blocks)
2. Extracts text from each block by joining content element values
3. Filters blocks by minimum word count (configurable, default: 3)
4. Calculates Jaccard word similarity between deleted and inserted blocks
5. Converts matching pairs (above threshold) to `MovedSource` and `MovedDestination`

#### Scenario: Move detected between similar blocks

- **GIVEN** a deleted block with text "The quick brown fox"
- **AND** an inserted block with text "The quick brown fox jumps"
- **WHEN** Jaccard similarity is calculated
- **THEN** similarity is above threshold (default: 0.8)
- **AND** atoms are marked as `MovedSource` and `MovedDestination`

#### Scenario: Short blocks ignored

- **GIVEN** a deleted block with text "the"
- **AND** an inserted block with text "the"
- **WHEN** move detection runs with `moveMinimumWordCount: 3`
- **THEN** the blocks are NOT converted to moves
- **AND** they remain as `Deleted` and `Inserted`

#### Scenario: Below threshold treated as separate changes

- **GIVEN** a deleted block with text "The quick brown fox"
- **AND** an inserted block with text "A slow gray elephant"
- **WHEN** Jaccard similarity is calculated
- **THEN** similarity is below threshold
- **AND** atoms remain as `Deleted` and `Inserted`

### Requirement: Jaccard Word Similarity

The system SHALL provide a `jaccardWordSimilarity()` function that calculates similarity between two text strings:
- Tokenizes both strings into word sets
- Calculates: `|intersection| / |union|`
- Returns a value between 0.0 (no similarity) and 1.0 (identical)
- Optionally supports case-insensitive comparison

#### Scenario: Identical text returns 1.0

- **WHEN** comparing "hello world" to "hello world"
- **THEN** similarity is `1.0`

#### Scenario: No common words returns 0.0

- **WHEN** comparing "hello world" to "foo bar"
- **THEN** similarity is `0.0`

#### Scenario: Partial overlap

- **WHEN** comparing "the quick brown fox" to "the slow brown dog"
- **THEN** similarity is `|{the, brown}| / |{the, quick, brown, fox, slow, dog}|` = `2/6` ≈ `0.33`

### Requirement: Move Detection Settings

The system SHALL provide configurable settings for move detection:
- `detectMoves`: Enable/disable move detection (default: `true`)
- `moveSimilarityThreshold`: Jaccard threshold for move matching (default: `0.8`)
- `moveMinimumWordCount`: Minimum words for move consideration (default: `3`)
- `caseInsensitive`: Case-insensitive similarity matching (default: `false`)

#### Scenario: Move detection disabled

- **WHEN** `detectMoves` is `false`
- **THEN** `detectMovesInAtomList()` returns immediately without modification
- **AND** relocated content appears as separate `w:del` and `w:ins` elements

#### Scenario: Custom threshold applied

- **GIVEN** `moveSimilarityThreshold: 0.5`
- **WHEN** blocks have 55% word overlap
- **THEN** they are converted to moves

### Requirement: OpenXML Move Markup Generation

The system SHALL generate native Word move tracking markup when moves are detected:

For moved source (content moved FROM):
- `w:moveFromRangeStart` with `w:id`, `w:name`, `w:author`, `w:date`
- `w:moveFrom` containing the moved content
- `w:moveFromRangeEnd` with matching `w:id`

For moved destination (content moved TO):
- `w:moveToRangeStart` with `w:id`, `w:name`, `w:author`, `w:date`
- `w:moveTo` containing the moved content
- `w:moveToRangeEnd` with matching `w:id`

#### Scenario: Move source markup structure

- **WHEN** atoms are marked as `MovedSource`
- **THEN** output contains `w:moveFromRangeStart` before content
- **AND** output contains `w:moveFrom` wrapping content runs
- **AND** output contains `w:moveFromRangeEnd` after content
- **AND** `w:name` attribute links to corresponding destination

#### Scenario: Move destination markup structure

- **WHEN** atoms are marked as `MovedDestination`
- **THEN** output contains `w:moveToRangeStart` before content
- **AND** output contains `w:moveTo` wrapping content runs
- **AND** output contains `w:moveToRangeEnd` after content
- **AND** `w:name` matches the corresponding source

#### Scenario: Range IDs properly paired

- **WHEN** move markup is generated
- **THEN** `w:moveFromRangeStart` and `w:moveFromRangeEnd` share the same `w:id`
- **AND** `w:moveToRangeStart` and `w:moveToRangeEnd` share the same `w:id`

### Requirement: Format Change Info Interface

The system SHALL provide a `FormatChangeInfo` interface with:
- `oldRunProperties`: The `w:rPr` element from the original document (may be null)
- `newRunProperties`: The `w:rPr` element from the modified document (may be null)
- `changedProperties`: Array of friendly property names that differ (e.g., "bold", "italic")

#### Scenario: Bold added

- **GIVEN** original text has no bold formatting
- **AND** modified text has `<w:b/>` in `w:rPr`
- **WHEN** format change is detected
- **THEN** `changedProperties` contains `"bold"`

#### Scenario: Multiple properties changed

- **GIVEN** original text has `<w:b/>`
- **AND** modified text has `<w:i/>` and `<w:u/>`
- **WHEN** format change is detected
- **THEN** `changedProperties` contains `"bold"`, `"italic"`, `"underline"`

### Requirement: Format Change Detection Algorithm

The system SHALL provide a `detectFormatChangesInAtomList()` function that identifies formatting differences in Equal atoms after LCS comparison. The algorithm:
1. Iterates through atoms with `correlationStatus === Equal`
2. Skips atoms without `comparisonUnitAtomBefore` reference
3. Extracts `w:rPr` from ancestor `w:r` element for both original and modified atoms
4. Normalizes `w:rPr` elements (removes existing `w:rPrChange`, sorts children)
5. Compares normalized properties for equality
6. Converts non-equal atoms to `FormatChanged` status with `formatChange` info

#### Scenario: Text becomes bold

- **GIVEN** an Equal atom with text "hello"
- **AND** original atom has no `w:rPr` children
- **AND** modified atom has `<w:b/>` in `w:rPr`
- **WHEN** format detection runs
- **THEN** atom status becomes `FormatChanged`
- **AND** `formatChange.changedProperties` contains `"bold"`

#### Scenario: No format change

- **GIVEN** an Equal atom with text "hello"
- **AND** both original and modified atoms have identical `w:rPr`
- **WHEN** format detection runs
- **THEN** atom status remains `Equal`
- **AND** `formatChange` is not set

#### Scenario: Format detection with text change

- **GIVEN** an atom with `correlationStatus === Inserted`
- **WHEN** format detection runs
- **THEN** the atom is skipped (not checked for format changes)

### Requirement: Run Property Extraction

The system SHALL provide a `getRunPropertiesFromAtom()` function that extracts the `w:rPr` element from an atom's ancestor `w:r` element.

#### Scenario: Run with properties

- **GIVEN** an atom with `ancestorElements` containing a `w:r` element
- **AND** the `w:r` has a `w:rPr` child
- **WHEN** `getRunPropertiesFromAtom()` is called
- **THEN** the `w:rPr` element is returned

#### Scenario: Run without properties

- **GIVEN** an atom with `ancestorElements` containing a `w:r` element
- **AND** the `w:r` has no `w:rPr` child
- **WHEN** `getRunPropertiesFromAtom()` is called
- **THEN** `null` is returned

### Requirement: Run Property Normalization

The system SHALL provide a `normalizeRunProperties()` function that prepares `w:rPr` elements for comparison by:
1. Treating `null` as equivalent to empty `w:rPr`
2. Removing `w:rPrChange` elements (existing revision tracking)
3. Sorting child elements by tag name
4. Sorting attributes within each child by attribute name

#### Scenario: Normalize null properties

- **WHEN** `normalizeRunProperties(null)` is called
- **THEN** an empty `w:rPr` element is returned

#### Scenario: Remove existing revision tracking

- **GIVEN** `w:rPr` containing `<w:b/>` and `<w:rPrChange>...</w:rPrChange>`
- **WHEN** `normalizeRunProperties()` is called
- **THEN** only `<w:b/>` remains in the result

### Requirement: Run Property Comparison

The system SHALL provide an `areRunPropertiesEqual()` function that compares two `w:rPr` elements after normalization.

#### Scenario: Empty properties equal

- **WHEN** comparing `null` to empty `<w:rPr/>`
- **THEN** the result is `true`

#### Scenario: Different properties

- **WHEN** comparing `<w:rPr><w:b/></w:rPr>` to `<w:rPr><w:i/></w:rPr>`
- **THEN** the result is `false`

#### Scenario: Same properties different order

- **WHEN** comparing `<w:rPr><w:b/><w:i/></w:rPr>` to `<w:rPr><w:i/><w:b/></w:rPr>`
- **THEN** the result is `true` (after normalization sorts children)

### Requirement: Format Change Detection Settings

The system SHALL provide configurable settings for format change detection:
- `detectFormatChanges`: Enable/disable format change detection (default: `true`)

#### Scenario: Format detection disabled

- **WHEN** `detectFormatChanges` is `false`
- **THEN** `detectFormatChangesInAtomList()` returns immediately without modification
- **AND** formatting-only changes appear as Equal content with no revision markup

#### Scenario: Format detection enabled by default

- **WHEN** settings are created with defaults
- **THEN** `detectFormatChanges` is `true`

### Requirement: OpenXML Format Change Markup Generation

The system SHALL generate native Word format change tracking markup (`w:rPrChange`) when format changes are detected.

For format-changed content:
- The current `w:rPr` contains the NEW properties
- `w:rPrChange` is added as a child of `w:rPr` containing the OLD properties
- `w:rPrChange` includes `w:id`, `w:author`, and `w:date` attributes

#### Scenario: Format change markup structure

- **WHEN** atoms are marked as `FormatChanged`
- **THEN** output contains `w:rPr` with new properties
- **AND** `w:rPr` contains `w:rPrChange` child
- **AND** `w:rPrChange` contains the old `w:rPr` properties
- **AND** `w:rPrChange` has `w:id`, `w:author`, `w:date` attributes

#### Scenario: Bold added markup

- **GIVEN** original text with no formatting
- **AND** modified text with bold
- **WHEN** format change markup is generated
- **THEN** output is:
```xml
<w:r>
  <w:rPr>
    <w:b/>
    <w:rPrChange w:id="1" w:author="Author" w:date="...">
      <w:rPr/>
    </w:rPrChange>
  </w:rPr>
  <w:t>text</w:t>
</w:r>
```

#### Scenario: Bold removed markup

- **GIVEN** original text with bold
- **AND** modified text with no formatting
- **WHEN** format change markup is generated
- **THEN** output is:
```xml
<w:r>
  <w:rPr>
    <w:rPrChange w:id="1" w:author="Author" w:date="...">
      <w:rPr>
        <w:b/>
      </w:rPr>
    </w:rPrChange>
  </w:rPr>
  <w:t>text</w:t>
</w:r>
```

### Requirement: Format Change Revision Reporting

The system SHALL include format changes in `GetRevisions()` output with type `FormatChanged`, extracting revision information from `w:rPrChange` elements.

#### Scenario: Get format change revisions

- **GIVEN** a document with `w:rPrChange` elements
- **WHEN** `GetRevisions()` is called
- **THEN** format changes are included in the revision list
- **AND** each has `revisionType: FormatChanged`
- **AND** each has `author`, `date`, and `text` properties
- **AND** each has `formatChange` details with old/new properties

### Requirement: Property Name Mapping

The system SHALL provide friendly names for common run properties:

| OOXML Element | Friendly Name |
|--------------|---------------|
| `w:b` | bold |
| `w:i` | italic |
| `w:u` | underline |
| `w:strike` | strikethrough |
| `w:sz` | fontSize |
| `w:szCs` | fontSizeComplex |
| `w:rFonts` | font |
| `w:color` | color |
| `w:highlight` | highlight |
| `w:vertAlign` | verticalAlign |
| `w:caps` | allCaps |
| `w:smallCaps` | smallCaps |

#### Scenario: Unknown property name

- **WHEN** a property without a friendly name is changed (e.g., `w:emboss`)
- **THEN** the local name (`emboss`) is used as the property name

### Requirement: Docx Comparison Package Migrates with Canonical Naming
The repository SHALL provide a `docx-comparison` package in `packages/docx-comparison` published as `@usejunior/docx-comparison`.

#### Scenario: canonical package identity is declared
- **WHEN** `packages/docx-comparison/package.json` is evaluated
- **THEN** the package name is `@usejunior/docx-comparison`
- **AND** licensing remains MIT

#### Scenario: canonical OpenSpec capability is present
- **WHEN** destination OpenSpec specs are listed
- **THEN** a canonical `docx-comparison` capability spec is present

