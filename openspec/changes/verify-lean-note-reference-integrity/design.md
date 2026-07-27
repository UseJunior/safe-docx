## Context

Protocol v4 receives immutable original, revised, and compared DOCX paths.
Lean builds a bounded classic-ZIP index, reads the fixed conventional Main
Document Part at `word/document.xml`, derives
`word/_rels/document.xml.rels`, selects direct explicit header/footer stories,
and checks those triples together with conventional fixed-path note stories.

This increment remains bounded to that fixed conventional Main Document Part.
It does not inspect `_rels/.rels`, select another office document, or prove
general OPC main-part discovery.

Two note-integrity gaps remain:

1. the checked footnote/endnote parts are not selected from the conventional
   Main Document Part's implicit relationships; and
2. the checker does not establish that references in conforming reference
   source stories resolve to unique user-note definitions in the same package.

The production TypeScript `validateNoteIntegrity` helper remains regression
evidence, not the trust boundary. It accepts hard-coded part strings, scans only
`document.xml`, compares lexical IDs, and does not classify definitions by
typed `w:type`.

## Goals / Non-Goals

### Goals

- Select Transitional Footnotes and Endnotes Parts from the fixed conventional
  Main Document Part's derived relationships part, without a producer manifest.
- Align note story triples by semantic kind while retaining each side's safe
  normalized path.
- Treat main and selected direct headers/footers as the complete conforming
  reference-source partition.
- Scan selected note-definition stories for definitions and forbidden nested
  `w:footnoteReference`/`w:endnoteReference` elements. Such references are
  structured failures, not closure edges.
- Parse IDs using the `ST_DecimalNumber` whitespace-collapse and integer lexical
  semantics, with bounded raw input and canonical evidence.
- Prove exact correspondence from selector identity through admitted source
  partition, parsed inventories, checker result, and aggregate pass.
- Require exactly two semantic note-story slots and six side-kind inventory
  records in every valid protocol-v5 response, including terminal responses.
- Keep public certificate protocol v1 additive and inplace-only.

### Non-Goals

- `_rels/.rels` discovery, alternate Main Document Parts, or full OPC main-part
  selection.
- Comments, comment relationships, or modern-comment extensions.
- Display numbering, custom-mark rendering, pagination, layout, or rendering.
- Recursive note references, self-reference, cross-kind note cycles, or any
  graph-closure semantics. These inputs fail as nonconformant.
- Content-type validation, general relationship-graph validation, or full OPC.
- Strict WordprocessingML or Strict relationship namespaces.
- Glossary-document-owned note parts.
- Rebuild-mode certification.
- Requiring every user definition to be referenced.
- Full ECMA-376 conformance.

## Standards Boundary

The implementation and tests cite only exercised behavior:

| Registry target | Supported use |
| --- | --- |
| ECMA-376 5th ed. Part 1 §11.3.4 | The conventional Main Document Part implicitly selects one internal Endnotes Part. |
| ECMA-376 5th ed. Part 1 §11.3.7 | The conventional Main Document Part implicitly selects one internal Footnotes Part. |
| Part 1 §§17.11.2-17.11.3 | Normal and special `w:endnote` definitions and typed identity. |
| Part 1 §17.11.7 | `w:endnoteReference` is a Main Document story reference; it is nonconformant inside a note-definition story. |
| Part 1 §17.11.8 | `w:endnotes` is the Endnotes Part root. |
| Part 1 §§17.11.9-17.11.10 | Special and normal `w:footnote` definitions and typed identity. |
| `ECMA-PART1-17-11-14` | `w:footnoteReference` is a Main Document story reference identity, not a display number; it is nonconformant inside a note-definition story. |
| Part 1 §17.11.15 | `w:footnotes` is the Footnotes Part root. |
| Part 1 §17.18.10 | `ST_DecimalNumber` is the integer-derived decimal lexical domain used by note IDs. |

The vendored Transitional schema bindings are:

- `wml.xsd#simpleType:ST_DecimalNumber`
- `wml.xsd#simpleType:ST_FtnEdn`
- `wml.xsd#complexType:CT_FtnEdnRef`
- `wml.xsd#complexType:CT_FtnEdn`
- `wml.xsd#element:footnoteReference`
- `wml.xsd#element:endnoteReference`
- `wml.xsd#element:footnotes`
- `wml.xsd#element:endnotes`

Target normalization, fixed conventional-main selection, canonical evidence,
cross-snapshot alignment, coalescing, ordering, and resource bounds are
SafeDocX verifier policy rather than additional ECMA claims.

## Decisions

### 1. The selector is explicitly conventional-main bounded

Name the selector namespace and public scope so the boundary is visible, for
example `Tier2.ConventionalMainNoteSelector` and
`selection: "fixed-word-document-main-relationships"`.

For each package Lean:

1. requires the fixed `word/document.xml`;
2. derives only `word/_rels/document.xml.rels`;
3. parses direct package relationship records there; and
4. filters by the exact Transitional relationship types:

```text
http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes
http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes
```

For each semantic kind:

- zero exact-type records means absent;
- Lean first filters all direct records by exact relationship type without
  considering target mode;
- exactly one total exact-type record must remain, and that sole record must
  then be internal, satisfy target mode and existing safe normalization,
  identify a unique indexed regular file, and parse with the expected
  Transitional root;
- more than one is ambiguous and fails;
- an exact-type external, unsafe, oversized, missing, malformed, or wrong-root
  target fails;
- references with no selected exact-type relationship fail
  `NOTE_RELATIONSHIP_REQUIRED`; and
- arbitrary unselected relationships and orphan parts are not inspected.

Original/revised/compared note stories align only by `footnotes` or `endnotes`.
Safe normalized paths and relationship IDs may differ.

No `_rels/.rels` input, root-office-document relationship, or content-type
evidence appears in the request, selector, theorem, certificate, or coverage
claim.

### 2. Reference-source stories and definition stories are disjoint

For each side, the complete admitted story partition is:

```text
valid reference sources:
  0. fixed word/document.xml
  1..N. every successfully selected direct header/footer physical story,
        ordered by physicalStoryOrdinal

definition/poison-scan stories:
  footnotes semantic slot
  endnotes semantic slot
```

Only the first partition contributes valid note references.

Selected footnote/endnote definition stories are scanned completely for:

- direct definitions of their own kind; and
- any expanded-name `w:footnoteReference` or `w:endnoteReference` at any depth.

Every such reference in a definition story produces
`NOTE_REFERENCE_IN_DEFINITION_STORY`. It never enters the valid reference list.
The issue identifies the containing source note kind and referenced kind, so:

- footnote-to-footnote and endnote-to-endnote self/recursive references fail;
- footnote-to-endnote and endnote-to-footnote cross-kind edges fail; and
- cycles cannot be hidden by transitive closure because no closure is computed.

With a complete scan, a self-kind poison fails that kind's inventory; a
cross-kind poison fails both involved inventories. Aggregate pass is false.

If any admitted main/header/footer source or either selected definition story
cannot be completely selected, loaded, decoded, parsed, or scanned within
limits, both `footnotes` and `endnotes` inventories for that side are
`not_evaluated`, all four counts in each are zero, and aggregate pass is false.
No partial reference list or partially trusted kind may be reported.

### 3. Decimal parsing follows §17.18.10 exactly within a raw bound

Every reference and direct definition requires a namespace-resolved `w:id`.
Before XML Schema whitespace processing or `Int` parsing, the decoded raw
attribute value must contain at most **64 UTF-8 bytes**.

Lean applies the XML Schema `whiteSpace = collapse` behavior inherited by
`xsd:integer`:

1. replace tab, line feed, and carriage return with space;
2. trim leading and trailing spaces; and
3. collapse each internal run of spaces to one space.

The collapsed lexical form must match `[+-]?[0-9]+` with no remaining spaces.
It then parses to `Int`.

Canonical evidence grammar is:

```text
0 | -?[1-9][0-9]*
```

Leading `+`, leading zeroes, surrounding collapsible whitespace, and negative
zero normalize away. Therefore `"1"`, `"+01"`, and `" \t+001\r\n"` identify
the same integer, while `"-0"` emits canonical `"0"`. A canonical evidence ID
is at most **64 ASCII bytes** because the raw lexical admission bound is applied
first.

Malformed, empty-after-collapse, internally spaced, or over-64-byte lexical
forms fail with structured evidence. Raw invalid lexical evidence is truncated
only by rejection at admission; it is never emitted beyond 64 bytes.

### 4. Typed direct definitions form the user map

Only direct `w:footnote` children of `w:footnotes` and direct `w:endnote`
children of `w:endnotes` are definitions.

| `w:type` | Integrity class |
| --- | --- |
| absent | user |
| `normal` | user |
| `separator` | special separator |
| `continuationSeparator` | special continuation separator |
| `continuationNotice` | special continuation notice |
| anything else | structured failure |

Numeric IDs never infer special status. User IDs `0` and `1` remain user IDs.
A reference resolves only against same-kind user definitions. Matching a
special definition does not satisfy it.

User-definition IDs must be unique after canonicalization, including
unreferenced definitions. Special-entry uniqueness and required special-entry
counts remain outside this checker. Unique unreferenced user definitions pass.

### 5. Six exact theorem targets prevent vacuous success

Add these exact audited theorem targets:

1. `Tier2.ConventionalMainNoteSelector.selected_note_identity_sound`
2. `Tier2.NoteReferenceIntegrity.admitted_source_partition_complete`
3. `Tier2.NoteReferenceIntegrity.parsed_inventory_evidence_exact`
4. `Tier2.NoteReferenceIntegrity.package_note_reference_integrity_sound`
5. `Tier2.NoteReferenceIntegrity.incomplete_partition_zero_evidence_sound`
6. `Tier2.NoteReferenceIntegrity.note_integrity_aggregate_pass_sound`

The proof-facing semantics live in
`Tier2/NoteReferenceIntegrity/Semantics.lean`. That module imports only raw
package/index types, bounded XML event types, protocol-v5 data types, and the
independent canonical-JSON grammar. It MUST NOT import the selector, scanner,
checker, aggregate runner, or serializer implementation modules. It defines
these predicates independently of executable success bits:

```lean
def RelationshipRecordAt
    (relsEvents : Array XmlEvent) (ordinal : Nat)
    (record : RelationshipRecord) : Prop

def XmlEventAt
    (story : LoadedStory) (eventOrdinal : Nat)
    (event : XmlEvent) : Prop

def PartLoadedAt
    (pkg : PackageView) (path : NormalizedPartPath)
    (bytes : ByteArray) : Prop

def Utf8DecodedPartAs
    (bytes : ByteArray) (text : String) : Prop

def XmlParsedPartAs
    (text : String) (root : XmlElement)
    (events : Array XmlEvent) : Prop

def FullyScannedStoryOf
    (pkg : PackageView) (source : StorySourceIdentity)
    (story : LoadedStory) (scan : StoryScanEvidence) : Prop

def SelectedNoteIdentityOf
    (pkg : PackageView) (kind : NoteKind)
    (selected : SelectedNoteIdentity) : Prop

def CompleteAdmittedPartitionOf
    (pkg : PackageView) (side : VerifierSide)
    (selected : SelectedStories) (partition : ReferenceSourcePartition)
    (scans : SideScanEvidence) : Prop

def OptionalNoteSlotSatisfiedOf
    (pkg : PackageView) (kind : NoteKind)
    (selection : SelectedStories)
    (slot : DefinitionStorySourceV5)
    (scans : SideScanEvidence) : Prop

def ParsedInventoryEvidenceOf
    (pkg : PackageView) (side : VerifierSide)
    (partition : ReferenceSourcePartition)
    (evidence : ParsedNoteEvidence) : Prop

def PackageNoteIntegrity
    (inventory : PackageNoteInventory) : Prop

inductive IntrinsicFailureStage
  | selection
  | load
  | utf8Decode
  | xmlParse
  | rootMismatch
  | fullScan

inductive SemanticLimitKind
  | referenceOccurrence
  | uniqueReferenceId
  | definition
  | poisonReference

inductive IncompleteCauseV5
  | intrinsicStoryFailure
      (slot : ExpectedStorySlot) (stage : IntrinsicFailureStage)
  | localSemanticLimitCrossing
      (limit : SemanticLimitKind) (sentinel : Nat)
  | skippedAfterPriorCrossing
      (priorSide : VerifierSide)
      (limit : SemanticLimitKind) (sentinel : Nat)

structure GlobalAdmissionContextV5 where
  sideOrder : Array VerifierSide
  packageViews : PackageView × PackageView × PackageView
  selectedStories : VerifierSide → SelectedStories
  admissionEvents : Array GlobalAdmissionEvent
  firstLocalSemanticCrossing :
    Option (VerifierSide × SemanticLimitKind × Nat)

def GlobalAdmissionContextOf
    (request : VerifierRequestV5)
    (context : GlobalAdmissionContextV5) : Prop

def IncompleteCauseOf
    (context : GlobalAdmissionContextV5) (side : VerifierSide)
    (evaluation : SideNoteEvaluationV5)
    (cause : IncompleteCauseV5) : Prop

def IncompleteSideZeroEvidenceOf
    (request : VerifierRequestV5)
    (context : GlobalAdmissionContextV5)
    (side : VerifierSide) (evaluation : SideNoteEvaluationV5)
    (cause : IncompleteCauseV5) : Prop

def AggregatePassOf
    (request : VerifierRequestV5) (response : VerifierResponseV5) : Prop

def SerializedResponseOf
    (response : VerifierResponseV5) (stdout : ByteArray) : Prop
```

Their definitional equations are pinned:

```lean
RelationshipRecordAt events ordinal record :=
  (directRelationshipRecordsSpec events).get? ordinal = some record

XmlEventAt story ordinal event :=
  (boundedDepthFirstExpandedEventsSpec story.root).get? ordinal = some event

PartLoadedAt pkg path bytes :=
  ExactlyOneRegularBinaryEntryAt pkg.index path ∧
  boundedDecompressSpec pkg.archive path = some bytes

Utf8DecodedPartAs bytes text :=
  strictUtf8DecodeSpec bytes = some text

XmlParsedPartAs text root :=
  namespaceAwareXmlParseSpec text = some root

FullyScannedStoryOf pkg source story scan :=
  PartLoadedAt pkg source.normalizedPartPath story.bytes ∧
  Utf8DecodedPartAs story.bytes story.text ∧
  XmlParsedPartAs story.text story.root ∧
  story.events = boundedDepthFirstExpandedEventsSpec story.root ∧
  story.events.size ≤ 500000 ∧
  scan.source = source ∧
  scan.visitedEvents = story.events ∧
  scan.completed = true

SelectedNoteIdentityOf pkg kind selected :=
  ∃ relsEvents record normalized,
    DerivedMainRelationshipsEvents pkg "word/document.xml" relsEvents ∧
    (directRelationshipRecordsSpec relsEvents).filter
      (isExactTransitionalRelationshipType kind) = [record] ∧
    RelationshipRecordAt relsEvents record.ordinal record ∧
    record.targetMode = .internal ∧
    normalizeRelationshipTargetSpec "word/document.xml" record.target =
      some normalized ∧
    selected.relationshipId = record.id ∧
    selected.normalizedPartPath = normalized ∧
    ExactlyOneRegularBinaryEntryAt pkg.index normalized ∧
    LoadedRootExpandedNameAt pkg normalized (expectedNoteRoot kind)

OptionalNoteSlotSatisfiedOf pkg kind selection slot scans :=
  match selection.note kind with
  | .present identity =>
      SelectedNoteIdentityOf pkg kind identity ∧
      slot.kind = kind ∧
      slot.relationship = some identity.relationship ∧
      slot.partPresent = true ∧
      ∃ source story scan,
        scans.realizationFor (.note kind) = some (source, story, scan) ∧
        FullyScannedStoryOf pkg source story scan
  | .absent =>
      NoExactTypeRelationshipRecord pkg kind ∧
      slot.kind = kind ∧
      slot.relationship = none ∧
      slot.partPresent = false ∧
      referenceElementEventsOfKindSpec scans kind = []
  | .failed _ => False

CompleteAdmittedPartitionOf pkg side selected partition scans :=
  partition.side = side ∧
  partition.status = .complete ∧
  partition.sources =
    [fixedMainSource pkg] ++
      canonicalSelectedPhysicalSourcesSpec selected ∧
  partition.definitionStories =
    [semanticDefinitionSlotSpec pkg .footnotes,
     semanticDefinitionSlotSpec pkg .endnotes] ∧
  NoDuplicatePhysicalSource partition.sources ∧
  ScanDomainExactlyExpectedPresentSlots
    selected partition scans ∧
  (∀ source ∈ partition.sources,
    ∃ story scan,
      scans.realizationFor source.slot = some (source, story, scan) ∧
      FullyScannedStoryOf pkg source story scan) ∧
  OptionalNoteSlotSatisfiedOf pkg .footnotes selected
    partition.definitionStories[0] scans ∧
  OptionalNoteSlotSatisfiedOf pkg .endnotes selected
    partition.definitionStories[1] scans ∧
  scans.realizations.map (fun realization =>
    realization.scan.visitedEvents.size) |>.sum ≤ 1000000

ParsedInventoryEvidenceOf pkg side partition evidence :=
  evidence.references =
    validReferenceEventsSpec XmlEventAt pkg partition.sources ∧
  evidence.definitions =
    directTypedDefinitionsSpec XmlEventAt pkg partition.definitionStories ∧
  evidence.poison =
    definitionStoryReferenceEventsSpec
      XmlEventAt pkg partition.definitionStories ∧
  evidence.wireCounts =
    projectSixInventoryCountsSpec
      evidence.references evidence.definitions evidence.poison ∧
  evidence.issues =
    canonicalIssuesSpec pkg side partition
      evidence.references evidence.definitions evidence.poison

AggregatePassOf request response :=
  ∃ original revised compared,
    RequestPackageViewsSpec request = some (original, revised, compared) ∧
    ResponseCardinalityAndOrderV5 response ∧
    (∀ side kind selected,
      ResponseSelectedNoteAt response side kind = some selected →
      SelectedNoteIdentityOf
        (sidePackage side original revised compared) kind selected) ∧
    (∀ side partition,
      ResponsePartitionAt response side = partition →
      ∃ scans,
        IndependentSideScanEvidenceSpec
          (sidePackage side original revised compared) side scans ∧
        CompleteAdmittedPartitionOf
          (sidePackage side original revised compared) side
          (selectedStories response side) partition scans) ∧
    (∀ side, ∃ evidence,
      ParsedInventoryEvidenceOf
        (sidePackage side original revised compared) side
        (partition response side) evidence ∧
      ResponseInventoryProjectionAt response side =
        projectInventoryEvidenceSpec evidence ∧
      PackageNoteIntegrity (packageInventorySpec evidence)) ∧
    AllGenericStoryReportsSound response ∧
    AllProtocolV5PassEquations response

GlobalAdmissionContextOf request context :=
  context.sideOrder = [.original, .revised, .compared] ∧
  RequestPackageViewsSpec request = some context.packageViews ∧
  (∀ side,
    context.selectedStories side =
      canonicalSelectedStoriesSpec (context.packageView side)) ∧
  context.admissionEvents =
    canonicalGlobalAdmissionEventsSpec
      context.packageViews
      (fun side =>
        canonicalSelectedStoriesSpec (context.packageView side)) ∧
  context.firstLocalSemanticCrossing =
    firstSemanticCrossingSpec context.admissionEvents

IntrinsicStageFailureSpec pkg slot stage :=
  firstFailedIntrinsicStageSpec pkg slot
    [.selection, .load, .utf8Decode, .xmlParse, .rootMismatch, .fullScan] =
      some stage

IncompleteCauseOf context side evaluation cause :=
  match cause with
  | .intrinsicStoryFailure slot stage =>
      slot ∈ expectedStorySlotsSpec
        (context.packageView side)
        (canonicalSelectedStoriesSpec (context.packageView side)) ∧
      IntrinsicStageFailureSpec
        (context.packageView side) slot stage ∧
      evaluation.intrinsicFailure = some (slot, stage) ∧
      NoSemanticCrossingBefore context side ∧
      evaluation.localSemanticCrossing = none
  | .localSemanticLimitCrossing limit sentinel =>
      SemanticLimitCrossingSpec
        context.admissionEvents side limit sentinel ∧
      context.firstLocalSemanticCrossing = some (side, limit, sentinel) ∧
      evaluation.intrinsicFailure = none ∧
      evaluation.scanStarted = true ∧
      evaluation.localSemanticCrossing = some (limit, sentinel)
  | .skippedAfterPriorCrossing priorSide limit sentinel =>
      sideRank priorSide < sideRank side ∧
      context.firstLocalSemanticCrossing =
        some (priorSide, limit, sentinel) ∧
      evaluation.intrinsicFailure = none ∧
      evaluation.localSemanticCrossing = none ∧
      evaluation.scanStarted = false

IncompleteSideZeroEvidenceOf request context side evaluation cause :=
  GlobalAdmissionContextOf request context ∧
  evaluation.partition.side = side ∧
  evaluation.partition.status = .incomplete ∧
  IncompleteCauseOf context side evaluation cause ∧
  evaluation.internalReferences = [] ∧
  evaluation.internalDefinitions = [] ∧
  evaluation.internalPoisonReferences = [] ∧
  evaluation.exposedParsedEvidence = none ∧
  evaluation.footnotesInventory =
    notEvaluatedZeroInventorySpec side .footnotes ∧
  evaluation.endnotesInventory =
    notEvaluatedZeroInventorySpec side .endnotes ∧
  evaluation.footnotesStory =
    notEvaluatedZeroStorySpec .footnotes ∧
  evaluation.endnotesStory =
    notEvaluatedZeroStorySpec .endnotes

SerializedResponseOf response stdout :=
  stdout.size ≤ 2621440 ∧
  StrictCanonicalJsonV5.parseAll stdout =
    some (canonicalResponseJsonSpec response) ∧
  EscapedEvidenceChargesWithinV5 response
```

Every `*Spec` helper above is defined by structural recursion in the same
semantics module and has no implementation-module import. In particular,
`directRelationshipRecordsSpec` recognizes indexed direct-child relationship
records from XML events, and `boundedDepthFirstExpandedEventsSpec` produces
namespace-expanded start-element events from a complete bounded depth-first
tree traversal. Relationship cardinality is checked before target mode: one
internal and one external record with the same exact relationship type is two
exact-type records and therefore cannot select. `FullyScannedStoryOf` requires
independent package loading, strict decoding, namespace-aware parsing, and
complete ordered traversal. `AggregatePassOf` inspects package views bound to
the request; it MUST NOT be defined as `response.passed = true` or solely as
equations among response fields. `StrictCanonicalJsonV5` and
`canonicalResponseJsonSpec` are the independent JSON grammar/projection and do
not call the production encoder.

`firstFailedIntrinsicStageSpec` evaluates the six independent stage predicates
in the displayed order and returns only the first failure. `.fullScan` includes
an incomplete XML-event visit and side-wide event-sum overflow, but explicitly
excludes all four semantic limit crossings. Consequently the three
`IncompleteCauseV5` constructors are disjoint: intrinsic failure has no
prior/local semantic crossing, local crossing is the globally first crossing
and has no intrinsic failure, and skipped has no local work and names that
strictly earlier first crossing.

`canonicalSelectedStoriesSpec` independently derives fixed main,
relationship-selected header/footer, and exact-type note selections from one
`PackageView`; it does not call a production selector and never discovers an
orphan or otherwise unselected part. `GlobalAdmissionContextOf` requires its
stored `selectedStories` function to equal that independent derivation for
every side, and constructs `admissionEvents` from the same derived function.
`IncompleteCauseOf` intentionally recomputes the canonical selection in its
intrinsic branch rather than trusting the stored field. Therefore a context
that injects an unselected or orphan malformed story satisfies neither the
global-context predicate nor an intrinsic cause.

The six theorem declarations are pinned exactly as follows. Renaming an
argument is harmless, but changing an argument type, hypothesis, conclusion,
or predicate is a protocol-v5 change requiring a new OpenSpec proposal.

#### `selected_note_identity_sound`

```lean
theorem selected_note_identity_sound
    (pkg : PackageView) (kind : NoteKind)
    (selected : SelectedNoteIdentity)
    (hSelect :
      selectConventionalMainNote pkg kind = .ok (some selected)) :
    SelectedNoteIdentityOf pkg kind selected
```

Consequently every successful selected note identity is backed by exactly one
total direct relationship record of the exact type in the derived
`word/_rels/document.xml.rels`; only after that cardinality fact is established
does the proposition require the sole record to be internal. The normalized
path equals the selector output, the binary index has exactly one regular entry
at that path, and the loaded parsed root has the expected Transitional expanded
name.

#### `admitted_source_partition_complete`

```lean
theorem admitted_source_partition_complete
    (pkg : PackageView) (side : VerifierSide)
    (selected : SelectedStories) (evaluation : SideNoteEvaluationV5)
    (hEvaluate :
      evaluateNoteSideV5 pkg side selected = evaluation)
    (hComplete : evaluation.partition.status = .complete) :
    CompleteAdmittedPartitionOf
      pkg side selected evaluation.partition evaluation.scanEvidence
```

Thus, for each evaluated side, the admitted partition equals, in canonical
order, the fixed main story plus every successfully selected header/footer
physical story exactly once, followed by exactly the two semantic
definition-story slots. Every expected present source has an independently
loaded, strictly decoded, parsed, and fully scanned realization; total admitted
events for the side do not exceed 1,000,000. No selected physical story is
omitted or duplicated, and no definition story is classified as a valid
reference source. An absent optional note slot is complete only under the
separate valid-absence equation; failed presence is never absence.

#### `parsed_inventory_evidence_exact`

```lean
theorem parsed_inventory_evidence_exact
    (pkg : PackageView) (side : VerifierSide)
    (selected : SelectedStories) (partition : ReferenceSourcePartition)
    (scans : SideScanEvidence)
    (evidence : ParsedNoteEvidence)
    (hPartition :
      CompleteAdmittedPartitionOf pkg side selected partition scans)
    (hScan :
      scanNoteEvidence pkg side partition scans = .ok evidence) :
    ParsedInventoryEvidenceOf pkg side partition evidence
```

For each evaluated side, the proposition establishes:

- the internal valid-reference list equals the ordered concatenation of every
  parsed reference event from the valid source partition;
- the internal definition list equals every direct typed definition from the
  two definition-story slots;
- the poison list equals every footnote/endnote reference event found in either
  definition story;
- the six wire inventory counts equal the corresponding internal list
  projections; and
- coalesced issue evidence is exactly the deterministic projection of parser,
  selector, poison, duplicate, and missing-definition failures.

#### `package_note_reference_integrity_sound`

```lean
theorem package_note_reference_integrity_sound
    (inventory : PackageNoteInventory)
    (h : checkPackageNoteIntegrity inventory = true) :
    PackageNoteIntegrity inventory
```

`PackageNoteIntegrity inventory` is definitionally the conjunction:

```lean
UserDefinitionsUnique inventory ∧
inventory.forbiddenDefinitionStoryReferences = [] ∧
∀ reference ∈ inventory.references,
  ∃! definition,
    definition ∈ inventory.definitions ∧
    definition.classification = .user ∧
    definition.kind = reference.kind ∧
    definition.id = reference.id
```

There is intentionally no reverse condition requiring every definition to
be referenced.

#### `incomplete_partition_zero_evidence_sound`

```lean
theorem incomplete_partition_zero_evidence_sound
    (request : VerifierRequestV5) (global : GlobalNoteEvaluationV5)
    (side : VerifierSide) (evaluation : SideNoteEvaluationV5)
    (cause : IncompleteCauseV5)
    (hEvaluateAll :
      evaluateAllNoteSidesV5 request = global)
    (hSide : global.sideEvaluation side = evaluation)
    (hIncomplete : evaluation.partition.status = .incomplete)
    (hCause : global.incompleteCause side = some cause) :
    IncompleteSideZeroEvidenceOf
      request global.admissionContext side evaluation cause
```

This theorem deliberately has no `CompleteAdmittedPartitionOf` hypothesis.
Its explicit cause is exactly one of: an intrinsic expected-story
selection/load/decode/parse/root/scan failure; a local semantic limit crossing
at its pinned sentinel; or a skipped side strictly later than the globally
first local semantic crossing. `GlobalAdmissionContextOf` binds that cause to
the request package views, canonical side order, admission events, and first
crossing. In every branch, all three internal parsed lists are empty, no
parsed evidence object is exposed, both wire inventories are `not_evaluated`
with zero counts, and both side note-story projections are `not_evaluated`
with zero token counts and no report.

#### `note_integrity_aggregate_pass_sound`

```lean
theorem note_integrity_aggregate_pass_sound
    (request : VerifierRequestV5) (response : VerifierResponseV5)
    (stdout : ByteArray)
    (hRun : canonicalSemanticResponse request = .ok (response, stdout))
    (hPass : response.passed = true) :
    AggregatePassOf request response ∧
    SerializedResponseOf response stdout
```

This is the axiom-free semantic theorem. Consequently it implies:

- all three conventional-main selector identities satisfy
  `selected_note_identity_sound`;
- all three source partitions are complete;
- exactly two semantic note stories and six inventories are present;
- every inventory status is `passed`;
- every valid reference resolves uniquely;
- every poison list and issue list is empty;
- both semantic note-story generic reports pass; and
- retained main and selected header/footer generic reports pass through
  `story_collection_checker_sound`.

#### `production_run_request_core_refinement_sound`

```lean
theorem production_run_request_core_refinement_sound
    (request : RunRequestCoreRequest) (result : RunRequestCoreResult)
    (hRun : runRequestCore request = .ok result)
    (hPass : result.responsePassed = true) :
    ProductionRunRequestRefinesSemanticOf request result
```

`runRequestCore` derives each independent `PackageView` from request-bound
package records that retain the exact request-bound package bytes, exact
extracted entry bytes, decoded text, successful typed parser equation,
parser-derived root, visited events, event count, and full-scan completion
evidence. `XmlParsedPartAs` independently binds source text and the
parser-derived expanded root to the retained event traversal. Extraction and
parsing occur once. The production refinement consumes the retained successful
parser equation and requires exact package-byte, extracted-byte, parser-state,
root, event, count, and depth equality; it does not rerun the parser, recompute
whole-package CRC, or rescan semantic candidates. No proof projection may
synthesize a root from a story label or set `fullyScanned := true`.

The TypeScript supervisor creates one private mode-0700 temporary root per
verifier invocation and passes it as `SAFE_DOCX_LEAN_TEMP_ROOT`. The executable
reads each caller path exactly once and writes those retained bytes exactly
once to package snapshots inside that root. Every ZIP index and extraction
command uses a snapshot, never the caller path. The supervisor waits for child
close and recursively removes the root on success, failure, timeout, and output
overflow. Lean surfaces snapshot cleanup failure deterministically, and no
PATH-resolved `chmod` command is used. Retained extraction evidence binds the
exact package bytes to the successful ZIP index, central-directory bounds,
selected central record, local-header/data offsets, exact compressed byte
slice, decompressed bytes, expanded size, CRC, and one extraction invocation.
The OS file write and the external `unzip` deflate implementation remain
explicit trusted boundaries: Lean proves the exact input/output evidence
consumed after extraction, but does not prove the external deflate algorithm.
This removes caller-path TOCTOU without overstating decompression verification.
Standalone execution uses Lean's in-process secure temporary-directory API and
removes that root recursively on normal exit; an operating-system kill can
prevent standalone self-cleanup, so kill-resistant cleanup is claimed only for
the TypeScript-supervised path.

`ProductionRunRequestRefinesSemanticOf request result` binds every package
record and extraction provenance to `packageViewOfRecord`; selector identities
to `selectConventionalMainNoteRecords`; bounded scan references, definitions,
poison references, crossings, and processed-candidate evidence to semantic
inventories and partitions; generic and semantic aggregate pass values; every
protocol-v5 JSON field, array, value, order, status, count, identity, issue,
and terminal shape; exact production JSON; and finalized stdout with one
newline. The axiom-free semantic byte envelope is proved separately by
`note_integrity_aggregate_pass_sound`; it is deliberately not a conjunct of
the production refinement and is not represented as the production wire
format. The production theorem binds every concrete JSON field and the exact
finalized UTF-8 stdout, which is where `Lean.Json`, `String`, and their three
approved foundations enter the proof.

`semanticProtocolV5Projection` is the independent wire projection. It derives
all thirteen protocol-v5 fields from the semantic response, typed relationship
and inventory evidence, canonical issue ordering/coalescing, limits, and
terminal policy. It cannot depend on `buildRunRequestCoreJson`,
`buildRunRequestCoreResponse`, or `runRequestCore`. The production refinement
requires the concrete builder output to equal this projection field by field
and under canonical JSON serialization, so a production-builder defect breaks
the proof rather than changing the expected value.

Its typed encoder intentionally duplicates the protocol grammar and does not
call production JSON encoders, ordering/coalescing helpers, budget helpers, or
terminal shapers. A recursive Lean value-dependency audit enforces that
separation. Compile-time and evaluated drift witnesses mutate a field name, a
field value, array order, issue coalescing/budget behavior, and terminal shape;
each mutation fails `ProtocolV5EveryFieldOf`. A separate retained-evidence
call-graph audit forbids package loading, extraction, CRC, XML parsing, and
semantic rescanning below `runRequestCore` admission. Dataflow counters bind
one package read and snapshot write per side, one extraction and parse per
admitted source, and one bounded semantic scan per side.

`runRequest` calls this core and writes `result.stdout` directly. The public
certificate claim requires both the axiom-free semantic theorem and this
production refinement theorem.

All six semantic targets are printed separately in `AxiomAudit.lean`. For each
target, the normalized per-target `#print axioms` set SHALL be empty. The
separate production refinement target's normalized set SHALL be exactly:

```text
propext
Classical.choice
Quot.sound
```

These are Lean foundations reached by direct `Lean.Json`, `String`, canonical
JSON compression, and concrete production equality in the theorem type. The
production target may contain no LeanSpike comparison-engine or residual
axiom. In particular no target may contain:

```text
LeanSpike.compareDocumentXml
LeanSpike.compareDocumentXml_output_preservation_friendly
LeanSpike.compareDocumentXml_output_text_roundtrip
```

The separate whole-file audit must still equal the existing exact six-name
allowlist because legacy LeanSpike targets remain audited. The implementation
adds exact per-target audit scripts before the unchanged union diff. No target
may hide a residual engine axiom merely because that name already appears in
the legacy union. A recursive Lean-environment declaration-dependency audit
rejects any constant dependency from the first five proof-only semantic
targets above to
`selectConventionalMainNote`, `buildReferenceSourcePartition`,
`scanNoteEvidence`, `evaluateNoteSideV5`, `evaluateAllNoteSidesV5`,
`checkPackageNoteIntegrity`, `verifyRequestV5`, the production serializer, or
`VerifierResponseV5.passed`.
The semantic aggregate target is subject to the same executable-dependency
ban. For the production refinement target, the recursive audit requires exact
declaration-type equality with the pinned signature, direct signature
constants `runRequestCore` and `ProductionRunRequestRefinesSemanticOf`, and
transitive reachability of `selectConventionalMainNoteRecords`, actual parser
evidence projection, bounded scanner, integrity and aggregate functions, exact
JSON constructor, canonical semantic serializer, and finalizer. It rejects all
LeanSpike engine/residual constants and admits only the exact three foundations
above. Compile-time negative witnesses include: one internal
plus one external exact-type relationship, an omitted physical story, an
omitted XML reference event, a purported complete partition lacking a fully
scanned realization or exceeding 1,000,000 events, an absent optional slot
with a reference, a failed-present slot mislabeled absent, load/decode/parse
failures, each forged incomplete-cause tag, an incomplete result that retains
one internal reference or a nonzero wire count, a global context whose
`selectedStories` injects an unselected/orphan malformed story, a duplicate
definition, a false aggregate response, and noncanonical/trailing JSON. Each
corresponding semantic predicate must be false for its malformed witness. The
source tree remains zero-`sorry`.

### 6. Protocol v5 has a single exact cardinality model

The request is:

```ts
interface LeanVerifierRequestV5 {
  protocolVersion: 5;
  originalDocxPath: string;
  revisedDocxPath: string;
  comparedDocxPath: string;
}
```

The checker literal is
`safe-docx-lean-conventional-main-note-integrity-checker`.

Every valid response, including terminal responses, contains:

- exactly one fixed main report;
- retained bounded header/footer arrays;
- exactly three `referenceSourcePartitions`, ordered original, revised,
  compared;
- exactly two `noteStories`, ordered footnotes, endnotes;
- exactly six `noteInventories`, ordered
  original/footnotes, original/endnotes, revised/footnotes, revised/endnotes,
  compared/footnotes, compared/endnotes; and
- zero or more canonically ordered, coalesced `noteIntegrityIssues`.

The semantic wire structures are:

```ts
type VerifierSide = 'original' | 'revised' | 'compared';
type NoteKind = 'footnotes' | 'endnotes';
type EvaluationStatus = 'passed' | 'failed' | 'not_evaluated';
type IssueOrdinalSpace =
  | 'relationship'
  | 'source'
  | 'definition'
  | 'reference'
  | 'poison'
  | 'aggregate';

interface NoteRelationshipIdentityV5 {
  relationshipId: string;
  normalizedPartPath: string;
}

interface ReferenceSourceV5 {
  sourceOrdinal: number;
  sourceStory: 'main' | 'header' | 'footer';
  physicalStoryOrdinal?: number;
  normalizedPartPath: string;
}

interface DefinitionStorySourceV5 {
  kind: NoteKind;
  relationship?: NoteRelationshipIdentityV5;
  partPresent: boolean;
}

interface ReferenceSourcePartitionV5 {
  side: VerifierSide;
  status: 'complete' | 'incomplete';
  sources: ReferenceSourceV5[];
  definitionStories: [
    DefinitionStorySourceV5,
    DefinitionStorySourceV5
  ];
}

interface NoteStorySlotV5 {
  kind: NoteKind;
  status: EvaluationStatus;
  original: DefinitionStorySourceV5;
  revised: DefinitionStorySourceV5;
  compared: DefinitionStorySourceV5;
  parsedTokenCounts: {
    original: number;
    revised: number;
    combined: number;
  };
  report?: StoryCheckReportV4;
}

interface NoteDefinitionCountsV5 {
  user: number;
  separator: number;
  continuationSeparator: number;
  continuationNotice: number;
}

interface NoteInventoryReportV5 {
  side: VerifierSide;
  kind: NoteKind;
  status: EvaluationStatus;
  relationship?: NoteRelationshipIdentityV5;
  referenceOccurrences: number;
  uniqueReferenceIds: number;
  definitions: NoteDefinitionCountsV5;
  forbiddenDefinitionStoryReferences: number;
}

type PhysicalStoryOrdinalV5 = number; // integer in 0..383

type IssueSourceIdentityV5 =
  | {
      sourceStory: 'main';
      sourceStoryOrdinal: 0;
    }
  | {
      sourceStory: 'header' | 'footer';
      sourceStoryOrdinal: PhysicalStoryOrdinalV5;
    }
  | {
      sourceStory: 'footnotes' | 'endnotes';
      sourceStoryOrdinal: 0;
    };

interface OrdinaryNoteIntegrityIssueV5 {
  code: Exclude<
    NoteIntegrityIssueCode,
    'NOTE_ISSUE_LIMIT_EXCEEDED' |
    'NOTE_EVIDENCE_STRING_BUDGET_EXCEEDED'
  >;
  side: VerifierSide;
  kind: NoteKind;
  detail: string;
  ordinalSpace: IssueOrdinalSpace;
  firstOccurrenceOrdinal: number;
  occurrenceCount: number;
  source: IssueSourceIdentityV5;
  canonicalId?: string;
  rawId?: string;
  rawIdByteLength?: number;
  rawIdDigest?: string;
  referencedKind?: NoteKind;
  relationshipId?: string;
  rawTarget?: string;
  normalizedPartPath?: string;
}

type TerminalNoteIntegrityIssueV5 =
  | {
      code: 'NOTE_ISSUE_LIMIT_EXCEEDED';
      side: 'original';
      kind: 'footnotes';
      detail: 'protocol v5 aggregate ordinary issue limit exceeded';
      ordinalSpace: 'aggregate';
      firstOccurrenceOrdinal: 0;
      occurrenceCount: 1;
    }
  | {
      code: 'NOTE_EVIDENCE_STRING_BUDGET_EXCEEDED';
      side: 'original';
      kind: 'footnotes';
      detail: 'protocol v5 escaped evidence string budget exceeded';
      ordinalSpace: 'aggregate';
      firstOccurrenceOrdinal: 0;
      occurrenceCount: 1;
    };

type NoteIntegrityIssueV5 =
  | OrdinaryNoteIntegrityIssueV5
  | TerminalNoteIntegrityIssueV5;

type NoteIntegrityIssueCode =
  | 'NOTE_RELATIONSHIP_AMBIGUOUS'
  | 'NOTE_RELATIONSHIP_EXTERNAL'
  | 'NOTE_RELATIONSHIP_INVALID_TARGET_MODE'
  | 'NOTE_RELATIONSHIP_UNSAFE_TARGET'
  | 'NOTE_RELATIONSHIP_TARGET_LIMIT_EXCEEDED'
  | 'NOTE_RELATIONSHIP_REQUIRED'
  | 'NOTE_PART_MISSING'
  | 'NOTE_PART_INVALID_UTF8'
  | 'NOTE_PART_INVALID_XML'
  | 'NOTE_PART_ROOT_MISMATCH'
  | 'NOTE_PART_LIMIT_EXCEEDED'
  | 'NOTE_ID_MISSING'
  | 'NOTE_ID_INVALID_DECIMAL'
  | 'NOTE_ID_LEXICAL_LIMIT_EXCEEDED'
  | 'NOTE_TYPE_INVALID'
  | 'NOTE_USER_DEFINITION_DUPLICATE'
  | 'NOTE_REFERENCE_MISSING_DEFINITION'
  | 'NOTE_REFERENCE_IN_DEFINITION_STORY'
  | 'NOTE_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED'
  | 'NOTE_UNIQUE_REFERENCE_LIMIT_EXCEEDED'
  | 'NOTE_DEFINITION_LIMIT_EXCEEDED'
  | 'NOTE_POISON_REFERENCE_LIMIT_EXCEEDED'
  | 'NOTE_SOURCE_PARTITION_INCOMPLETE'
  | 'NOTE_ISSUE_LIMIT_EXCEEDED'
  | 'NOTE_EVIDENCE_STRING_BUDGET_EXCEEDED';

interface LeanVerifierResponseV5 {
  protocolVersion: 5;
  checker: 'safe-docx-lean-conventional-main-note-integrity-checker';
  passed: boolean;
  fixedStories: [FixedStoryReportV4];
  presenceMismatches: [];
  fixedStoryIssues: [];
  relationshipSlots: RelationshipSlotV4[];
  relationshipStories: RelationshipStoryReportV4[];
  selectionIssues: SelectionIssueV4[];
  referenceSourcePartitions: [
    ReferenceSourcePartitionV5,
    ReferenceSourcePartitionV5,
    ReferenceSourcePartitionV5
  ];
  noteStories: [NoteStorySlotV5, NoteStorySlotV5];
  noteInventories: [
    NoteInventoryReportV5,
    NoteInventoryReportV5,
    NoteInventoryReportV5,
    NoteInventoryReportV5,
    NoteInventoryReportV5,
    NoteInventoryReportV5
  ];
  noteIntegrityIssues: NoteIntegrityIssueV5[];
}
```

The tuple positions, exact keys, and literal union above are normative.
`selectionIssues` remains the unchanged protocol-v4
`SelectionIssueV4[]`. A selection issue has the existing v4 fields and never
acquires protocol-v5 `source`, ordinal-space, or note-ID fields. Required
source identity applies only to ordinary entries of
`noteIntegrityIssues`.

### 7. Presence, status, and pass equations are exact

For each definition-story side record:

- `relationship` absent implies `partPresent = false`;
- `partPresent = true` requires `relationship`;
- absent is valid only when there is no exact-type relationship record and the
  fully scanned valid-source stories contain zero same-kind reference
  elements, including malformed-ID elements;
- a sole selected relationship creates present intent: any subsequent
  load/decode/parse/root/full-scan failure is failed presence, makes the
  partition incomplete, and can never be represented as valid absence;
- a selected relationship may have `partPresent = false` only with a matching
  missing/load issue; and
- relationship identity must equal the corresponding inventory and semantic
  note-story identity.

For each source partition:

- `sources[0]` is exactly main with ordinal 0 and path
  `word/document.xml`;
- later sources correspond one-to-one, in physical ordinal order, with that
  side's successfully selected header/footer physical stories;
- source ordinals are contiguous;
- `definitionStories` has exactly footnotes then endnotes; and
- `complete` means every listed and expected source and both present definition
  stories were completely scanned.

For every ordinary `noteIntegrityIssues` entry, `source` is required and is
one exact discriminated identity:

- main uses `{ sourceStory: 'main', sourceStoryOrdinal: 0 }`;
- a header/footer uses its zero-based ordinal in the single combined canonical
  physical-story sequence, in `0..383`; the discriminator says whether that
  sequence entry is a header or footer;
- footnotes and endnotes each use their semantic singleton identity with
  `sourceStoryOrdinal: 0`.

Relationship-record parse/target issues use main because
`word/_rels/document.xml.rels` is derived from main.
`NOTE_RELATIONSHIP_REQUIRED` uses the missing semantic note story.
Part/root/definition issues use the selected footnotes or endnotes story.
Valid-source reference issues use the actual main/header/footer source.
Poison issues use the actual footnotes/endnotes definition story.
`NOTE_SOURCE_PARTITION_INCOMPLETE` uses the first incomplete actual source.
Terminal issues are the only issues without `source`; inventing `source` on a
terminal issue is invalid.

For note-story slots:

- exactly footnotes then endnotes;
- `report` is present iff status is `passed` or `failed`;
- `report.passed` equals `status = passed`;
- `not_evaluated` requires no report and zero token counts; and
- a selected relationship/load/root failure makes that semantic slot
  `not_evaluated`.

For inventories:

- an incomplete side partition requires both side-kind statuses
  `not_evaluated`, no relationship-derived conclusion beyond truthful selected
  identity, and every count zero;
- a complete partition forbids `not_evaluated`;
- `passed` means no applicable coalesced issue and the executable checker is
  true;
- `failed` means at least one applicable issue or false checker result; and
- a cross-kind poison issue applies to both involved inventories.

Aggregate `passed` is true exactly when:

- there are no fixed, selection, or note issues;
- all fixed/relationship/note story reports pass;
- all three partitions are complete; and
- all six inventories are passed.

TypeScript rejects any violation rather than repairing or interpreting it.

### 8. Ordinal spaces, coalescing, and ordering are exact

One combined 16-bit occurrence range is insufficient because valid references
and poison references can coexist. Protocol v5 therefore uses separate ordinal
spaces. Ordinals are zero-based within `(side, ordinalSpace)`:

| Ordinal space | Derivation | Maximum admitted ordinal | Crossing/missing sentinel |
| --- | --- | ---: | ---: |
| `relationship` | direct relationship-record index in document order | 1,023 | 1,024 for missing exact type |
| `source` | canonical source ordinal: main 0; physical sources 1..384; footnotes `sources.length`; endnotes `sources.length + 1` | 386 | none |
| `definition` | direct admitted definition ordinal within the selected same-kind note root | 4,095 | 4,096 |
| `reference` | admitted valid-source reference event order across main then physical header/footer sources | 8,191 | 8,192 |
| `poison` | admitted forbidden-reference event order across footnotes then endnotes definition stories | 4,095 | 4,096 |
| `aggregate` | no ordinary record | none | terminal 0 |

Every issue code has one exact ordinal source:

- relationship ambiguity/external/mode/target issues use the first implicated
  relationship-record index; `NOTE_RELATIONSHIP_REQUIRED` uses sentinel 1,024;
- missing note part, UTF-8/XML/root/part-limit, and source-partition issues use
  `source`; note part ordinals are the final two partition positions;
- definition `w:type`, missing ID, invalid decimal, lexical limit, and duplicate
  definition issues use the direct `definition` ordinal; a duplicate uses the
  first duplicate occurrence, not the first definition;
- valid-source missing/invalid/overlong ID, reference-limit, unique-ID-limit,
  and missing-definition issues use the `reference` ordinal of the first
  implicated event;
- definition-story missing/invalid/overlong IDs and all forbidden self/cross
  references use the `poison` ordinal; and
- issue-count and escaped-string exhaustion use `aggregate`, ordinal 0.

The relationship missing sentinel and the definition/reference/poison crossing
sentinels appear only on their structured issues; admitted records end one
below. Source space has no cardinality-crossing sentinel in this slice.

Issues coalesce only when these fields match:

```text
side, kind, code, ordinalSpace, source.sourceStory,
source.sourceStoryOrdinal,
canonicalId/rawId/overlongKey, referencedKind, relationshipId,
rawTarget, normalizedPartPath
```

The first ordinal and positive `occurrenceCount` summarize the group. Different
codes or ordinal spaces never coalesce.

For an ID of at most 64 bytes, a malformed lexical may retain bounded `rawId`.
For an overlong ID, `rawId` and `canonicalId` MUST be absent. Its deterministic
`overlongKey` is:

```text
source.sourceStory + source.sourceStoryOrdinal +
rawIdByteLength + rawIdDigest
```

`rawIdDigest` is the existing Lean CRC-32 over the complete decoded raw UTF-8
bytes, serialized as exactly eight lowercase hexadecimal ASCII characters.
`rawIdByteLength` is bounded by the selected part's 16 MiB expanded-size limit.
Equal overlong keys coalesce even if two forbidden raw values collide under
CRC-32. That collision only merges diagnostics: the inventory remains failed,
no identity-resolution claim uses the digest, and `occurrenceCount` preserves
the number of rejected events. Different source identities never coalesce.

Total issue order is:

```text
side rank, kind rank, ordinal-space rank, firstOccurrenceOrdinal,
source-story rank, source.sourceStoryOrdinal, code, canonicalId, rawId,
rawIdByteLength, rawIdDigest, referenced-kind rank, relationshipId,
rawTarget, normalizedPartPath
```

Optional fields sort absent before present; strings sort by unsigned UTF-8 byte
sequence; numeric fields sort numerically. `occurrenceCount` is in
`1..8,192` for ordinary note-integrity issues and exactly 1 for aggregate
terminal issues. Selection issues retain only their protocol-v4 field shape,
canonical ordering, and coalescing rules; protocol v5 replaces every prior
selection-issue cardinality rule with the shared 511 ordinary cap across
`selectionIssues` and `noteIntegrityIssues`. Selection issues do not
participate in note-issue coalescing keys.

### 9. Semantic limit crossings have executable equations

Reduced protocol-v5 semantic limits are:

| Limit | Value |
| --- | ---: |
| reference events in valid sources per side | 8,192 |
| unique valid references per side/kind | 4,096 |
| direct definitions per selected note part | 4,096 |
| poison references per side | 4,096 |

For each limit, `n` is the count before the candidate event:

```text
admit candidate iff n < limit
crossing iff n = limit
```

There is no saturating admission.

For every candidate, checks occur in this total order and stop at the first
failure:

1. confirm that the source story and XML traversal itself remain admitted;
2. for a direct definition, check the 4,096-definition capacity before reading
   `w:type` or `w:id`;
3. for a definition-story reference, check the 4,096-poison capacity before
   reading its ID;
4. for a valid-source reference, check the 8,192-reference-event capacity;
5. check the raw ID's 64-byte lexical admission bound, then parse and
   canonicalize it;
6. for a newly seen valid canonical ID, check the side-kind 4,096-unique-ID
   capacity; and
7. admit the candidate and increment all applicable counts atomically.

Checks irrelevant to the candidate kind are skipped without changing the
relative order. Therefore an 8,193rd valid-source reference that would also
introduce the 4,097th unique ID emits only
`NOTE_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED` at reference sentinel 8,192. The
candidate ID is not parsed, the unique-ID check is not reached, and
`NOTE_UNIQUE_REFERENCE_LIMIT_EXCEEDED` is not emitted. The winning issue has
the exact occurrence-limit shape below.

- The 8,193rd valid reference emits
  `NOTE_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED` in `reference` space at ordinal
  8,192. Its `side`, `kind`, and required `source` are those of the candidate;
  `detail` is exactly
  `protocol v5 valid-source reference occurrence limit exceeded`;
  `occurrenceCount` is 1; and every optional issue field is absent.
- A candidate introducing the 4,097th distinct canonical ID for one side-kind
  emits `NOTE_UNIQUE_REFERENCE_LIMIT_EXCEEDED` in `reference` space at that
  candidate's admitted reference ordinal. Its `side`, `kind`, and `source` are
  those of the candidate; `canonicalId` is present; `detail` is exactly
  `protocol v5 unique note reference ID limit exceeded`;
  `occurrenceCount` is 1; and every other optional field is absent.
- The 4,097th direct definition in a selected note part emits
  `NOTE_DEFINITION_LIMIT_EXCEEDED` in `definition` space at ordinal 4,096.
  Its `side`, `kind`, and note-story `source` identify the selected part;
  `detail` is exactly `protocol v5 direct note definition limit exceeded`;
  `occurrenceCount` is 1; and every optional field is absent.
- The 4,097th poison reference emits
  `NOTE_POISON_REFERENCE_LIMIT_EXCEEDED` in `poison` space at ordinal 4,096.
  Its `side`, `kind`, and `source` identify the containing definition story;
  `referencedKind` identifies the candidate element; `detail` is exactly
  `protocol v5 definition-story reference limit exceeded`;
  `occurrenceCount` is 1; and every other optional field is absent.

Each crossing event is rejected and not counted. The crossing side becomes
incomplete; both of its inventories are `not_evaluated` with every count zero.
All later sides in canonical admission order are also incomplete and
`not_evaluated` with zero counts because their semantic scan never starts.
Earlier fully completed sides retain their inventories. Both triple-level note
stories become `not_evaluated` with no report and zero token counts because one
side is unavailable. The one crossing issue is retained unless aggregate issue
or string exhaustion triggers the terminal collapse below.

Malformed ID/type/relationship/reference failures that do not cross a resource
limit do not make the partition incomplete if scanning completes. They produce
`failed` inventories with exact counts of admitted valid records and bounded
issues.

After semantic issue generation, aggregate admission across both retained
issue arrays has one total order:

1. canonicalize protocol-v4 `selectionIssues` in their existing v4 order;
2. canonicalize/coalesce/sort ordinary protocol-v5 `noteIntegrityIssues` by
   the order in section 8;
3. form one admission stream consisting of every selection issue followed by
   every ordinary note-integrity issue;
4. retain already charged non-issue evidence only while the ordinary escaped
   string total is at most 1,571,840 bytes;
5. for each candidate in the cross-array stream, check the shared
   511-ordinary-issue capacity before
   charging any of that candidate's strings;
6. if capacity remains, charge that issue's strings against the ordinary
   escaped-string budget; and
7. append it to its original array only if both checks passed.

The first failed check immediately emits its matching canonical terminal
response and no later check runs. Thus, if the 512th ordinary issue would also
cross the escaped-string budget, `NOTE_ISSUE_LIMIT_EXCEEDED` wins. If
non-issue evidence or one of the first 511 issues crosses the string budget
before an issue-count crossing is reached,
`NOTE_EVIDENCE_STRING_BUDGET_EXCEEDED` wins. Either terminal clears
`selectionIssues` and places the sole terminal entry in
`noteIntegrityIssues`; a terminal is never emitted into `selectionIssues`.

### 10. Resource admission order is normative

The executable admits work in this exact order:

1. binary-index original, revised, then compared; any failure is pre-response
   fatal;
2. extract/decode/parse fixed main original, revised, then compared; any failure
   is pre-response fatal;
3. parse derived main relationships original, revised, then compared;
4. complete existing header/footer selector metadata and selected physical
   story loading in protocol-v4 canonical order;
5. select and load notes in side-major order:
   original/footnotes, original/endnotes, revised/footnotes,
   revised/endnotes, compared/footnotes, compared/endnotes;
6. scan side-major partitions: main, selected physical header/footer stories by
   physical ordinal, footnotes definition story, endnotes definition story;
7. build inventories in the fixed six-record order;
8. run generic reports in main, relationship physical-story, footnotes,
   endnotes order; and
9. coalesce/sort evidence, enforce aggregate budgets, serialize, and perform the
   final response-byte check.

A semantic crossing in step 5 or 6 stops that side and all later semantic side
work exactly as specified in section 9. Earlier complete evidence is retained.
Aggregate issue/string exhaustion in step 9 instead uses terminal collapse and
clears semantic evidence as specified next. This distinction is normative.

### 11. Exact aggregate limits and structural response proof

Protocol v5 pins:

| Limit | Value |
| --- | ---: |
| request path | 4,096 UTF-8 bytes each |
| raw/canonical admitted note ID | 64 UTF-8 bytes |
| overlong ID byte-length source | at most 16,777,216 |
| relationship records per side | 1,024 |
| reference-source records per side | 385 |
| semantic note stories | exactly 2 |
| side-kind inventories | exactly 6 |
| ordinary issues across `selectionIssues` plus `noteIntegrityIssues` | 511 |
| reserved terminal issue slots | 1 |
| issue-slot accounting capacity | 512 |
| maximum issues in one realizable response | 511 ordinary or 1 terminal |
| detail | 256 UTF-8 bytes |
| relationship ID | 128 UTF-8 bytes |
| raw target or normalized path | 256 UTF-8 bytes |
| XML events per part | 500,000 |
| aggregate XML events per side | 1,000,000 |
| ordinary escaped JSON evidence-string bytes | 1,571,840 |
| reserved terminal escaped-string bytes | 1,024 |
| total escaped JSON evidence-string bytes | 1,572,864 |
| legal protocol-v5 JSON response | 2,621,440 bytes |
| legal protocol-v5 stdout including one newline | 2,621,441 bytes |
| executable stdout hard cap | 8,388,608 bytes |

The string budget is measured after JSON escaping and includes quotes for every
response string, so no separate worst-case escaping multiplier is omitted. The
ordinary producer cannot consume the 1,024-byte terminal reserve.
The producer charges structures before appending them:

| Structural charge | Unit charge | Maximum units | Maximum bytes |
| --- | ---: | ---: | ---: |
| top-level keys, one fixed-main report, three partition envelopes, two evaluated note reports, six inventories, array punctuation, issue-array envelope | fixed | 1 | 124,928 |
| relationship-slot envelope excluding charged strings | 320 | 384 | 122,880 |
| relationship-story/report envelope excluding charged strings | 640 | 384 | 245,760 |
| selecting-slot ordinal | 16 | 384 | 6,144 |
| non-main reference-source record excluding charged strings | 192 | 1,152 | 221,184 |
| v4-selection or v5-note ordinary issue envelope excluding charged strings | 640 | 511 | 327,040 |
| ordinary escaped strings including quotes | ordinary budget | 1 | 1,571,840 |
| **Maximum realizable ordinary response** |  |  | **2,619,776** |
| non-coexisting terminal issue envelope reserve | 640 | 1 | 640 |
| non-coexisting terminal escaped-string reserve | 1,024 | 1 | 1,024 |
| **Legal JSON accounting envelope** |  |  | **2,621,440** |

Unit charges decompose as follows; constant key strings are structural, while
dynamic string values and their quotes use the escaped-string budget:

| Record | keys/punctuation | bounded numerics/literals | unit total |
| --- | ---: | ---: | ---: |
| relationship slot | 248 | 72 | 320 |
| relationship story plus six-check report | 448 | 192 | 640 |
| selecting-slot ordinal and comma | 4 | 12 | 16 |
| non-main source record | 152 | 40 | 192 |
| larger of v4 selection issue or v5 note issue with every optional key present | 464 | 176 | 640 |

The 124,928-byte fixed row decomposes into 16,384 bytes for top-level keys and
the fixed-main report, 24,576 for three partition envelopes, 32,768 for two
evaluated note reports, 24,576 for six inventories, and 26,624 for array
punctuation plus the issue-array envelope:

```text
16,384 + 24,576 + 32,768 + 24,576 + 26,624 = 124,928
```

`ProtocolV5StructuralChargeAudit.lean` serializes one empty-string,
maximum-numeric instance of every record and proves its bytes are no greater
than the unit charge. `ProtocolV5MaximumOrdinaryShape.lean` constructs one
combined realizable ordinary worst case in which all 384 relationship
slots/stories, all 1,152 non-main source records, both evaluated note reports,
six evaluated inventories, a nonzero protocol-v4 selection-issue prefix and
protocol-v5 note-issue suffix totaling 511 maximally charged ordinary issues,
maximum selector ordinals, and exactly the 1,571,840-byte ordinary
escaped-string budget coexist. `ProtocolV5StructuralChargeAudit.lean` proves
both issue shapes fit the shared 640-byte unit charge. The combined response
must serialize to at most 2,619,776 bytes and pass the strict decoder:

```text
124,928 + 122,880 + 245,760 + 6,144 + 221,184
+ (640 * 511) + 1,571,840 = 2,619,776
```

`ProtocolV5CanonicalTerminalShapes.lean` separately constructs both terminal
responses, proves that ordinary evidence is absent, proves each terminal uses
no more than the reserved 640 structural plus 1,024 escaped-string bytes, and
proves each full terminal JSON response is at most 2,621,440 bytes, proves
stdout is that JSON plus exactly one newline and at most 2,621,441 bytes, and
proves the result is accepted by the strict decoder. No fixture or legal response combines the ordinary
1,571,840-byte budget with the 1,024-byte terminal reserve. The legal envelope
is conservative accounting:

```text
2,619,776 + 640 + 1,024 = 2,621,440
```

The maximum realizable ordinary response leaves 5,768,832 bytes below the
8 MiB hard cap, while the conservative legal JSON envelope leaves 5,767,168
and its newline-terminated stdout leaves 5,767,167:

```text
8,388,608 - 2,619,776 = 5,768,832
8,388,608 - 2,621,440 = 5,767,168
8,388,608 - 2,621,441 = 5,767,167
```

### 12. Terminal collapse is fully pinned

The 512th attempted ordinary issue across the selection-then-note stream is
not appended. Shared ordinary issue capacity is 511 so one aggregate terminal
slot is always available. Likewise, an ordinary append that would make escaped
evidence strings exceed 1,571,840 bytes is rejected before mutation. The
issue-count check precedes the string charge for the same candidate, as pinned
in section 9. The terminal issue uses only the separate 640-byte structural and
1,024-byte escaped-string reserves. Either crossing clears both ordinary issue
arrays and emits exactly one terminal `noteIntegrityIssues` entry.

For issue-count exhaustion the entry is exactly:

```json
{
  "code": "NOTE_ISSUE_LIMIT_EXCEEDED",
  "side": "original",
  "kind": "footnotes",
  "detail": "protocol v5 aggregate ordinary issue limit exceeded",
  "ordinalSpace": "aggregate",
  "firstOccurrenceOrdinal": 0,
  "occurrenceCount": 1
}
```

For escaped-string exhaustion only `code` and `detail` differ:

```json
{
  "code": "NOTE_EVIDENCE_STRING_BUDGET_EXCEEDED",
  "side": "original",
  "kind": "footnotes",
  "detail": "protocol v5 escaped evidence string budget exceeded",
  "ordinalSpace": "aggregate",
  "firstOccurrenceOrdinal": 0,
  "occurrenceCount": 1
}
```

All optional issue fields are absent. The complete terminal response has:

- `passed: false`;
- truthful `fixedStories: [main]`;
- `presenceMismatches: []` and `fixedStoryIssues: []`;
- `relationshipSlots: []`, `relationshipStories: []`, and
  `selectionIssues: []` (cleared, never truncated);
- three incomplete partitions whose `sources` are exactly their fixed main
  record, whose definition stories have no relationship and
  `partPresent: false`;
- exactly two `not_evaluated` note stories with all side identities absent,
  all `partPresent: false`, zero token counts, and no `report`;
- exactly six `not_evaluated` inventories with no relationship and all counts
  zero; and
- exactly the single terminal issue above.

No retained prefix or hidden truncation is permitted. Archive/index,
required-main, process, serialization, or final 2,621,440-byte assertion
failure emits no protocol JSON and maps to public `not_run`.

### 13. TypeScript strictly decodes, but does not re-prove Lean

The launcher sends protocol v5 only. The decoder recursively rejects:

- unknown/missing keys or unsupported literals;
- anything other than exactly three partitions, two note slots, and six
  inventories in canonical order;
- any protocol-v4 selection issue with protocol-v5 `source`, ordinal-space, or
  note-ID fields; any ordinary note-integrity issue without exactly one
  `source` discriminant; main or note identity with an ordinal other than 0;
  header/footer identity outside `0..383` or inconsistent with the selected
  canonical physical-story entry; an invented note-issue source identity
  inconsistent with the implicated XML or relationship record; or any
  terminal issue containing `source`;
- a nonterminal response where
  `selectionIssues.length + noteIntegrityIssues.length > 511`; a cross-array
  admission order other than all canonical v4 selection issues before all
  canonical v5 note issues; a terminal in `selectionIssues`; or a terminal
  response whose `selectionIssues` is nonempty or whose
  `noteIntegrityIssues` is not exactly the one canonical terminal;
- duplicate/coalescing/order/occurrence violations;
- contradictory relationship, presence, path, partition, status, count,
  report, issue, or aggregate-pass equations;
- any limit or serialized response overflow;
- a noncanonical evidence ID;
- a terminal response outside either exact terminal shape; and
- protocol-v4 output from the v5 executable path.

The decoder validates evidence consistency; it does not independently recreate
the hidden full reference/definition lists. Their exactness is supplied by
`parsed_inventory_evidence_exact` in the compiled checker.

### 14. Public certificate v1 remains additive and honest

The public certificate remains protocol v1 and adds co-present optional
`noteStoryScope`, `referenceSourcePartitions`, `noteStories`,
`noteInventories`, and `noteIntegrityFailures` for a valid protocol-v5
response. `checkerProtocolVersion` includes 5.

The scope literal is:

```text
selection: fixed-word-document-main-relationships
mainDocumentPart: word/document.xml
relationshipsPart: word/_rels/document.xml.rels
alignment: semantic-note-kind
namespaces: transitional
reconstructionMode: inplace
```

The legacy `fixedStoryScope` conventional tuple is emitted only if all six
side-kind slots are non-vacuously conventional:

- every original/revised/compared footnotes slot selected, loaded, and checked
  exactly `word/footnotes.xml`;
- every original/revised/compared endnotes slot selected, loaded, and checked
  exactly `word/endnotes.xml`; and
- both semantic note-story reports are evaluated.

If any of those six conditions is absent, failed before checking, or uses an
alternate safe path, `fixedStoryScope` is omitted. The new per-side semantic
evidence is authoritative.

A `not_run` or rebuild `not_applicable` certificate carries no protocol-v5 note
claim. The `note-reference integrity` exclusion is removed only for valid
passed/failed protocol-v5 evidence with complete partitions; all other
exclusions remain.

### 15. Real-document evidence is non-vacuous for both kinds

The checked-in NVCA source has user footnotes but no user endnote reference.
Tests must therefore derive a deterministic fixture from the real NVCA source
that adds, on all three snapshots:

- one exact internal endnotes relationship;
- one selected valid endnotes part;
- one user `w:endnoteReference` in an admitted reference source; and
- one matching user `w:endnote` definition.

The baseline must prove nonzero user reference and definition counts for both
footnotes and endnotes.

Compared-only mutation tests then cover:

- missing and canonical-alias duplicate definitions;
- a valid lexical alias and `-0` canonical evidence;
- recursive/self-kind and cross-kind references injected into note-definition
  stories;
- missing, wrong-type, duplicate, external, unsafe, and alternate-safe-path
  relationships;
- issue coalescing collisions that differ by code, source, referenced kind, or
  occurrence ordinal;
- exact issue/string terminal responses and decoder rejection of malformed
  terminal mixtures; and
- unchanged unrelated header/footer selection.

No LibreOffice or `soffice` process is used.

## Risks / Trade-offs

- **Conventional-main scope is narrower than full OPC.** This is deliberate and
  appears in names and certificates.
- **Any incomplete admitted story suppresses both kind claims.** This loses
  partial evidence but prevents hidden references.
- **Definition-story references are rejected rather than followed.** This
  matches the targeted reference clauses and avoids unverifiable cycles.
- **The 64-byte lexical bound is stricter than unbounded `xsd:integer`.** It is
  an explicit verifier resource policy, applied before parsing.
- **Protocol v5 is internally breaking.** Public protocol v1 remains additive.

## Migration Plan

1. Add the conventional-main note selector, partition scanner, typed inventory,
   and six theorem targets.
2. Migrate executable output and strict decoding atomically to protocol v5.
3. Add public additive evidence and exact terminal/maximum-shape tests.
4. Add the NVCA-derived non-vacuous endnote fixture and adversarial mutations.
5. Update axiom audit, coverage, ECMA registry, generated docs, and CI.
6. Ship only after independent review and post-merge real-document smoke.

## Open Questions

- None. Cardinalities, ordering, terminal forms, and response bounds are pinned
  above for implementation and re-review.
