## Context

Protocol v5 proves note-reference integrity from three immutable DOCX packages.
It retains one bounded parse/scan for fixed main, selected header/footer, and
selected note stories. Legacy `w:commentReference` can occur in all of those
stories, while its definitions live in a Comments part selected independently
from fixed-main relationships. This change extends that production proof
boundary; it does not model TypeScript comparison.

## Goals / Non-Goals

### Goals

- Select the legacy Comments part independently on each side.
- Prove the complete physical source set, exact ordered reference projection,
  direct-definition projection, and exact-one resolution.
- Bind the actual production core and serialized v6 response to independent
  proof semantics without rereading, reparsing, or rescanning runtime input.
- Preserve bounded deterministic output, private snapshots, and public
  certificate v1 compatibility.

### Non-Goals

- `commentRangeStart`/`commentRangeEnd` pairing, nesting, topology, or
  correspondence to `commentReference`.
- Modern comments, replies, parent graphs, authors, dates, content, rendering,
  repair, Strict, full OPC/content types/schema validation, or rebuild.

## Standards Boundary

The exercised normative surface is ECMA-376 5th edition Part 1:

- §17.13.4.6: Transitional `w:comments` collection;
- §17.13.4.2: direct `w:comment` definitions;
- §17.13.4.5: `w:commentReference`;
- §17.18.10: `ST_DecimalNumber`.

The exact relationship URI is
`http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments`.
The definition-ID trace is
`w:comment → CT_Comment → CT_TrackChange/@w:id → ST_DecimalNumber`;
the reference-ID trace is `w:commentReference → CT_Markup/@w:id →
ST_DecimalNumber`. The §17.18.10 registry entry is renamed from note-specific
wording to “WordprocessingML signed decimal identifiers” and its claim covers
both notes and legacy comments without changing the schema locator.
Safe path normalization, fixed-main selection, limits, ordering, diagnostic
coalescing, and certificate presentation are SafeDocX policy.

## Decisions

### 1. Protocol v6 is required

The private request becomes `VerifierRequestV6` with the same three paths and
`protocolVersion: 6`. Raw TypeScript decoding accepts v6 only; v5 fixtures
migrate and v5 runtime output becomes `not_run`. Public
`DocumentIntegrityCertificate.protocolVersion` remains `1`.

The response retains every v5 field and adds these three fields:

```text
commentStory
commentInventories
commentIntegrityIssues
```

`commentStory` is one object, not an array. `commentInventories` has exactly
three entries in original/revised/compared order. No caller supplies a scan,
inventory, selector result, or JSON fragment.

### 2. Selection is fixed-main, total, and relationship-selected

For each side, Lean uses the already retained parse of
`word/_rels/document.xml.rels`. It filters all direct `Relationship` records by
the exact Comments type before inspecting `TargetMode`.

- zero records returns `.ok none`;
- one record returns `.ok (some selected)` iff its ID is present and at most
  128 UTF-8 bytes, its ID is unique among all direct relationship records, its
  target is present and at most 256 UTF-8 bytes, its `TargetMode` is absent or
  exactly `Internal`, and its target normalizes safely relative to
  `word/document.xml`;
- one exact-type `External` record returns `.error .external`;
- one record with any other explicit `TargetMode` returns
  `.error .invalidTargetMode`;
- a missing/overlong/duplicate ID, missing/overlong/unsafe target, or failed
  normalization returns its exact typed error; and
- two or more exact-type records returns `.error .ambiguous`, including one
  internal plus one external. Cardinality wins before record validation, and
  the second exact-type relationship ordinal identifies the failure.

Selection ends at an admissible normalized relationship identity. Unique ZIP
entry, metadata/resource admission, extraction, UTF-8, parse, and root checks
are subsequent part-admission stages, not ways to turn `some` into `none`.
Therefore a valid selected Comments part with no references remains selected
and is scanned; unique unreferenced definitions pass.

No root relationship, content type, orphan part, or conventional
`word/comments.xml` assumption participates. The three selected paths may
differ. Define the complete result predicate:

```lean
def CommentSelectionResultOf
    (pkg : PackageView)
    (result : Except CommentSelectionFailure
      (Option SelectedCommentIdentity)) : Prop :=
  let records := exactCommentRelationshipRecordsSpec
    (fixedMainRelationshipEventsSpec pkg)
  match result with
  | .ok none => records = []
  | .ok (some selected) =>
      ∃ record, records = [record] ∧
        AdmissibleCommentRelationshipRecordSpec pkg record selected
  | .error failure =>
      canonicalCommentSelectionFailureSpec pkg records = some failure
```

The three branches are disjoint and exhaustive. The negative witness
`forged_comment_absence_rejected` supplies one admissible record with `.ok none`
and proves `¬ CommentSelectionResultOf pkg (.ok none)`.

### 3. The source set is derived, not supplied

For one side the exact reference-source order is:

```text
0       fixed word/document.xml
1..N    selected header/footer physical stories in physicalStoryOrdinal order
N+1     selected present footnotes story
N+2     selected present endnotes story
```

Absent note slots contribute no source. The maximum is 387 sources: main, 384
physical header/footer stories, footnotes, and endnotes. The implementation
reuses retained event arrays from the same production pass. It must not parse
XML again for comment verification.

The Comments part is a definition story and never a reference source. A
`w:commentReference` inside comment content is outside this slice and is not
followed. A `w:comment` is a definition only when it is a direct child of the
selected `w:comments` root; a nested `w:comment` is
`COMMENT_DEFINITION_NOT_DIRECT`.

### 4. Decimal identity is shared exactly with v5

Raw `w:id` is limited to 64 UTF-8 bytes before XML Schema whitespace collapse.
Tab/LF/CR become spaces, outer whitespace is trimmed, internal spaces collapse,
and the result must match `[+-]?[0-9]+`. The canonical form is
`0 | -?[1-9][0-9]*`; signs, leading zeroes, and negative zero normalize.

Missing, malformed, and overlong IDs fail. Overlong diagnostics never retain
raw bytes or a digest. Their key is the issue code, exact source identity,
ordinal space, and occurrence ordinal, plus bounded `rawIdByteLength`. It is
diagnostic occurrence identity, not document provenance.

### 5. Complete, failed, and absent sides are distinct

A side is complete only if its existing v5 source partition is complete, every
expected source realization is retained and exact, and comment selection and
the required Comments part complete all intrinsic stages.

- absent relationship plus zero reference elements is valid absence and a
  passed zero-count inventory;
- absent relationship plus any reference, including one with invalid ID,
  yields `COMMENT_RELATIONSHIP_REQUIRED`;
- selected presence that fails cardinality, mode, normalization, load, UTF-8,
  parse, root, or full scan is not absence;
- incomplete prerequisite, failed required infrastructure, or semantic limit
  crossing yields `not_evaluated`, zero wire counts, empty internal lists, and
  no `ParsedCommentEvidence`;
- a completely scanned side with malformed IDs, duplicate definitions,
  non-direct definitions, or missing matches is evaluated `failed`;
- unique unreferenced direct definitions are valid.

Reference-element discovery is intentionally separate from ID admission.
When selection is `.ok none`, the evaluator walks retained source events only
until the first expanded-name `w:commentReference`, records its source and
event ordinal, and emits `COMMENT_RELATIONSHIP_REQUIRED` without looking up,
measuring, collapsing, or parsing `w:id`. Thus relationship-required wins
simultaneously over missing, malformed, overlong, reference-count, and
unique-ID failures on that element. Tests combine absence with each malformed
ID shape and with a 4,097th element. When selection is `some`, normal reference
limit and ID order applies. A selector error precedes all source reference
inspection.

### 6. Comments share all existing package resource budgets

No limit increases for package work. The selected Comments part is charged
against the same counters already carrying main, relationships,
header/footer, and note work:

| Resource | Per-part | Per-side cumulative | Triple cumulative |
| --- | ---: | ---: | ---: |
| compressed bytes | 8,388,608 | 16,777,216 | 50,331,648 |
| expanded bytes | 16,777,216 | 33,554,432 | 100,663,296 |
| compression ratio | expanded `≤ compressed × 100`; empty compressed data may expand only to zero | same admitted entries | same admitted entries |
| unique selected XML parts | 1 candidate | 256 | 768 |
| XML depth | 128 | n/a | n/a |
| XML events | 500,000 | 1,000,000 | 3,000,000 |

Package bytes remain 33,554,432 per side, central directory bytes 4,194,304,
and indexed entries 1,024; those are established before any part selection.

The exact global work order is:

1. immutable snapshot and binary index for original, revised, compared;
2. retained v5 main, fixed relationships, selected header/footer, and note
   work in its existing order;
3. comment selector classification for original, revised, compared, stopping
   immediately on the first selector error;
4. for each side in original/revised/compared order, verify the retained source
   set; if selector is absent, perform relationship-required element discovery
   only; if selected, admit ZIP metadata;
5. before decompression, test in order: unique regular entry, side and triple
   selected-part counts, per-part compressed, per-part expanded, ratio, side
   cumulative compressed, side cumulative expanded, triple cumulative
   compressed, triple cumulative expanded;
6. charge accepted byte metadata, decompress once, verify output length/CRC,
   decode UTF-8, compute `eventLimit = min 500000 remainingSideEvents
   remainingTripleEvents`, parse with depth 128 and that event limit, then
   charge events;
7. only after a complete parse/root check, inspect definition IDs and complete
   semantic checks.

Metadata-known failures perform no decompression. Byte/decompression/UTF-8
failures perform no XML parse. Depth/event/root failures perform no ID reads.
Any selector or resource failure is the globally first comment stop: the
crossing side is `not_evaluated`; all later side comment work is
`skippedAfterPriorCommentFailure`; no later Comments part is decompressed or
parsed. Existing completed v5 evidence is retained unless terminal JSON
collapse occurs.

### 7. Independent proof predicates

`Tier2/CommentReferenceIntegrity/TypedSemantics.lean` imports no module. It
defines bounded bytes, typed relationship/package/index/extraction/XML-event
records, the typed selector/evaluator/scanner/integrity predicates, typed
protocol values, and the structural byte encoder. The production
`Semantics.lean` layer retains the richer request-bound relations used by the
foundational bridge, but it is not one of the seven empty-axiom targets.
Neither typed declarations nor their theorem signatures may import or mention
an executable selector, parser, scanner, checker, response builder, JSON value,
string conversion, IO action, production encoder, or `LeanSpike` declaration.

The following equations are normative:

```lean
def SelectedCommentIdentityOf
    (pkg : PackageView) (selected : SelectedCommentIdentity) : Prop :=
  CommentSelectionResultOf pkg (.ok (some selected))

def AdmittedCommentPartOf
    (pkg : PackageView) (side : VerifierSide)
    (prior : GlobalResourceUsage)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization) : Prop :=
  ExactlyOneRegularBinaryEntryAt pkg.index selected.normalizedPartPath ∧
  CommentMetadataAdmittedSpec pkg prior selected realization.entry ∧
  BoundedExtractionEvidenceSpec pkg realization.entry
    realization.extraction ∧
  StrictUtf8DecodeSpec realization.extraction.decompressedBytes =
    some realization.text ∧
  BoundedXmlParseSpec realization.text transitionalWmlNamespace "comments"
    128 (min 500000
      (min (1000000 - (prior.side side).xmlEvents)
        (3000000 - prior.tripleXmlEvents))) =
      .ok realization.parsed ∧
  realization.parsed.events.size ≤ 500000

def RequestBoundCommentRealizationOf
    (request : VerifierRequestV6) (side : VerifierSide)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization) : Prop :=
  let pkg := request.packageView side
  let retained := request.retainedPackageRecord side
  pkg = packageViewOfRetainedPackageRecordSpec retained ∧
  pkg.packageBytes = retained.packageBytes ∧
  pkg.index = retained.index ∧
  retained.packageBytes = request.packageBytes side ∧
  retained.index = binaryIndexSpec retained.packageBytes ∧
  request.retainedSnapshotBytes side = request.packageBytes side ∧
  request.snapshotWriteInvocationCount side = 1 ∧
  realization.extraction.snapshotPath = request.privateSnapshotPath side ∧
  request.retainedCommentExtraction side =
    some realization.extraction ∧
  request.commentExtractionInvocationCount side = 1 ∧
  request.commentParseInvocationCount side = 1 ∧
  realization.selected = selected ∧
  AdmittedCommentPartOf pkg side request.resourceUsageBeforeComments
    selected realization

inductive CommentSelectionRealizationOutcome
  | absent
  | selected (identity : SelectedCommentIdentity)
  | selectorError (failure : CommentSelectionFailure)
  | realizationError (identity : SelectedCommentIdentity)
      (failure : CommentRealizationFailure)

def CompleteCommentSourceSetOf
    (pkg : PackageView) (side : VerifierSide)
    (noteEvaluation : SideNoteEvaluationV5)
    (set : CommentSourceSet) (scans : SideScanEvidence) : Prop :=
  noteEvaluation.partition.status = .complete ∧
  set.side = side ∧
  set.sources =
    [fixedMainSourceSpec pkg] ++
    canonicalPhysicalSourcesSpec noteEvaluation.partition ++
    presentNoteSourcesSpec noteEvaluation.partition ∧
  set.sources.length ≤ 387 ∧
  NoDuplicatePhysicalSourceSpec set.sources ∧
  ScanDomainExactlySpec set.sources scans ∧
  ∀ source ∈ set.sources, ∃ realization,
    scans.realizationFor source = some realization ∧
    RetainedFullyScannedStoryOf pkg source realization

def ParsedCommentEvidenceOf
    (pkg : PackageView) (side : VerifierSide)
    (set : CommentSourceSet) (comment : Option CommentStoryRealization)
    (evidence : ParsedCommentEvidence) : Prop :=
  evidence.references =
    orderedCommentReferencesSpec set.sources ∧
  evidence.definitions =
    directCommentDefinitionsSpec comment ∧
  evidence.nonDirectDefinitions =
    nonDirectCommentDefinitionsSpec comment ∧
  evidence.issues =
    canonicalCommentIssuesSpec pkg side set comment
      evidence.references evidence.definitions
      evidence.nonDirectDefinitions ∧
  evidence.wireCounts =
    commentCountProjectionSpec evidence

def RequestBoundRetainedCommentEvidenceOf
    (request : VerifierRequestV6) (side : VerifierSide)
    (realization : CommentStoryRealization)
    (evidence : ParsedCommentEvidence) : Prop :=
  let pkg := request.packageView side
  let sourceSet :=
    canonicalCommentSourceSetSpec pkg (request.noteEvaluation side)
  let sourceScans := request.retainedSourceScans side
  CompleteCommentSourceSetOf pkg side (request.noteEvaluation side)
    sourceSet sourceScans ∧
  request.retainedCommentScanRealization side = some realization ∧
  request.retainedCommentScanSourceSet side = some sourceSet ∧
  request.retainedCommentScanSourceScans side = some sourceScans ∧
  request.commentScanInvocationCount side = 1 ∧
  request.retainedCommentScanResult side = .ok evidence ∧
  ParsedCommentEvidenceOf pkg side sourceSet (some realization) evidence

def SelectionToCommentRealizationOf
    (request : VerifierRequestV6) (side : VerifierSide)
    (outcome : CommentSelectionRealizationOutcome)
    (stored : Option CommentStoryRealization)
    (semanticEvidence : Option ParsedCommentEvidence) : Prop :=
  let pkg := request.packageView side
  match outcome with
  | .absent =>
      selectConventionalMainCommentSpec pkg = .ok none ∧
      stored = none ∧ semanticEvidence = none
  | .selected selected =>
      selectConventionalMainCommentSpec pkg = .ok (some selected) ∧
      ∃ realization evidence,
        stored = some realization ∧
        semanticEvidence = some evidence ∧
        RequestBoundCommentRealizationOf request side selected realization ∧
        RequestBoundRetainedCommentEvidenceOf request side
          realization evidence ∧
        (∀ otherRealization otherEvidence,
          RequestBoundCommentRealizationOf request side selected
              otherRealization →
          RequestBoundRetainedCommentEvidenceOf request side
              otherRealization otherEvidence →
          otherRealization = realization ∧ otherEvidence = evidence)
  | .selectorError failure =>
      selectConventionalMainCommentSpec pkg = .error failure ∧
      stored = none ∧ semanticEvidence = none
  | .realizationError selected failure =>
      selectConventionalMainCommentSpec pkg = .ok (some selected) ∧
      canonicalCommentRealizationFailureSpec request side selected =
        some failure ∧
      stored = none ∧ semanticEvidence = none

def PackageCommentIntegrity (inventory : PackageCommentInventory) : Prop :=
  UserCommentDefinitionsUnique inventory ∧
  inventory.nonDirectDefinitions = [] ∧
  ∀ reference ∈ inventory.references, ∃! definition,
    definition ∈ inventory.definitions ∧
    definition.id = reference.id

def IncompleteCommentSideZeroEvidenceOf
    (request : VerifierRequestV6) (context : GlobalCommentAdmissionContextV6)
    (side : VerifierSide) (evaluation : SideCommentEvaluationV6)
    (cause : CommentIncompleteCauseV6) : Prop :=
  GlobalCommentAdmissionContextOf request context ∧
  evaluation.side = side ∧
  evaluation.status = .notEvaluated ∧
  CommentIncompleteCauseOf context side evaluation cause ∧
  evaluation.internalReferences = [] ∧
  evaluation.internalDefinitions = [] ∧
  evaluation.parsedEvidence = none ∧
  evaluation.inventory = zeroCommentInventorySpec side ∧
  evaluation.story = notEvaluatedCommentStorySideSpec side

def ResponseRetainedCommentEvidenceOf
    (request : VerifierRequestV6) (response : VerifierResponseV6)
    (side : VerifierSide) : Prop :=
  match response.commentOutcome side, response.commentRealization side,
      response.commentParsedEvidence side with
  | .selected _, some realization, some evidence =>
      RequestBoundRetainedCommentEvidenceOf request side
        realization evidence ∧
      ResponseCommentInventoryAt response side =
        commentCountProjectionSpec evidence ∧
      PackageCommentIntegrity (packageCommentInventorySpec evidence)
  | .absent, none, none =>
      ResponseCommentInventoryAt response side =
        zeroPassingCommentInventorySpec side
  | _, _, _ => False

def CommentAggregatePassOf
    (request : VerifierRequestV6) (response : VerifierResponseV6) : Prop :=
  ∃ packages,
    RequestPackageViewsV6Spec request = some packages ∧
    ResponseCardinalityAndOrderV6 response ∧
    ExistingProtocolV5SemanticObligationsHold request response ∧
    (∀ side,
      CommentSelectionResultOf (packages side)
        (ResponseCommentSelectionResultAt response side)) ∧
    (∀ side,
      SelectionToCommentRealizationOf request side
        (response.commentOutcome side)
        (response.commentRealization side)
        (response.commentParsedEvidence side)) ∧
    (∀ side, ResponseRetainedCommentEvidenceOf request response side) ∧
    AllProtocolV6PassEquations response

def SerializedResponseV6Of
    (response : VerifierResponseV6) (stdout : ByteArray) : Prop :=
  stdout = independentCanonicalProtocolV6BytesSpec response ++ "\n".toUTF8 ∧
  independentCanonicalProtocolV6BytesSpec response |>.size ≤ 2626368 ∧
  stdout.size ≤ 2626369
```

Every `*Spec` helper is structural recursion in the independent module.
`RetainedFullyScannedStoryOf` equates exact package bytes, extracted bytes,
strict UTF-8, parsed root/events, and the retained one-call scan result. It does
not recompute parsing, decompression, CRC, or scanning at runtime.
`RequestBoundRetainedCommentEvidenceOf` likewise identifies one exact retained
scan invocation and result. Its scan consumes the same selected realization,
the canonical admitted source set computed from the request-bound package view
and note evaluation, and the request's retained source scans. No caller may
supply a second source set, scan inventory, or parsed-evidence existential.
`ResponseRetainedCommentEvidenceOf` projects counts and integrity from that
same `response.commentParsedEvidence side` value.

### 8. Exact theorem signatures

The semantic proof layer imports no production module. `BoundedBytes` carries
`List UInt8`, an explicit limit, and its admission proof. Relationships,
package indexes, ZIP entries and slices, XML expanded names/attributes/events,
selected identities, retained realizations, source records, scans, inventories,
and protocol values are typed records over bounded bytes and natural-number
ordinals. `TypedJson` is a byte-native algebraic datatype whose encoder is
structural recursion. None of the following seven declaration types or
transitive dependencies may mention `String`, `String.toUTF8`, `Lean.Json`,
`IO`, a production selector/builder, or any `LeanSpike` declaration.

`TypedBinaryIndexOf` is substantive rather than a count projection. Its
structurally recursive validator requires a package of at most 33,554,432
bytes, at most 1,024 complete entries, a central-directory span of at most
4,194,304 bytes within the package, unique safe bounded entry names, one
non-directory selected entry, and pairwise-disjoint local spans before the
central directory. For every entry it checks the `PK\x03\x04` local signature,
flags/method/CRC/sizes/offsets, local filename length and exact filename bytes,
the computed data offset, and the exact compressed payload span. Selection
requires exactly one index entry with the normalized Comments path; `any`
membership is insufficient. Extraction then equates the request package,
one-write immutable snapshot, selected entry, exact compressed byte slice, and
expanded bytes before typed XML events are admitted.

The typed index relation parses the retained package bytes themselves. An
index-independent structural pass discovers every classic single-disk EOCD
candidate in the final 65,557-byte window whose comment ends exactly at EOF
and whose central span ends at that candidate. Exactly one candidate is
required; zero and multiple candidates fail before ZIP64-marker rejection or
binding to `TypedPackageIndex`. The sole candidate is then checked for ZIP64
locator/record markers and bound to the typed entry count and central
offset/size. It then traverses exactly that many `PK\x01\x02` records to the EOCD,
binding every central name, flag, method, CRC, compressed/expanded size, and
local offset to the typed entries. Each corresponding `PK\x03\x04` record must
repeat the exact name/flags/method/CRC/sizes and derive the exact data
offset/span. Every raw local and central filename is limited to exactly 256
bytes before decoding. Encryption, descriptors, unsupported flags/methods, ZIP64 and
ambiguous path extras are rejected without calling the production ZIP parser.
Closed fixtures include a complete local record, central record and EOCD;
central CRC/size/local-offset/count/name mutations and EOCD removal fail
`TypedBinaryIndexOf`. A complete archive containing two structurally valid
EOF-aligned EOCD candidates is rejected as ambiguous, while complete safe-name
archives establish acceptance at 256 raw filename bytes and rejection at 257.

`canonicalTypedCommentSources` is derived only from typed package-side inputs:
main source ordinal 0; aligned header/footer slots and their deduplicated
physical stories in contiguous physical order; then present semantic footnotes
and endnotes in that order. Each note selection carries retained note-reference
presence, selected relationship/path, part presence, and the retained source.
An absent relationship with a retained reference is therefore incomplete
rather than silently absent. The derivation requires contiguous ordinals,
one-to-one slot/story correspondence, exact path and event identity, and no
omitted, injected, or duplicated source realization. No
`sourcePartitionAdmitted` Boolean participates in this typed predicate.
Instead, `TypedPriorSourceAdmission` is an explicit typed cause:
`admitted`, `relationshipFailure`, `storyRealizationFailure`,
`resourceFailure`, or `noteAdmissionFailure`. The production adapter derives
that cause only from retained selection issues, retained note-scan presence,
the concrete semantic resource crossing, and the retained note evaluation's
`complete` result. The executable source-set bridge proves that this derived
cause and the typed main/slot/story/note records produce exactly the retained
concrete source sequence; a caller cannot substitute an admission decision.

Header/footer slots form a partition, not a flattened story list. Every slot
ordinal occurs exactly once across story selector lists; each selector list is
the ordered slots with that exact `(kind, original, revised, compared)`
physical key; keys are unique in first-seen order; physical ordinals are
contiguous; and source order follows physical-story order. Interleaved slots
`A,B,A` therefore derive stories `A:[0,2], B:[1]`.

These exact seven targets must each print an empty axiom set:

```lean
theorem typed_comment_selector_result_sound
    (commentType : BoundedBytes) (relationships : List TypedRelationship) :
    TypedCommentSelectionResultOf commentType relationships
      (selectTypedComment commentType relationships)

theorem typed_comment_selection_to_realization_sound
    (side : Side) (pkg : TypedPackageView) :
    TypedSelectionToRealizationOf side pkg
      (evaluateTypedCommentSide side pkg)

theorem typed_admitted_comment_source_set_complete
    (side : Side) (pkg : TypedPackageView)
    (hStatus :
      (evaluateTypedCommentSide side pkg).status ≠ .notEvaluated) :
    TypedCompleteSourceSetOf pkg side
      (evaluateTypedCommentSide side pkg).sources

theorem typed_parsed_comment_inventory_evidence_exact
    (input : TypedScanInput) :
    TypedParsedCommentEvidenceOf input (scanTypedCommentEvidence input)

theorem typed_package_comment_reference_integrity_sound
    (scan : TypedCommentScan)
    (h : checkTypedPackageCommentIntegrity scan = true) :
    TypedPackageCommentIntegrity scan

theorem typed_incomplete_comment_partition_zero_evidence_sound
    (side : Side) (pkg : TypedPackageView) :
    TypedIncompleteZeroOf (evaluateTypedCommentSide side pkg)

theorem typed_comment_integrity_aggregate_pass_sound
    (request : TypedRequestV6) :
    TypedCommentAggregatePassOf request
        (canonicalTypedResponseV6 request) ∧
      TypedSerializedResponseV6Of (canonicalTypedResponseV6 request)
        (independentProtocolV6Projection
          (canonicalTypedResponseV6 request))
```

`TypedCommentAggregatePassOf` includes all three
`TypedSelectionToRealizationOf` results, so the typed evaluator is a real
production-refinement dependency rather than an audit-only name.

The five separately named executable refinement targets have these exact
signatures:

```lean
theorem executable_comment_selector_refines_typed
    (pkg : PackageView) (typedCommentType : BoundedBytes)
    (typedRelationships : List TypedRelationship)
    (h : executableSelectorRefinementCheck pkg typedCommentType
      typedRelationships = true) :
    ExecutableSelectorRefinesTyped pkg typedCommentType typedRelationships

theorem executable_comment_realization_refines_typed
    (pkg : PackageView) (side : VerifierSide)
    (prior : GlobalResourceUsage) (selected : SelectedCommentIdentity)
    (note : SideNoteEvaluationV5) (evaluation : SideCommentEvaluationV6)
    (realization : CommentStoryRealization)
    (typed : TypedCommentRealization)
    (hRun : realizeSelectedCommentV6 pkg side prior selected = .ok realization)
    (hEvaluation : evaluateCommentSideV6 pkg side note = evaluation)
    (h : executableRealizationRefinementCheck realization typed = true) :
    ExecutableRealizationRefinesTyped pkg side prior selected note evaluation
      realization typed

theorem executable_comment_source_set_refines_typed
    (pkg : PackageView) (side : VerifierSide)
    (note : SideNoteEvaluationV5) (set : CommentSourceSet)
    (evaluation : SideCommentEvaluationV6)
    (typedSources : List TypedStorySource)
    (hSet : canonicalCommentSourceSet pkg side note = set)
    (hEvaluation : evaluateCommentSideV6 pkg side note = evaluation)
    (h : executableSourceSetRefinementCheck set typedSources = true) :
    ExecutableSourceSetRefinesTyped pkg side note set evaluation typedSources

theorem executable_comment_incomplete_refines_typed
    (pkg : PackageView) (side : VerifierSide)
    (note : SideNoteEvaluationV5) (evaluation : SideCommentEvaluationV6)
    (typed : TypedSideEvaluation)
    (hEvaluation : evaluateCommentSideV6 pkg side note = evaluation)
    (h : executableIncompleteRefinementCheck
      pkg side note evaluation typed = true) :
    ExecutableIncompleteRefinesTyped pkg side note evaluation typed

theorem executable_protocol_utf8_json_refines_typed
    (response : Json) (passed : Bool)
    (h : protocolV6JsonProjectionCheck response passed = true) :
    ∃ typedResponse,
      ProtocolV6JsonProjectionOf response passed typedResponse
```

These bridges check concrete production `String.toUTF8`, relationship,
realization, source-set, incomplete-result, `Json.compress`, and stdout
operations against typed values. They do not prove a caller-supplied equality.
The realization, source-set, and incomplete-result predicates retain the
literal `hRun`, `hSet`, and `hEvaluation` equations in their conclusions.
Source correspondence is an exact ordered list equality over source ordinal,
part path, and event identity, so one production source cannot satisfy two
typed positions and duplicates cannot be reused existentially.
`ExecutableIncompleteValueOf` is non-vacuous: executable
`not_evaluated` holds if and only if `admittedCommentIncompleteCause` returns
one exact selector, realization, source-partition, or semantic cause, and that
same branch has zero realization, parsed evidence, references, definitions,
inventory, typed sources, and typed scan evidence. Source-partition failure is
tested before selector evaluation and therefore cannot be relabeled by an
absent or malformed relationship.
Their normalized axiom sets are each exactly
`[propext, Classical.choice, Quot.sound]`.

The exact empty-axiom closure uses structural Boolean equality/order helpers
for bounded bytes, naturals, sides, source kinds, slots, and source lists.
Generated sparse-case proof helpers are disabled for these validators. The
only additional proof-only closure entries are the four explicit cases of
`bool_and_eq_true_parts`, and only
`typed_admitted_comment_source_set_complete` admits those entries.

The production target remains:

```lean
theorem production_run_request_core_v6_refinement_sound
    (request : RunRequestCoreRequestV6) (result : RunRequestCoreResultV6)
    (hRun : runRequestCoreV6 request = .ok result)
    (hPass : result.responsePassed = true) :
    ProductionRunRequestV6RefinesSemanticOf request result
```

`ProductionRunRequestV6RefinesSemanticOf` contains an explicit
`∃ typedRequest typedResponse canonicalBytes`. `TypedRequestOfProduction`
constructs `typedRequest` only from the retained package bytes and exact binary
index, selected entry, request-bound snapshot/extraction, typed parser result,
canonical source records, and retained one-call comment scan. It never decodes
`result.response` or a protocol projection to construct typed expected values.
`typedResponse` is then computed independently by
`canonicalTypedResponseV6 typedRequest`. The conclusion requires:

```lean
typedResponse = canonicalTypedResponseV6 typedRequest ∧
TypedCommentAggregatePassOf typedRequest typedResponse ∧
TypedSerializedResponseV6Of typedResponse canonicalBytes ∧
ProtocolV6JsonProjectionOf result.response result.responsePassed
  typedResponse ∧
result.response.compress.toUTF8.data.toList = canonicalBytes ∧
result.stdout.data.toList = canonicalBytes ++ [10]
```

It also binds the exact package bytes/index, selected entry, byte slice,
snapshot extraction, typed XML events, canonical retained source set, actual
one-call scan, semantic inventory/issue result, and all inherited v5 evidence.
The runtime executes the independent typed event scanner only where the
retained one-call scan is admitted; selector and pre-parse resource errors
retain the required empty/no-later-work evidence.

The dependency audit discovers the complete type-and-value closure recursively
using declaration module provenance. For each target it expands both the
observed theorem and a literal boundary-root allowlist and requires exact
equality of their project executable closures, including compiler-generated
match splitters. It denies the complete `LeanSpike.*` namespace and, for the
seven typed targets, all production and legacy semantic modules. Missing-root
and forbidden-extra self-tests must fail. The production closure must
substantively reach the typed evaluator, typed scanner, typed package/index/XML
adapters, independent byte encoder, semantic field projection, emitted JSON
projection relation, final canonical bytes, and final stdout relation.

The production theorem and all five executable bridges have exactly
`[propext, Classical.choice, Quot.sound]`; the seven typed targets are empty.
The whole-file normalized union remains the existing exact six-name allowlist.
Union equality does not replace per-target signature, closure, or axiom checks.

The negative suite must contain actual proofs against the semantic predicates,
including these declarations rather than decoder-only or executable-only
tests:

```lean
theorem selected_semantic_evidence_none_rejected
    (request : VerifierRequestV6) (side : VerifierSide)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization)
    (evidence : ParsedCommentEvidence)
    (hSelected : SelectionToCommentRealizationOf request side
      (.selected selected) (some realization) (some evidence)) :
    ¬ SelectionToCommentRealizationOf request side
      (.selected selected) (some realization) none

theorem substituted_retained_comment_scan_evidence_rejected
    (request : VerifierRequestV6) (side : VerifierSide)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization)
    (evidence substituted : ParsedCommentEvidence)
    (hSelected : SelectionToCommentRealizationOf request side
      (.selected selected) (some realization) (some evidence))
    (hDifferent : substituted ≠ evidence) :
    ¬ SelectionToCommentRealizationOf request side
      (.selected selected) (some realization) (some substituted)

theorem package_view_retained_record_mismatch_rejected
    (request : VerifierRequestV6) (side : VerifierSide)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization)
    (hMismatch :
      (request.packageView side).packageBytes ≠
        (request.retainedPackageRecord side).packageBytes ∨
      (request.packageView side).index ≠
        (request.retainedPackageRecord side).index) :
    ¬ RequestBoundCommentRealizationOf request side selected realization
```

The same suite must reject forged absence with one admissible record, an
invented realization whose bytes/index/extraction/parse evidence is not
request-bound, two distinct purported realization/evidence pairs for one
selected identity, a stored realization on absent or selector-error branches,
internal-plus-external ambiguity,
injected/orphan sources, omitted note sources, duplicated source realization,
partial scans, arbitrary inventories/JSON, absent-as-present, failed
presence-as-absence, malformed IDs, duplicate definitions, partial incomplete
evidence, forged crossing causes, and production/spec encoder drift.

### 9. Semantic limits and simultaneous crossing order

```text
comment reference occurrences per side                 4096
unique canonical reference IDs per side                4096
direct comment definitions per selected part           4096
non-direct comment definitions per selected part       4096
raw ID UTF-8 bytes                                        64
comment sources per side                                 387
Comments-part XML events                              500000
all ordinary issues across selection+note+comment        511
ordinary escaped evidence strings                    1571840
terminal escaped-string charge                          1024
legal aggregate escaped strings                       1572864
ordinary legal JSON upper envelope                    2624704
legal JSON response                                   2626368
legal stdout including one LF                         2626369
```

Candidate admission is side-major original/revised/compared. Within a side:

1. require the prior note source partition and retained scans;
2. classify exact Comments relationships in relationship-record order;
3. scan retained sources in source order and XML event order; if selection is
   absent, stop at the first reference element and emit relationship-required
   without reading its ID;
4. when selected, for each reference test occurrence limit, then lexical ID,
   then unique-ID limit, so candidate 4097 reports occurrence crossing only;
5. if absent and no reference element exists, establish valid absence;
6. load/decode/parse/root/full-scan the selected Comments part;
7. scan direct-child order; for each definition test definition count before
   lexical ID; then scan non-direct definitions in event order;
8. check duplicates, exact-one resolution, inventories, and generic story;
9. proceed to the next side unless a semantic limit crossed.

The globally first semantic crossing stops semantic work on later sides.
Crossing side and skipped sides expose zero evidence; earlier complete sides
remain unless aggregate terminal collapse occurs.

Issue arrays are coalesced and sorted independently, then aggregate-admitted in
this order: `selectionIssues`, `noteIntegrityIssues`,
`commentIntegrityIssues`. On the same candidate, count exhaustion is tested
before string exhaustion. An earlier string crossing remains first.

### 10. Selector and resource failure disposition is total

Failures already produced while parsing the fixed-main relationships remain
v5-shaped `selectionIssues`: `MISSING_RELATIONSHIPS_PART`, `INVALID_UTF8`,
`INVALID_RELATIONSHIPS_XML`, `INVALID_RELATIONSHIPS_ROOT`,
`RELATIONSHIP_LIMIT_EXCEEDED`, `MALFORMED_RELATIONSHIP_RECORD`,
`RELATIONSHIP_ID_LIMIT_EXCEEDED`, `DUPLICATE_RELATIONSHIP_ID`, and
`INVALID_TARGET_XML`. They have the existing v5 field grammar and precedence.
Any one prevents comment selection; comment story and all three inventories
are `not_evaluated`/zero, and `commentIntegrityIssues` is empty.

The inherited mapping is exact: missing relationships part →
`MISSING_RELATIONSHIPS_PART`; relationships bytes not UTF-8 → `INVALID_UTF8`;
malformed relationships XML → `INVALID_RELATIONSHIPS_XML`; wrong package
relationships root → `INVALID_RELATIONSHIPS_ROOT`; direct record 1,025 →
`RELATIONSHIP_LIMIT_EXCEEDED`; missing `Id`, `Type`, or `Target` →
`MALFORMED_RELATIONSHIP_RECORD`; relationship ID byte 129 →
`RELATIONSHIP_ID_LIMIT_EXCEEDED`; second use of an ID by any direct record →
`DUPLICATE_RELATIONSHIP_ID`; invalid XML attribute/reference in Target →
`INVALID_TARGET_XML`. They have no occurrence/source fields because they retain
the exact v5 `SelectionIssue` grammar; side is required when the package side
is known, and relationship ID/target appear only where that existing grammar
permits. They are admitted before every v6 comment issue and count toward the
same 511 ordinary capacity.

All comment-specific ordinary issues have exactly the required keys
`code`, `side`, `kind: "comments"`, `detail`, `ordinalSpace`,
`firstOccurrenceOrdinal`, `occurrenceCount`, and `source`, followed by only the
code-specific keys in this table. `source` is
`{sourceStory, sourceStoryOrdinal}`. Main/comments/footnotes/endnotes use
ordinal 0; header/footer use physicalStoryOrdinal `0..383`.

| Failure / exact code | Array | Space / ordinal | Source | Extra keys | Disposition and precedence |
| --- | --- | --- | --- | --- | --- |
| second exact-type record / `COMMENT_RELATIONSHIP_AMBIGUOUS` | comment | relationship / second record `0..1023` | main/0 | none | selector error; wins before validating either record |
| sole external / `COMMENT_RELATIONSHIP_EXTERNAL` | comment | relationship / record ordinal | main/0 | `relationshipId`, `rawTarget` | selector error |
| unsupported mode / `COMMENT_RELATIONSHIP_INVALID_TARGET_MODE` | comment | relationship / record ordinal | main/0 | `relationshipId`, `rawTarget`, `targetMode` | selector error |
| target >256 bytes / `COMMENT_RELATIONSHIP_TARGET_LIMIT_EXCEEDED` | comment | relationship / record ordinal | main/0 | `relationshipId`, `rawTargetByteLength` | before normalization; raw target omitted |
| unsafe/failed normalize / `COMMENT_RELATIONSHIP_UNSAFE_TARGET` | comment | relationship / record ordinal | main/0 | `relationshipId`, `rawTarget` | before source inspection |
| prior source incomplete / `COMMENT_SOURCE_PARTITION_INCOMPLETE` | comment | source / canonical source `0..386` | exact source | none | before reference/part work |
| absent relationship plus first reference / `COMMENT_RELATIONSHIP_REQUIRED` | comment | reference / first element `0..4095` | exact source | none | element presence wins before ID/limit reads |
| no indexed target / `COMMENT_PART_MISSING` | comment | relationship / selected record ordinal | comments/0 | `relationshipId`, `normalizedPartPath` | before metadata charging |
| side selected part 257 / `COMMENT_SELECTED_PART_LIMIT_EXCEEDED` | comment | relationship / selected ordinal | comments/0 | identity/path | before size checks |
| triple selected part 769 / `COMMENT_TRIPLE_SELECTED_PART_LIMIT_EXCEEDED` | comment | relationship / selected ordinal | comments/0 | identity/path | after side part count, before size checks |
| compressed >8,388,608 / `COMMENT_PART_COMPRESSED_LIMIT_EXCEEDED` | comment | relationship / selected ordinal | comments/0 | identity/path | before decompression |
| expanded >16,777,216 / `COMMENT_PART_EXPANDED_LIMIT_EXCEEDED` | comment | relationship / selected ordinal | comments/0 | identity/path | after compressed test, before decompression |
| ratio >100 or invalid zero denominator / `COMMENT_PART_RATIO_LIMIT_EXCEEDED` | comment | relationship / selected ordinal | comments/0 | identity/path | after part sizes, before cumulative tests |
| side compressed >16,777,216 / `COMMENT_CUMULATIVE_COMPRESSED_LIMIT_EXCEEDED` | comment | relationship / selected ordinal | comments/0 | identity/path | before decompression |
| side expanded >33,554,432 / `COMMENT_CUMULATIVE_EXPANDED_LIMIT_EXCEEDED` | comment | relationship / selected ordinal | comments/0 | identity/path | after side compressed |
| triple compressed >50,331,648 / `COMMENT_TRIPLE_COMPRESSED_LIMIT_EXCEEDED` | comment | relationship / selected ordinal | comments/0 | identity/path | after side expanded |
| triple expanded >100,663,296 / `COMMENT_TRIPLE_EXPANDED_LIMIT_EXCEEDED` | comment | relationship / selected ordinal | comments/0 | identity/path | after triple compressed |
| extraction length/CRC/deflate / `COMMENT_PART_EXTRACTION_FAILED` | comment | relationship / selected ordinal | comments/0 | identity/path | after metadata charge; before UTF-8 |
| invalid UTF-8 / `COMMENT_PART_INVALID_UTF8` | comment | relationship / selected ordinal | comments/0 | identity/path | before parse |
| malformed XML / `COMMENT_PART_INVALID_XML` | comment | relationship / selected ordinal | comments/0 | identity/path | before ID reads |
| depth 129 / `COMMENT_PART_XML_DEPTH_LIMIT_EXCEEDED` | comment | relationship / selected ordinal | comments/0 | identity/path | beats event/root; no ID reads |
| event 500,001 with side/triple remaining >500,000 / `COMMENT_PART_XML_EVENT_LIMIT_EXCEEDED` | comment | relationship / selected ordinal | comments/0 | identity/path | per-part crossing |
| event exceeding remaining side allowance / `COMMENT_CUMULATIVE_XML_EVENT_LIMIT_EXCEEDED` | comment | relationship / selected ordinal | comments/0 | identity/path | when side remaining is the minimum |
| event exceeding remaining triple allowance / `COMMENT_TRIPLE_XML_EVENT_LIMIT_EXCEEDED` | comment | relationship / selected ordinal | comments/0 | identity/path | when triple remaining is the strict minimum; side wins a tie |
| wrong expanded root / `COMMENT_PART_ROOT_MISMATCH` | comment | relationship / selected ordinal | comments/0 | identity/path | after complete parse; before ID reads |

Every row makes the side `not_evaluated`, counts zero, and stops all later
comment-side work. `identity/path` means exactly `relationshipId` and
`normalizedPartPath`; it is not optional shorthand in the wire grammar.
Metadata tests occur in displayed order. Depth failure wins over event failure
at the same parser transition; side cumulative events win a side/triple tie.

Semantic issue fields and ordinals are:

| Code | Space / ordinal | Source | Exact extra keys |
| --- | --- | --- | --- |
| `COMMENT_REFERENCE_ID_MISSING` | reference / occurrence `0..4095` | exact reference source | none |
| `COMMENT_REFERENCE_ID_MALFORMED` | reference / occurrence | exact source | `rawId` |
| `COMMENT_REFERENCE_ID_TOO_LONG` | reference / occurrence | exact source | `rawIdByteLength` |
| `COMMENT_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED` | reference / `4096` | candidate source | none |
| `COMMENT_UNIQUE_REFERENCE_ID_LIMIT_EXCEEDED` | reference / candidate occurrence | candidate source | `canonicalId` |
| `COMMENT_DEFINITION_ID_MISSING` | definition / direct ordinal `0..4095` | comments/0 | none |
| `COMMENT_DEFINITION_ID_MALFORMED` | definition / direct ordinal | comments/0 | `rawId` |
| `COMMENT_DEFINITION_ID_TOO_LONG` | definition / direct ordinal | comments/0 | `rawIdByteLength` |
| `COMMENT_DEFINITION_LIMIT_EXCEEDED` | definition / `4096` | comments/0 | none |
| `COMMENT_DEFINITION_NOT_DIRECT` | definition / event ordinal `0..4095` | comments/0 | `canonicalId` |
| `COMMENT_NON_DIRECT_DEFINITION_LIMIT_EXCEEDED` | definition / `4096` | comments/0 | none |
| `COMMENT_DEFINITION_DUPLICATE` | definition / second direct ordinal | comments/0 | `canonicalId` |
| `COMMENT_DEFINITION_MISSING` | reference / first occurrence for ID | exact first source | `canonicalId` |

Malformed `rawId` appears only at ≤64 bytes. Overlong raw bytes and digests are
never emitted. Semantic failures with complete scans produce `failed` and exact
counts; semantic limit codes produce `not_evaluated`/zero and stop later sides.
The strict decoder enforces relationship record ordinals in `0..1023`, source
ordinals in `0..386`, ordinary reference/definition ordinals in `0..4095`, and
the three semantic limit sentinels at exactly `4096`. Every ordinary issue has
`occurrenceCount >= 1`; non-coalescing codes require exactly 1, while duplicate
definition and missing definition counts are bounded by the emitted definition
and reference inventories respectively. Terminal issues require aggregate
space, original side, ordinal 0, count 1, no source, no extras, and the exact
terminal zero-evidence response shape.
`COMMENT_UNIQUE_REFERENCE_ID_LIMIT_EXCEEDED` requires the crossing
`canonicalId`, an ordinary reference ordinal in `0..4095`, and
`not_evaluated` with all inventory counts zero. Reference-occurrence admission
runs first, so equal 4,096 limits make this crossing unreachable today while
keeping its protocol grammar exact.
Coalescing includes every semantic field except detail/count/first ordinal,
sums counts, and keeps the minimum ordinal; occurrence-specific lexical and
limit issues include occurrence ordinal in their key. Sorting is side, space
rank relationship/source/reference/definition/aggregate, ordinal, source rank
main/header/footer/footnotes/endnotes/comments, source ordinal, code, extras.

### 11. Canonical protocol-v6 JSON grammar and equations

Object key order is normative at every object level and is strict
lexicographic UTF-8 key order, matching canonical `Json.compress` output.
The decoder scans raw JSON before `JSON.parse`, rejects duplicate keys and
non-canonical order recursively, and only then applies typed shape checks.
Dynamic strings are bounded as in v5:
detail 256, relationship ID 128, target/path 256, raw/canonical ID 64, and
target mode 16 UTF-8 bytes.

The complete top-level key order is:

```text
checker, commentIntegrityIssues, commentInventories, commentStory,
fixedStories, fixedStoryIssues, noteIntegrityIssues, noteInventories,
noteStories, passed, presenceMismatches, protocolVersion,
referenceSourcePartitions, relationshipSlots, relationshipStories,
selectionIssues
```

The first thirteen fields retain the exact protocol-v5 grammar and equations;
`protocolVersion` is exactly `6` and checker is exactly
`safe-docx-lean-conventional-main-comment-integrity-checker`. The final three
fields use the grammar below. No unknown key, duplicate key, alternate key
order, omitted field, `null` array, or extra issue field is legal.

```text
CommentRelationship :=
 {"relationshipId":String128,
  "relationshipRecordOrdinal":Nat0_1023,
  "normalizedPartPath":String256}

CommentStorySide :=
 {"status":"absent"|"passed"|"failed"|"not_evaluated",
  "relationship":null|CommentRelationship,
  "partPresent":Bool}

CommentStory :=
 {"status":"passed"|"failed"|"not_evaluated",
  "original":CommentStorySide,
  "revised":CommentStorySide,
  "compared":CommentStorySide,
  "parsedTokenCounts":{"original":Nat0_500000,
                       "revised":Nat0_500000,
                       "combined":Nat0_500000}}

CommentInventory :=
 {"side":"original"|"revised"|"compared",
  "status":"passed"|"failed"|"not_evaluated",
  "relationship":null|CommentRelationship,
  "referenceOccurrences":Nat0_4096,
  "uniqueReferenceIds":Nat0_4096,
  "definitions":Nat0_4096,
  "nonDirectDefinitions":Nat0_4096,
  "unreferencedDefinitions":Nat0_4096}
```

There are exactly three inventories in side order. Equations:

- absent side: side status `absent`, relationship null, partPresent false,
  token count 0; inventory `passed`, relationship null, all counts 0;
- evaluated pass/fail: side and inventory status agree, relationship is the
  same non-null identity, partPresent true, token count equals retained parsed
  tokens, all counts equal parsed evidence,
  `uniqueReferenceIds ≤ referenceOccurrences` and
  `unreferencedDefinitions ≤ definitions`;
- not evaluated before index presence: relationship is the selector identity
  if selection succeeded, else null; partPresent false; token/counts zero;
- not evaluated after index presence: relationship is non-null, partPresent
  true, token/counts zero;
- top story `not_evaluated` iff any side is not evaluated; otherwise `failed`
  iff any side failed; otherwise `passed`;
- response `passed` iff existing v5 pass equations hold, story and all three
  inventories pass, and all three issue arrays are empty.

An ordinary `CommentIssue` has the base keys and exactly the extras from
section 9. A terminal issue has exactly:

```json
{"code":"COMMENT_ISSUE_LIMIT_EXCEEDED|COMMENT_EVIDENCE_STRING_BUDGET_EXCEEDED",
 "side":"original","kind":"comments","detail":"...",
 "ordinalSpace":"aggregate","firstOccurrenceOrdinal":0,"occurrenceCount":1}
```

It has no source or extras. Terminal collapse clears relationship
slots/stories and all ordinary issue arrays, retains fixed main only, reduces
existing partitions to main, marks both note stories, the comment story, all
six note inventories, and all three comment inventories not evaluated/zero,
and places exactly one terminal in `commentIntegrityIssues`.

### 12. Exact structural charging and envelopes

Define `dynamicEscapedStringBytes` as the byte length of every dynamic JSON
string including quotes after escaping. Define `structuralBytes j :=
j.compress.toUTF8.size - dynamicEscapedStringBytes j`. The concrete encoder
must prove these per-record maxima; every key, delimiter, numeric digit,
boolean, null, and quote is in one row:

| Record/field class | keys and delimiters | bounded numerics/literals | unit total | units |
| --- | ---: | ---: | ---: | ---: |
| three new top-level member names and separators | 64 | 0 | 64 | 1 |
| new inventory/issue array brackets and at most 510 comment-issue separators | 512 | 0 | 512 | 1 |
| comment-story outer keys/braces | 128 | 0 | 128 | 1 |
| comment-story status member | 24 | 8 | 32 | 1 |
| three named side members | 96 | 0 | 96 | 1 |
| one bound-shape CommentStorySide including CommentRelationship | 224 | 96 | 320 | 3 |
| parsedTokenCounts keys/braces | 208 | 48 | 256 | 1 |
| one CommentInventory excluding relationship | 448 | 192 | 640 | 3 |
| one bound-shape CommentRelationship inside inventory | 224 | 96 | 320 | 3 |
| ordinary comment issue | 464 | 176 | 640 | at most 511 shared |
| terminal comment issue | 464 | 176 | 640 | exactly 1, non-coexisting |

The ordinary per-code structural charges are also audited, rather than hidden
inside the 640 unit:

| Exact issue shape | Structural bytes |
| --- | ---: |
| base plus no extras: ambiguous, source-incomplete, relationship-required, missing-ID, occurrence/definition/non-direct limits | 512 |
| base plus one bounded numeric or string extra: target-limit, ID-malformed/too-long, unique-ID, non-direct, duplicate, missing-definition | 544 |
| base plus `relationshipId` and `rawTarget`, or identity/path | 576 |
| base plus `relationshipId`, `rawTarget`, and `targetMode` | 608 |
| existing v5 selection/note ordinary per-slot upper charge | 640 |
| source-less terminal shape | 640 |

The full code-to-shape assignment is the extras table in sections 10 and 11;
the structural audit fails if any code serializes keys not assigned there.
Unused bytes in a smaller issue's 640 admission slot cannot be transferred to
strings or another record, so this is a per-record upper charge rather than a
free reserve.

Thus new fixed ordinary structure is exactly:

```text
64 + 512 + 128 + 32 + 96 + (320 × 3) + 256
   + (640 × 3) + (320 × 3)
= 4,928 bytes
```

Comment issues do not add 511 slots. Each fits the existing 640-byte issue unit,
and the single shared capacity is rewritten as:

```text
selectionIssues.length
+ noteIntegrityIssues.length
+ commentIntegrityIssues.length ≤ 511
```

Aggregate admission is selection, note, then comment. The near-envelope witness
contains nonzero prefixes in all three arrays totaling 511. Existing v5
ordinary issue structure `(640 × 511)` therefore remains unchanged. All dynamic
comment strings coexist inside, rather than in addition to, the existing exact
1,571,840-byte ordinary string budget.

The protocol-v6 ordinary legal upper envelope is derived by charge
inequalities, not claimed as an attained serialized maximum:

```text
serialized ordinary v6 bytes
≤ 2,619,776 inherited v5 ordinary upper bound
  +   4,928 proved v6 fixed-structure upper charge
= 2,624,704 protocol-v6 ordinary legal upper envelope
```

The terminal issue uses the existing non-coexisting 640 structural and 1,024
escaped-string charges. The legal envelopes are:

```text
ordinaryLegalEnvelope + terminalStructuralCharge + terminalStringCharge
= 2,624,704 + 640 + 1,024
= 2,626,368 legal terminal JSON limit

2,626,368 + 1 LF = 2,626,369 legal stdout limit
8,388,608 - 2,626,369 = 5,762,239 bytes below hard cap
```

`ProtocolV6StructuralChargeAudit.lean` serializes bound-numeric empty-string
instances and proves each row as an inequality.
`ProtocolV6OrdinaryEnvelopeWitness.lean` combines the inherited v5 bounded
structure, all comment fields, nonempty selection/note/comment issue arrays
totaling exactly 511, and exactly 1,571,840 charged ordinary string bytes. It
strict-decodes, records its actual serialized byte length, and proves only that
length `≤ 2,624,704`; it does not claim equality or global maximality.
Separate terminal fixtures strict-decode both exact terminal codes and prove
their actual lengths satisfy the exact legal limit equations
`jsonBytes ≤ 2,626,368` and `stdoutBytes = jsonBytes + 1 ≤ 2,626,369`.
The terminal limits are not claimed as attained shapes. No unallocated reserve
exists.

### 13. Independent projection and immutable runtime

`independentProtocolV6Projection` is a byte-native field-by-field encoder over
`TypedProtocolV6Response`, implemented in the no-import typed semantic module.
It encodes all 16 protocol-v6 fields in canonical order: `checker`,
`commentIntegrityIssues`, `commentInventories`, `commentStory`, `fixedStories`,
`fixedStoryIssues`, `noteIntegrityIssues`, `noteInventories`, `noteStories`,
`passed`, `presenceMismatches`, `protocolVersion`,
`referenceSourcePartitions`, `relationshipSlots`, `relationshipStories`, and
`selectionIssues`. Its recursive value dependency closure excludes
`runRequestCoreV6`, every `String`/JSON operation, all production JSON builders,
field helpers, sorters, coalescers, budget functions, terminal functions, and
v5/v6 serialization helpers.

`typedRequestOfProduction` separately converts retained package/index,
extraction, parser, source-scan, comment-scan, and inherited semantic
evaluation records into typed inputs. It never decodes `result.response` or
uses `protocolV6Projection` as an expected typed response.
`ProtocolV6JsonProjectionOf` then requires
`response.compress.toUTF8.data.toList =
independentProtocolV6Projection typedResponse`. Thus the production response
does not supply its own expected value. Realizable witnesses mutate production
builders and compare against this complete projection. Additional proof
witnesses show that omitting/mutating `commentIntegrityIssues` and mutating an
inherited field change canonical bytes.

The TypeScript supervisor creates one mode-0700 private root without invoking a
PATH-resolved `chmod`, writes each retained package byte array once, passes only
snapshot paths to Lean, waits for child close, and recursively removes the root
on success, checker failure, timeout, stdout overflow, and decoder failure.
Cleanup failure is surfaced. Production evidence retains package bytes, binary
index offsets, compressed slice, decompressed bytes, parsed events, and
one-read/one-write/one-extract/one-parse/one-scan counters. External deflate
remains an explicit trusted boundary; CRC is an extraction check, never proof
of source provenance.

### 14. Public claim and real evidence

The strongest public sentence is:

> For the original, revised, and compared inplace DOCX packages, every
> namespace-resolved legacy comment reference in the verified main, selected
> header/footer, footnote, and endnote stories resolves to exactly one direct
> legacy comment definition in the Comments part selected by the fixed main
> document relationships.

The certificate immediately scopes this to Transitional legacy comments and
lists the exclusions. A real source-derived fixture must contain at least one
reference in every source class and at least five direct definitions per side
before any mutation. Relocation changes both relationship target and ZIP entry.
Compared-only mutations cover every issue family while asserting unrelated
story identities and original/revised evidence remain stable. LibreOffice is
not invoked.

## Risks / Trade-offs

- v6 is a private breaking migration; strict rejection avoids silently
  interpreting incomplete v5 evidence.
- This proves package-local legacy identity, not visual anchor correctness.
- The larger envelope is bounded below 3 MiB, but worst-case fixtures and
  concrete charge proofs are mandatory before implementation may ship.

## Migration Plan

1. Approve this proposal and independent review.
2. Implement proofs and v6 production core in the dedicated worktree.
3. Migrate strict decoder/tests and additive certificate projection.
4. Run focused, real-DOCX, axiom/dependency, conformance, and full
   non-LibreOffice gates.
5. Merge with `Refs #672`; close only after independent post-merge smoke.

## Open Questions

None. Any change to theorem propositions, source set, issue grammar, limits,
terminal shape, protocol fields, or output envelope requires proposal revision
before implementation.
