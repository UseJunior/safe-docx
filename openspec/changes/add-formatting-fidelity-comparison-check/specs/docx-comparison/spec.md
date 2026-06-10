## ADDED Requirements

### Requirement: Formatting-Fidelity Comparison Check

The system SHALL provide a deterministic, in-engine formatting comparison `compareFormattingFidelity(expectedDocumentXml, actualDocumentXml)` that aligns the two views by paragraph text content and reports formatting divergence across run properties (`w:rPr`), paragraph properties (`w:pPr`), table properties (`w:tblPr`/`w:trPr`/`w:tcPr`), and section properties (`w:sectPr`), producing a structured per-property divergence report and a scalar formatting-fidelity score in [0, 1] where exact preservation scores exactly 1.0.

#### Scenario: identical document views score perfect formatting fidelity

- **WHEN** the same document.xml view is compared against itself
- **THEN** the score is exactly 1.0 with zero divergences and zero unaligned paragraphs

#### Scenario: dropped run bold is reported as a char-weighted run divergence

- **WHEN** the actual view drops `w:b` from a run whose text is preserved
- **THEN** a run-scope divergence with property "bold" and kind "removed" is reported, the run dimension counts the affected characters as divergent, and the score is below 1.0

#### Scenario: differing run splits with identical formatting do not reduce fidelity

- **WHEN** the actual view carries the same paragraph text split into different `w:r` boundaries with equivalent run properties
- **THEN** the score is exactly 1.0 with zero divergences

#### Scenario: dropped paragraph alignment is reported as a paragraph divergence

- **WHEN** the actual view drops `w:jc` from a paragraph's `w:pPr`
- **THEN** a paragraph-scope divergence with property "alignment" and kind "removed" is reported and the paragraph dimension records one divergent unit

#### Scenario: dropped table cell shading is reported as a table divergence

- **WHEN** the actual view drops `w:shd` from a table cell's `w:tcPr` while the cell text is preserved
- **THEN** a table-scope divergence is reported and the table dimension records the affected paragraph as divergent

#### Scenario: changed page size is reported as a section divergence

- **WHEN** the actual view carries a `w:sectPr` whose `w:pgSz` differs from the expected view
- **THEN** a section-scope divergence with property `w:pgSz` and kind "changed" is reported

#### Scenario: namespace declaration placement does not register as formatting divergence

- **WHEN** the actual view serializes a property element with an inline `xmlns:*` declaration while the expected view inherits the same namespace binding from an ancestor, all other attributes being identical
- **THEN** the score is exactly 1.0 with zero divergences, because namespace declarations record where a prefix is bound rather than formatting

#### Scenario: unaligned paragraph content lowers alignment coverage not formatting tallies

- **WHEN** a paragraph's text differs between the two views so it cannot be content-aligned
- **THEN** the unaligned paragraph is counted in the unaligned tallies and lowers the score through alignment coverage, while the formatting dimensions count only aligned paragraphs

### Requirement: Projection-Based Candidate Formatting Comparison

The system SHALL provide `compareProjectedFormattingFidelity(expectedCandidateXml, actualCandidateXml)` that compares the accept-all projections and the reject-all projections of two tracked-changes candidates and returns both formatting-fidelity reports plus an overall score equal to the minimum of the two projection scores, so that revision-markup granularity differences between reconstruction modes do not register as formatting divergence.

#### Scenario: projected fidelity ignores revision markup granularity differences

- **WHEN** two candidates encode the same insertion with different `w:ins` wrapper and run granularity but identical formatting
- **THEN** the overall projected score is exactly 1.0

#### Scenario: pipeline inplace and rebuild candidates are measurable end-to-end

- **WHEN** the comparison pipeline produces an inplace candidate and a rebuild candidate for the same original and revised documents
- **THEN** the projected formatting-fidelity comparison of the two candidates returns well-formed accept and reject reports with scores in [0, 1]
