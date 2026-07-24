## ADDED Requirements

### Requirement: Ancillary field evidence separates ECMA structure from SafeDocX safety policy

The ECMA-376 registry SHALL bind ancillary implementation claims only to
edition 5 Part 1 §§17.10.2 and 17.10.5 for registered typed footer/header
bindings, §§17.10.3 and 17.10.4 for footer/header story roots, §17.16.18 for
complex-field structure, and §§17.16.5.42, 17.16.5.44, 17.16.5.45, and
17.16.5.51 for the bounded NUMPAGES, PAGE, PAGEREF, and REF instruction
vocabulary.

Target normalization, package containment, note-entry isolation, duplicate
direct note-ID rejection, assembly provenance, and exact canonical range
preservation SHALL be labeled as SafeDocX safety policies or metamorphic
invariants rather than ECMA-376 requirements. This change SHALL add no
unsupported Part 2 or note clause.
Section 17.11.14 SHALL be cited only where implementation or tests actually use
`w:footnoteReference/@w:id` as a reference identifier; independent note-entry
validation and REF/PAGEREF preservation SHALL NOT establish that claim.

#### Scenario: [SDX-ANC-CONFORMANCE-01] Binding, root, and field citations match exercised structure

- **WHEN** source and tests claim typed section bindings, expected header/footer roots, complex-field structure, or supported instruction classification
- **THEN** their single-line conformance tags SHALL cite only the corresponding registered Part 1 clauses
- **AND** target normalization, package containment, note-entry isolation, and duplicate direct note-ID rejection SHALL not be presented as consequences of those clauses

#### Scenario: [SDX-ANC-CONFORMANCE-02] Exact range and provenance evidence remain repository invariants

- **WHEN** tests compare a source ancillary field inventory with the final assembled package
- **THEN** they SHALL describe source provenance and canonical whole-range equality as SafeDocX evidence
- **AND** they SHALL NOT attribute exact preservation, field evaluation, pagination, cached-result correctness, bookmark resolution, or note-entry provenance to ECMA-376

#### Scenario: [SDX-ANC-CONFORMANCE-03] Note citations remain bounded

- **WHEN** independent note-entry validation or note-field preservation tests run
- **THEN** they SHALL add no unsupported Part 2 or note citation
- **AND** duplicate direct note-ID rejection SHALL be described only as a SafeDocX evidence-safety policy
- **AND** §17.11.14 SHALL appear only on a test that actually distinguishes a footnote reference ID from a display number
- **AND** no evidence SHALL claim complete note-definition/reference or relationship integrity

#### Scenario: [SDX-ANC-CONFORMANCE-04] Registry non-goals preserve the Lean boundary

- **WHEN** the registry documents runtime ancillary comparison evidence
- **THEN** it SHALL state that the strict runtime predicate and relationship-selected stories do not broaden the Lean checker
- **AND** executable protocol v3 SHALL remain inplace-only with fixed main/footnotes/endnotes scope and headers/footers excluded
- **AND** dynamic relationship-addressed Lean stories SHALL be named as a separate successor slice
