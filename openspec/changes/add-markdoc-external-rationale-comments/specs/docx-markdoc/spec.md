## ADDED Requirements

### Requirement: Only explicitly external-facing rationales become comments

The system SHALL materialize rationale as a native root Word comment only when
comment materialization is enabled and the rationale category is exactly
`external-facing`. It SHALL NOT normalize, infer, or select an absent or other
category, and SHALL fail before output if more than one selected rationale names
the same operation.

#### Scenario: [SDX-MDOC-34] Exact external-facing category selects one rationale
- **GIVEN** one operation with one rationale categorized exactly `external-facing`
- **AND** rationale-comment materialization is enabled with valid deterministic identity
- **WHEN** the Markdoc compiles
- **THEN** the tracked DOCX SHALL contain exactly one native root comment carrying that rationale text
- **AND** the comment SHALL be associated with that operation's tracked edit range

#### Scenario: [SDX-MDOC-35] Unclassified and other categories remain private metadata
- **GIVEN** rationales with an absent category, an internal category, or a value resembling but not equal to `external-facing`
- **WHEN** rationale-comment materialization is enabled
- **THEN** none of those rationales SHALL produce a comment
- **AND** the system SHALL NOT infer shareability from rationale text or surrounding edits

#### Scenario: [SDX-MDOC-36] Duplicate selected rationales fail closed
- **GIVEN** two `external-facing` rationales naming the same operation
- **WHEN** compilation begins
- **THEN** compilation SHALL fail before document mutation with a stable diagnostic
- **AND** no partial DOCX output SHALL be returned

### Requirement: Rationale comment identity is explicit and deterministic

The system SHALL accept rationale-comment author, initials, and date as a
separate nested compile configuration. Every value SHALL come from caller input,
SHALL NOT fall back to tracked-revision identity or the process clock, and SHALL
produce identical comment metadata and identifiers for identical inputs.

#### Scenario: [SDX-MDOC-37] Caller identity controls deterministic comment metadata
- **GIVEN** valid non-empty comment author and initials plus a valid caller-supplied date
- **WHEN** identical source, Markdoc, and compile options are compiled twice
- **THEN** comment author, initials, date, identifiers, anchors, and serialized comment parts SHALL be identical
- **AND** tracked-revision author and date MAY differ without changing comment identity

#### Scenario: [SDX-MDOC-38] Missing comment identity never falls back
- **GIVEN** materialization is enabled without a valid author, initials, or date
- **WHEN** compilation begins
- **THEN** compilation SHALL fail before mutation with a stable identity diagnostic
- **AND** the compiler SHALL NOT substitute tracked-revision identity, defaults, or current time

### Requirement: Each rationale anchors to its attributable tracked edit

The system SHALL create one contiguous native comment range per selected
rationale using compiler-retained operation attribution. The range SHALL exclude
unrelated leading and trailing text and adjacent operations, and compilation
SHALL fail before output when one exact attributable range cannot be produced.

#### Scenario: [SDX-MDOC-39] Insertions anchor only inserted text
- **GIVEN** a selected rationale for an insertion operation
- **WHEN** the tracked DOCX is materialized
- **THEN** the comment range SHALL cover exactly the inserted text attributable to that operation
- **AND** SHALL exclude the anchor paragraph's unchanged neighboring text

#### Scenario: [SDX-MDOC-40] Deletions remain commentable in tracked output
- **GIVEN** a selected rationale for a deletion operation
- **WHEN** the tracked DOCX is materialized
- **THEN** the comment range SHALL cover exactly the deleted text retained in tracked markup
- **AND** SHALL exclude unchanged neighboring text and adjacent revisions

#### Scenario: [SDX-MDOC-41] Replacements prefer generated replacement text
- **GIVEN** a selected rationale for a replacement or inline edit that emits inserted text
- **WHEN** the tracked DOCX is materialized
- **THEN** the comment range SHALL cover the inserted replacement text attributable to that operation
- **AND** SHALL exclude deleted predecessor text, unchanged context, and adjacent operations

#### Scenario: [SDX-MDOC-42] Multi-paragraph operation has one bounded comment
- **GIVEN** one selected rationale whose attributable edit spans multiple paragraphs
- **WHEN** the tracked DOCX is materialized
- **THEN** exactly one comment range SHALL begin at the first attributable changed character and end at the last
- **AND** unrelated leading and trailing clause text and adjacent operations SHALL remain outside the range
- **AND** unchanged text between the endpoints MAY be included only where required by the single contiguous range

#### Scenario: [SDX-MDOC-43] Ambiguous attribution emits no output
- **GIVEN** selected rationale whose operation has no anchorable tracked content or overlaps another operation ambiguously
- **WHEN** compilation attempts comment materialization
- **THEN** compilation SHALL fail before returning output with a stable anchoring diagnostic
- **AND** the compiler SHALL NOT anchor by rationale-text search or proximity

### Requirement: Native comments preserve certified projections

Comment materialization SHALL NOT change accept-all text, reject-all text,
accept-all semantic formatting, or reject-all semantic formatting. Rationale
text SHALL remain outside every operative-text projection and comment-only
package changes SHALL NOT weaken existing delivery certification.

#### Scenario: [SDX-MDOC-44] Commented and uncommented projections are equivalent
- **GIVEN** the same source and Markdoc compiled with and without rationale-comment materialization
- **WHEN** both tracked outputs are accepted and rejected and their formatting projections are verified
- **THEN** both accept-all projections SHALL equal the generated clean document in text and semantic formatting
- **AND** both reject-all projections SHALL equal the pinned source in text and semantic formatting
- **AND** rationale text SHALL appear in neither operative-text projection

#### Scenario: [SDX-MDOC-48] Projection processing preserves comment integrity
- **GIVEN** a rationale comment anchored to inserted, deleted, replacement, or multi-paragraph tracked content
- **WHEN** accept-all and reject-all projections are materialized
- **THEN** each projection SHALL retain matching comment records, range starts, range ends, and references for every surviving annotation
- **AND** when tracked anchor text does not survive, its comment range SHALL collapse to one deterministic zero-width boundary at the edit location
- **AND** neither projection SHALL contain mismatched or partially retained native comment components

### Requirement: Release verification fails closed on absent native comments

When native comments are required, independent release verification SHALL report
a positive valid native-comment count for materialized rationales and SHALL fail
when no selected rationale produced a comment. Existing comment-record,
range-start, range-end, reference, multiplicity, and identifier-uniqueness checks
SHALL continue to apply.

#### Scenario: [SDX-MDOC-45] Required native comments report a positive count
- **GIVEN** compilation materialized at least one selected rationale comment
- **WHEN** independent verification runs with `requireNativeComments: true`
- **THEN** native-comment verification SHALL pass with a positive count
- **AND** every comment record, range start, range end, and reference SHALL satisfy the existing integrity checks

#### Scenario: [SDX-MDOC-46] Required native comments reject zero selected output
- **GIVEN** comment materialization produced no native comment because no rationale was selected
- **WHEN** independent verification runs with `requireNativeComments: true`
- **THEN** native-comment verification SHALL fail its minimum-count requirement
- **AND** the release verdict SHALL NOT treat an empty comment set as success

### Requirement: Rationale comment fixtures remain synthetic and public-safe

Tests and committed artifacts for rationale comments SHALL use only synthetic
documents, identities, and rationale text. Private matter documents, private
rationales, and extracts from a private corpus SHALL NOT enter repository
fixtures, snapshots, logs, or diagnostics.

#### Scenario: [SDX-MDOC-47] Public tests contain no matter artifacts
- **GIVEN** rationale-comment tests in the public repository
- **WHEN** their fixtures, snapshots, logs, and diagnostics are reviewed
- **THEN** every document, identity, and rationale SHALL be synthetic
- **AND** no private corpus path, text, or matter artifact SHALL be committed
