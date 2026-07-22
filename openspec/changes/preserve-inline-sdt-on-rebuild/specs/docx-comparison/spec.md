## ADDED Requirements

### Requirement: Forced rebuild preserves unchanged inline structured document tags through an opaque node boundary

When comparison uses `reconstructionMode: rebuild`, the system SHALL preserve an
unchanged inline `w:sdt` in a rebuilt paragraph as one ordered semantic node,
including its controlled text, `w:sdtPr`, `w:sdtContent`, declared ignorable
foreign attributes, ordered extension children/payload, and effective namespace
and MCE declarations. The system SHALL still apply intentional edits outside
the opaque boundary. Unknown extension preservation is a metamorphic SafeDocX
invariant, not an ECMA-376 conformance claim.

#### Scenario: [SDX-SDT-01] Same-paragraph outside edit retains the complete inline SDT on forced rebuild

- **GIVEN** an existing DOCX paragraph with ordinary text and an unchanged inline `w:sdt`
- **WHEN** unrelated text in the same paragraph is edited and comparison is forced through `reconstructionMode: rebuild`
- **THEN** `reconstructionModeUsed` SHALL be `rebuild`
- **AND** the output SHALL contain one `w:sdt` with the same controlled text, ordered `w:sdtPr` and `w:sdtContent` structure, foreign extension payload, and effective namespace/MCE bindings
- **AND** accepting changes SHALL retain the outside edit while rejecting changes SHALL retain the original outside text
- **AND** wholesale replacement of ordinary surrounding text SHALL use the unchanged opaque boundary as a paragraph anchor when paragraph/container identity is unchanged

#### Scenario: [SDX-SDT-02] Multiple and split-run inline controls retain deterministic paragraph order

- **GIVEN** a paragraph containing multiple sibling inline `w:sdt` controls whose contents span valid split runs
- **WHEN** forced rebuild reconstructs the paragraph
- **THEN** each control SHALL be emitted exactly once in its original relative order among ordinary runs
- **AND** no controlled run SHALL be duplicated, flattened, or moved across an opaque boundary

#### Scenario: [SDX-SDT-03] Opaque namespace ownership preserves root, local, and aliased bindings

- **GIVEN** inline controls using foreign prefixes declared at the document root or control node, including prefix aliases and `mc:Ignorable` tokens
- **WHEN** the opaque node is re-emitted during forced rebuild
- **THEN** every used prefix and ignorable token SHALL retain the same namespace URI and effective scope
- **AND** ordered foreign children, attributes, and payload SHALL retain namespace-aware semantic equality
- **AND** valid descendant-local declarations and legal prefix shadowing SHALL be resolved at their effective element scope

#### Scenario: [SDX-SDT-04] Unsafe opaque payload or paragraph ownership fails closed

- **GIVEN** an inline control with changed controlled content or properties, a missing or reordered counterpart, moved paragraph ownership, whole-paragraph correlation loss, nested opaque boundaries, conflicting prefix ownership, an unbound used prefix, or an unbound `mc:Ignorable` token
- **WHEN** forced rebuild attempts opaque passthrough
- **THEN** reconstruction SHALL fail with an opaque-passthrough or XML namespace-well-formedness error
- **AND** it SHALL NOT emit a flattened, stale, duplicated, or partially reconstructed `w:sdt`

#### Scenario: [SDX-SDT-05] Real content-control corpus measurement is labeled without overclaiming

- **GIVEN** the repository's real existing DOCX corpus contains block-level content controls but no verified inline control fixture
- **WHEN** the real documents are compared through forced rebuild without an SDT mutation
- **THEN** the test SHALL report before/after content-control counts as block-SDT no-regression evidence
- **AND** focused inline preservation claims SHALL remain grounded in synthetic structural fixtures, not relabeled as real-world inline evidence
