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

### Requirement: Tracked move ranges are structurally paired

The system SHALL emit exactly one source range and one destination range per
logical tracked move. The emitted structure SHALL use unique
schema-valid `ST_DecimalNumber` range ids canonicalized as integers, non-empty
move names, balanced non-crossing same-direction start/end markers, one range
per direction and `w:name`, and a one-to-one match between source and
destination move names. Both Strict and Transitional use the same integer type
for these ids. The non-empty name rule deliberately strengthens the required
`ST_String` schema attribute, whose lexical space includes the empty string.
Individual `w:moveFrom` or `w:moveTo` wrapper revision IDs are not required to
match the range IDs.

#### Scenario: [MOVE-RANGE-PAIR-01] Inplace emission produces one range pair per logical move

- **GIVEN** one detected move whose source is split across multiple runs or paragraphs
- **WHEN** inplace reconstruction emits tracked move markup
- **THEN** the output contains exactly one `w:moveFromRangeStart` / `w:moveFromRangeEnd` pair
- **AND** the output contains exactly one `w:moveToRangeStart` / `w:moveToRangeEnd` pair
- **AND** each end reuses its start id and both directions use the same move name

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

### Requirement: Inplace Reconstruction Cross-Run Recovery
The atomizer comparison pipeline SHALL evaluate cross-run inplace reconstruction passes before using rebuild fallback when `reconstructionMode` is `inplace`, and SHALL report which inplace pass produced the output.

The pipeline evaluates inplace passes in a fixed order — `inplace_word_split`, `inplace_run_level`, `inplace_word_split_cross_run`, `inplace_run_level_cross_run` — selecting the first whose reconstruction satisfies every round-trip safety check. The cross-run passes are a safety net for run-fragmented documents that the no-cross-run passes cannot reconstruct safely.

As of this requirement's last revision that safety net is not reachable by any known input: `inplace_run_level` deletes and re-inserts whole runs, which preserves normalized text by construction, so it satisfies the round-trip text checks on every case that `inplace_word_split` fails — the cross-run passes are therefore never the selected rescuer. A prior "Cross-run pass rescues inplace output" scenario asserted that unreachable branch and could not be honestly mapped to a test; it is reclassified as a documented residual rather than a routinely-exercised path. The general recovery guarantee is preserved by the "Rebuild fallback only after all inplace passes fail" scenario, which requires the cross-run passes to be evaluated before any rebuild fallback. Reachability of the cross-run passes (candidate dead code superseded by `inplace_word_split` / premerge improvements) is tracked as an engine follow-up. See #469.

#### Scenario: Inplace reconstruction reports the pass that produced the output
- **GIVEN** a run-fragmented document pair compared with `reconstructionMode: inplace` whose first inplace pass fails a round-trip safety check
- **WHEN** a later inplace pass satisfies every safety check and is selected
- **THEN** the result SHALL report `inplaceSuccessDiagnostics.passUsed` naming the selected pass
- **AND** `inplaceSuccessDiagnostics.precedingFailedAttempts` SHALL list every earlier pass that failed a safety check, in evaluation order

#### Scenario: Rebuild fallback only after all inplace passes fail
- **GIVEN** all inplace passes (no-cross-run and cross-run) fail at least one safety check
- **WHEN** comparison completes
- **THEN** the pipeline SHALL use `reconstructionModeUsed: rebuild`
- **AND** `fallbackReason` SHALL be `round_trip_safety_check_failed`

#### Scenario: Table-heavy run-fragmented templates preserve tracked table structure
- **GIVEN** table-heavy OpenAgreements templates with differing run segmentation across original and revised documents
- **WHEN** a small text edit is applied and tracked output is downloaded with `fail_on_rebuild_fallback: true`
- **THEN** download SHALL succeed without rebuild fallback
- **AND** tracked output SHALL preserve table structure (`w:tbl` remains present)

### Requirement: Side-tagged comparison tree carries both side representatives

The comparison engine SHALL provide a side-tagged tree representation of a
compared document pair in which every node carries a tag of `both`, `original`,
or `revised`.

A `both`-tagged node SHALL hold **two** element representatives — one for the
original side and one for the revised side — because two nodes may be matched
without being identical. It MAY additionally carry a scoped property delta
recording a formatting difference between those representatives.

A property delta SHALL be scoped to the OOXML property level it describes — run
(`w:rPr`), paragraph mark (`w:pPr/w:rPr`), paragraph (`w:pPr`), table row or
cell (`w:trPr` / `w:tcPr`), or section (`w:sectPr`) — and SHALL record a direct
property snapshot of each side. It SHALL NOT record formatting resolved through
the style chain or `docDefaults`; effective-formatting fidelity is out of scope
for this representation.

Content that is textually identical on both sides SHALL be tagged `both` and
SHALL NOT be represented as a deletion paired with an insertion.

#### Scenario: Matched-but-differing nodes retain both representatives

- **GIVEN** a run whose text is identical on both sides but whose direct run properties differ
- **WHEN** the pair is aligned into the tagged tree
- **THEN** the node SHALL be tagged `both` with distinct original and revised representatives
- **AND** it SHALL carry a run-scoped property delta holding each side's direct `w:rPr` snapshot

#### Scenario: Property delta scope matches the property level

- **GIVEN** a paragraph whose `w:pPr` differs between sides while its runs are unchanged
- **WHEN** the pair is aligned
- **THEN** the delta SHALL be recorded at paragraph scope, not run scope

#### Scenario: Equal content is tagged both

- **GIVEN** an original and revised document containing an identical run of text
- **WHEN** the pair is aligned
- **THEN** the corresponding node SHALL be tagged `both`
- **AND** no delete/insert representation of that content SHALL be produced

### Requirement: Each projection is isomorphic to its input side

The engine SHALL define `project(tree, side)` as a total fold retaining nodes
tagged `both` or `side`, and the aligner SHALL satisfy a projection-isomorphism
contract for each side `s`:

- **P1 bijection**: every node of input side `s` corresponds to exactly one tree
  occurrence tagged `both` or `s`, and every such occurrence corresponds to
  exactly one node of input side `s`. An explicitly opaque subtree counts as a
  single atomic input unit and its descendants are not separately accounted;
- **P2 order**: sibling order in `project(tree, s)` equals sibling order in
  input side `s`;
- **P3 containment**: parent/child relationships are preserved, so a projected
  node's parent is the projection of its tree parent;
- **P4 content**: side-specific namespace, name, attributes and text are those
  of side `s`'s representative. Element identity SHALL be namespace URI plus
  local name, never the lexical qualified name, because prefixes are aliasable;
- **P5 opaque payload**: a subtree the engine explicitly declines to model is
  carried through equivalent to the input subtree it stands for.

A subtree the engine does not model SHALL be marked opaque **explicitly**. The
absence of modeled children SHALL NOT be interpreted as a declaration of
opacity, because that is also what an incomplete construction looks like: a
representation that cannot distinguish "not modeled deliberately" from "not
modeled by mistake" certifies the second as the first.

P5 equivalence is **canonical, not byte-level**: attribute order is normalized,
adjacent text nodes are concatenated, CDATA and text are treated alike, and
comments and processing instructions do not participate. Content depending on
those distinctions SHALL NOT be modeled as opaque payload.

Coverage and multiplicity alone SHALL NOT be treated as sufficient. An
obligation stating only that each input node appears exactly once admits
`original = [A, B]`, `revised = [B, A]`, tree `[both(B), both(A)]`, whose
original projection is `[B, A]` rather than `[A, B]`; P2 is what excludes it.

P1-P5 SHALL be checkable against the tree without serializing it.

The contract SHALL be scoped to **IR projection fidelity**. It SHALL NOT be
represented as establishing serializer correctness, accept/reject semantics, or
package and story assembly correctness, each of which is a separate layer with
its own evidence.

#### Scenario: Projections reproduce their input sides

- **GIVEN** any aligned pair
- **WHEN** `project(tree, 'original')` and `project(tree, 'revised')` are evaluated
- **THEN** each SHALL be isomorphic to its input side under P1-P5

#### Scenario: An unmodeled subtree must declare itself opaque

- **GIVEN** a tree node whose input element has child elements
- **WHEN** the node carries no modeled children and is not marked opaque
- **THEN** the contract SHALL report a P1 violation naming the unaccounted children
- **AND** the same shape marked opaque SHALL verify clean

#### Scenario: Reordering that satisfies coverage is rejected

- **GIVEN** an original side ordered `[A, B]` and a revised side ordered `[B, A]`
- **WHEN** a candidate tree orders them `[both(B), both(A)]`
- **THEN** the contract SHALL reject the candidate for violating P2
- **AND** the violation SHALL be reported without requiring serialization

#### Scenario: Contract violations name the offending node

- **WHEN** the P1-P5 checks run against a constructed tree
- **THEN** a violation SHALL raise a distinguishable error naming the failing
  obligation and the offending node
- **AND** the failure SHALL NOT be repaired by a downstream pass

### Requirement: Pre-existing tracked changes are represented by construction invariants

The tagged tree SHALL represent tracked-change markup already present in either
input (`w:ins` / `w:del` from prior authors) under explicit invariants rather
than as opaque transported payload, because the engine splits runs along
provenance boundaries and seeds revision identifiers across preserved roots.

The representation SHALL specify:

- **provenance splitting**: where a comparison-side boundary falls inside a
  pre-existing revision, the split SHALL preserve that revision's author and
  date on every resulting fragment;
- **nesting**: which projection unwraps a comparison revision nested inside a
  pre-existing one;
- **revision-identifier allocation**: identifiers SHALL NOT collide with any
  already present in either input;
- **multi-author relationships**: the model SHALL retain the ordered prior
  revision stacks from both representatives and SHALL define how comparison
  revisions nest relative to them.

After a tagged-tree serializer exists, accept and reject over serialized stacked
revisions from several authors SHALL agree with the corresponding tree
projections. This serialized evidence SHALL pass before offline corpus evidence
is treated as complete.

These invariants SHALL be evidenced on the multi-author corpus before the
representation is exercised on any other class of input.

#### Scenario: Provenance survives a boundary split

- **GIVEN** an original document carrying `w:ins` markup from a prior author
- **AND** a comparison-side boundary falling inside that insertion
- **WHEN** the pair is aligned
- **THEN** every resulting fragment SHALL retain the prior author's attribution and date

#### Scenario: Allocated revision identifiers avoid input collisions

- **GIVEN** inputs that already contain revision identifiers
- **WHEN** the tree allocates identifiers for the comparison's own revisions
- **THEN** no allocated identifier SHALL equal one present in either input

#### Scenario: Serialized multi-author stacks preserve both projections

- **GIVEN** a tagged tree retaining ordered revision stacks from several authors
- **WHEN** the offline serializer emits tracked markup and accept/reject are applied
- **THEN** accept SHALL reproduce the revised tree projection
- **AND** reject SHALL reproduce the original tree projection

### Requirement: Tagged-tree construction is the default with an explicit legacy rollback

The ordinary comparison pipeline SHALL use tagged-tree construction by default.
Callers SHALL be able to request the legacy construction explicitly for one
release-cycle rollback window ending 2026-11-16. Legacy removal SHALL proceed
on or after that date once #837 has shipped and #838's release-evidence gate is
complete; if either gate remains incomplete, continued availability SHALL
require a new dated extension decision. Existing runtime safety checks — text, bookmark,
field structure, ancillary story, relationship closure, and package integrity —
SHALL remain in force for both strategies. The public `rebuild` mode SHALL
remain available and unchanged.

The offline harness SHALL continue recording divergence between the two constructions across the
formatting-fidelity corpus, the multi-author fixtures, the OpenAgreements and
NVCA/ILPA templates, and the pinned engine-bug characterization cases.

Divergence SHALL be assessed on projections and fidelity scores rather than
output bytes. A divergence that is not projection-equivalent SHALL be reported
as blocking. A divergence that is projection-equivalent but textually different
SHALL be recorded for individual review and either accepted with a rationale or
pinned as a characterization case.

#### Scenario: Tagged-tree is default with legacy rollback

- **GIVEN** a document pair and no comparison-strategy override
- **WHEN** the pair is compared through the ordinary pipeline
- **THEN** the tagged-tree strategy SHALL construct the returned redline
- **AND** an explicit legacy strategy SHALL remain available as a rollback
- **AND** every existing runtime safety check SHALL still run

#### Scenario: Tagged-tree publication failure returns the validated legacy redline

- **GIVEN** tagged-tree is the requested or default strategy
- **AND** its publication candidate fails an existing runtime safety check
- **WHEN** the legacy candidate has already passed its applicable validation
- **THEN** the pipeline SHALL return the legacy redline instead of throwing
- **AND** SHALL report tagged-tree as requested and legacy as used
- **AND** SHALL report a stable fallback reason and the failed-check diagnostics
- **AND** reconstruction-mode fallback metadata SHALL remain unchanged

#### Scenario: Legacy rollback reaches its sunset

- **GIVEN** the date is on or after 2026-11-16
- **AND** #837 has shipped and #838's release-evidence gate is complete
- **WHEN** comparison strategy support is evaluated
- **THEN** the legacy strategy and automatic fallback SHALL be removed
- **AND** an unmet gate SHALL require an explicit dated extension decision

#### Scenario: Divergence is recorded with fixture identity

- **GIVEN** a controlled offline corpus run
- **WHEN** the two constructions differ
- **THEN** the report SHALL name the fixture and the diverging projection
- **AND** SHALL classify the divergence as projection-inequivalent (blocking) or
  projection-equivalent (for review)

