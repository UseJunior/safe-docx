## ADDED Requirements

### Requirement: Relationship-selected Lean evidence keeps conformance claims bounded

The ECMA-376 registry SHALL bind relationship-selected Lean implementation and
test claims only to edition 5 Part 1 §17.10.5 for direct typed
`w:headerReference` bindings, §17.10.2 for direct typed
`w:footerReference` bindings, §17.10.4 for selected `w:hdr` roots, and
§17.10.3 for selected `w:ftr` roots. Registry `verifiedBy` entries SHALL name
the actual Lean selector/executable and compiled or real-DOCX tests that
exercise each claim.

Safe internal target normalization, bounded repeated percent decoding with
unsafe or ambiguous results rejected, package containment, section ordinal
alignment, selector-observable section-count or ordered-slot failure,
single-direct-body and terminal-section inventory constraints, deterministic
ordering, shared-target deduplication, partial successful-evidence retention,
structured failure aggregation, and certificate compatibility SHALL be
identified as SafeDocX safety or evidence policies rather than consequences of
those Part 1 clauses.
The checker coverage ledger and generated conformance documentation SHALL state
the exact relationship-selected surface, Transitional-only namespace policy,
accepted XML/target subset, classic-ZIP-only binary index, required-main
`not_run` boundary, unconditional ZIP64-extra rejection, method-specific flag
masks, complete local-record span policy, selector-partitioned response bound,
aggregate verifier/evidence limits, canonical main/relationship/footnotes/
endnotes resource admission, metadata-before-decompression enforcement,
bounded event-to-token parsing, typed failure reasons with equality-inclusive
aggregate event classification, and exclusions.

This change SHALL NOT add a full OPC, relationship-graph, content-type, XML
Schema, inherited-role, pagination, rendering, field-evaluation, bookmark, or
complete ECMA-376 claim. It SHALL NOT add unsupported Part 2 citations.

#### Scenario: [LEAN-REL-CONFORMANCE-01] Binding and root citations match exercised structure

- **WHEN** implementation or tests claim direct typed header/footer bindings or
  selected header/footer roots
- **THEN** their conformance evidence SHALL cite only the corresponding
  registered Part 1 §§17.10.2, 17.10.3, 17.10.4, or 17.10.5
- **AND** `verifiedBy` paths SHALL identify the Lean and test evidence that
  actually exercises the claim

#### Scenario: [LEAN-REL-CONFORMANCE-02] Selector safety remains repository policy

- **WHEN** target normalization, package containment, ordinal alignment,
  deterministic ordering, deduplication, failure aggregation, or certificate
  compatibility is documented or tested
- **THEN** it SHALL be labeled as a SafeDocX policy or verifier invariant
- **AND** it SHALL NOT be attributed to the bounded header/footer Part 1 clauses

#### Scenario: [LEAN-REL-CONFORMANCE-03] Coverage docs preserve explicit non-goals

- **WHEN** protocol v4 coverage and generated conformance documentation are
  checked
- **THEN** they SHALL list direct explicit selected header/footer stories as
  covered and fixed main/footnote/endnote stories as retained
- **AND** they SHALL explicitly exclude inherited roles, unselected parts,
  complete relationship/OPC/schema validation, pagination, rendering, and full
  ECMA-376 conformance

#### Scenario: [LEAN-REL-CONFORMANCE-04] Parser and resource policies are not ECMA maxima

- **WHEN** coverage docs state Transitional-only namespaces, accepted
  declarations/entities/ZIP methods/targets, classic-ZIP-only binary inventory,
  ZIP64-extra/disk-start/flag/local-span policy, required-main process boundary,
  selector-partitioned serialization bound, canonical resource phases,
  metadata-before-decompression policy, or numeric resource/evidence ceilings
- **THEN** they SHALL identify those choices as bounded verifier policy
- **AND** they SHALL NOT present rejected Strict syntax, unsupported OPC
  features including ZIP64, or values above the ceilings as nonconformant with
  ECMA-376

#### Scenario: [LEAN-REL-CONFORMANCE-05] Resource admission is verifier policy

- **WHEN** coverage documents describe metadata-first selected-target
  admission, optional-note ordering, typed parser failures, or aggregate
  XML-event stopping at or below the per-part ceiling
- **THEN** they SHALL identify these as bounded SafeDocX verifier policies
- **AND** they SHALL not attribute those limits or processing phases to the
  cited header/footer clauses
