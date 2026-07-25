## ADDED Requirements

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
