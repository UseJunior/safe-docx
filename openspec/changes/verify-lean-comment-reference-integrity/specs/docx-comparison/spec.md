## ADDED Requirements

### Requirement: Lean selects one bounded legacy Comments part

The compiled verifier SHALL derive `word/_rels/document.xml.rels` from fixed
`word/document.xml`, filter direct relationship records by the exact
Transitional Comments relationship type, establish total exact-type
cardinality before target mode, return `none` iff that list is empty, return
`some` iff it contains exactly one admissible internal relationship, and return
a typed error otherwise. Part admission then requires one safe indexed regular
part with a Transitional `w:comments` root. Safe relocated targets SHALL be
valid. Orphan parts and `_rels/.rels` SHALL not participate.

#### Scenario: Relocated Comments part is selected
- **GIVEN** each side has one exact internal Comments relationship to a
  different safe normalized package path
- **WHEN** protocol v6 verifies the triple
- **THEN** each side SHALL use its relationship-selected path
- **AND** path inequality alone SHALL not fail semantic alignment

#### Scenario: Ambiguous or external selection fails closed
- **GIVEN** a side has two exact-type records, or its sole exact-type record is
  external, unsafe, missing, malformed, or selects the wrong root
- **WHEN** comment evaluation runs
- **THEN** that side SHALL expose no partial comment counts
- **AND** aggregate pass SHALL be false

#### Scenario: Unreferenced selected Comments part remains selected
- **GIVEN** one admissible relationship selects a valid Comments part containing
  only unique unreferenced definitions
- **WHEN** protocol v6 evaluates the side
- **THEN** selector result SHALL be `some`
- **AND** the inventory SHALL pass with zero references

#### Scenario: Forged absence is rejected
- **GIVEN** one admissible exact-type relationship exists
- **WHEN** a proof witness supplies selector result `none`
- **THEN** `CommentSelectionResultOf` SHALL be false

### Requirement: Lean checks legacy comment definition resolution

The verifier SHALL collect namespace-resolved `w:commentReference` IDs from
every already admitted main, selected header/footer, footnote, and endnote
physical story. It SHALL parse reference IDs and direct `w:comment` definition
IDs through bounded `ST_DecimalNumber` semantics and require every canonical
reference to have exactly one direct definition in the relationship-selected
Comments part. Canonical duplicate definitions SHALL fail. Unique unreferenced
definitions SHALL pass.

#### Scenario: Every admitted story contributes references
- **GIVEN** references in main, selected header/footer, footnote, and endnote
  stories
- **WHEN** the side inventory is evaluated
- **THEN** all occurrences SHALL appear in canonical source and XML-event order
- **AND** each SHALL resolve to exactly one direct definition

#### Scenario: Numeric aliases collide
- **GIVEN** direct definitions use IDs `1` and `" +001 "`
- **WHEN** bounded XML Schema integer parsing canonicalizes them
- **THEN** the definitions SHALL be duplicate ID `1`
- **AND** the side SHALL fail

#### Scenario: Unreferenced definition is allowed
- **GIVEN** one unique direct comment definition has no admitted reference
- **WHEN** all referenced IDs still resolve uniquely
- **THEN** comment integrity SHALL pass

### Requirement: Comment verification fails incomplete sides without partial evidence

The verifier SHALL require the exact retained source set and a fully selected,
loaded, decoded, parsed, root-checked, and scanned required Comments part. A
source prerequisite failure, a reference with no Comments relationship, failed
selected presence, or a semantic limit crossing SHALL make the side
`not_evaluated`, zero every exposed comment count, and expose no parsed
reference or definition list.

#### Scenario: Missing required relationship suppresses evidence
- **GIVEN** a complete admitted source contains a comment reference
- **AND** no exact Comments relationship exists
- **WHEN** protocol v6 evaluates the side
- **THEN** it SHALL emit `COMMENT_RELATIONSHIP_REQUIRED` at the first reference
- **AND** it SHALL detect the reference element before reading or
  canonicalizing that element's `w:id`
- **AND** this code SHALL win when the same first reference has a missing,
  malformed, or overlong ID
- **AND** its comment inventory SHALL be `not_evaluated` with zero counts

#### Scenario: Comments part shares package resource budgets
- **GIVEN** prior admitted stories have consumed part of a side's cumulative
  compressed, expanded, or XML-event budget
- **WHEN** the selected Comments part would cross the remaining budget
- **THEN** its exact resource code SHALL be emitted before prohibited later
  work
- **AND** no later side/part decompression, parse, or ID read SHALL occur

#### Scenario: Empty infrastructure is valid absence
- **GIVEN** no exact Comments relationship and no admitted comment reference
- **WHEN** protocol v6 evaluates the side
- **THEN** the Comments slot SHALL be validly absent
- **AND** the zero-count inventory SHALL pass

### Requirement: Protocol v6 binds production behavior to independent semantics

The verifier SHALL prove exact selector, complete-source, parsed-evidence,
package-integrity, selector-to-request-bound-realization,
incomplete-zero-evidence, aggregate-pass, and production refinement targets.
The semantic predicates and typed protocol projection SHALL use bounded byte
strings, typed relationship/package/index/XML-event records, and a structurally
recursive byte encoder. They SHALL be independent of `String`,
`String.toUTF8`, `Lean.Json`, `IO`, executable selectors, production scanners,
success bits, JSON supplied by callers, and production encoder helpers.

#### Scenario: Aggregate pass is non-vacuous
- **WHEN** a production protocol-v6 response passes
- **THEN** all seven semantic theorem conclusions SHALL hold over request-bound
  package bytes and retained parser/scan evidence
- **AND** every selected side SHALL have exactly one retained Comments
  realization and exactly one `some` semantic-evidence value satisfying
  metadata, snapshot extraction, parse, canonical admitted-source, retained
  source-scan, and one-call retained comment-scan equations; absent and
  selector-error sides SHALL have neither
- **AND** aggregate inventory projection and
  `response.commentParsedEvidence side` SHALL use that exact retained evidence,
  without a separately supplied witness
- **AND** each request package view SHALL equal the independent projection of
  the corresponding retained package record, including exact equality of its
  package bytes and binary index
- **AND** the production refinement SHALL establish equality with an
  independently encoded field-complete semantic projection
- **AND** the typed request's expected response SHALL be constructed from the
  independent semantic projection and computed pass predicate rather than by
  decoding the emitted production response
- **AND** the field-complete projection SHALL encode every inherited v5 field,
  every comment field, ordinary and terminal issue shapes, canonical order and
  coalescing, and the exact resource envelopes
- **AND** negative witnesses for omitted sources, forged scans, injected
  inventories, duplicate definitions, omitted or mutated
  `commentIntegrityIssues`, inherited-field drift, and encoder drift SHALL fail
- **AND** `TypedBinaryIndexOf` SHALL validate complete unique safe entry names,
  exact central/local metadata and local-header filename correspondence,
  in-package non-overlapping spans, and exactly one selected Comments entry
- **AND** `TypedBinaryIndexOf` SHALL independently discover every structurally
  valid classic single-disk EOF-aligned EOCD candidate without consulting the
  supplied index, require exactly one candidate before ZIP64-marker rejection,
  bind the sole candidate to the index, traverse the complete central directory
  from package bytes, and bind every central record to its exact local header
  without calling the production ZIP parser
- **AND** raw local and central ZIP filenames SHALL be bounded at 256 bytes
  before decoding, with complete 256-byte accepted and 257-byte rejected archive
  witnesses
- **AND** the strict decoder SHALL accept a structurally valid
  `normalizedPartPath` of exactly 256 UTF-8 bytes and reject one of 257 bytes
- **AND** canonical source derivation SHALL use typed main, aligned
  header/footer slot and physical-story records, and semantic note selections
  with retained note-reference presence; it SHALL not consume a caller
  `sourcePartitionAdmitted` Boolean
- **AND** prior-source admission SHALL be the typed cause `admitted`,
  `relationshipFailure`, `storyRealizationFailure`, `resourceFailure`, or
  `noteAdmissionFailure`, derived by the production bridge only from retained
  selection issues, retained note-scan presence, the concrete semantic
  crossing, and retained note-evaluation completeness
- **AND** closed witnesses SHALL reject omitted, injected, and duplicated
  canonical sources; duplicate direct definitions; injected inventory output;
  stored realization/scan evidence on absent or selector-error branches; and
  forged incomplete and scan-crossing causes
- **AND** interleaved physical targets `A,B,A` SHALL derive selector partitions
  `A:[0,2], B:[1]` in first-seen physical order, while omitted, duplicate,
  wrong-key, and wrong-order partitions SHALL fail
- **AND** `COMMENT_UNIQUE_REFERENCE_ID_LIMIT_EXCEEDED` SHALL carry its crossing
  canonical ID and produce `not_evaluated` with zero counts even though
  occurrence-limit precedence makes it unreachable under the current equal
  limits

#### Scenario: Invented Comments realization is rejected
- **GIVEN** a selected relationship and a purported realization whose package
  bytes, binary index, extracted bytes, parse events, or one-call counters do
  not equal the request-bound retained evidence
- **WHEN** `SelectionToCommentRealizationOf` is checked
- **THEN** the predicate SHALL be false
- **AND** two distinct satisfying realizations for one selected identity SHALL
  be impossible

#### Scenario: Detached semantic evidence is rejected
- **GIVEN** a selected side with one request-bound realization and retained
  one-call scan evidence
- **WHEN** `SelectionToCommentRealizationOf` is supplied `semanticEvidence =
  none` or a different parsed evidence value
- **THEN** the semantic predicate SHALL be false
- **AND** replacing the retained scan result, canonical admitted source set, or
  retained source scans SHALL not establish aggregate pass

#### Scenario: Detached package view is rejected
- **GIVEN** a request whose package view bytes or binary index differ from its
  retained package record for the same side
- **WHEN** `RequestBoundCommentRealizationOf` is checked
- **THEN** the semantic predicate SHALL be false

### Requirement: Protocol v6 is deterministic and exactly bounded

The private response SHALL retain every v5 field and add exactly one
discriminated comment story, three side-ordered discriminated comment
inventories, and one comment issue array using the complete canonical grammar
pinned in the design.
Selection, note, and comment issues SHALL share one 511-entry ordinary cap and
one 1,571,840-byte ordinary escaped-string budget. The ordinary legal JSON
envelope SHALL be 2,624,704 bytes; legal terminal JSON SHALL be at most 2,626,368 bytes;
and finalized stdout SHALL be at most 2,626,369 bytes including one newline.

#### Scenario: Near-envelope witness combines all ordinary dimensions
- **WHEN** `ProtocolV6OrdinaryEnvelopeWitness.lean` combines the retained v5
  structural bounds, all new comment fields, nonempty prefixes in all three
  issue arrays totaling 511 populated ordinary issues, and
  exactly 1,571,840 charged ordinary escaped-string bytes
- **THEN** the strict decoder SHALL accept it
- **AND** its exact serialized length SHALL be measured
- **AND** that length SHALL be at most the 2,624,704-byte ordinary legal
  envelope
- **AND** every structural byte SHALL be charged to a named field, record, or
  code shape rather than an unallocated reserve

#### Scenario: Terminal collapse has one shape
- **GIVEN** the 512th ordinary issue or an ordinary string-budget crossing
- **WHEN** aggregate admission runs in selection-then-note-then-comment order
- **THEN** all ordinary issue arrays SHALL be cleared
- **AND** exactly one source-less terminal comment issue SHALL remain
- **AND** comment story and all three inventories SHALL be `not_evaluated`
- **AND** the exact terminal fixture SHALL fit the legal JSON and stdout bounds

#### Scenario: Strict decoder rejects private v5
- **GIVEN** a private checker report whose protocol version is not 6 or whose
  new fields violate exact keys, cardinality, order, equations, or bounds
- **WHEN** TypeScript decodes it
- **THEN** verification SHALL be `not_run`

### Requirement: Public certificate v1 adds honest comment evidence

The public certificate SHALL remain protocol v1 and MAY add co-present
legacy-comment scope, selected story, three inventories, and bounded failures
only after a structurally valid protocol-v6 run. Downstream consumers SHALL not
need Lean installed.

#### Scenario: Inplace certificate explains the verified claim
- **GIVEN** a valid protocol-v6 inplace run
- **WHEN** the public certificate is assembled
- **THEN** it SHALL state that every admitted legacy comment reference resolves
  to exactly one direct definition in the relationship-selected Comments part
- **AND** it SHALL retain explicit exclusions for range topology, modern
  comments, Strict, full OPC/schema validation, and rebuild mode

#### Scenario: Rebuild makes no claim
- **GIVEN** comparison used rebuild mode
- **WHEN** the public certificate is assembled
- **THEN** comment verification SHALL be `not_applicable`
- **AND** no protocol-v6 comment evidence SHALL appear

### Requirement: Real DOCX evidence covers every admitted source class

Tests SHALL derive a real inplace DOCX triple with a safe relocated Comments
part and nonzero references in main, selected header/footer, footnote, and
endnote stories before applying compared-only mutations.

#### Scenario: Compared-only missing definition fails
- **GIVEN** the real source-derived baseline passes
- **WHEN** one referenced definition is removed only from compared
- **THEN** only the compared comment inventory SHALL fail
- **AND** unrelated selected-story identities SHALL remain unchanged
