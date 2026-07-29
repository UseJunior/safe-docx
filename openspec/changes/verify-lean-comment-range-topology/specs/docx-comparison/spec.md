## ADDED Requirements

### Requirement: Lean verifies legacy comment range topology from retained events

The compiled verifier SHALL reuse the canonical retained `CommentSourceSet`,
`StorySlot` realizations, each realization's `visitedEvents`, and the selected
Comments realization. It SHALL collect namespace-resolved
`w:commentRangeStart`, `w:commentRangeEnd`, and `w:commentReference` elements in
one bounded, stack-safe event-order pass with explicit counters. It SHALL NOT
perform a new package read, extraction, XML parse, relationship traversal,
story discovery, copied whole-event-list projection, `zipIdx` scan, or
quadratic per-event filtering.

#### Scenario: Every retained physical story is scanned once
- **GIVEN** markers in main, selected header/footer, footnote, and endnote
  physical stories
- **WHEN** protocol v7 evaluates the side
- **THEN** one retained marker scan SHALL visit each admitted story in canonical
  physical-story and XML-event order
- **AND** its references, starts, and ends SHALL come from the same
  `visitedEvents` evidence used by the production refinement
- **AND** no package or XML realization work SHALL be repeated

#### Scenario: Incomplete retained scans expose no topology
- **GIVEN** a required retained story is missing, partial, reordered, or
  substituted
- **WHEN** comment topology is evaluated
- **THEN** the side SHALL be `not_evaluated`
- **AND** reference, start, end, and definition wire counts SHALL all be zero
- **AND** no partial marker table SHALL satisfy the semantic predicate

### Requirement: Lean enforces the paired-or-point comment profile

The verifier SHALL enforce the paired-or-point profile for every canonical
decimal comment ID admitted from a reference or range marker: exactly one
`w:commentReference` and exactly one selected direct `w:comment` definition. A
unique direct definition with no reference or range marker SHALL remain a valid
unreferenced definition. Zero range endpoints on a referenced ID SHALL be a
valid point comment. Otherwise, the verifier SHALL require exactly one start
and one end with that canonical ID in the same retained physical story as the
reference, and the start event ordinal SHALL be less than the end event
ordinal.

#### Scenario: Point comment passes without endpoints
- **GIVEN** one direct definition and one admitted reference share a canonical
  ID
- **AND** no range start or end exists for that ID
- **WHEN** protocol v7 evaluates the side
- **THEN** the comment SHALL pass as a point comment

#### Scenario: Unique unreferenced definition remains valid
- **GIVEN** the selected Comments realization contains one direct definition
  whose canonical ID appears in no retained reference, start, or end
- **WHEN** protocol v7 evaluates the side
- **THEN** the definition SHALL remain valid and SHALL be counted as
  unreferenced
- **AND** no synthetic reference or range obligation SHALL be created
- **AND** typed semantics, executable evidence, strict decoding, and public
  projection SHALL agree on the passing inventory

#### Scenario: Cross-paragraph range passes
- **GIVEN** one start and one later end with the same canonical ID occur in
  different paragraphs of one retained physical story
- **AND** that story contains the unique reference and the selected Comments
  realization contains the unique direct definition
- **WHEN** protocol v7 evaluates the side
- **THEN** the ranged comment SHALL pass

#### Scenario: Crossing ranges pass
- **GIVEN** event order is start A, start B, end A, end B in one retained story
- **AND** A and B each have one reference and one direct definition
- **WHEN** protocol v7 evaluates the side
- **THEN** both ranges SHALL pass
- **AND** the verifier SHALL NOT impose a nesting restriction

#### Scenario: Orphan endpoint fails the stronger profile
- **GIVEN** a canonical ID has one start and no end, or one end and no start
- **WHEN** protocol v7 evaluates the side
- **THEN** the side SHALL fail with bounded orphan-endpoint evidence
- **AND** the certificate and conformance ledger SHALL identify this as a
  stronger Safe-DOCX profile rule, not an ECMA pairing requirement

#### Scenario: Cross-story association fails
- **GIVEN** a start and end, or an endpoint and its reference, are split across
  retained physical stories
- **WHEN** protocol v7 evaluates their canonical ID
- **THEN** the side SHALL fail with deterministic cross-story evidence
- **AND** identical story kinds or content SHALL NOT make distinct physical
  stories interchangeable

### Requirement: Comment marker identities and counts are exact and bounded

The verifier SHALL parse marker and reference `w:id` values through the
existing bounded canonical `ST_DecimalNumber` policy. It SHALL count marker
elements before ID admission, limit references, starts, and ends to 4,096 each,
and limit the union of canonical IDs admitted from references, starts, and ends
to 4,096. The union crossing SHALL use exactly
`COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED`; direct-definition-only
IDs SHALL not consume that counter. Every evaluated comment inventory SHALL
include exact `rangeStartOccurrences` and `rangeEndOccurrences`.

#### Scenario: Numeric aliases collide
- **GIVEN** two markers use lexical IDs `1` and `" +001 "`
- **WHEN** XML Schema whitespace and decimal canonicalization are applied
- **THEN** both markers SHALL associate with canonical ID `1`
- **AND** duplicate-cardinality rules SHALL apply to that one ID

#### Scenario: Malformed marker evidence is bounded
- **GIVEN** a start or end has a missing, malformed, or over-64-byte `w:id`
- **WHEN** the one-pass scanner visits it
- **THEN** the exact marker-kind issue SHALL be emitted in deterministic event
  order
- **AND** overlong evidence SHALL expose only its bounded byte length under the
  existing raw-ID privacy policy

#### Scenario: First counter crossing is terminal for the side
- **GIVEN** the next reference, start, end, or unique ID would exceed 4,096
- **WHEN** the scanner reaches that element
- **THEN** its exact crossing issue SHALL win before topology issues
- **AND** the side SHALL be `not_evaluated` with all inventory counts zero
- **AND** later-side comment work SHALL be skipped under the existing global
  stop policy

#### Scenario: Unique union-ID crossing has one code
- **GIVEN** 4,096 distinct canonical IDs have already been admitted from any
  mixture of references, starts, and ends
- **WHEN** the next valid marker introduces a new canonical ID
- **THEN** the side SHALL emit
  `COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED`
- **AND** the issue SHALL use that marker's actual ordinal space, source-set
  ordinal, source event ordinal, occurrence ordinal, and canonical ID
- **AND** `COMMENT_UNIQUE_REFERENCE_ID_LIMIT_EXCEEDED` SHALL be rejected as a
  protocol-v7 alias

### Requirement: Protocol v7 binds production topology to independent semantics

The verifier SHALL migrate the private request/response to protocol v7 while
retaining exactly 16 top-level fields. Seven byte-native semantic theorem
targets SHALL prove selector, realization, source completeness, exact one-pass
marker evidence, per-package range integrity, incomplete zero evidence, and
aggregate serialized response soundness without production, string, JSON, IO,
or LeanSpike dependencies. The seven semantic and six executable/production
propositions SHALL have the complete signatures pinned in the design and SHALL
derive their evidence and canonical response from request-bound package/index,
selected Comments, retained `StorySlot`, and exact `visitedEvents` values. They
SHALL NOT assume topology integrity, an arbitrary inventory, an issue list, or
an expected response.

#### Scenario: Passing production evidence is non-vacuous
- **WHEN** a production protocol-v7 response passes
- **THEN** the typed semantic response SHALL be computed independently from
  request-bound package/index, selected Comments, retained source, and
  `visitedEvents` evidence
- **AND** the exact retained marker scan SHALL supply all inventory and issue
  projections
- **AND** starts, ends, references, definitions, inherited fields, canonical
  JSON bytes, and final newline SHALL match the independent projection
- **AND** omitted IDs, stories, events, fields, or marker kinds and substituted
  inventories, scans, realizations, or encoders SHALL fail closed

#### Scenario: Proof policy remains exact
- **WHEN** theorem signatures, transitive dependencies, axioms, and source are
  audited
- **THEN** all seven semantic targets SHALL be axiom-free
- **AND** executable refinements and production SHALL use exactly the existing
  foundational axioms and no others
- **AND** the implementation SHALL contain zero `sorry`

### Requirement: Protocol v7 is strict, deterministic, and resource bounded

The private response SHALL use the exact 16-field canonical grammar, three
side-ordered extended comment inventories, and deterministic bounded topology
issues. One shared 511 ordinary-issue cap and 1,571,840-byte ordinary
escaped-string budget SHALL remain. Concrete protocol-v7 structural,
coalescing, ordinary-envelope, terminal-envelope, and stdout charge proofs
SHALL determine the strict decoder limits. The new issue code conditions,
per-ID precedence, required and forbidden extras, source-set/event ordinals,
coalescing identity, and total comparator SHALL be exactly those pinned in the
design; overlapping mismatch aliases SHALL be rejected.

#### Scenario: Strict decoder rejects incomplete topology grammar
- **GIVEN** a private response is v6 or has an omitted/extra/misordered field,
  invalid inventory count/equation, unknown or aliased issue, wrong source or
  ordinal space, noncanonical issue order, invalid coalescing, or impossible
  terminal mixture
- **WHEN** TypeScript decodes it
- **THEN** verification SHALL be `not_run`

#### Scenario: Terminal collapse has one proved shape
- **GIVEN** the 512th ordinary issue or an ordinary string-budget crossing
- **WHEN** aggregate admission runs in selection-then-note-then-comment order
- **THEN** ordinary issue arrays SHALL be cleared
- **AND** exactly one existing terminal comment issue SHALL remain
- **AND** all comment inventories SHALL be `not_evaluated` with zero counts
- **AND** canonical JSON and stdout SHALL fit their protocol-v7 proved
  envelopes and the existing 8 MiB hard cap

### Requirement: Public certificate v1 reports honest range-profile evidence

The public document-integrity certificate SHALL remain protocol v1. After a
valid inplace protocol-v7 run it MAY expose additive start/end inventory counts,
bounded topology failures, and a human-readable paired-or-point profile. It
SHALL distinguish ECMA-backed marker/ID semantics from Safe-DOCX's stronger
orphan-endpoint rejection. Every existing required v1 field and literal SHALL
remain unchanged, including
`DocumentIntegrityCommentScope.rangeTopology: false`.

The only new public-v1 fields SHALL be optional top-level
`checkerProtocolVersion: 7`, optional `commentRangeTopology` with the exact
required keys and literals pinned in the design, and optional
`rangeStartOccurrences`/`rangeEndOccurrences` on comment inventories. A
certificate projected from a valid protocol-v7 inplace report SHALL include
all of them; their presence SHALL require `checkerProtocolVersion: 7`. Older v1
certificates MAY omit all of them.

#### Scenario: Inplace certificate states the strongest honest claim
- **GIVEN** a valid passing protocol-v7 inplace run
- **WHEN** the public certificate is assembled
- **THEN** it SHALL report exact-one reference/direct-definition association
  and point-or-paired same-physical-story topology
- **AND** it SHALL state that cross-paragraph and crossing ranges are permitted
- **AND** it SHALL exclude ECMA-permitted unmatched endpoint anchors, modern
  comments, Strict, rendering/layout, and rebuild
- **AND** it SHALL NOT claim complete ECMA coverage
- **AND** it SHALL carry top-level and topology-profile
  `checkerProtocolVersion: 7`

#### Scenario: Rebuild makes no topology claim
- **GIVEN** comparison used rebuild mode
- **WHEN** the public certificate is assembled
- **THEN** comment range verification SHALL be `not_applicable`
- **AND** `checkerProtocolVersion`, `commentRangeTopology`, range counts, and
  protocol-v7 failures SHALL all be absent

### Requirement: Complete production evidence remains stack and memory safe

Tests SHALL exercise point, same-paragraph, cross-paragraph, crossing, every
retained story class, malformed/overlong/alias, orphan/reverse/duplicate,
cross-story/missing-association, incomplete, and resource-limit behavior
through focused, real-DOCX, differential, and complete NVCA-derived production
paths.

#### Scenario: Complete NVCA-derived production path is bounded
- **GIVEN** the complete checked-in NVCA-derived original/revised/compared
  triple with selected legacy Comments infrastructure and range mutations
- **WHEN** the TypeScript supervisor invokes the compiled protocol-v7 verifier
  under the fixed 8 MiB process stack
- **THEN** baseline point/ranged cases SHALL pass and negative cases SHALL
  return structured `failed` or `not_evaluated` evidence
- **AND** no case SHALL crash or return `not_run`
- **AND** each invocation SHALL finish within 120 seconds and below 1.5 GiB
  checker peak RSS
- **AND** no test SHALL invoke LibreOffice/soffice
