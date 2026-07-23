## ADDED Requirements

### Requirement: Forced rebuild preserves unchanged supported main-story complex fields

When comparison uses `reconstructionMode: rebuild`, the system SHALL preserve
each unchanged, complete, non-nested, same-paragraph PAGE, NUMPAGES, REF, or
PAGEREF complex field in `word/document.xml` as one ordered interval. The
preserved interval SHALL retain its begin, instruction, separator, cached
result, end, run properties, wholly contained range markers, extension payload,
and effective namespace/MCE meaning while intentional edits outside the
interval remain active.

Exact interval preservation is a SafeDocX metamorphic invariant. ECMA-376
conformance claims remain limited to registered complex-field structure and
instruction syntax.

#### Scenario: [FIELD-REBUILD-01] Same-paragraph outside edit retains complete field

- **GIVEN** original and revised paragraphs containing the same complete
  supported complex field and different ordinary text outside that field
- **WHEN** comparison is forced through `reconstructionMode: rebuild`
- **THEN** `reconstructionModeUsed` SHALL be `rebuild`
- **AND** the output SHALL contain exactly one structurally equivalent copy of
  the complete field interval in its original paragraph order
- **AND** accepting changes SHALL retain the revised outside text
- **AND** rejecting changes SHALL retain the original outside text
- **AND** both projections SHALL contain a structurally valid complete field

#### Scenario: [FIELD-REBUILD-02] All four bounded instruction classes preserve

- **GIVEN** complete unchanged PAGE, NUMPAGES, REF, and PAGEREF fields in
  separate focused fixtures
- **WHEN** each fixture is rebuilt with an outside edit
- **THEN** each instruction, spacing, switches, cached result, run properties,
  contained payload, and effective namespace/MCE meaning SHALL remain
  structurally equivalent
- **AND** the tests SHALL use the shared field constants and
  `buildDocxFromBodyXml`

#### Scenario: [FIELD-REBUILD-03] Multiple sibling fields emit once in order

- **GIVEN** a paragraph with multiple complete supported sibling fields and
  ordinary text between them
- **WHEN** forced rebuild preserves the fields
- **THEN** each field SHALL be emitted exactly once
- **AND** field and ordinary-run order SHALL match the source
- **AND** no interval SHALL overlap, cross, duplicate, or consume another

#### Scenario: [FIELD-REBUILD-04] Unsafe selected interval fails closed

- **GIVEN** a supported field selected for exact passthrough whose counterpart
  loses paragraph/container ownership, moves or reorders, mutates, becomes
  non-contiguous, has incomplete atom ownership, or contains a paired range
  crossing the field boundary
- **WHEN** forced rebuild attempts preservation
- **THEN** reconstruction SHALL fail with a dedicated field-passthrough error
- **AND** it SHALL NOT silently emit a flattened, stale, partial, or duplicated
  field

#### Scenario: [FIELD-REBUILD-05] Unsupported and edited fields retain existing path

- **GIVEN** a field that is inserted, deleted, instruction-edited,
  cached-result-edited, nested, paragraph-spanning, ancillary-story, simple, or
  outside the four supported instruction classes
- **WHEN** comparison runs
- **THEN** it SHALL NOT be represented as an exact field-passthrough interval
- **AND** existing supported comparison behavior and safety validators SHALL
  remain authoritative

### Requirement: Preserved field outputs satisfy structural and projection gates

Every rebuild output containing an exact field-passthrough interval SHALL pass
the field-structure validator, AI revision validator, emitted schema/MCE gate,
and accept/reject text projections before it is returned.

#### Scenario: [FIELD-REBUILD-06] Combined and projected documents pass all gates

- **WHEN** a forced rebuild emits one or more preserved field intervals
- **THEN** combined, accepted, and rejected documents SHALL pass field-structure
  validation
- **AND** the combined output SHALL pass revision and emitted schema/MCE gates
- **AND** normalized accepted text SHALL equal revised input text
- **AND** normalized rejected text SHALL equal original input text
- **AND** the preserved-field count and fingerprints SHALL match the selected
  occurrences

#### Scenario: [FIELD-REBUILD-07] Real-document evidence is bounded to observed fields

- **GIVEN** the checked-in real DOCX corpus
- **WHEN** field-bearing documents run through forced rebuild with outside edits
- **THEN** the test SHALL report field instruction classes, stories, counts, and
  before/after structural fingerprints
- **AND** claims SHALL be limited to the supported field types and main-story
  placements actually observed
