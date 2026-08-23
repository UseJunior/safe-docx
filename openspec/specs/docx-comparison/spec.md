# docx-comparison Specification

## Purpose
TBD - created by archiving change add-wmlcomparer-core-types. Update Purpose after archive.
## Requirements
### Requirement: Correlation Status Enumeration

The system SHALL provide a `CorrelationStatus` enum with `Nil`, `Normal`,
`Unknown`, `Inserted`, `Deleted`, `Equal`, `Group`, `MovedSource`,
`MovedDestination`, and `FormatChanged`. Statuses SHALL describe tagged nodes or
serialized tracked ranges and SHALL NOT require a flattened comparison atom.

#### Scenario: Tagged nodes receive correlation status

- **WHEN** aligned content exists only on the revised side
- **THEN** the corresponding tagged node's `correlationStatus` is `Inserted`

#### Scenario: Matched formatting difference receives format status

- **WHEN** a `both` node has equal text and a scoped direct-property delta
- **THEN** its `correlationStatus` is `FormatChanged`

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

The system SHALL classify moves on tagged subtrees. It SHALL first pair exact
subtree signatures, then globally pair residual original/revised candidates using
word Jaccard and containment similarity. Residual matching SHALL be one-to-one,
deterministic, independent of candidate enumeration order, and governed by the
configured threshold, minimum word count, and case behavior.

Matching SHALL reject overlapping and ancestor/descendant conflicts, the two
paragraph representatives of one `both` node, and candidates whose fields,
ranges, tables, text boxes, notes, or preserved input revisions cannot be emitted
safely. Repeated equal or similar blocks SHALL receive stable move names and IDs.

#### Scenario: Exact move matching precedes fuzzy matching

- **GIVEN** exact-signature and merely similar residual move candidates
- **WHEN** tagged move classification runs
- **THEN** every safe exact pair SHALL bind before residual fuzzy pairing begins

#### Scenario: Residual matching is globally deterministic

- **GIVEN** repeated similar original and revised subtrees with tied scores
- **WHEN** candidates are enumerated in different orders
- **THEN** the same one-to-one move pairs, names, and IDs SHALL be produced

#### Scenario: Paired paragraph representatives are not moves

- **GIVEN** original and revised candidates whose nearest paragraphs are the two representatives of one `both` node
- **WHEN** fuzzy move classification runs
- **THEN** those candidates SHALL remain ordinary changes rather than a move pair

### Requirement: Jaccard Word Similarity

The system SHALL provide portable `jaccardWordSimilarity()` and
`wordContainmentSimilarity()` string functions. Jaccard similarity SHALL
tokenize strings into word sets and return intersection size divided by union
size from `0.0` to `1.0`. Containment similarity SHALL report how completely the
smaller word set occurs in the larger. Both SHALL support explicit
case-sensitive or case-insensitive comparison without an external diff library.

#### Scenario: Identical text returns one

- **WHEN** `jaccardWordSimilarity()` compares "hello world" with "hello world"
- **THEN** it SHALL return `1.0`

#### Scenario: Contained phrase scores complete containment

- **WHEN** `wordContainmentSimilarity()` compares "quick brown fox" with "the quick brown fox jumps"
- **THEN** it SHALL return `1.0` for the smaller word set's containment

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

### Requirement: Tracked move ranges are structurally paired

The system SHALL emit exactly one source range and one destination range per
logical tagged move. Each direction SHALL have one balanced start/end pair with
a schema-valid integer identifier, both directions SHALL share one non-empty
move name, and wrapper revision identifiers SHALL remain independent from range
identifiers.

#### Scenario: Tagged emission produces one range pair per logical move

- **GIVEN** one tagged move whose source spans a complete paragraph
- **WHEN** the tagged serializer emits tracked move markup
- **THEN** exactly one `w:moveFromRangeStart` / `w:moveFromRangeEnd` pair SHALL be emitted
- **AND** exactly one `w:moveToRangeStart` / `w:moveToRangeEnd` pair SHALL be emitted
- **AND** each end SHALL reuse its start identifier and both directions SHALL use the same non-empty move name

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

The system SHALL detect direct formatting differences between the original and
revised representatives of `both` tagged nodes. It SHALL normalize the relevant
run, paragraph-mark, paragraph, row, cell, or section property snapshots; ignore
existing property-change children while comparing live properties; and attach a
scoped `PropertyDelta` containing original/revised snapshots and friendly changed
property names. Effective formatting resolved through styles remains explicitly
out of scope unless separately supplied.

#### Scenario: Equal text becomes bold

- **GIVEN** a `both` run node with equal text, no original `w:b`, and revised `w:b`
- **WHEN** tagged property detection runs
- **THEN** it SHALL attach a run-scoped property delta naming `bold`

#### Scenario: Existing property revisions do not become live differences

- **GIVEN** representatives whose live properties are equal but whose prior `w:rPrChange` histories differ
- **WHEN** tagged property detection runs
- **THEN** no new direct-formatting delta SHALL be created solely from that history

### Requirement: Run Property Extraction

The system SHALL extract direct run-property snapshots from each representative
of a tagged run and SHALL return `null` when the representative has no direct
`w:rPr`. Extraction SHALL preserve the source tree and prior revision provenance.

#### Scenario: Properties are extracted from both representatives

- **GIVEN** a `both` run whose original and revised `w:rPr` differ
- **WHEN** run properties are extracted
- **THEN** separate original and revised snapshots SHALL be returned without mutating either representative

### Requirement: Run Property Normalization

The system SHALL normalize direct property snapshots for semantic comparison by
removing prior property-change history, normalizing insignificant XML variation,
and applying deterministic child ordering. It SHALL NOT discard meaningful
property values or rewrite the source representatives.

#### Scenario: Equivalent property order compares equally

- **GIVEN** two `w:rPr` snapshots with the same properties in different child order
- **WHEN** the snapshots are normalized
- **THEN** their normalized forms SHALL be equal

### Requirement: Run Property Comparison

The system SHALL compare normalized direct run-property snapshots and SHALL
return both equality and the friendly names of changed properties. Missing and
present snapshots SHALL compare according to their semantic property values,
including toggle removal.

#### Scenario: Removing bold is reported

- **GIVEN** original direct run properties contain `w:b` and revised properties do not
- **WHEN** the snapshots are compared
- **THEN** equality SHALL be false and changed properties SHALL include `bold`

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

The system SHALL include emitted property revisions in `extractRevisions()`
output with type `FORMAT_CHANGE`. Each result SHALL retain the comparison
author and expose the affected paragraph's before/after projection.

#### Scenario: Get format change revisions

- **GIVEN** a document containing emitted `w:rPrChange` markup
- **WHEN** `extractRevisions()` runs after paragraph bookmarks are assigned
- **THEN** the result SHALL include a `FORMAT_CHANGE` revision with its `author`

### Requirement: Property Name Mapping

The system SHALL map OOXML property names to stable friendly names in a portable
`propertyNaming` module used by tagged construction and public statistics. Known
run properties SHALL include `bold`, `italic`, `underline`, `color`, `fontSize`,
`fontFamily`, `strike`, `highlight`, `verticalAlign`, and `caps`. Unknown direct
properties SHALL be reported deterministically rather than collapsed into the
literal `directProperties` placeholder.

#### Scenario: Known property has a friendly name

- **WHEN** a changed `w:sz` property is categorized
- **THEN** the changed-property list SHALL contain `fontSize`

#### Scenario: Unknown property remains distinguishable

- **WHEN** an unrecognized direct property changes
- **THEN** its deterministic OOXML-derived name SHALL be reported
- **AND** it SHALL NOT be reported only as `directProperties`

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

### Requirement: Tagged migration evidence is capability-complete

Before a comparison capability is removed or changed, the system SHALL record
that capability in a committed tagged-tree characterization
manifest. Each fixture row SHALL identify and hash the fixture, list exercised
capabilities and package parts, report original/revised projection results,
summarize normalized package parts and public statistics, and record tagged-tree
authority, schema, formatting, relationship, auxiliary-definition,
unrepresented-change, and unsupported-story diagnostics.

Historical equality SHALL be characterization rather than a correctness oracle.
A known difference SHALL carry a stable, explicitly adjudicated divergence ID.
The harness SHALL fail when its corpus is unavailable, a fixture or exercised
package part disappears, tagged-tree does not retain sole comparison authority,
or a divergence changes without review.

#### Scenario: Missing corpus evidence fails loudly

- **GIVEN** the strategy-differential corpus is unavailable or incomplete
- **WHEN** the characterization suite runs
- **THEN** the suite SHALL fail rather than skip or report the evidence as passing

#### Scenario: A behavior fix closes an explicit divergence

- **GIVEN** a known tagged defect recorded under a stable divergence ID
- **WHEN** the tagged implementation is corrected
- **THEN** its projection and package invariants SHALL pass
- **AND** removal of the divergence SHALL be an explicit reviewed manifest change

### Requirement: Tagged rationale attribution is exact and private

Markdoc compilation SHALL carry each selected rationale's operation identity as
tagged-tree provenance rather than authored sentinel text. Serialization SHALL
resolve every operation to exactly one bounded interval of generated tracked
revision containers after compatibility rewrites. Operation intervals SHALL be
unambiguous and non-overlapping. Private provenance metadata and omitted
rationale text SHALL NOT occur in any published package part.

#### Scenario: Multiple operations retain disjoint rationale ranges

- **GIVEN** multiple Markdoc operations with selected rationales
- **WHEN** tagged comparison serializes and compatibility-finalizes the redline
- **THEN** each operation SHALL map to one balanced comment range around its own revisions
- **AND** no operation's attributed interval SHALL overlap another operation's interval

#### Scenario: Private attribution data does not leak

- **GIVEN** internal and external rationales compiled under an external-only policy
- **WHEN** the tracked DOCX is published
- **THEN** no private provenance marker or sentinel text SHALL occur in any package part
- **AND** omitted internal rationale text SHALL NOT occur in any package part

### Requirement: Tagged publication owns the complete result package

The comparison engine SHALL build one tracked result by deterministically
reconciling the original and revised packages with tagged story publications,
without consuming a legacy result buffer, merged atom list, or legacy output-mode
decision. The public API SHALL NOT expose a caller-selectable package base.
Accepting every comparison revision SHALL preserve revised semantics, and
rejecting every comparison revision SHALL preserve original semantics, including
each projection's referenced ancillary resources. Publication SHALL own relationship and
content-type closure; headers, footers, notes, comments, people, numbering,
styles, media and custom XML; auxiliary identifier collisions; footnote
reconciliation; text-box and ancillary stories; unrepresented changes; and final
schema, projection, field, bookmark, relationship and formatting-fidelity gates.

Consumer compatibility SHALL run against the complete tagged document using one
revision-ID allocator seeded from every surviving numeric revision identifier.
Bookmark identifiers SHALL NOT seed that allocator. Volatile TOC PAGEREF cache
revisions SHALL be suppressed after compatibility enforcement and before the
final safety and formatting checks. When equal numeric bookmark IDs identify
differently named ranges across the independently authored inputs, the engine
SHALL remap the original-side ID before alignment. When tagged publication would
otherwise create a bookmark-name collision absent from both inputs, the engine
SHALL mint a collision-safe name for the original-side bookmark and SHALL
rewrite that side's complete or fragmented REF, PAGEREF, NOTEREF, HYPERLINK
`\\l`, and TOC `\\b` field targets plus internal-hyperlink anchors across
`word/*.xml` before republishing. Accept All SHALL preserve revised-side names
and targets; Reject All MAY expose the generated internal original-side name.

#### Scenario: Standalone publication has no legacy assembly dependency

- **GIVEN** original and revised packages and their tagged story publications
- **WHEN** the result package is assembled
- **THEN** assembly SHALL succeed without a legacy result buffer or merged atoms
- **AND** normalized main and ancillary package parts SHALL satisfy the publication gates

#### Scenario: One package preserves both source projections

- **GIVEN** original and revised packages with changes in main and ancillary stories
- **WHEN** the comparison package is assembled
- **THEN** accepting every comparison revision SHALL preserve revised semantics and referenced ancillary resources
- **AND** rejecting every comparison revision SHALL preserve original semantics and referenced ancillary resources
- **AND** the caller SHALL NOT select an original-based or revised-based output

#### Scenario: Revision and bookmark identifiers may overlap numerically

- **GIVEN** tagged markup containing the same numeric value in revision and bookmark ID spaces
- **WHEN** consumer compatibility splits a revision wrapper while hoisting bookmarks
- **THEN** the newly allocated revision ID SHALL avoid every surviving revision ID
- **AND** bookmark IDs SHALL remain unchanged

#### Scenario: Original-side bookmark collisions preserve reference targets

- **GIVEN** consumer-compatibility hoisting would duplicate a bookmark name that is unique in each input
- **WHEN** one or more supported original-side bookmark fields or internal hyperlinks target that bookmark across `word/*.xml`
- **THEN** the original-side bookmark and all corresponding original-side field and hyperlink targets SHALL use one collision-safe generated name
- **AND** Accept All SHALL retain the revised-side name and targets while Reject All retains the generated original-side equivalents

#### Scenario: Cross-version bookmark IDs are package-local

- **GIVEN** original and revised packages assign the same numeric bookmark ID to differently named ranges
- **WHEN** tagged publication aligns their bookmark boundaries
- **THEN** the original-side range SHALL receive a collision-safe internal ID before alignment
- **AND** the combined, Accept All, and Reject All projections SHALL contain no comparison-created duplicate or unmatched bookmark boundaries

#### Scenario: Volatile TOC cache changes are suppressed before final gates

- **GIVEN** a TOC PAGEREF field whose instruction and surrounding content are unchanged but whose cached page number differs
- **WHEN** tagged publication is finalized
- **THEN** the cached page number SHALL NOT be emitted as an authored insertion or deletion
- **AND** both cache-insensitive projections SHALL preserve their source TOC

### Requirement: Tagged statistics describe emitted markup

The system SHALL derive range-level comparison statistics from final serialized
tracked markup, after coalescing and splitting around word refinement, bookmarks,
range boundaries, property nodes, opaque subtrees, paragraph and row revisions,
existing revision provenance, and field controls. Modified paragraphs SHALL be
counted by logical tagged node, and paragraph-style deltas SHALL contribute once.

Public atom-named metrics SHALL carry `atomMetricVersion: 'tagged-token-v1'`.
That version SHALL count canonical comparison-text tokens, including whitespace
and edge punctuation, plus supported non-text comparison leaves in the tagged
alignment. A future weighting change SHALL use a new version value.

#### Scenario: Serialized wrapper transformations determine range totals

- **GIVEN** a tagged change whose serializer splits or coalesces tracked wrappers
- **WHEN** comparison statistics are reported
- **THEN** inserted, deleted, moved, and formatting range totals SHALL equal the final emitted markup

#### Scenario: Atom metrics do not silently change units

- **GIVEN** a tagged leaf spanning multiple text tokens
- **WHEN** atom-named statistics are derived
- **THEN** the result SHALL identify the `tagged-token-v1` unit
- **AND** a different weighting SHALL require a new atom metric version

### Requirement: Unsafe tagged publication raises a typed diagnostic error

After the private legacy soak switch is retired, a tagged publication that fails a safety or formatting gate SHALL throw `TaggedPublicationSafetyError`. The error
SHALL carry the failed checks and the existing structured diagnostics; the system
SHALL NOT silently return a degraded or partially assembled result.

#### Scenario: Final safety failure does not degrade silently

- **GIVEN** an authoritative tagged candidate that fails a publication gate
- **WHEN** no private emergency fallback is enabled
- **THEN** comparison SHALL throw `TaggedPublicationSafetyError`
- **AND** the error SHALL identify every failed check and its diagnostics

### Requirement: Tagged-tree construction is the sole public comparison spine

The ordinary comparison pipeline SHALL construct and publish tracked results
through the tagged tree. The result package SHALL reconcile both input archives
under the fixed dual-projection package contract.
Legacy construction MAY exist only behind a private emergency switch during a
measured release/corpus soak and SHALL NOT be selectable through library, CLI, or
MCP public inputs. After the soak gate, the legacy switch and automatic fallback
SHALL be deleted.

Public `reconstructionMode`, `comparisonStrategy`, `engine`, `premergeRuns`, and
`maxWordRefinementChangeRanges` options SHALL be absent. Existing schema,
projection, field, bookmark, ancillary-story, relationship, package-integrity,
text-box, auxiliary-sidecar, and formatting-fidelity checks SHALL remain in force.

#### Scenario: Public comparison uses one deterministic tagged publication

- **GIVEN** a document pair and no private emergency override
- **WHEN** the pair is compared through any public entry point
- **THEN** the tagged tree SHALL construct and publish one package whose accept-all projection preserves revised semantics and whose reject-all projection preserves original semantics
- **AND** no public strategy, engine, or reconstruction-mode selector SHALL be accepted
- **AND** no public package-base or provenance selector SHALL be accepted

#### Scenario: Soak evidence gates legacy deletion

- **GIVEN** the tagged assembler is authoritative
- **WHEN** legacy deletion is proposed
- **THEN** at least one release/corpus cycle SHALL have stable capability-manifest evidence
- **AND** the last legacy-capable commit and durable remote-ref rollback procedure SHALL be recorded
