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

### Requirement: Tracked move ranges are structurally certified

The system SHALL emit exactly one source range and one destination range per
logical tracked move. The compiled fixed-story checker SHALL require unique
schema-valid `ST_DecimalNumber` range ids canonicalized as integers, non-empty
move names, balanced non-crossing same-direction start/end markers, one range
per direction and `w:name`, and a one-to-one match between source and
destination move names. Both Strict and Transitional use the same integer type
for these ids. The non-empty name rule deliberately strengthens the required
`ST_String` schema attribute, whose lexical space includes the empty string.
The checker does not associate individual `w:moveFrom` or
`w:moveTo` wrapper revision IDs with those ranges. The public document-integrity
certificate SHALL expose the bounded result `Tracked move range markers are
structurally paired by range ID and move name.` and SHALL list wrapper-to-range
revision-ID association as an exclusion.
The move-range check SHALL be an optional additive field in the public v1
certificate so certificates produced before this check remain valid v1 values;
consumers SHALL treat absence as unavailable evidence, not as a passing result.

#### Scenario: [MOVE-RANGE-PAIR-01] Inplace emission produces one range pair per logical move

- **GIVEN** one detected move whose source is split across multiple runs or paragraphs
- **WHEN** inplace reconstruction emits tracked move markup
- **THEN** the output contains exactly one `w:moveFromRangeStart` / `w:moveFromRangeEnd` pair
- **AND** the output contains exactly one `w:moveToRangeStart` / `w:moveToRangeEnd` pair
- **AND** each end reuses its start id and both directions use the same move name

#### Scenario: [LEAN-MOVE-RANGE-01] Compiled checker certifies structurally valid move ranges

- **GIVEN** a compared fixed story with one uniquely identified, balanced move source range and one move destination range using the same name
- **WHEN** the compiled Lean checker evaluates the DOCX triple
- **THEN** the move-range checker conjunct passes
- **AND** the public certificate says `Tracked move range markers are structurally paired by range ID and move name.`
- **AND** the certificate excludes association of individual move-wrapper revision IDs with move ranges

#### Scenario: [LEAN-MOVE-RANGE-02] Move-range mutations fail independently of text checks

- **GIVEN** a valid moved-text DOCX triple whose accept and reject text projections match
- **WHEN** the compared story is mutated with a duplicate marker, missing marker, crossed range, mismatched source/destination name, malformed decimal id, numeric-id alias collision, or empty move name
- **THEN** the move-range checker conjunct fails for every mutation
- **AND** the accept and reject text checks continue to pass

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

### Requirement: Round-trip text preservation across track-change resolution is formally proved, with a single named residual obligation

The system SHALL carry a machine-checked Lean proof closing `inv_rt_001` in `verification/lean/LeanSpike/Spec.lean` (the sole remaining `sorry` in the verification spike). `inv_rt_001` states that for any Lean `OoxmlDoc` values `a`, `b`, `combined` with `compareDocumentXml a b = some combined`, the normalized text of `acceptAllChanges combined` equals the normalized text of `b`, and the normalized text of `rejectAllChanges combined` equals the normalized text of `a`.

The proof SHALL be structured as definitional model + machine-checked lemmas + a single named residual axiom, mirroring the Tier 2 `inv_field_001` closure:

- `extractTextWithParagraphs` and `normalizeText` in `Spec.lean` SHALL be rewired from `axiom` to definitional `def`s aliasing new functions in `verification/lean/Tier2/RoundTripText.lean`, which mirror `extractTextWithParagraphs` (`packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:660-688`) and `normalizeText` (`trackChangesAcceptorAst.ts:701-711`). `extractTextWithParagraphs` collects `w:t` and `w:delText` text in document order per paragraph; `instrText` / `delInstrText` / `fldChar` atoms contribute no text.
- `RoundTripText.lean` SHALL prove, with no `sorry`: (a) `extractText (accept d)` equals the revised-side text projection of `d`; (b) `extractText (reject d)` equals the original-side text projection of `d`, consuming the text-invariance of the `delText → text` / `delInstrText → instrText` rename pass; and (c) that `accept`'s dropping of empty-collapsing paragraphs (`verification/lean/Tier2/AcceptReject.lean:44`) is absorbed by `normalizeText`.
- A single new named axiom `compareDocumentXml_output_text_roundtrip` SHALL be declared in `Spec.lean`, asserting that for any `(a, b)` with `compareDocumentXml a b = some combined`, the normalized revised-side projection of `combined` equals the normalized text of `b` and the normalized original-side projection of `combined` equals the normalized text of `a`. The axiom SHALL be stated over text projections of `combined` alone (no `accept` / `reject`), so the machine-checked lemmas carry the connection to the `accept` / `reject` outputs and the axiom is not a restatement of the theorem.
- The `inv_rt_001` proof SHALL compose the named axiom with the `RoundTripText` lemmas as its only non-`Tier2`-internal premises.

`normalizeText` is modeled structurally over a paragraph list (`List (List Char)`, one `List Char` entry per paragraph) rather than as a faithful `String` regex engine, capturing trim + blank-entry drop; the extensional gap to the literal TS regex rewrite (which also collapses intra-line whitespace) SHALL be documented as a Tier-2.5-class residual, not left as a hidden assumption. Extensional equivalence between the Lean `extractText` / `normalizeText` / `accept` / `reject` and their production TS counterparts is NOT established by this requirement and remains a documented residual owned by Tier 2.5. Discharging `compareDocumentXml_output_text_roundtrip` by modeling `compareDocumentXml` definitionally is out of scope and owned by a successor Tier 3 change.

#### Scenario: [LEAN-RT-01] Accept-side round-trip lemma is closed

- **GIVEN** a Lean `Doc` value `d`
- **WHEN** `extractText (accept d)` is evaluated and normalized
- **THEN** it equals the normalized revised-side text projection of `d`, established by a closed Lean proof in `verification/lean/Tier2/RoundTripText.lean` whose normalization step discharges `accept`'s empty-paragraph dropping

#### Scenario: [LEAN-RT-02] Reject-side round-trip lemma is closed

- **GIVEN** a Lean `Doc` value `d`
- **WHEN** `extractText (reject d)` is evaluated (after `reject`'s global `delText → text` / `delInstrText → instrText` rename pass, mirroring `trackChangesAcceptorAst.ts:602-616`)
- **THEN** it equals the original-side text projection of `d`, established by a closed Lean proof that consumes the text-invariance of the rename pass

#### Scenario: [LEAN-RT-03] `inv_rt_001` sorry is replaced by a proof composing the named residual axiom and the lemmas

- **WHEN** `lake build` is run in `verification/lean/`
- **THEN** the build succeeds with no `sorry` warning anywhere in the spike
- **AND** the `sorry` audit in `.github/workflows/lean-build.yml` reports zero `sorry`, and its prior allowance for the `inv_rt_001` `sorry` in `Spec.lean` is removed
- **AND** the `inv_rt_001` proof uses `compareDocumentXml_output_text_roundtrip` and the `Tier2.RoundTripText` lemmas as its only non-`Tier2`-internal premises

#### Scenario: [LEAN-RT-04] Residual obligations and the normalizeText modeling gap are documented

- **WHEN** a reader inspects `verification/lean/Tier2/README.md` or the Specification Gap section of `verification/lean/README.md`
- **THEN** the document explicitly states (a) that the closed `inv_rt_001` proof carries `compareDocumentXml_output_text_roundtrip` as a named residual axiom scoped to this repo's inplace atomizer output (not OOXML comparison engines in general), owned by Tier 3; (b) that the spike now carries exactly two named residual axioms (`compareDocumentXml_output_preservation_friendly` and `compareDocumentXml_output_text_roundtrip`) and zero `sorry`; (c) that `normalizeText` is modeled as a paragraph-list (`List Char` per entry) transform capturing trim + blank-entry drop, with the TS regex's intra-line multi-space/tab collapse unmodeled and owned by Tier 2.5; (d) that extensional equivalence of `extractText` / `accept` / `reject` with their TS counterparts (including `extractText`'s structural- vs. `w:t`-then-`w:delText` ordering) is owned by Tier 2.5; (e) that the production engine's runtime round-trip safety checks are not made redundant by this proof

#### Scenario: [LEAN-RT-05] Bridge case provides a falsifiability layer for the new axiom

- **WHEN** `packages/docx-core/src/integration/lean-spec-bridge.test.ts` runs
- **THEN** at least one field-bearing fixture case asserts `inv_rt_001`'s conclusion against the live engine — the normalized accepted comparison output equals the normalized revised input, and the normalized rejected output equals the normalized original input, using the real TS `extractTextWithParagraphs` and `normalizeText` — and passes
- **AND** the test docstring states precisely that it checks the round-trip conclusion (which the machine-checked lemmas `extractText_accept_normalized` / `extractText_reject` equate to the projection-form residual axiom, so falsifying the conclusion falsifies the axiom), that it does not assert the `revisedText` / `originalText` projection equality directly, and that it is a single fixture case, NOT empirical grounding for a universal claim

### Requirement: Field-bearing property coverage falsifies the inplace residual axioms over generated field documents

The system SHALL exercise the two named residual axioms about this repo's inplace `compareDocumentXml` output — `compareDocumentXml_output_preservation_friendly` (INV-FIELD-001) and `compareDocumentXml_output_text_roundtrip` (INV-RT-001), declared in `verification/lean/LeanSpike/Spec.lean` — against the live TypeScript comparison engine over a **fast-check arbitrary that generates field-bearing documents**, not only over hand-written single fixtures.

The arbitrary SHALL generate clean (non-pre-tracked) `(original, revised)` document pairs in which selected paragraphs carry a complete, self-contained field drawn from the shared constants `COMPLETE_NUMPAGES_FIELD` / `COMPLETE_PAGE_FIELD` / `COMPLETE_PAGEREF_FIELD` (`packages/docx-core/src/testing/ooxml-fixtures.ts`), and the difference between the two sides SHALL realize one of a fixed set of field operations: field-insert, field-delete, field-stable (field present and identical on both sides), and text-only (field unchanged on both sides with a tracked text edit in a different paragraph). The arbitrary SHALL NOT generate fragmented field modifications, nested fields, or fields spanning paragraph boundaries; those surfaces are out of scope.

The property tests SHALL run through the inplace reconstruction path and:

- treat any inplace fallback as falsification (via the existing `assertInplaceResult`, emitting `triage=inplace-fallback`), NOT silently filter it with `fc.pre`;
- assert an operation-family (and field-type) coverage floor so a generator that stopped producing an operation fails loudly rather than passing vacuously;
- for INV-FIELD-001, assert the document-level field-structure invariant (`assertFieldInvariant`) on every run, and additionally assert the stronger per-subtree `recursivelyWellformed` / `fieldContextNeutral ∀ ctx` invariant (`assertRecursivelyWellformed`) only on runs whose operation is not field-delete, because post-#217 the inplace atomizer fragments deleted fields and the resulting `<w:del>` subtrees are not field-context-neutral — the same per-operation assertion-strength split the existing field-delete fixture documents;
- for INV-RT-001, assert that the normalized text of `acceptAllChanges(combined)` equals the revised input's normalized text and the normalized text of `rejectAllChanges(combined)` equals the original's, using the live `extractTextWithParagraphs` / `normalizeText`, with field result text (`<w:t>` payloads) counted and `instrText` / `delInstrText` / `fldChar` atoms contributing no text.

This requirement strengthens empirical falsifiability only; it introduces no Lean change and does not discharge either residual axiom (Tier 3 owns that). The existing field-free property tests and the three single field fixtures SHALL remain.

#### Scenario: [LEAN-FBA-01] Field-bearing arbitrary drives INV-FIELD-001 across operations

- **GIVEN** the `fieldBearingPairArb` fast-check arbitrary generating clean field-bearing `(original, revised)` pairs over field-insert / field-delete / field-stable / text-only operations and the NUMPAGES / PAGE / PAGEREF field types
- **WHEN** each generated pair is compared through the live inplace engine and the combined output is accepted and rejected
- **THEN** `assertFieldInvariant` holds on every run and `assertInplaceResult` confirms inplace mode was used, with the property executing at `numRuns: 100`

#### Scenario: [LEAN-FBA-02] Per-operation assertion strength matches the post-#217 engine

- **WHEN** a generated run's operation is field-insert, field-stable, or text-only
- **THEN** the stronger `assertRecursivelyWellformed` (per-subtree `fieldContextNeutral ∀ ctx`) is asserted in addition to `assertFieldInvariant`
- **AND** when the operation is field-delete, only the document-level `assertFieldInvariant` is asserted, because the fragmented `<w:del>` subtrees are not field-context-neutral — matching the strength of the `compareDocumentXml_output_preservation_friendly` axiom

#### Scenario: [LEAN-FBA-03] Field-bearing arbitrary drives INV-RT-001 round-trip

- **WHEN** each generated field-bearing pair is compared and the combined output is projected through accept-all and reject-all
- **THEN** the normalized accepted text equals the revised input's normalized text and the normalized rejected text equals the original's, via the live `extractTextWithParagraphs` / `normalizeText`, with field result text counted and field instruction / fldChar atoms contributing none

#### Scenario: [LEAN-FBA-04] Fallback is falsification and coverage is floored, not silently filtered

- **WHEN** the field-bearing properties run
- **THEN** any inplace fallback fails the property with `triage=inplace-fallback` diagnostics rather than being discarded by `fc.pre`
- **AND** a coverage assertion requires every field operation family (and field type) to have been exercised, so a degenerate generator that drops an operation fails loudly instead of passing vacuously

#### Scenario: [LEAN-FBA-05] Bridge file self-description stays accurate

- **WHEN** a reader inspects the header comment blocks of `packages/docx-core/src/integration/lean-spec-bridge.test.ts`
- **THEN** the "Coverage surfaces" block lists the field-bearing arbitrary and its operation families, the "Fallback semantics" block scopes the "field-free ⇒ no `ContainerResolutionError`" claim to the two original generators and documents the field-bearing arbitrary's narrower inplace-safe operation set, and the "Coverage limitations" note no longer implies all field-bearing input families live only in `collapsed-field-inplace.test.ts`

### Requirement: Protocol v4 independently selects relationship-addressed stories

The compiled Lean verifier SHALL accept internal executable protocol v4 only
and SHALL receive only immutable original, revised, and compared DOCX package
paths. Lean SHALL independently parse each package's `word/document.xml`
exact direct `w:document/w:body/w:sectPr` and
`w:document/w:body/w:p/w:pPr/w:sectPr` bindings and
`word/_rels/document.xml.rels`; normalize and resolve selected targets; parse
the selected target parts; and assemble the story triples. The request SHALL
NOT contain a TypeScript-produced story manifest, pre-resolved target, selector
conclusion, or invariant pass bit.

The selector SHALL include only direct explicit header/footer bindings whose
role is `first`, `default`, or `even`. Other `w:sectPr` ancestry SHALL emit
`UNSUPPORTED_SECTION_PLACEMENT`; indirect header/footer descendants of a
supported section, and any header/footer reference outside an open supported
direct section, SHALL emit `INDIRECT_SECTION_BINDING`. Main inventory
construction SHALL require exactly one direct `w:document/w:body`, reject
missing, multiple, or nested bodies, permit at most one direct body-level
terminal `w:sectPr`, and reject any body element after it. It SHALL NOT infer
inherited role semantics, pagination, or reader fallback behavior. Protocol
v1-v3 requests and unknown request fields SHALL be rejected.

#### Scenario: [LEAN-REL-01] Lean derives selected stories from three packages

- **GIVEN** an inplace original/revised/compared package triple with valid
  direct first, default, and even header and footer bindings
- **WHEN** the protocol v4 verifier runs
- **THEN** Lean SHALL derive every selected story from each package's document
  and relationship XML
- **AND** no TypeScript-produced story manifest SHALL participate in selection

#### Scenario: [LEAN-REL-02] Unsupported selection semantics are not inferred

- **GIVEN** a role is absent and could be supplied by Word's inherited or
  fallback header/footer behavior
- **WHEN** the verifier selects relationship stories
- **THEN** it SHALL select only the direct explicit supported bindings
- **AND** the certificate SHALL make no inherited-role, pagination, or
  rendering claim

### Requirement: Protocol v4 schema and status equations are exact

The request SHALL have exactly `protocolVersion: 4`, `originalDocxPath`,
`revisedDocxPath`, and `comparedDocxPath`. The response SHALL have exactly
`protocolVersion: 4`,
`checker: "safe-docx-lean-relationship-story-checker"`, `passed`,
`fixedStories`, `presenceMismatches`, `fixedStoryIssues`, `relationshipSlots`,
`relationshipStories`, and `selectionIssues`, with the exact nested fields,
types, optional issue locators, literal enums, `FixedStoryIssueCode`, and
`SelectionIssueCode` unions specified in the design. Every object at every
nesting level SHALL reject unknown keys; optional issue locator fields SHALL be
absent rather than `null`.

Fixed and relationship reports SHALL derive their `passed` bit from the
conjunction of exactly six generic checks. Slot and physical-story ordinals
SHALL be contiguous array indices. Every logical slot SHALL reference exactly
one physical story and occur exactly once across physical selector lists.
Physical grouping SHALL be if and only if kind plus all three normalized paths
match. Each package side SHALL expose at most 256 unique selected paths. An
optional fixed report and an issue for the same story name SHALL be mutually
exclusive. Ordering, uniqueness, fixed-name/part mappings, presence mismatches,
token counts, locator lengths, and issue ordering SHALL satisfy every equation
specified in the design.

Protocol v4 `presenceMismatches` SHALL be empty: required-main absence prevents
a response, while optional absence is empty-token semantics. Overall `passed`
SHALL equal: no selection issue, no optional fixed-story issue, every fixed
story report passed, and every relationship story report passed.

A valid v4 response SHALL exist only after all three required
`word/document.xml` parts are uniquely indexed/extracted, UTF-8 decoded,
accepted-root parsed/tokenized within limits, and used to construct supported
section inventories. Any failure in that chain, including wrong root, malformed
main XML, main byte/depth/token limit, or inability to construct a bounded
inventory, SHALL be process-level `not_run` with no v4 evidence fields.
Recognized but unsupported section placement is instead a structured
post-tokenization selection issue.

After valid main tokenization, relationship/binding/alignment and
relationship-XML failures plus selected target missing/malformed/wrong-root/
UTF-8/known-limit failures SHALL be structured `selectionIssues` and public
`failed`. Optional note known-limit, UTF-8, XML, root, depth, or token failures
SHALL be structured `fixedStoryIssues` and public `failed`; absent optional
sides remain empty. Actual extractor exit/length/CRC correspondence failure for
any part SHALL remain `not_run`.
When selected physical work fails to load, every independently successful
physical work item and its selecting slots SHALL remain in canonical,
contiguously reindexed structured evidence; only failed work SHALL receive load
issues, and aggregate `passed` SHALL be false.

#### Scenario: [LEAN-REL-17] Exact nested schema rejects ambiguity

- **WHEN** a request or response contains an unknown key, `null` optional
  locator, invalid literal, unsafe/negative integer, duplicate identity,
  noncanonical order, bad cardinality, or inconsistent derived bit
- **THEN** internal protocol validation SHALL reject it
- **AND** the public certificate SHALL be `not_run`, never `passed`

#### Scenario: [LEAN-REL-18] Completed selection failure differs from not-run

- **WHEN** Lean returns a schema-valid v4 response with a structured selection
  issue, optional fixed-story issue, or failed story report
- **THEN** the public certificate SHALL be `failed` and retain the valid
  structured evidence
- **BUT WHEN** execution, trustworthy ZIP indexing, extraction, or protocol
  validation does not complete
- **THEN** the public certificate SHALL be `not_run` with no relationship pass

#### Scenario: [LEAN-REL-19] Required main failures cannot produce structured failure

- **WHEN** any required main part is absent, non-unique, unextractable, invalid
  UTF-8, malformed, wrong-root, over byte/depth/token limits, or cannot produce
  the supported section inventory within limits
- **THEN** the executable SHALL produce no valid v4 response
- **AND** the public certificate SHALL be `not_run` without v4 evidence fields

### Requirement: Relationship stories align deterministically by logical slot

The verifier SHALL align original, revised, and compared bindings only by
logical slot `(sectionOrdinal, kind, role)`. It SHALL retain the relationship
ID and normalized package path from each side as evidence and SHALL NOT use
either as cross-package identity.

The three documents SHALL have equal section counts and equal ordered explicit
slot inventories. A count mismatch or selector-observable difference in the
ordered direct `(kind, role)` inventory SHALL be a structured selection
failure; the verifier SHALL NOT heuristically reconcile sections. Remaining
ordinally aligned target permutations SHALL be checked as their actual XML
triples. The verifier SHALL NOT claim semantic section identity or detection of
a permutation among selector-indistinguishable sections.

Logical evidence SHALL order section ordinal ascending, header before footer,
and role first, default, then even. Physical checks SHALL deduplicate only
stories with the same kind and complete original/revised/compared normalized
target tuple, while retaining every selecting logical slot.

#### Scenario: [LEAN-REL-03] Side-specific identities align by slot

- **GIVEN** one logical slot uses different valid relationship IDs and
  normalized target paths in the three packages
- **WHEN** protocol v4 assembles its relationship story
- **THEN** the story SHALL align by section ordinal, kind, and role
- **AND** the report SHALL retain all three side-specific IDs and paths

#### Scenario: [LEAN-REL-04] Selector-observable section differences fail closed

- **WHEN** section counts differ or the ordered direct slot inventories differ
- **THEN** verification SHALL fail with a structured section alignment issue
- **AND** no LCS, target-path match, or relationship-ID match SHALL be used to
  manufacture an alignment
- **AND** no claim SHALL be made about semantic identity or permutations of
  selector-indistinguishable sections

#### Scenario: [LEAN-REL-05] Shared targets check once without losing selectors

- **GIVEN** multiple logical slots select the same kind and the same complete
  three-side target tuple
- **WHEN** the collection is assembled
- **THEN** the physical XML triple SHALL be parsed and checked once
- **AND** its evidence SHALL list every selecting logical slot in canonical
  order

### Requirement: Selected relationship resolution is safe and fail closed

Each selected binding SHALL resolve unambiguously through the package's own
package-relationships XML to exactly one internal relationship of the matching
header/footer type. The verifier SHALL safely normalize relative or
package-absolute targets against `word/document.xml`, preserve package-root
containment, require the selected target part, and require the expected
WordprocessingML `w:hdr` or `w:ftr` root.

Malformed or wrong-root document/relationship XML, unsupported section
structure, duplicate slots or relationship IDs, missing or ambiguous selected
relationships, type mismatch, external or invalid target mode, unsafe target,
missing target part, malformed target XML, wrong target root, invalid UTF-8,
and extraction-bound failures SHALL produce bounded structured selection
issues and make the aggregate fail. A selected candidate SHALL never be
silently omitted or replaced with an empty story. Unreferenced malformed
header/footer parts SHALL remain outside verification and receive no passing
evidence.

Raw or repeatedly percent-decoded `*`, `[`, or `]` in a relationship target
SHALL be `UNSAFE_TARGET`; these names SHALL never reach extractor invocation.

#### Scenario: [LEAN-REL-06] Safe internal targets resolve

- **WHEN** a selected relationship uses a relative or package-absolute internal
  target whose dot segments normalize within the package root
- **THEN** Lean SHALL resolve it to one deterministic normalized package path
- **AND** SHALL require a present part with the expected expanded-name root

#### Scenario: [LEAN-REL-07] Adversarial selected relationships fail structurally

- **WHEN** a selected relationship is missing, duplicated, external,
  type-mismatched, unsafe, package-escaping, missing its part, malformed, or
  points to the wrong root
- **THEN** protocol v4 SHALL return a structured issue with stable code, side,
  and available logical/relationship/path locator fields
- **AND** aggregate `passed` SHALL be false regardless of other story reports

### Requirement: Protocol v4 pins its accepted syntax and aggregate limits

The verifier SHALL accept only the Transitional namespaces and the exact
XML/namespace, relationship-record, ZIP, and relationship-target subsets
specified in the change design. Strict OOXML namespace URIs SHALL remain
outside this increment. Prefixes SHALL resolve namespace-aware; malformed
QNames, unbound or illegally rebound prefixes, duplicate expanded attributes,
unsupported declarations/entities, comments, non-declaration processing
instructions, CDATA, DTDs, external entities, extra roots, or non-whitespace
outside the root SHALL fail closed.

Relationship records SHALL be direct children of the package-relationships
root with exactly one `Id`, `Type`, and `Target` and at most one `TargetMode`.
Both self-closing and explicit-empty records SHALL be accepted; child content
SHALL fail structurally. Malformed records and duplicate IDs SHALL fail structurally even when
unselected. A structurally valid unselected record's type/target semantics
SHALL remain unchecked and SHALL receive no passing evidence.

Lean SHALL construct the trusted package inventory by bounded binary parsing of
a classic single-disk ZIP central directory. It SHALL perform the exact EOCD
search/validation, central-record consumption, central/local filename and
flags/method agreement, UTF-8-flag/printable-ASCII name policy, Unicode Path
extra-field rejection, duplicate and unsafe-name rejection, compression/
encryption policy, and size/offset/range/overlap checks specified in the
design. It SHALL reject ZIP64 extra field ID `0x0001` in every central or local
extra sequence regardless of sentinel use, require every central disk-start
field to equal zero, and require classic size/offset fields rather than ZIP64
sentinels.

For stored method `0`, only UTF-8 bit 11 SHALL be allowed
(`flags & ~0x0800 == 0`). For deflate method `8`, only option bits 1-2 and
UTF-8 bit 11 SHALL be allowed (`flags & ~0x0806 == 0`). Central/local flags
SHALL be equal. Every complete local-record span, comprising fixed local
header, filename, extra field, and compressed data, SHALL agree with its
central record, end no later than the central-directory start, remain
package-bounded, and be pairwise non-overlapping. ZIP64, multi-disk, encrypted,
data-descriptor/patch/strong-encryption/reserved-flag, unsupported-method,
ambiguous-name, or invalid index input SHALL be `not_run`, not structured
selection failure.

Only after one unique safe central/local entry is proven MAY Lean invoke
`unzip -p --` by argv for decompression. It SHALL use an absolute controlled
snapshot path and exact pattern-safe entry name, then verify exit status,
bounded output length, and CRC-32 against the binary index. Extractor
correspondence failure SHALL be `not_run`; `unzip` output SHALL NOT supply
trusted inventory metadata.

The verifier SHALL enforce the exact per-item, per-package, and three-package
limits specified in the design: 32/96 MiB packages; 4/12 MiB classic central
directories; 1,024/3,072 ZIP entries; 256-byte ZIP names; 64/192 sections;
384/1,152 direct bindings; 1,024/3,072 relationship records; 256/768 unique
selected parts; 8 MiB compressed and 16 MiB expanded per XML part; 16/48 MiB
cumulative compressed XML; 32/96 MiB cumulative expanded XML; 500,000
per-part, 1,000,000 per-package, and 3,000,000 per-request XML events; depth
128; 1,536 issues; 128-byte relationship IDs; 256-byte path/target/locator/
detail values; 1 MiB aggregate emitted variable strings; 64 KiB request/stderr;
and 8 MiB response.

Resource admission SHALL proceed as required main first; relationship XML,
complete unique selected-target metadata, and selected physical work next;
footnotes next; and endnotes last. Before decompressing any selected target,
Lean SHALL enforce every metadata-known relationship path-count, selected-part,
compressed-byte, and expanded-byte ceiling over each package and the triple.
A relationship metadata ceiling SHALL emit a selection issue and SHALL admit
no selected-target decompression. Each admitted XML part SHALL be event-parsed
under the remaining per-part and package bounds, and its semantic tokens SHALL
be derived from that bounded event stream without an unbounded second parse.
Aggregate event exhaustion SHALL stop later selected work. An optional note
whose metadata would cross a byte ceiling SHALL emit its corresponding fixed
story issue without extraction; optional processing SHALL remain ordered
footnotes before endnotes, and truthful relationship evidence already completed
SHALL remain visible.
Bounded XML parse failure SHALL carry a typed reason and completed/observed
event and depth counts. A typed event-limit failure SHALL be aggregate
exhaustion when the remaining package allowance is less than or equal to the
500,000-event per-part ceiling, including equality, and SHALL stop subsequent
selected and optional extraction. It SHALL remain a per-part overflow only when
the remaining package allowance is greater than 500,000.

The response serializer SHALL use the invariant that selecting slot ordinals
form an exact partition across physical stories. It SHALL bound relationship
story structure as at most 384 fixed story-overhead charges of 640 bytes plus
384 selector-ordinal charges of eight bytes, rather than a false flat bound
that includes an unbounded selector list. Together with the other design
charges and six-times worst-case JSON expansion of the 1 MiB string budget,
the maximum SHALL be 7,212,032 bytes, below 8,388,608.

Executable maximum-shape fixtures SHALL cover one shared story with the legal
192-selector single-kind maximum and 384 stories with one selector each, both
with worst-case escaping and near-ceiling string budgets. Separate fixtures SHALL spend the reserved 512
string bytes on `ISSUE_LIMIT_EXCEEDED` and
`EVIDENCE_STRING_BUDGET_EXCEEDED` in turn. No within-budget input SHALL
overflow the output cap.

#### Scenario: [LEAN-REL-14] XML and namespace subset fails closed

- **WHEN** selector or selected-story XML uses a Strict namespace, malformed or
  unbound QName, duplicate expanded attribute, unsupported declaration/entity,
  comment, processing instruction, CDATA, DTD, external entity, or extra root
- **THEN** protocol v4 SHALL reject it under the pinned accepted subset
- **AND** alternate prefixes correctly bound to the Transitional namespaces
  SHALL remain accepted

#### Scenario: [LEAN-REL-15] Unselected relationship records remain structurally bounded

- **WHEN** an unselected direct relationship record is malformed or duplicates
  any relationship ID
- **THEN** selection SHALL fail with a structured issue
- **BUT WHEN** an unselected record is structurally valid but has an unsupported
  type, external mode, or unsafe target
- **THEN** its target semantics SHALL remain unchecked and no passing evidence
  SHALL be emitted for it

#### Scenario: [LEAN-REL-16] Aggregate budgets prevent amplification

- **WHEN** an item, package, or three-package aggregate exceeds any pinned ZIP,
  section, binding, relationship, selected-part, byte, XML event/depth, issue,
  locator/detail, request, diagnostic, or response limit
- **THEN** the run SHALL fail before publishing a passing certificate
- **AND** reaching a limit exactly SHALL remain permitted

#### Scenario: [LEAN-REL-22] Metadata and event admission stop decompression

- **WHEN** selected paths exceed 256, relationship metadata exceeds a byte
  aggregate, an optional note would cross the remaining byte budget, or an
  admitted part exhausts the aggregate XML-event budget
- **THEN** Lean SHALL not decompress metadata-rejected selected or optional
  parts and SHALL stop parsing later work after event exhaustion
- **AND** relationship failures SHALL remain selection issues, optional
  crossings SHALL remain fixed-story issues, and prior truthful relationship
  evidence SHALL remain visible
- **AND** exact equality between remaining aggregate events and the per-part
  ceiling SHALL use aggregate classification without inspecting diagnostic text

#### Scenario: [LEAN-REL-20] Lean binary index establishes exact extraction identity

- **WHEN** a classic single-disk stored/deflated package satisfies the bounded
  EOCD, central-directory, local-header, filename, flag, size, offset, and CRC
  contract
- **THEN** Lean MAY decompress one uniquely indexed safe exact name through
  `unzip -p --`
- **AND** SHALL accept the bytes only when output length and CRC match the index

#### Scenario: [LEAN-REL-21] Archive ambiguity is not a structured verifier result

- **WHEN** a package is ZIP64, multi-disk, encrypted, uses a data descriptor or
  unsupported method, has ambiguous EOCD, mismatched central/local names,
  invalid UTF-8/ASCII naming, Unicode Path ambiguity, duplicate/unsafe names,
  ZIP64 `0x0001` extra field, nonzero central disk start, forbidden flag bit,
  directory/symlink/special entries, overlapping or out-of-bounds complete
  local-record spans, or extractor correspondence failure
- **THEN** the executable SHALL produce no valid v4 response
- **AND** the public certificate SHALL be `not_run`

#### Scenario: [LEAN-REL-22] Every legal response fits the output cap

- **WHEN** response arrays and variable strings reach every protocol-v4
  cardinality and aggregate evidence ceiling
- **THEN** production serialization SHALL remain below 8 MiB even under
  worst-case JSON escaping
- **AND** maximum-schema fixtures SHALL cover both one shared story with the
  legal 192-selector single-kind maximum and 384 one-selector stories
- **AND** either terminal issue SHALL fit using its mutually exclusive reserved
  bytes

### Requirement: Generic collection verification covers fixed and relationship stories

Protocol v4 SHALL retain the fixed required main story and optional
footnote/endnote stories with their existing presence, reserved-note
projection, namespace, and independent-state semantics. It SHALL append valid
deduplicated relationship-selected header/footer triples and run the existing
generic named-story collection checker over the combined deterministic list.

The existing generic collection soundness theorem SHALL be reused. The Lean
implementation SHALL provide and audit
`direct_binding_selection_complete`,
`aligned_slot_unique_work_item`,
`dedup_preserves_selector_locators`, and
`relationship_story_aggregate_sound`. Their intended statements SHALL prove,
respectively: every supported per-side direct binding identity emits exactly
one structured identifying issue or appears with its exact identity in exactly
one aligned slot, mutually exclusively; every successful slot maps to exactly
one physical work item; every physical story's locator list equals the
canonical deterministic list derived from aligned slots; every checked triple
matches the loaded physical work's complete key, generated name, and exact
original/revised/combined token lists; and aggregate success implies all of
those predicates plus the result of `story_collection_checker_sound` for every
fixed and selected physical story.

`AxiomAudit.lean` SHALL add `#print axioms` targets for all four theorems under
`Tier2.RelationshipStorySelector` while retaining all existing audit targets.
The normalized repository-wide axiom union SHALL remain exactly the existing
six names: `Classical.choice`,
`LeanSpike.compareDocumentXml`,
`LeanSpike.compareDocumentXml_output_preservation_friendly`,
`LeanSpike.compareDocumentXml_output_text_roundtrip`, `Quot.sound`, and
`propext`. No new `sorry` or axiom SHALL be introduced.

#### Scenario: [LEAN-REL-08] Every selected story must pass independently

- **GIVEN** fixed stories and multiple selected header/footer triples
- **WHEN** one selected header/footer story violates a generic field, move, or
  accept/reject text check
- **THEN** that story and the aggregate SHALL fail
- **AND** markers or text in another story SHALL NOT balance the failure

#### Scenario: [LEAN-REL-09] Selector proofs do not widen the axiom union

- **WHEN** CI audits the generic checker theorem and every new selector theorem
- **THEN** the normalized axiom union SHALL equal the unchanged exact six-name
  allowlist
- **AND** every Lean module SHALL remain zero-`sorry`
- **AND** all four named selector/aggregate theorems SHALL be explicit
  `#print axioms` targets

### Requirement: Public certificate v1 adds honest relationship-story evidence

The public document-integrity certificate SHALL remain protocol v1 and preserve
the meaning and availability of its verifier, main-document scope, package and
main XML hashes, main checks and token counts, fixed-story scope and reports,
presence mismatches, reconstruction mode, statuses, and legacy v1 values.
Internal checker metadata SHALL distinguish legacy v3 from current v4.

Protocol v4 results SHALL add exactly the optional v1 fields
`fixedStoryFailures?: DocumentIntegrityFixedStoryFailure[]`,
`relationshipStoryScope?: DocumentIntegrityRelationshipScope`,
`relationshipSlots?: DocumentIntegrityRelationshipSlot[]`,
`relationshipStories?: DocumentIntegrityRelationshipStory[]`, and
`relationshipSelectionFailures?:
DocumentIntegrityRelationshipSelectionFailure[]` with the exact TypeScript
fields, literal enums, issue-code union, and optionality specified in the
design. `checkerProtocolVersion` SHALL widen to optional `3 | 4`. A valid v4 run
SHALL emit the fixed failure field and all four relationship fields together,
including empty arrays, and
SHALL preserve internal identities, ordinals, ordering, cardinality, failures,
and checks while renaming internal token-count key `combined` to public
`compared`.

Absence of additive v4 evidence SHALL mean unavailable, not passing.
Legacy v1 certificates MAY omit all five fields and carry absent or v3 internal
metadata. Partial emission by the current v4 producer SHALL be forbidden.
Rebuild SHALL remain `not_applicable`; unavailable, malformed, inconsistent,
timed-out, or unbounded protocol execution SHALL remain `not_run`. A selection
issue, optional fixed-story issue, or failed story SHALL prevent `passed`.

The certificate SHALL continue to exclude inherited role semantics, unselected
parts, complete relationship or OPC integrity, full XML Schema validation,
field evaluation, bookmark resolution, pagination, rendering, and complete
ECMA-376 conformance.

#### Scenario: [LEAN-REL-10] Legacy public v1 shape remains compatible

- **WHEN** a consumer reads either a legacy fixed-story v1 certificate or a v1
  certificate with protocol v4 relationship evidence
- **THEN** all preexisting public v1 fields SHALL retain their meanings
- **AND** all relationship-story fields SHALL be additive and optional
- **AND** a current v4 producer SHALL emit all five additive v4 evidence fields
  together or none of them

#### Scenario: [LEAN-REL-11] Inconsistent v4 output cannot become a pass

- **WHEN** executable output has unknown fields, duplicate or out-of-order
  selectors, inconsistent counts, invalid identities, or an aggregate pass bit
  inconsistent with failures and story reports
- **THEN** the launcher SHALL return public `not_run`
- **AND** SHALL NOT publish relationship-story passing evidence

### Requirement: Relationship-story verification has compiled and real-DOCX evidence

Tests SHALL exercise the actual compiled protocol v4 executable and launcher
with multiple sections, all direct header/footer roles, side-specific
identities, shared targets, deterministic ordering, fixed-story retention,
section misalignment, and adversarial relationship/target/part inputs.

A real regression SHALL load
`tests/test_documents/nvca-coi-regression/source.docx`, derive the revised side
with one unrelated minimal body edit through exported
`replaceParagraphTextRange`, produce true inplace output, and require nonzero
relationship-story evidence. It SHALL mutate every deduplicated selected
header/footer target one at a time in the compared package only, leaving
original and revised byte-identical. Each mutation SHALL remain parser-accepted,
token-observable to a generic check, within limits, and selection-successful.
The test SHALL reject `not_run` or selection failure as evidence and SHALL
require the corresponding relationship story report to fail at least one
generic check while retaining the same physical identity and affected logical
slots. Shared targets SHALL retain all selecting slot locators. The compiled
suite, axiom audit, coverage ledger check, and NVCA mutation test SHALL be wired
into Lean CI.

#### Scenario: [LEAN-REL-12] Real NVCA selected-story mutations fail

- **GIVEN** the checked-in NVCA COI source-derived true-inplace package triple
  passes protocol v4 with selected header/footer evidence
- **WHEN** each deduplicated selected header/footer target is independently
  mutated only in the compared snapshot with parser-accepted token-observable
  XML
- **THEN** selection SHALL still succeed with the same story identity
- **AND** the corresponding relationship story report SHALL fail a generic
  check
- **AND** shared-target failures SHALL retain all affected logical slot
  locators

#### Scenario: [LEAN-REL-13] CI executes the compiled trust boundary

- **WHEN** Lean verifier, launcher, NVCA fixture/test, or coverage-ledger inputs
  change
- **THEN** CI SHALL build the Lean executable and run focused protocol v4,
  adversarial, real-DOCX, axiom, zero-`sorry`, and coverage checks
- **AND** the mandatory repository gates SHALL pass before merge
