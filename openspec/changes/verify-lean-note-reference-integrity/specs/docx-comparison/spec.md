## ADDED Requirements

### Requirement: Lean selects Transitional notes from the fixed conventional main

The compiled Lean verifier SHALL first filter all direct records in
`word/_rels/document.xml.rels`, derived from fixed `word/document.xml`, by the
exact Transitional Footnotes or Endnotes relationship type without filtering
target mode. It SHALL require zero or one total exact-type record and, only
when exactly one remains, require that sole record to be internal before safe
target normalization, binary ZIP lookup, and expected-root checking. It SHALL
align triples by semantic kind rather than path and SHALL NOT claim
`_rels/.rels` main-part discovery.

#### Scenario: Safe alternate note paths align by kind
- **GIVEN** original, revised, and compared packages whose valid internal footnotes relationships target three different safe paths
- **WHEN** protocol v5 selects note stories
- **THEN** it SHALL align the selected parts as one `footnotes` story triple
- **AND** it SHALL retain each side's relationship ID and normalized path

#### Scenario: Ambiguous or unsafe relationship fails closed
- **GIVEN** a package with duplicate exact-type note relationships, one internal plus one external exact-type relationship, a sole external exact-type relationship, an unsupported target mode, or an unsafe target
- **WHEN** protocol v5 selects note stories
- **THEN** it SHALL return a bounded structured note-integrity issue
- **AND** aggregate pass SHALL be false
- **AND** internal-plus-external SHALL fail cardinality before either record can be selected

#### Scenario: Wrong relationship type cannot satisfy references
- **GIVEN** a package with a valid-source note reference but no exact-type relationship for that kind
- **WHEN** protocol v5 checks package-local integrity
- **THEN** it SHALL fail with `NOTE_RELATIONSHIP_REQUIRED`
- **AND** it SHALL not infer intent from arbitrary unselected relationships

#### Scenario: Alternate package main is outside this slice
- **GIVEN** `_rels/.rels` points to an office document other than `word/document.xml`
- **WHEN** protocol v5 is requested
- **THEN** the verifier SHALL make no claim that it selected that alternate main
- **AND** its selector identity SHALL remain fixed conventional-main only

### Requirement: Lean parses typed definitions and bounded decimal identities

The verifier SHALL parse direct `w:footnote` and `w:endnote` definitions under
their selected roots. Before integer parsing it SHALL admit at most 64 raw
UTF-8 bytes, apply §17.18.10 `ST_DecimalNumber` whitespace collapse, require
the integer lexical space, and emit canonical `0 | -?[1-9][0-9]*` evidence. An
absent or `normal` `w:type` SHALL be a user definition; `separator`,
`continuationSeparator`, and `continuationNotice` SHALL be non-user special
definitions. Numeric values SHALL NOT determine classification.

#### Scenario: Numeric zero user note remains user
- **GIVEN** a direct note definition with `w:id="0"` and absent or `normal` `w:type`
- **WHEN** the verifier builds the definition inventory
- **THEN** it SHALL classify the definition as user
- **AND** a matching valid-source reference SHALL resolve to it

#### Scenario: Typed separator does not satisfy a user reference
- **GIVEN** a `separator` definition with the same numeric ID as a valid-source reference
- **WHEN** package-local integrity is checked
- **THEN** the separator SHALL be excluded from the user map
- **AND** the reference SHALL fail unless exactly one user definition also matches

#### Scenario: Decimal aliases and negative zero canonicalize
- **GIVEN** note IDs containing collapsible surrounding whitespace, a sign, leading zeroes, or `-0`
- **WHEN** the verifier parses at most 64 raw UTF-8 bytes
- **THEN** integer-equivalent values SHALL compare as one identity
- **AND** negative zero SHALL emit canonical ID `0`

#### Scenario: Overlong lexical ID fails before integer parsing
- **GIVEN** a decoded raw note ID longer than 64 UTF-8 bytes
- **WHEN** the verifier scans it
- **THEN** it SHALL report `NOTE_ID_LEXICAL_LIMIT_EXCEEDED`
- **AND** it SHALL not invoke unbounded integer parsing

### Requirement: Lean proves package-local unique resolution

The verifier SHALL require every valid-source reference in each evaluated
package side and note kind to resolve to exactly one same-kind user definition.
Canonical duplicate user-definition IDs SHALL fail. Repeated references and
unique unreferenced user definitions SHALL remain valid.

#### Scenario: Every valid reference resolves uniquely
- **GIVEN** repeated valid-source references whose IDs all have unique same-kind user definitions
- **WHEN** `checkPackageNoteIntegrity` returns true
- **THEN** `package_note_reference_integrity_sound` SHALL establish exactly one matching user definition per reference
- **AND** the theorem SHALL use no residual-obligation axiom

#### Scenario: Numeric aliases are duplicate definitions
- **GIVEN** two user definitions whose different raw IDs denote the same `ST_DecimalNumber`
- **WHEN** package-local integrity is checked
- **THEN** the verifier SHALL report `NOTE_USER_DEFINITION_DUPLICATE`

#### Scenario: Unreferenced definition is valid
- **GIVEN** a unique well-formed user definition that no valid source references
- **WHEN** package-local integrity is checked
- **THEN** the definition SHALL remain valid
- **AND** no issue SHALL call it invalid merely because it is unreferenced

### Requirement: Source partition is complete and definition-story references are poison

Valid references SHALL come only from fixed main and every selected direct
header/footer physical story. Selected footnote/endnote stories SHALL supply
direct definitions and SHALL be completely scanned for forbidden references.
Any footnote/endnote reference in a definition story SHALL be structured
nonconformance and SHALL NOT enter a closure list. A complete side SHALL have
an independently loaded, strictly decoded, namespace-aware parsed, fully
scanned realization for every expected present source and no more than
1,000,000 admitted events across those realizations.

#### Scenario: Header-hosted reference participates
- **GIVEN** a selected header containing a footnote reference with no user definition
- **WHEN** protocol v5 checks the package
- **THEN** that side's footnote inventory SHALL fail

#### Scenario: Recursive note reference is rejected
- **GIVEN** a selected definition story containing a reference to its own kind
- **WHEN** protocol v5 scans definition stories
- **THEN** it SHALL report `NOTE_REFERENCE_IN_DEFINITION_STORY`
- **AND** it SHALL not follow that reference as a closure edge

#### Scenario: Cross-kind note cycle is rejected
- **GIVEN** footnotes and endnotes definition stories that reference each other
- **WHEN** protocol v5 scans them
- **THEN** both involved inventories SHALL fail with structured poison evidence

#### Scenario: Incomplete source suppresses both kinds
- **GIVEN** any admitted main/header/footer source or selected definition story cannot be completely selected, loaded, parsed, or scanned
- **WHEN** protocol v5 assembles that side's inventories
- **THEN** the side SHALL carry exactly one intrinsic-story-failure cause
- **AND** both note kinds for that side SHALL be `not_evaluated`
- **AND** all counts in both inventories SHALL be zero
- **AND** all internal reference/definition/poison lists SHALL be empty and no partial parsed evidence SHALL be exposed
- **AND** `incomplete_partition_zero_evidence_sound` SHALL establish those conclusions without a complete-partition hypothesis
- **AND** aggregate pass SHALL be false

#### Scenario: Optional absence is distinct from failed presence
- **GIVEN** an optional note kind has no exact-type relationship and no valid-source reference element of that kind, including malformed-ID occurrences
- **WHEN** the complete partition is established
- **THEN** its absent definition slot SHALL be valid with no relationship and `partPresent: false`
- **GIVEN** an exact-type relationship exists but its selected part cannot be loaded, decoded, parsed, root-checked, or fully scanned
- **WHEN** side evaluation completes
- **THEN** the slot SHALL be failed presence, the partition SHALL be incomplete, and it SHALL NOT satisfy valid absence

#### Scenario: Semantic crossing and skipped sides have explicit causes
- **GIVEN** one side encounters a pinned semantic limit crossing
- **WHEN** global side-major evaluation continues
- **THEN** that side SHALL carry `localSemanticLimitCrossing` with the exact limit and sentinel
- **AND** every unstarted later side SHALL carry `skippedAfterPriorCrossing` naming that earlier side, limit, and sentinel
- **AND** global context SHALL prove original/revised/compared order and identify the first local crossing
- **AND** every affected side SHALL expose zero counts, no partial parsed evidence, and `not_evaluated` for both kinds

#### Scenario: Global context cannot inject an unselected story
- **GIVEN** a forged global admission context whose selected stories add an unselected or orphan malformed story for one side
- **WHEN** `GlobalAdmissionContextOf` and an intrinsic failure cause are checked
- **THEN** the context SHALL fail because its per-side selection differs from the independent canonical selection derived from that side's package view
- **AND** admission events SHALL be derived from that same independent selection
- **AND** the orphan story SHALL NOT qualify as an intrinsic failure slot

### Requirement: Lean proves selector-to-aggregate correspondence

The verifier SHALL audit exact theorem targets establishing selected-note
identity, complete admitted partition, equality of parsed lists and evidence,
package-local integrity, incomplete-side zero evidence, and aggregate-pass
implication. Omitted selectors, stories, references, definitions, partial
lists, or issues SHALL not satisfy a claim vacuously.

#### Scenario: Aggregate pass implies every correspondence obligation
- **WHEN** protocol-v5 aggregate `passed` is true
- **THEN** `selected_note_identity_sound`, `admitted_source_partition_complete`, `parsed_inventory_evidence_exact`, `package_note_reference_integrity_sound`, and `note_integrity_aggregate_pass_sound` SHALL apply
- **AND** `production_run_request_core_refinement_sound` SHALL bind actual
  single-pass `runRequestCore` extraction/parser/scanner evidence, selector,
  integrity, JSON, and stdout behavior to that semantic response
- **AND** concrete production JSON SHALL equal an independent field-complete
  semantic projection that has no dependency on the production builder
- **AND** that projection SHALL use an independently implemented typed encoder
  with no production encoder, ordering, coalescing, budget, or terminal-helper
  dependency, and mutation witnesses SHALL reject drift in each such category
- **AND** the TypeScript supervisor SHALL create a private mode-0700 temporary
  root, pass it to Lean, wait for child close, and recursively remove it on
  success, failure, timeout, and output overflow
- **AND** extraction SHALL use a package snapshot written once from the exact
  retained package bytes inside that root rather than rereading the caller path
- **AND** no PATH-resolved `chmod` command SHALL be required, and snapshot or
  root cleanup failures SHALL surface as deterministic failures
- **AND** retained evidence SHALL bind ZIP central/local offsets, the exact
  compressed slice, the external decompression result, and one-call counters,
  while identifying external deflate as a trusted boundary
- **AND** exactly two note stories and six passed inventories SHALL be covered

### Requirement: Protocol v5 is exact deterministic and bounded

The executable SHALL accept only protocol-v5 three-path requests and return
exactly three canonical source partitions, two semantic note-story slots, and
six side-kind inventories. Issues SHALL coalesce by their exact semantic key
using separate relationship/source/definition/reference/poison/aggregate
ordinal spaces. It SHALL enforce exact semantic crossing equations, canonical
side/story admission order, required discriminated source identities only for
ordinary v5 note-integrity issues, v4-shaped and canonically ordered/coalesced
selection issues, total cross-array crossing precedence and one shared 511
ordinary cardinality cap, one reserved terminal slot, structural
charges, a 2,619,776-byte realizable ordinary maximum, a 2,621,440-byte
legal JSON envelope, and a 2,621,441-byte stdout envelope that includes the
required one-byte newline.

#### Scenario: Combined maximum construction fits
- **WHEN** `ProtocolV5MaximumOrdinaryShape.lean` emits one response combining maximum relationship/source evidence, evaluated note reports, six evaluated inventories, 511 populated ordinary issues, and exactly the 1,571,840-byte ordinary escaped-string budget
- **THEN** the strict decoder SHALL accept it
- **AND** its serialized response SHALL be at most 2,619,776 bytes
- **AND** the separate terminal reserve SHALL NOT appear in that response

#### Scenario: Canonical terminal reserve is tested separately
- **WHEN** `ProtocolV5CanonicalTerminalShapes.lean` emits each exact terminal response
- **THEN** all ordinary evidence SHALL be absent
- **AND** only the reserved 640 structural bytes and 1,024 escaped-string bytes SHALL be available to the terminal issue
- **AND** each full JSON response SHALL be accepted and remain within the
  2,621,440-byte legal JSON envelope
- **AND** exact emitted stdout SHALL be that JSON plus one newline and remain
  within 2,621,441 bytes

#### Scenario: Contradictory evidence is rejected
- **GIVEN** output with wrong cardinality, unknown keys, duplicate/coalescing violations, invalid order, impossible equations, noncanonical IDs, oversized values, or an inconsistent pass bit
- **WHEN** TypeScript decodes it
- **THEN** it SHALL reject the response as `not_run`

#### Scenario: Structured terminal evidence has one exact shape
- **GIVEN** note issue-count or evidence-string exhaustion
- **WHEN** Lean emits structured terminal protocol v5
- **THEN** relationship slots/stories and selection issues SHALL be cleared, each partition SHALL retain main only, both note stories and all six inventories SHALL be `not_evaluated` with zero counts, and exactly the pinned terminal issue SHALL remain
- **AND** no retained prefix or hidden truncation SHALL be permitted

#### Scenario: Semantic limit crossing has deterministic fallout
- **GIVEN** the first candidate beyond the 8,192 reference-event, 4,096 unique-ID, 4,096 definition, or 4,096 poison limit
- **WHEN** canonical side-major admission encounters it
- **THEN** the exact corresponding limit code and ordinal-space sentinel SHALL be emitted
- **AND** the crossing and later sides SHALL have both inventories `not_evaluated` with zero counts
- **AND** earlier complete sides SHALL remain retained unless aggregate terminal collapse occurs

#### Scenario: Simultaneous crossings have one winner
- **GIVEN** the 8,193rd valid reference would also introduce the 4,097th unique ID
- **WHEN** the candidate is admitted
- **THEN** only `NOTE_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED` at reference sentinel 8,192 SHALL be emitted and the candidate ID SHALL NOT be parsed
- **GIVEN** the 512th ordinary issue would also cross the escaped-string budget
- **WHEN** aggregate evidence is admitted
- **THEN** the exact `NOTE_ISSUE_LIMIT_EXCEEDED` terminal response SHALL win
- **AND** an ordinary string crossing reached before issue-count exhaustion SHALL instead produce the exact `NOTE_EVIDENCE_STRING_BUDGET_EXCEEDED` terminal response

#### Scenario: Overlong ID evidence retains no forbidden raw value
- **GIVEN** an over-64-byte note ID
- **WHEN** its diagnostic key is created
- **THEN** `rawId` and `canonicalId` SHALL be absent
- **AND** the key SHALL use source identity, bounded byte length, and eight-lowercase-hex CRC-32
- **AND** a CRC collision MAY coalesce diagnostics but SHALL NOT alter failed status or create an identity claim

#### Scenario: Ordinary issue source identity is exact
- **WHEN** an ordinary v5 note-integrity relationship, part, definition, valid-reference, poison, or incomplete-source issue is emitted
- **THEN** it SHALL contain the required discriminated source identity specified for that code
- **AND** main/footnotes/endnotes ordinals SHALL be 0 while a header/footer ordinal SHALL identify its canonical physical-story entry in `0..383`
- **AND** the strict decoder SHALL reject omitted, invented, inconsistent, or out-of-range identities and SHALL reject any terminal issue containing a source identity

#### Scenario: Selection and note issue arrays share one aggregate budget
- **GIVEN** protocol-v4 `selectionIssues` and ordinary protocol-v5 `noteIntegrityIssues` coexist
- **WHEN** aggregate issue admission runs
- **THEN** v4-shaped canonically ordered/coalesced selection issues SHALL be admitted first without v5 source fields, followed by canonically ordered source-bearing v5 note issues
- **AND** protocol v5 SHALL replace any prior selection-issue cardinality rule with the shared cap
- **AND** their combined ordinary count SHALL be at most 511
- **AND** count or string exhaustion SHALL clear `selectionIssues` and leave exactly one canonical terminal entry in `noteIntegrityIssues`
- **AND** the strict decoder SHALL reject a terminal in `selectionIssues`, mixed terminal/ordinary evidence, or incorrect cross-array counts

#### Scenario: Resource admission order is stable
- **WHEN** protocol v5 processes all three package sides
- **THEN** binary index, main, relationships, header/footer work, side-major note selection, side-major partition scans, inventories, generic reports, evidence charging, and serialization SHALL occur in the exact specified order

### Requirement: Public certificate v1 exposes additive honest note evidence

The public certificate SHALL remain protocol v1 and MAY add co-present
conventional-main scope, source partitions, semantic note stories, six
inventories, and bounded failures for a valid protocol-v5 run. It SHALL not
identify an alternate selected part as a conventional fixed path.

#### Scenario: Protocol-v5 pass produces honest public evidence
- **GIVEN** successful inplace protocol-v5 verification
- **WHEN** the public certificate is assembled
- **THEN** it SHALL identify fixed `word/document.xml`, its derived relationships part, Transitional semantic-kind alignment, and per-side note identities
- **AND** it SHALL retain exclusions for `_rels/.rels` discovery, numbering, rendering, custom marks, comments, full OPC/content types, Strict namespaces, and unselected parts

#### Scenario: Legacy fixed scope requires all six conventional slots
- **GIVEN** any side-kind slot is absent, unchecked, failed before checking, or selected at an alternate path
- **WHEN** the public certificate is assembled
- **THEN** legacy `fixedStoryScope` SHALL be omitted
- **AND** it SHALL be emitted only when all three sides checked both exact conventional note paths

#### Scenario: Rebuild makes no note-integrity claim
- **GIVEN** comparison used rebuild mode
- **WHEN** the certificate is assembled
- **THEN** status SHALL be `not_applicable`
- **AND** no protocol-v5 note evidence SHALL appear

### Requirement: Real source-derived evidence is non-vacuous for both kinds

Tests SHALL derive original/revised/compared fixtures from the real NVCA source
and add a valid endnote relationship, reference, and definition to every side,
because the source has no user endnote reference. Baseline evidence SHALL have
nonzero footnote and endnote user references and definitions before mutations.

#### Scenario: Compared-only missing definition fails
- **GIVEN** a passing source-derived inplace comparison
- **WHEN** one referenced user definition is removed only from the compared selected part
- **THEN** the corresponding compared inventory SHALL fail
- **AND** unrelated header/footer selection SHALL remain unchanged

#### Scenario: Path relocation preserves semantic alignment
- **GIVEN** a passing source-derived triple whose compared note part moves to another safe path with its relationship updated
- **WHEN** protocol v5 reruns
- **THEN** the note story SHALL remain aligned by kind
- **AND** path inequality alone SHALL not fail

#### Scenario: Both kinds are non-vacuous
- **GIVEN** the real NVCA source-derived fixture
- **WHEN** the compiled protocol-v5 baseline runs
- **THEN** all six inventories SHALL be evaluated
- **AND** both kinds SHALL have at least one user reference and user definition

#### Scenario: Poison alias collision and terminal mutations are exercised
- **GIVEN** the passing source-derived baseline
- **WHEN** compared-only recursive/cross-kind poison, lexical alias, coalescing collision, or terminal-limit mutations run
- **THEN** each SHALL produce or reject exactly the specified structured evidence
- **AND** unrelated header/footer evidence SHALL remain unchanged
