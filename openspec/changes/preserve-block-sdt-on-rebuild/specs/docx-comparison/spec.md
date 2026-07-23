## ADDED Requirements

### Requirement: Forced rebuild preserves unchanged direct body block structured document tags

When comparison uses `reconstructionMode: rebuild`, the system SHALL preserve an
unchanged direct `w:body/w:sdt` subtree as one opaque scaffold-owned block,
including ordered `w:sdtPr`, optional `w:sdtEndPr`, `w:sdtContent`, every
controlled paragraph and attribute, complex DrawingML payload, relationship
references, and effective namespace/MCE semantics. Exact opaque preservation is
a bounded SafeDocX metamorphic invariant, not an ECMA-376 requirement.

#### Scenario: [SDX-SDT-BLOCK-01] Outside edits retain a complete block control

- **GIVEN** a direct body-level block control owning a contiguous paragraph interval
- **WHEN** unrelated body paragraphs are edited through forced rebuild
- **THEN** the validated original block subtree SHALL remain semantically identical
- **AND** every relationship-namespace attribute SHALL resolve to an identical relationship and dependent-part closure on both sides
- **AND** accepting and rejecting changes SHALL retain the block while projecting the outside edit correctly

#### Scenario: [SDX-SDT-BLOCK-02] Multiple identical controls pair locally and deterministically

- **GIVEN** multiple unchanged direct body-level block controls, including semantically identical controls
- **WHEN** forced rebuild correlates and reconstructs the document
- **THEN** each control SHALL retain its direct body placement and paragraph-slot ownership
- **AND** no document-wide ordinal SHALL launder movement or changed ownership into a valid match

#### Scenario: [SDX-SDT-BLOCK-03] Unsupported block ownership fails before output

- **GIVEN** mutation, an internal edit, insertion, deletion, reorder, movement, changed or non-contiguous paragraph ownership, correlation loss, nesting, or table/cell placement
- **WHEN** forced rebuild attempts opaque block passthrough
- **THEN** reconstruction SHALL fail before emitting lossy document XML
- **AND** it SHALL NOT preserve stale content, flatten the control, or partially replace owned paragraphs

#### Scenario: [SDX-SDT-BLOCK-04] Block identity work remains linear in group count

- **GIVEN** ordinary and block-owned paragraph groups
- **WHEN** hierarchical correlation computes opaque group identity
- **THEN** identity SHALL be precomputed or memoized once per group per comparison run
- **AND** deterministic instrumentation counts SHALL prove that bound without timing assertions

#### Scenario: [SDX-SDT-BLOCK-05] Relationship closure changes fail before reconstruction

- **GIVEN** a block control referencing internal or external package relationships
- **WHEN** an Id binding, type, target mode, normalized target, referenced part bytes, or recursively referenced XML-part closure differs
- **THEN** forced rebuild SHALL fail before reconstruction
- **AND** dangling, unsafe, cyclic, or unsupported relationship-bearing targets SHALL fail closed
- **AND** external targets SHALL be compared without network access
