## MODIFIED Requirements

### Requirement: Projection-Based Candidate Formatting Comparison

The system SHALL provide `compareProjectedFormattingFidelity(expectedCandidateXml, actualCandidateXml)` that compares the accept-all projections and the reject-all projections of two tracked-changes candidates and returns both formatting-fidelity reports plus an overall score equal to the minimum of the two projection scores, so that revision-markup granularity differences between reconstruction modes do not register as formatting divergence. Accepting a tracked removal of a paragraph-level section break SHALL remove the paragraph-owned section-properties container when the change snapshot is its only element child; it SHALL NOT remove the body-level final section-properties container or a section-properties container with live formatting children.

#### Scenario: projected fidelity ignores revision markup granularity differences

- **WHEN** two candidates encode the same insertion with different `w:ins` wrapper and run granularity but identical formatting
- **THEN** the overall projected score is exactly 1.0

#### Scenario: pipeline inplace and rebuild candidates are measurable end-to-end

- **WHEN** the comparison pipeline produces an inplace candidate and a rebuild candidate for the same original and revised documents
- **THEN** the projected formatting-fidelity comparison of the two candidates returns well-formed accept and reject reports with scores in [0, 1]

#### Scenario: accepting a tracked section-break removal does not leave a ghost section

- **GIVEN** an invented candidate whose paragraph-owned `w:sectPr` has a `w:sectPrChange` snapshot and no live section-property child
- **WHEN** accept-all and reject-all projections are compared with their corresponding revised and original source views
- **THEN** both formatting-fidelity scores are exactly 1.0
- **AND** accept-all contains no paragraph-owned section-properties container for the removed break
- **AND** reject-all restores the prior section properties

#### Scenario: live and final section properties are preserved

- **GIVEN** section-properties containers with live formatting children or a body-level final section-properties container
- **WHEN** revisions are accepted
- **THEN** those section-properties containers remain present
