## Context

Protocol v6 already retains all data needed for legacy comment range topology:

- one canonical `CommentSourceSet` per side;
- ordered `StorySlot` realizations for main, selected header/footer, present
  footnote, and present endnote stories;
- each realization's complete `visitedEvents`;
- one relationship-selected, request-bound Comments realization; and
- the direct-definition and reference integrity evidence introduced by
  `verify-lean-comment-reference-integrity`.

The missing property is association and event-order topology for
`w:commentRangeStart`, `w:commentRangeEnd`, and `w:commentReference`. The change
extends that proof boundary. It does not discover or parse any additional
package content and does not model TypeScript comparison or Word layout.

## Goals / Non-Goals

### Goals

- Verify point and ranged legacy comments over every retained physical story.
- Bind range evidence to the same retained package, selected Comments
  realization, source set, source scans, and one-call semantic scan used by
  production.
- Keep scanning linear, bounded, stack-safe, deterministic, and fail-closed.
- Preserve exact independent semantics, protocol projection, resource
  accounting, strict decoding, and public certificate compatibility.
- State the standards boundary and stronger Safe-DOCX profile honestly.

### Non-Goals

- Modern/threaded comments, `commentsExtended.xml`, `commentsIds.xml`,
  `people.xml`, replies, parent graphs, durable IDs, or resolved state.
- Comment author, date, initials, content, formatting, rendering, or visual
  layout.
- Strict namespaces, full OPC/content-type/schema validation, repair, or
  rebuild-mode certification.
- Requiring nesting, forbidding crossing ranges, requiring endpoints to share a
  paragraph, or imposing an end-to-reference event-order rule.

## Standards Boundary

The exercised normative surface is ECMA-376 5th edition Part 1:

- §17.13.4.3: `w:commentRangeEnd`;
- §17.13.4.4: `w:commentRangeStart`;
- §17.13.4.5: `w:commentReference`; and
- §17.18.10: `ST_DecimalNumber`.

The existing selected Comments realization inherits the v6 evidence for:

- §17.13.4.2: direct `w:comment` definitions; and
- §17.13.4.6: the Transitional `w:comments` root.

The Transitional XSD requires `w:id` on the range markers through
`CT_Markup`/`CT_MarkupRange` and types it as `ST_DecimalNumber`. Those ID
typing and element-semantics claims are eligible for `@conformance` evidence.
ECMA prose, however, permits an unmatched start or end to act as a point
anchor. The Safe-DOCX rule that a nonempty endpoint set must contain exactly
one start and one end is therefore a deliberate stronger verification-profile
constraint. It must be recorded as a conformance gap/profile rule and must not
be presented as ECMA-required pairing.

The strongest honest public claim is:

> For each original, revised, and compared inplace DOCX package, every
> namespace-resolved Transitional legacy comment ID admitted from the verified
> main, selected header/footer, footnote, and endnote stories has exactly one
> reference and exactly one direct definition in the relationship-selected
> Comments part. It is either a point comment with no range markers or satisfies
> the stronger Safe-DOCX profile of one start and one later end in the same
> retained physical story as its reference.

This is not a claim of complete ECMA-376 conformance, visual-range correctness,
or support for all ECMA-permitted unmatched-marker point anchors.

## Decisions

### 1. Protocol v7 changes evidence, not package inputs

`VerifierRequestV7` keeps the same three immutable original, revised, and
compared DOCX snapshot paths and uses `protocolVersion: 7`. The private response
keeps exactly these 16 lexicographically ordered top-level fields:

```text
checker, commentIntegrityIssues, commentInventories, commentStory,
fixedStories, fixedStoryIssues, noteIntegrityIssues, noteInventories,
noteStories, passed, presenceMismatches, protocolVersion,
referenceSourcePartitions, relationshipSlots, relationshipStories,
selectionIssues
```

The inherited field meanings remain unchanged except where comment inventory
and issue grammar is explicitly extended below. The checker identity becomes
`safe-docx-lean-conventional-main-comment-range-integrity-checker`.
Raw TypeScript decoding accepts v7 only; a v6 runtime report is `not_run`.
`DocumentIntegrityCertificate.protocolVersion` remains `1`.

No top-level range field is added. The three `commentInventories` gain two
counts, and `commentIntegrityIssues` gains exact range issue variants. This
keeps the top-level field count at 16 while still making all new evidence
mandatory and strictly decoded.

### 2. Retained source and Comments evidence is the only input

For each side, source order remains:

```text
0       fixed word/document.xml
1..N    selected header/footer physical stories in physicalStoryOrdinal order
N+1     selected present footnotes story
N+2     selected present endnotes story
```

The maximum remains 387 sources. Main, header, footer, footnote, and endnote
are separate physical stories even if content or canonical IDs match.

The implementation reuses:

- `canonicalCommentSourceSet`/`CommentSourceSet`;
- `SideScanEvidence.realizations`;
- each realization's `StorySlot` and `visitedEvents`;
- the selected `CommentStoryRealization`; and
- the selected direct-definition events already admitted in v6.

It must not read a package again, rewrite a snapshot, extract or decompress a
part again, parse XML again, walk relationships again, follow a comment
reference recursively, or discover a new story. Comments content remains a
definition story and is not a range/reference source.

The current `sourceEvents` construction through `realizations.zipIdx.map` is
not the v7 execution path. V7 uses tail-recursive loops directly over retained
realizations in source order, carrying source and event ordinals explicitly
and walking each retained `visitedEvents` sequence at most once. A crossing
returns immediately from the current event loop and prevents entry into later
stories. The retained evidence records processed event/story counts so this
early stop is structurally witnessed rather than inferred from timing. Any
typed mirror may represent the same evidence structurally, but production may
not build copied whole-event lists merely to assign ordinals.

### 3. One bounded event-order scan collects all source markers

One retained scan invocation per side processes starts, ends, and references
together. Its state contains:

```text
current source identity
current source event ordinal
global marker occurrence ordinal
reference occurrence count
range-start occurrence count
range-end occurrence count
unique canonical ID count
bounded per-ID association table
first crossing, if any
```

The walk is tail-recursive or iterative over the retained event arrays. It
does not use `zipIdx`, convert event arrays to copied lists, or run
`filter`/`filterMap` over all prior events for each event. Per-ID lookup uses
the repository's bounded indexed/map representation with insertion and lookup
cost independent of the number of previously visited XML events; final
deterministic projection sorts only the bounded issue/evidence records, not the
source event stream.

Every matching expanded-name start element is counted before ID admission.
The scanner parses `w:id` through the existing 64-UTF-8-byte bounded XML Schema
whitespace-collapse and canonical `ST_DecimalNumber` policy. Missing,
malformed, and overlong IDs remain distinct. Numeric aliases such as `1`,
`+001`, and whitespace-collapsed forms identify the same canonical ID.

The semantic maxima remain:

| Counter | Maximum admitted |
| --- | ---: |
| references | 4,096 |
| range starts | 4,096 |
| range ends | 4,096 |
| distinct canonical comment IDs | 4,096 |
| direct definitions | 4,096 |
| non-direct definitions | 4,096 |

The first crossing stops source semantic scanning, records the exact
source/event/occurrence counter, makes that side `not_evaluated`, zeros all
wire inventory counts, and prevents all later side comment work under the
existing global-stop policy. XML event/resource limits inherited from v6 still
apply before this scan.

### 4. Canonical per-ID topology is exact

For every canonical ID observed in a reference or range marker on a complete
evaluated side:

1. Exactly one direct definition exists in the selected Comments realization.
2. Exactly one `w:commentReference` exists across the retained source set.
3. Zero starts and zero ends is a valid point comment.
4. Otherwise exactly one start and exactly one end exist.
5. For a ranged comment, start, end, and reference have the same canonical ID
   and the same retained physical `StorySlot`.
6. Within that story, `start.eventOrdinal < end.eventOrdinal`.

No paragraph ordinal participates. A start and end may be in the same
paragraph or in different paragraphs. Two valid IDs may cross:

```text
start(A), start(B), end(A), end(B)
```

No stack-nesting predicate is defined, and crossing ranges are not rejected.
The unique reference may occur anywhere in the same physical story; v7 adds no
reference-versus-end order rule because this proposal does not claim one from
the cited sections.

Repeated references fail even when definitions resolve. A range marker whose
ID has no unique reference or direct definition fails association. A reference
and endpoints split between physical stories fail, including two different
header/footer physical stories or a main/note split. Canonically aliased marker
IDs collide before cardinality and association checks.

A unique direct definition whose ID never appears in a reference, start, or end
remains a valid unreferenced definition, preserving the v6 contract and its
`unreferencedDefinitions` inventory. Duplicate or non-direct definitions remain
invalid under the inherited rules.

The deliberate profile consequence is explicit: one start with no end, or one
end with no start, fails even though ECMA permits that unmatched marker to act
as a point anchor. A comment with no endpoints remains accepted.

### 5. Complete and incomplete evidence remains fail-closed

V7 preserves v6 selection, realization, package-resource, source-completeness,
and global-stop precedence. Topology is evaluated only when:

- the canonical retained source partition is complete;
- Comments selection/absence is resolved;
- a required selected Comments part is loaded, decoded, parsed, root-checked,
  and completely scanned;
- retained source realizations are exact and fully scanned; and
- the single v7 marker scan completes without a semantic crossing.

An absent Comments relationship plus no starts, ends, or references remains a
valid absent side. An absent relationship plus any of those marker elements
emits `COMMENT_RELATIONSHIP_REQUIRED` at the first marker in event order before
reading its ID.

Incomplete prerequisites, a failed required realization, or a resource/semantic
crossing expose no partial parsed topology. They produce `not_evaluated`,
empty internal marker tables, and this zero inventory:

```text
referenceOccurrences = 0
uniqueReferenceIds = 0
rangeStartOccurrences = 0
rangeEndOccurrences = 0
definitions = 0
unreferencedDefinitions = 0
nonDirectDefinitions = 0
```

### 6. Independent typed semantics is the specification

The no-import typed semantic module is extended with bounded bytes, expanded
names, typed events, typed physical-story identity, marker kind, marker
occurrence, per-ID association state, inventories, issues, and
`TypedRequestV7`/`TypedProtocolV7Response`. It does not mention `String`,
`String.toUTF8`, `Lean.Json`, `IO`, production scanners/builders, success bits,
or LeanSpike declarations.

The independent source scanner is defined by structural recursion over typed
story/event values and explicit fuel/counters. Its result records exact
event-order occurrences and the first crossing. The semantic relation binds
the result to the same typed source sequence once; it does not characterize
correctness by calling the executable scanner or by accepting a caller-supplied
inventory.

The core request-derived functions and predicates are:

```lean
typedPackageAt :
  TypedRequestV7 → Side → TypedPackageView
selectTypedCommentV7 :
  TypedPackageView →
    Except TypedCommentSelectionFailure (Option TypedSelectedCommentIdentity)
realizeTypedCommentV7 :
  TypedRequestV7 → Side →
    Except TypedCommentRealizationFailure (Option TypedCommentRealization)
canonicalTypedCommentSourcesV7 :
  TypedRequestV7 → Side → List TypedStorySource
typedMarkerScanInputV7 :
  TypedRequestV7 → Side → TypedMarkerScanInput
scanTypedCommentMarkersV7 :
  TypedMarkerScanInput → TypedMarkerScanEvidence
typedDefinitionsV7 :
  TypedRequestV7 → Side → List TypedCommentDefinition
evaluateTypedCommentSideV7 :
  TypedRequestV7 → Side → TypedSideCommentEvaluationV7
typedAllCommentRangeSidesPassV7 :
  TypedRequestV7 → Bool
canonicalTypedResponseV7 :
  TypedRequestV7 → TypedProtocolV7Response
independentProtocolV7Projection :
  TypedProtocolV7Response → List UInt8

TypedRequestBoundPackageOf :
  TypedRequestV7 → Side → TypedPackageView → Prop
TypedSelectionToRealizationV7Of :
  TypedRequestV7 → Side → TypedSideCommentEvaluationV7 → Prop
TypedCompleteCommentSourceSetV7Of :
  TypedRequestV7 → Side → List TypedStorySource → Prop
TypedCommentMarkerScanOf :
  TypedRequestV7 → Side → TypedMarkerScanEvidence → Prop
TypedCommentIdTopologyOf :
  List TypedCommentDefinition → TypedMarkerScanEvidence →
    CanonicalDecimalId → Prop
TypedPackageCommentRangeIntegrity :
  List TypedCommentDefinition → TypedMarkerScanEvidence → Prop
TypedIncompleteCommentRangeZeroOf :
  Side → TypedSideCommentEvaluationV7 → Prop
TypedCommentRangeAggregatePassOf :
  TypedRequestV7 → TypedProtocolV7Response → Prop
TypedSerializedResponseV7Of :
  TypedProtocolV7Response → List UInt8 → Prop
```

`TypedCommentIdTopologyOf` encodes the exact point/ranged disjunction and
physical-story/start-before-end rules. `TypedPackageCommentRangeIntegrity`
quantifies over the union of IDs from definitions, references, starts, and
ends. Its definition-only branch permits one unreferenced direct definition,
while every ID with a source occurrence uses the point/ranged topology
predicate. Thus an endpoint-only or reference-only ID cannot disappear from the
proof domain.

`typedMarkerScanInputV7 request side` is not a caller-provided marker list. Its
definition projects the exact package/index-bound canonical `StorySlot`
sequence and each slot's retained `visitedEvents` from
`canonicalTypedCommentSourcesV7 request side`. `typedDefinitionsV7 request
side` projects the direct definitions from the exact selected, request-bound
Comments realization returned by `realizeTypedCommentV7 request side`.
`canonicalTypedResponseV7 request` computes all inventories, issues, status
equations, terminal collapse, and inherited fields from those functions. No
theorem below accepts topology integrity, an inventory, an issue list, or an
expected response as an assumption.

The exact seven semantic targets and complete propositions are:

```lean
theorem typed_comment_selector_result_v7_sound
    (request : TypedRequestV7) (side : Side) :
    TypedRequestBoundPackageOf request side (typedPackageAt request side) ∧
    TypedCommentSelectionResultOf (typedPackageAt request side)
      (selectTypedCommentV7 (typedPackageAt request side))

theorem typed_comment_selection_to_realization_v7_sound
    (request : TypedRequestV7) (side : Side) :
    TypedSelectionToRealizationV7Of request side
      (evaluateTypedCommentSideV7 request side)

theorem typed_admitted_comment_source_set_v7_complete
    (request : TypedRequestV7) (side : Side)
    (hEvaluated :
      (evaluateTypedCommentSideV7 request side).status ≠ .notEvaluated) :
    TypedCompleteCommentSourceSetV7Of request side
      (canonicalTypedCommentSourcesV7 request side) ∧
    (typedMarkerScanInputV7 request side).stories =
      canonicalTypedCommentSourcesV7 request side

theorem typed_comment_marker_scan_evidence_exact
    (request : TypedRequestV7) (side : Side) :
    TypedCommentMarkerScanOf request side
      (retainedOrIndependentTypedMarkerScanV7 request side) ∧
    (retainedOrIndependentTypedMarkerScanV7 request side).inputStories =
        canonicalTypedCommentSourcesV7 request side

theorem typed_package_comment_range_integrity_sound
    (request : TypedRequestV7) (side : Side)
    (hCheck :
      checkTypedPackageCommentRangeIntegrity
        (typedDefinitionsV7 request side)
        (retainedOrIndependentTypedMarkerScanV7 request side) = true) :
    TypedPackageCommentRangeIntegrity
      (typedDefinitionsV7 request side)
      (retainedOrIndependentTypedMarkerScanV7 request side)

theorem typed_incomplete_comment_range_zero_evidence_sound
    (request : TypedRequestV7) (side : Side)
    (hIncomplete :
      (evaluateTypedCommentSideV7 request side).status = .notEvaluated) :
    TypedIncompleteCommentRangeZeroOf side
      (evaluateTypedCommentSideV7 request side)

theorem typed_comment_range_aggregate_pass_sound
    (request : TypedRequestV7)
    (hPass : typedAllCommentRangeSidesPassV7 request = true) :
    let response := canonicalTypedResponseV7 request
    let bytes := independentProtocolV7Projection response
    TypedCommentRangeAggregatePassOf request response ∧
    TypedSerializedResponseV7Of response bytes
```

`TypedCommentRangeAggregatePassOf` includes, for every side, the exact
request-bound package relation, selector/realization relation, passed status,
complete source relation, marker-scan relation, definition projection,
`TypedPackageCommentRangeIntegrity`, and inherited v6 obligations. The
`hPass` premise is the canonical Boolean evaluation of those three side
statuses; it is required because the former unconditional proposition was
inconsistent with invalid request values. Adversarial theorems instantiate
concrete canonical requests whose main/header event sequences produce
duplicate-reference, orphan-endpoint, reversed-range, and cross-story scans,
and prove without scan-equality premises that the aggregate predicate cannot
hold for each. A compiled inhabitance witness equates every retained
`inputStories` value to that request's canonical source sequence. Thus the
aggregate theorem cannot pass by constructing an unrelated response or by
omitting topology integrity. Each target and its complete transitive
dependency closure must print an empty normalized axiom set. The repository
remains zero-`sorry`. The four aggregate rejection witnesses and their
canonical inhabitance witness are exact empty-axiom audit targets and use only
kernel-checked proof reduction; `native_decide` is forbidden throughout the
protocol-v7 semantic and witness artifacts.

The five executable bridges and one production refinement have these exact
signatures and complete propositions:

```lean
theorem executable_comment_source_set_v7_refines_typed
    (request : VerifierRequestV7) (side : VerifierSide)
    (set : CommentSourceSet) (scans : SideScanEvidence)
    (typedRequest : TypedRequestV7)
    (hSet :
      canonicalCommentSourceSet (request.packageView side) side
        (request.noteEvaluation side) = set)
    (hScans : request.retainedSourceScans side = scans)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hCheck :
      executableCommentSourceSetV7RefinementCheck
        request side set scans typedRequest = true) :
    ExecutableCommentSourceSetV7RefinesTyped
      request side set scans typedRequest

theorem executable_comment_marker_scan_v7_refines_typed
    (request : VerifierRequestV7) (side : VerifierSide)
    (set : CommentSourceSet) (scans : SideScanEvidence)
    (evidence : ParsedCommentRangeEvidence)
    (typedRequest : TypedRequestV7)
    (hSet :
      canonicalCommentSourceSet (request.packageView side) side
        (request.noteEvaluation side) = set)
    (hScans : request.retainedSourceScans side = scans)
    (hRun :
      retainedCommentMarkerScanForRelationshipV7
        ((request.core.packageRecord
          (noteSideOfCommentSide side)).commentEvidence.identity.isSome)
        set scans = .ok evidence)
    (hRetained :
      request.retainedCommentRangeScanResult side = .ok evidence ∧
      request.commentRangeScanInvocationCount side = 1)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hCheck :
      executableCommentMarkerScanV7RefinementCheck
        request side set scans evidence typedRequest = true) :
    ExecutableCommentMarkerScanV7RefinesTyped
      request side set scans evidence typedRequest

theorem executable_comment_definition_realization_v7_refines_typed
    (request : VerifierRequestV7) (side : VerifierSide)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization)
    (typedRequest : TypedRequestV7)
    (hSelected :
      selectConventionalMainCommentV7 (request.packageView side) =
        .ok (some selected))
    (hRun :
      realizeSelectedCommentV7 request side selected = .ok realization)
    (hRetained :
      request.retainedCommentRealization side = some realization ∧
      request.commentExtractionInvocationCount side = 1 ∧
      request.commentParseInvocationCount side = 1)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hCheck :
      executableCommentDefinitionRealizationV7RefinementCheck
        request side selected realization typedRequest = true) :
    ExecutableCommentDefinitionRealizationV7RefinesTyped
      request side selected realization typedRequest

theorem executable_comment_incomplete_v7_refines_typed
    (request : VerifierRequestV7) (side : VerifierSide)
    (evaluation : SideCommentEvaluationV7)
    (typedRequest : TypedRequestV7)
    (hEvaluation :
      evaluateCommentSideV7 request side = evaluation)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hCheck :
      executableCommentIncompleteV7RefinementCheck
        request side evaluation typedRequest = true) :
    ExecutableCommentIncompleteV7RefinesTyped
      request side evaluation typedRequest

theorem executable_protocol_v7_utf8_json_refines_typed
    (request : VerifierRequestV7) (response : Json)
    (typedRequest : TypedRequestV7)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hResponse :
      response = protocolV7ResponseJson
        (canonicalRunRequestEvaluationV7 request))
    (hCheck :
      protocolV7JsonProjectionCheck
        response (canonicalTypedResponseV7 typedRequest) = true) :
    ProtocolV7JsonProjectionOf response
      (canonicalTypedResponseV7 typedRequest) ∧
    response.compress.toUTF8.data.toList =
      independentProtocolV7Projection
        (canonicalTypedResponseV7 typedRequest)

theorem production_run_request_core_v7_refinement_sound
    (request : RunRequestCoreRequestV7)
    (result : RunRequestCoreResultV7)
    (hRun : runRequestCoreV7 request = .ok result)
    (hPass : result.responsePassed = true) :
    ∃ typedRequest : TypedRequestV7,
      typedRequestOfRunRequestCoreV7 request result = some typedRequest ∧
      ProductionRunRequestV7RefinesSemanticOf
        request result typedRequest
          (canonicalTypedResponseV7 typedRequest)
          (independentProtocolV7Projection
            (canonicalTypedResponseV7 typedRequest)) ∧
      TypedCommentRangeAggregatePassOf typedRequest
        (canonicalTypedResponseV7 typedRequest) ∧
      ProtocolV7JsonProjectionOf result.response
        (canonicalTypedResponseV7 typedRequest) ∧
      result.response.compress.toUTF8.data.toList =
        independentProtocolV7Projection
          (canonicalTypedResponseV7 typedRequest) ∧
      result.stdout.data.toList =
        independentProtocolV7Projection
          (canonicalTypedResponseV7 typedRequest) ++ [10]
```

The conclusion predicates of the first four executable bridges include the
literal `hSet`, `hScans`, `hRun`, `hRetained`, `hSelected`, and `hEvaluation`
equations applicable to that bridge. They also equate the production package
bytes/index, selected Comments realization/direct definitions, ordered
`StorySlot` identities, each exact `visitedEvents`, and scan counters/results
to the corresponding fields derived from `typedRequest`. The protocol bridge
constructs its expected response only with `canonicalTypedResponseV7
typedRequest`; it never decodes `response` to obtain expected values.

`ProductionRunRequestV7RefinesSemanticOf` contains concrete source-set,
marker-scan, and definition-realization bridge instances for each actual side
of the request. `ProductionCommentEvidenceOf` retains the actual
`RetainedCommentMarkerScanRun`, including its exact source set, retained
scans, result equation, one-call invocation count, marker evidence, and
processed event/story counts. The production theorem obtains the bridge
instances from those retained operands and the selected Comments realization,
then binds them to the canonical typed response and bytes. Merely storing the
five bridge theorems as universally quantified implications does not satisfy
the production refinement.

Each executable bridge and the production theorem may use exactly the existing
foundational set `[propext, Classical.choice, Quot.sound]`, with the repository's
existing normalized six-name whole-file allowlist unchanged. Exact-signature,
module-provenance, recursive dependency, missing-required, forbidden-extra,
no-LeanSpike, and no-residual audits remain mandatory. No new axiom,
`opaque` shortcut, native oracle, or admitted theorem is allowed.

Every comment dependency or axiom audit entry point first builds the imported
project module from current source. Invoking an audit against a previously
compiled `.olean` without that build is not an accepted gate. A temporary
Lake-project regression must demonstrate that a stale direct import can pass
after its source is invalidated while the freshness-safe audit entry point
fails during its mandatory build.

Negative semantic witnesses reject an omitted story, substituted
`visitedEvents`, copied or reordered story identity, detached selected Comments
realization, injected marker inventory, endpoint-only ID hidden from the
domain, duplicate reference, orphan endpoint, reversed endpoints, cross-story
association, missing definition association, forged completion,
inherited-field drift, and encoder drift.

### 7. Protocol-v7 grammar and deterministic issues

All objects use canonical lexicographic UTF-8 key order. Raw JSON is checked
for duplicate/noncanonical keys before typed decoding. Unknown, missing, extra,
misordered, or incorrectly typed fields fail closed.

`CommentInventory` becomes:

```text
{"definitions":Nat0_4096,
 "nonDirectDefinitions":Nat0_4096,
 "rangeEndOccurrences":Nat0_4096,
 "rangeStartOccurrences":Nat0_4096,
 "referenceOccurrences":Nat0_4096,
 "relationship":null|CommentRelationship,
 "side":"original"|"revised"|"compared",
 "status":"passed"|"failed"|"not_evaluated",
 "uniqueReferenceIds":Nat0_4096,
 "unreferencedDefinitions":Nat0_4096}
```

There are exactly three inventories in original/revised/compared order. The
v6 equations are retained and extended so all marker counts equal the one-scan
evidence on evaluated sides and are zero on `not_evaluated` sides.

The source-ID limit counts the union of canonical IDs admitted from references,
range starts, and range ends. Direct-definition-only IDs do not consume this
counter. The exact crossing code is
`COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED`.

For a selected Comments realization, each matching source element is processed
in this exact order:

1. Test its kind-specific occurrence counter before reading `w:id`. The
   4,097th reference retains
   `COMMENT_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED`; the 4,097th start or end uses
   its corresponding new occurrence-limit code.
2. Test ID presence, then the 64-byte raw UTF-8 limit, then canonical decimal
   syntax. Exactly one missing/malformed/too-long code is produced.
3. If the canonical ID is not already in the reference/start/end union, test
   the unique union-ID counter. The 4,097th distinct ID produces
   `COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED`.
4. Admit the occurrence into the bounded per-ID table.

An absent Comments relationship is checked before this sequence. The first
start, end, or reference in global source-event order produces
`COMMENT_RELATIONSHIP_REQUIRED` without reading its ID. Its `ordinalSpace` is
the actual marker kind, its `firstOccurrenceOrdinal` is zero, and its source
and source-set/event ordinals identify that first element. Relationship
presence is carried into the retained event traversal, so this failure returns
directly from that event loop and prevents entry into later events or stories;
it is not derived by first completing a relationship-present marker scan.

After a complete scan, at most one topology code is selected per source ID by
this precedence:

1. duplicate reference;
2. missing reference for an endpoint-bearing ID;
3. duplicate start;
4. duplicate end;
5. orphan start;
6. orphan end;
7. cross-story association; and
8. reversed start/end.

Inherited direct-definition duplicate/non-direct issues are produced
independently. Inherited `COMMENT_DEFINITION_MISSING` is evaluated for every ID
in the reference/start/end union after ID admission, so a marker-only ID cannot
escape definition association. A unique direct-definition-only ID produces no
topology/definition-missing issue and increments `unreferencedDefinitions`.

New ordinary issue codes are:

```text
COMMENT_RANGE_START_ID_MISSING
COMMENT_RANGE_START_ID_MALFORMED
COMMENT_RANGE_START_ID_TOO_LONG
COMMENT_RANGE_END_ID_MISSING
COMMENT_RANGE_END_ID_MALFORMED
COMMENT_RANGE_END_ID_TOO_LONG
COMMENT_RANGE_START_OCCURRENCE_LIMIT_EXCEEDED
COMMENT_RANGE_END_OCCURRENCE_LIMIT_EXCEEDED
COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED
COMMENT_REFERENCE_DUPLICATE
COMMENT_REFERENCE_MISSING
COMMENT_RANGE_START_DUPLICATE
COMMENT_RANGE_END_DUPLICATE
COMMENT_RANGE_START_ORPHANED
COMMENT_RANGE_END_ORPHANED
COMMENT_RANGE_REVERSED
COMMENT_RANGE_CROSS_STORY
```

An ordinary v7 comment issue has exactly these required base keys:

```text
code, side, kind, detail, ordinalSpace,
firstOccurrenceOrdinal, occurrenceCount
```

`kind` is exactly `"comments"`, `detail` is at most 256 UTF-8 bytes, and
`ordinalSpace` is one of `relationship`, `source`, `definition`, `rangeStart`,
`rangeEnd`, `reference`, or `aggregate`. For marker and topology issues,
`Source` is exactly
`{"sourceStory":MarkerStoryKind,"sourceStoryOrdinal":MarkerStoryOrdinal}`.
`MarkerStoryKind` is `main`, `header`, `footer`, `footnotes`, or `endnotes`;
`comments` is forbidden. Main, footnotes, and endnotes require ordinal zero.
Header and footer require their canonical physical story ordinal in `0..383`.
`RelatedSource` has the same grammar.

Every nonterminal source-marker/topology issue additionally requires `source`,
`sourceSetOrdinal:Nat0_386`, and `sourceEventOrdinal:Nat0_499999`.
The Lean semantic/projection theorem requires `sourceSetOrdinal` to index the
canonical retained source sequence, `source` to equal the `StorySlot` at that
index, and `sourceEventOrdinal` to index that slot's retained `visitedEvents`
at the matching marker occurrence. Related-source fields obey the same
request-bound equations.

The fixed 16-field response does not expose retained XML events, so TypeScript
does not re-prove the event-to-marker equation or reparse package XML. It
checks only wire-visible consequences: valid kind/ordinal combinations,
`sourceSetOrdinal` and source identity agreement with that side's exposed
`referenceSourcePartitions`, event-ordinal bounds, code/ordinal-space
consistency, related-source partition identity, and deterministic ordering.
The Lean projection theorem is solely responsible for proving that each
bounded event ordinal names the asserted retained marker.

The complete optional-key universe is
`source`, `sourceSetOrdinal`, `sourceEventOrdinal`, `relatedSource`,
`relatedSourceSetOrdinal`, `relatedSourceEventOrdinal`, `canonicalId`, `rawId`,
`rawIdByteLength`, `relationshipId`, `rawTarget`, `rawTargetByteLength`,
`targetMode`, `normalizedPartPath`, and `rangeEndEventOrdinal`. The following
table is complete for new codes; every optional key not listed in its row is
forbidden.

| Code/class | Required ordinal space and sentinel | Required extras |
| --- | --- | --- |
| `COMMENT_RELATIONSHIP_REQUIRED` caused by start/end/reference | actual `rangeStart`/`rangeEnd`/`reference`; occurrence ordinal `0`; count `1` | `source`, `sourceSetOrdinal`, `sourceEventOrdinal` |
| start/end `*_ID_MISSING` | matching marker space; occurrence `<4096`; count `1` | `source`, `sourceSetOrdinal`, `sourceEventOrdinal` |
| start/end `*_ID_MALFORMED` | matching marker space; occurrence `<4096`; count `1` | `source`, `sourceSetOrdinal`, `sourceEventOrdinal`, `rawId:String64` |
| start/end `*_ID_TOO_LONG` | matching marker space; occurrence `<4096`; count `1` | `source`, `sourceSetOrdinal`, `sourceEventOrdinal`, `rawIdByteLength:Nat65_16777216` |
| start/end `*_OCCURRENCE_LIMIT_EXCEEDED` | matching marker space; occurrence `4096`; count `1` | `source`, `sourceSetOrdinal`, `sourceEventOrdinal` |
| `COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED` | actual introducing marker space; occurrence `<4096`; count `1` | `source`, `sourceSetOrdinal`, `sourceEventOrdinal`, `canonicalId:String64` |
| `COMMENT_REFERENCE_DUPLICATE` | `reference`; first duplicate reference occurrence `<4096`; count `1..4095` | `source`, `sourceSetOrdinal`, `sourceEventOrdinal`, `canonicalId:String64` |
| `COMMENT_REFERENCE_MISSING` | space of earliest endpoint; endpoint occurrence `<4096`; count `1` | `source`, `sourceSetOrdinal`, `sourceEventOrdinal`, `canonicalId:String64` |
| `COMMENT_RANGE_START_DUPLICATE` | `rangeStart`; first duplicate start occurrence `<4096`; count `1..4095` | `source`, `sourceSetOrdinal`, `sourceEventOrdinal`, `canonicalId:String64` |
| `COMMENT_RANGE_END_DUPLICATE` | `rangeEnd`; first duplicate end occurrence `<4096`; count `1..4095` | `source`, `sourceSetOrdinal`, `sourceEventOrdinal`, `canonicalId:String64` |
| `COMMENT_RANGE_START_ORPHANED` | `rangeStart`; occurrence `<4096`; count `1` | `source`, `sourceSetOrdinal`, `sourceEventOrdinal`, `canonicalId:String64` |
| `COMMENT_RANGE_END_ORPHANED` | `rangeEnd`; occurrence `<4096`; count `1` | `source`, `sourceSetOrdinal`, `sourceEventOrdinal`, `canonicalId:String64` |
| `COMMENT_RANGE_CROSS_STORY` | space of earliest start/end/reference; occurrence `<4096`; count `1` | `source`, `sourceSetOrdinal`, `sourceEventOrdinal`, `relatedSource`, `relatedSourceSetOrdinal:Nat0_386`, `relatedSourceEventOrdinal:Nat0_499999`, `canonicalId:String64` |
| `COMMENT_RANGE_REVERSED` | `rangeStart`; start occurrence `<4096`; count `1` | `source`, `sourceSetOrdinal`, `sourceEventOrdinal`, `rangeEndEventOrdinal:Nat0_499999`, `canonicalId:String64` |

For `COMMENT_RANGE_CROSS_STORY`, `source` is the globally earliest of the
unique start, end, and reference, and `relatedSource` is the globally earliest
later member whose physical `StorySlot` differs. For
`COMMENT_RANGE_REVERSED`, `sourceEventOrdinal` is the start ordinal and
`rangeEndEventOrdinal` is the end ordinal in the same physical story. The
cross-story code is reachable only after exact-one reference/start/end
cardinality and before the reversed check. The reversed code is reachable only
when those three occurrences share one physical story and
`start.eventOrdinal >= end.eventOrdinal`.

All inherited v6 code-to-extra rows remain unchanged except that source
reference issues also require `sourceSetOrdinal` and `sourceEventOrdinal` in v7 and
`COMMENT_RELATIONSHIP_REQUIRED` admits the three marker ordinal spaces above.
The v6 `COMMENT_UNIQUE_REFERENCE_ID_LIMIT_EXCEEDED` code is retired and is an
invalid alias in v7; the union-limit code above is its only v7 replacement.
Terminal issues retain exactly the seven base keys, use `aggregate`, original
side, ordinal zero, count one, and forbid every optional extra.

Coalescing identity is the complete issue object excluding only `detail`,
`firstOccurrenceOrdinal`, `sourceEventOrdinal`, and `occurrenceCount`.
Coalescing retains the earliest issue under the comparator below, sums counts
only up to 4,096, and keeps that earliest issue's first occurrence and source
event ordinals. Codes with count fixed to one never coalesce.

The total comparator for ordinary comment issues is the lexicographic tuple:

```text
sideRank(original=0,revised=1,compared=2),
phaseRank(relationship/resource=0,source-completeness=1,
          definition=2,source-id-or-limit=3,topology=4,aggregate=5),
sourceSetOrdinalOr0,
sourceStoryKindRank(main=0,header=1,footer=2,footnotes=3,endnotes=4,comments=5),
sourceStoryOrdinalOr0,
sourceEventOrdinalOr0,
markerRank(rangeStart=0,rangeEnd=1,reference=2,
           relationship=3,source=4,definition=5,aggregate=6),
firstOccurrenceOrdinal,
codeRank,
canonicalIdUtf8OrEmpty
```

`codeRank` is inherited v6 rank for inherited codes. New source ID/limit ranks
are exactly start missing, start too long, start malformed, end missing, end
too long, end malformed, start occurrence limit, end occurrence limit, unique
union-ID limit. New topology ranks are exactly reference duplicate, reference
missing, start duplicate, end duplicate, start orphan, end orphan, cross story,
reversed. Resource/terminal precedence remains selection, note, then comment.
A source scan crossing suppresses topology generation because no complete
topology exists after the crossing.

`rawIdByteLength` is bounded by the 16,777,216-byte per-part expanded-size
limit: an admitted retained XML attribute cannot contain more decoded UTF-8
bytes than its admitted part. Both Lean projection and TypeScript decoding
therefore require `65 ≤ rawIdByteLength ≤ 16,777,216`, whose decimal rendering
has at most eight digits. The structural charge table uses that finite width;
larger wire values are invalid rather than ordinary evidence.

The ordinary issue cap remains one shared 511-entry cap across
`selectionIssues`, `noteIntegrityIssues`, and `commentIntegrityIssues`. The
ordinary escaped-string budget remains 1,571,840 bytes. The terminal codes
remain `COMMENT_ISSUE_LIMIT_EXCEEDED` and
`COMMENT_EVIDENCE_STRING_BUDGET_EXCEEDED`; terminal collapse clears ordinary
issues and makes all comment inventories `not_evaluated`/zero.

### 8. Structural charging, envelopes, and stack bounds are proved

`ProtocolV7StructuralChargeAudit.lean` assigns every added inventory key,
delimiter, bounded number, ordinal-space literal, issue field, and code shape
to an exact charge row. `ProtocolV7OrdinaryEnvelopeWitness.lean` combines all
16 fields, all inherited dimensions, nonempty prefixes of all three issue
arrays totaling 511, maximum ordinary string charge, and maximum inventory
counts. `ProtocolV7CanonicalTerminalShapes.lean` covers both terminal codes.

The v7 ordinary JSON, terminal JSON, and stdout limits are derived from those
concrete inequalities before implementation is accepted; they are not copied
from v6 by assumption. The strict TypeScript decoder uses the exact proved
limits. The final stdout remains below the existing 8 MiB hard cap.

The scanner itself is tested under the fixed 8 MiB process stack. No proof or
production path may use package-sized/event-sized `List` conversion,
non-tail-recursive map, `zipIdx`, or per-event filtering over accumulated
markers. Native and production witnesses cover maximum ordinary marker counts,
large irrelevant event payloads, and early/late crossings.

Each compiled-checker invocation has a 120-second limit and checker peak RSS
must remain below 1.5 GiB (1,610,612,736 bytes). These limits apply to the
complete production path, not merely an isolated model scanner.

### 9. TypeScript decoder and public certificate

TypeScript strictly decodes protocol v7:

- exact 16 top-level keys and checker identity;
- exact inventory keys, side order, counts, and status equations;
- exact issue-code extras, ordinal spaces, source identities, sentinels,
  coalescing identities, and deterministic sort order;
- exact ordinary/terminal envelopes and terminal exclusivity; and
- response `passed` equivalence with inherited checks plus complete comment
  range integrity.

The decoder rejects v6, numeric aliases on canonical wire IDs, unknown issue
codes, impossible zero/nonzero counts, extra fields, malformed source
identities or wire-visible source-partition equations, out-of-range event
ordinals, `rawIdByteLength` outside `65..16,777,216`, invalid issue order,
noncanonical JSON, and partial terminal responses.

Public certificate protocol v1 remains structurally backward compatible. All
existing required fields remain required and unchanged. In particular,
`DocumentIntegrityCommentScope.rangeTopology` remains the required literal
`false`; it describes the frozen v6 legacy reference/definition sub-scope and
is not repurposed to claim v7 topology.

These are the only additive public-v1 fields:

```text
DocumentIntegrityCertificate.checkerProtocolVersion?: 7

DocumentIntegrityCertificate.commentRangeTopology?:
 {"checkerProtocolVersion":7,
  "crossParagraphRanges":true,
  "crossingRanges":true,
  "ecmaUnmatchedEndpointPointAnchorsAccepted":false,
  "profile":"safe-docx-paired-or-point",
  "samePhysicalStoryRequired":true,
  "status":"passed"|"failed"|"not_evaluated"}

DocumentIntegrityCommentInventory.rangeStartOccurrences?: Nat0_4096
DocumentIntegrityCommentInventory.rangeEndOccurrences?: Nat0_4096
```

The existing optional `commentIntegrityFailures` array may contain the exact
v7 issue grammar. No other existing public field changes type, literal value,
requiredness, or meaning.

Presence equations are exact:

- legacy public-v1 certificates may omit all four additive properties and
  remain decodable;
- any public certificate projected from a structurally valid protocol-v7
  inplace report must include top-level `checkerProtocolVersion: 7`,
  `commentRangeTopology`, and both range counts in every emitted comment
  inventory;
- if `commentRangeTopology` or either range count is present, top-level
  `checkerProtocolVersion` must be exactly `7`;
- `commentRangeTopology.checkerProtocolVersion` must equal the top-level value;
- `commentRangeTopology.status` equals the aggregate v7 comment story status;
- v7 failures are projected through the existing optional bounded
  `commentIntegrityFailures`;
- a v1 certificate produced by an older checker has no
  `checkerProtocolVersion` and cannot expose v7 topology/profile evidence; and
- rebuild mode remains `not_applicable` and omits `checkerProtocolVersion`,
  `commentRangeTopology`, both range counts, and v7 failures.

### 10. Test and production evidence

Focused positive fixtures cover:

- point comment with one definition/reference and no endpoints;
- one unique direct-definition-only ID counted as unreferenced with no
  topology issue;
- same-paragraph range;
- cross-paragraph range;
- independent ranges in main, every selected header/footer physical story,
  footnotes, and endnotes;
- endpoint/reference association in every retained story class;
- canonical decimal aliases; and
- crossing ranges.

Focused negative fixtures cover:

- missing, malformed, and over-64-byte IDs on starts, ends, and references;
- over-limit starts, ends, references, and unique IDs;
- duplicate references, starts, and ends;
- orphan start and orphan end, explicitly labeled as profile failures;
- reversed endpoints;
- endpoints split across stories;
- reference in a different story from its endpoints;
- endpoint-bearing ID with no reference;
- source ID with no unique direct definition;
- incomplete source scans, substituted `visitedEvents`, and detached selected
  Comments realization;
- simultaneous semantic/resource crossings and skipped later sides;
- every strict-decoder field, issue shape, order, coalescing, sentinel, and
  terminal mutation; and
- ordinary and terminal envelope boundaries.

The real source-derived DOCX fixture exercises all retained story classes,
same- and cross-paragraph ranges, crossing ranges, and compared-only mutations.
No fixture invokes LibreOffice/soffice.

The complete checked-in NVCA-derived original/revised/compared triple must run
through the exact TypeScript supervisor and compiled Lean protocol-v7 binary,
not a reduced or synthetic checker path. Baseline point/ranged evidence passes;
compared-only orphan, reversed, duplicate, cross-story, mismatch, malformed,
overlong, incomplete, and resource-limit mutations return structured
`failed`/`not_evaluated` evidence as specified, never `not_run` or abnormal
exit. The run retains the fixed 8 MiB stack, 120-second timeout, and below
1.5-GiB checker RSS gate.

## Risks / Trade-offs

- V7 is a private breaking migration. Strict rejection of v6 prevents old
  evidence from being mistaken for topology verification.
- The Safe-DOCX paired-or-point profile rejects an ECMA-permitted unmatched
  endpoint representation. Explicit gap labeling prevents overclaiming.
- A direct one-pass scanner changes a stack-sensitive production path. Exact
  retained-evidence proofs and full NVCA/memory gates control that risk.
- Keeping 16 top-level fields makes the public shape smaller, but requires
  inventory and issue grammar to carry all range evidence exactly.

## Migration Plan

1. Approve this separate proposal and obtain independent design review.
2. Implement independent semantics and typed proof targets before changing
   production execution.
3. Add executable refinements, protocol v7, strict TypeScript decoding, and
   additive public certificate evidence.
4. Add focused, differential, real-DOCX, full NVCA, stack, timeout, and memory
   tests.
5. Update conformance gaps/claims, coverage, generated projections, and CI.
6. Merge with `Refs #729`, `Refs #672`, `Refs #710`, and `Refs #547`; run
   exact-main post-merge smoke before considering the work complete.

Rollback reverts the v7 implementation as one change; v6 is not accepted as a
fallback by a v7 decoder.

## Open Questions

None. For this proposal, “consistent association” means that a ranged ID's
unique start, end, and reference share one canonical ID and one retained
physical story; only start-before-end is ordered. Any change to that rule,
the exact theorem signatures, issue grammar/order, limits, charge table,
envelopes, or top-level fields requires proposal revision before implementation.
