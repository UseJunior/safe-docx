## ADDED Requirements

### Requirement: Tagged migration evidence is capability-complete

Before a legacy comparison capability is removed or changed, the system SHALL
record that capability in a committed legacy-versus-tagged characterization
manifest. Each fixture row SHALL identify and hash the fixture, list exercised
capabilities and package parts, report original/revised projection results,
summarize normalized package parts and public statistics, and record fallback,
schema, formatting, relationship, auxiliary-definition, unrepresented-change,
and unsupported-story diagnostics.

Legacy equality SHALL be characterization rather than a correctness oracle. A
known difference SHALL carry a stable, explicitly adjudicated divergence ID.
The harness SHALL fail when its corpus is unavailable, a fixture or exercised
package part disappears, either strategy falls back, or a divergence changes
without review.

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

The comparison engine SHALL build the tracked result from the revised package and
tagged story publications without consuming a legacy result buffer, merged atom
list, or legacy output-mode decision. Publication SHALL own relationship and
content-type closure; headers, footers, notes, comments, people, numbering,
styles, media and custom XML; auxiliary identifier collisions; footnote
reconciliation; text-box and ancillary stories; unrepresented changes; and final
schema, projection, field, bookmark, relationship and formatting-fidelity gates.

Consumer compatibility SHALL run against the complete tagged document using one
revision-ID allocator seeded from every surviving numeric revision identifier.
Bookmark identifiers SHALL NOT seed that allocator. Volatile TOC PAGEREF cache
revisions SHALL be suppressed after compatibility enforcement and before the
final safety and formatting checks.

#### Scenario: Standalone publication has no legacy assembly dependency

- **GIVEN** original and revised packages and their tagged story publications
- **WHEN** the result package is assembled
- **THEN** assembly SHALL succeed without a legacy result buffer or merged atoms
- **AND** normalized main and ancillary package parts SHALL satisfy the publication gates

#### Scenario: Revision and bookmark identifiers may overlap numerically

- **GIVEN** tagged markup containing the same numeric value in revision and bookmark ID spaces
- **WHEN** consumer compatibility splits a revision wrapper while hoisting bookmarks
- **THEN** the newly allocated revision ID SHALL avoid every surviving revision ID
- **AND** bookmark IDs SHALL remain unchanged

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
through the tagged tree. The result package SHALL be based on the revised archive.
Legacy construction MAY exist only behind a private emergency switch during a
measured release/corpus soak and SHALL NOT be selectable through library, CLI, or
MCP public inputs. After the soak gate, the legacy switch and automatic fallback
SHALL be deleted.

Public `reconstructionMode`, `comparisonStrategy`, `engine`, `premergeRuns`, and
`maxWordRefinementChangeRanges` options SHALL be absent. Existing schema,
projection, field, bookmark, ancillary-story, relationship, package-integrity,
text-box, auxiliary-sidecar, and formatting-fidelity checks SHALL remain in force.

#### Scenario: Public comparison uses revised-based tagged publication

- **GIVEN** a document pair and no private emergency override
- **WHEN** the pair is compared through any public entry point
- **THEN** the tagged tree SHALL construct and publish the returned revised-based package
- **AND** no public strategy, engine, or reconstruction-mode selector SHALL be accepted

#### Scenario: Soak evidence gates legacy deletion

- **GIVEN** the tagged assembler is authoritative
- **WHEN** legacy deletion is proposed
- **THEN** at least one release/corpus cycle SHALL have stable capability-manifest evidence
- **AND** the last legacy-capable commit and multi-commit rollback procedure SHALL be recorded

## MODIFIED Requirements

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

### Requirement: Format Change Revision Reporting

The system SHALL include emitted property revisions in `extractRevisions()`
output with type `FORMAT_CHANGE`. Each result SHALL retain the comparison
author and expose the affected paragraph's before/after projection.

#### Scenario: Get format change revisions

- **GIVEN** a document containing emitted `w:rPrChange` markup
- **WHEN** `extractRevisions()` runs after paragraph bookmarks are assigned
- **THEN** the result SHALL include a `FORMAT_CHANGE` revision with its `author`

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

## REMOVED Requirements

### Requirement: Comparison Unit Base Interface

**Reason**: The side-tagged tree, not a flattened comparison-unit hierarchy, is the sole intermediate representation.
**Migration**: Use tagged nodes and side projections; no compatibility export is provided after the breaking release.

#### Scenario: Flattened base units are absent

- **WHEN** the post-migration public API is inspected
- **THEN** `ComparisonUnit` SHALL NOT be exported

### Requirement: Comparison Unit Atom Interface

**Reason**: Flattened atoms destroy the tree structure the tagged spine preserves.
**Migration**: Use `TaggedNode`, scoped property deltas, and tagged move relationships.

#### Scenario: Atom interface is absent

- **WHEN** the post-migration public API is inspected
- **THEN** `ComparisonUnitAtom` SHALL NOT be exported

### Requirement: Atom Factory Function

**Reason**: Tagged construction parses and aligns tree nodes directly.
**Migration**: Construct the tagged tree through the comparison entry point.

#### Scenario: Atom factory is absent

- **WHEN** the post-migration public API is inspected
- **THEN** `createComparisonUnitAtom` SHALL NOT be exported

### Requirement: OpenXML Move Markup Generation

**Reason**: The tagged serializer owns native move ranges; legacy atom-oriented markup generators are dead code.
**Migration**: Use tagged move classification and serialization.

#### Scenario: Legacy move generators are absent

- **WHEN** the post-migration public API is inspected
- **THEN** `generateMoveSourceMarkup`, `generateMoveDestinationMarkup`, and `allocateMoveIds` SHALL NOT be exported

### Requirement: Inplace Reconstruction Cross-Run Recovery

**Reason**: The tagged spine preserves hierarchy and does not use reconstruction retry passes.
**Migration**: Rely on tagged text alignment and typed publication-safety diagnostics.

#### Scenario: Cross-run reconstruction recovery is absent

- **WHEN** tagged publication fails a final safety gate
- **THEN** no in-place atomization retry ladder SHALL run

### Requirement: Tagged-tree construction is the default with an explicit legacy rollback

**Reason**: Public strategy selection and automatic legacy fallback end after the measured tagged-authority soak.
**Migration**: Use the sole revised-based tagged comparison path and handle `TaggedPublicationSafetyError` diagnostics.

#### Scenario: Public legacy rollback is absent

- **WHEN** a caller supplies a legacy comparison strategy after the breaking release
- **THEN** the public input SHALL be rejected as unsupported
