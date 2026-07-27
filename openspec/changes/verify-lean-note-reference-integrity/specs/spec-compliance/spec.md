## ADDED Requirements

### Requirement: Note integrity coverage names exact ECMA and schema boundaries

The ECMA registry and Lean checker coverage ledger SHALL identify the exact
supported note relationship, root, reference, definition, and typed-value
clauses. Each claim SHALL bind to the corresponding vendored Transitional
schema declaration, and SafeDocX normalization, canonicalization, alignment,
and resource policies SHALL be labeled as implementation policy.

#### Scenario: Coverage is regenerated for protocol v5
- **WHEN** protocol-v5 coverage and conformance documentation are generated
- **THEN** they SHALL cite Part 1 §§11.3.4, 11.3.7, 17.11.2-17.11.3, 17.11.7-17.11.10, 17.11.14-17.11.15, and 17.18.10 only for exercised behavior
- **AND** they SHALL bind note declarations to `ST_DecimalNumber`, `ST_FtnEdn`, `CT_FtnEdnRef`, `CT_FtnEdn`, `footnoteReference`, `endnoteReference`, `footnotes`, and `endnotes` in the vendored Transitional `wml.xsd`

### Requirement: Coverage distinguishes verified note integrity from exclusions

Coverage metadata SHALL state that protocol v5 proves package-local
reference-to-unique-user-definition integrity for Transitional notes selected
from the relationships of fixed `word/document.xml` in inplace comparison. It
SHALL separately enumerate poison-reference handling,
unreferenced-definition validity, and all excluded semantics.

#### Scenario: Coverage does not overclaim
- **WHEN** generated coverage describes note verification
- **THEN** it SHALL say that unique unreferenced definitions are permitted
- **AND** it SHALL say note-definition-story references are rejected rather than followed
- **AND** it SHALL exclude `_rels/.rels` discovery, comments, numbering, custom-mark rendering, pagination, content types, full OPC, Strict namespaces, rebuild certification, and complete ECMA-376 conformance

### Requirement: Axiom audit includes note-integrity soundness

The Lean axiom audit SHALL include
`selected_note_identity_sound`, `admitted_source_partition_complete`,
`parsed_inventory_evidence_exact`,
`package_note_reference_integrity_sound`,
`incomplete_partition_zero_evidence_sound`, and
`note_integrity_aggregate_pass_sound`. Each new target's normalized axiom set
SHALL be empty and specifically exclude all LeanSpike comparison-engine and
residual axioms. The separate complete normalized audit SHALL retain zero
`sorry` and the existing exact six-name observed axiom union.
The audit SHALL separately include
`production_run_request_core_refinement_sound`, whose exact normalized axiom
set SHALL be `[propext, Classical.choice, Quot.sound]` because its proposition
directly binds concrete `String` and `Lean.Json` production operations. That
target SHALL contain no LeanSpike comparison-engine or residual axiom.
The six declarations SHALL have the exact signatures and propositions pinned
by the change design. Their relationship-record, XML-event traversal,
independent load/decode/parse/full-scan, partition, parsed-evidence,
optional-slot satisfaction, global admission context, tagged incomplete cause,
package-integrity, incomplete-side-zero-evidence, aggregate, and
serialized-response predicates SHALL live in a proof-facing semantics module
that cannot import or depend on the executable selector, scanner, checker,
aggregate runner, production serializer, or `response.passed`.

#### Scenario: Note theorem passes the exact-union audit
- **WHEN** `lake env lean AxiomAudit.lean` is normalized and compared with `expected-axioms.txt`
- **THEN** all six exact selector/correspondence/integrity targets SHALL appear among the audited targets
- **AND** each new target's individual `#print axioms` output SHALL be empty
- **AND** the production refinement target SHALL report exactly `propext`,
  `Classical.choice`, and `Quot.sound`
- **AND** the observed union SHALL contain no additional axiom names

#### Scenario: Semantic predicates cannot make the theorems tautological
- **WHEN** declaration signatures, imports, and transitive constant dependencies are audited
- **THEN** all six semantic theorem declarations and the separate production
  refinement declaration SHALL match the pinned propositions
- **AND** executable functions SHALL not occur in the independent semantic
  predicate definitions
- **AND** the production refinement SHALL bind actual parser evidence,
  selector identities, bounded scans, inventories, partitions, issues,
  aggregate pass, every protocol-v5 JSON field, canonical serialization, and
  finalized stdout
- **AND** exact package and extracted bytes plus successful parser and bounded
  scan equations SHALL be retained from a single production pass rather than
  re-created by proof-only runtime work
- **AND** the independent semantic protocol projection SHALL have no dependency
  on the production JSON builder or `runRequestCore`
- **AND** a recursive value-call-graph audit SHALL reject dependencies on every
  production protocol encoder/helper and SHALL reject parser, CRC, extraction,
  or semantic-rescan work below the retained-evidence core boundary
- **AND** exact-byte extraction evidence SHALL be derived from package snapshots
  written once inside the TypeScript supervisor's private mode-0700 temporary
  root, which is removed after child close for success, failure, timeout, and
  output overflow, with no PATH-resolved `chmod` dependency and with external
  deflate disclosed as a trust boundary rather than a Lean-proved operation
- **AND** internal-plus-external exact relationships, incomplete purported-complete scans, side-event overflow, invalid absence, failed-presence-as-absence, forged intrinsic/local/skipped causes, a forged selected-stories context containing an unselected/orphan malformed story, partial incomplete output, duplicate-definition, aggregate, and serialized-response fixtures SHALL compile as negative witnesses for the corresponding predicates
