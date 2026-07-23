## ADDED Requirements

### Requirement: Forced rebuild preserves unchanged supported complex fields as ordered opaque ranges

When comparison uses `reconstructionMode: rebuild`, the system SHALL preserve
an unchanged, self-contained PAGE, NUMPAGES, REF, or PAGEREF complex field in
`word/document.xml` as the ordered direct paragraph-child range that contains
the field. The preserved range SHALL retain run boundaries, run properties,
field markers, instruction fragments, cached-result runs, supported
non-revision wrappers, attributes, namespace/MCE declarations, and extension
payload.

#### Scenario: [SDX-FIELD-REBUILD-01] Outside edit preserves decorated supported fields

- **GIVEN** an unchanged supported complex field whose markers, instruction, and result occupy distinct decorated runs and a supported non-revision wrapper
- **WHEN** unrelated text in the same or another paragraph changes and comparison is forced through rebuild
- **THEN** the output SHALL contain the original ordered field topology exactly once
- **AND** the unrelated edit SHALL be represented normally
- **AND** insertion or deletion of an unrelated direct paragraph child before the field SHALL NOT change field counterpart identity

#### Scenario: [SDX-FIELD-REBUILD-02] Multiple fields preserve deterministic order

- **GIVEN** multiple unchanged supported fields in one main-document paragraph
- **WHEN** unrelated content is rebuilt
- **THEN** each field range SHALL be paired by stable paragraph ownership and field-range sequence
- **AND** each range SHALL be emitted exactly once in source order

#### Scenario: [SDX-FIELD-REBUILD-03] Unsafe field ownership fails closed

- **GIVEN** an identifiable supported field is changed, inserted, deleted, reordered relative to another distinct field, moved across paragraphs, nested, overlapping, paragraph-spanning, malformed, tracked-revision-owned, shares an endpoint child with unrelated content, or loses merged correlation
- **WHEN** rebuild passthrough is evaluated
- **THEN** comparison SHALL fail before emitting a flattened field

#### Scenario: [SDX-FIELD-REBUILD-03] Unsupported malformed fields retain diagnostics

- **GIVEN** a malformed field whose instruction keyword is outside PAGE, NUMPAGES, REF, and PAGEREF
- **WHEN** rebuild passthrough and safety screening are evaluated
- **THEN** opaque preflight SHALL NOT reject it merely for being malformed
- **AND** existing rebuild safety diagnostics SHALL report its malformed field structure

#### Scenario: [SDX-FIELD-REBUILD-04] Inline SDT remains the sole owner

- **GIVEN** a supported field is wholly contained by an unchanged supported opaque inline SDT
- **WHEN** forced rebuild preserves that paragraph
- **THEN** the SDT SHALL remain the sole opaque owner and emitter
- **AND** the nested field SHALL NOT be captured or emitted independently

#### Scenario: [SDX-FIELD-REBUILD-05] Inplace and Lean boundaries remain unchanged

- **WHEN** this rebuild-only capability is enabled
- **THEN** direct inplace comparison SHALL NOT engage ordered-range capture or emission
- **AND** inplace field fragmentation and reconstruction SHALL remain unchanged
- **AND** Lean XML verifier evidence for rebuild SHALL remain `not_applicable`
