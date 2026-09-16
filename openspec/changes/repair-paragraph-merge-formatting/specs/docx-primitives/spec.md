## ADDED Requirements

### Requirement: Evidence-backed paragraph merge formatting

Accept and Reject paragraph-mark resolution SHALL treat paragraph-break removal and surviving paragraph formatting as separately verified concerns. Changes to the formatting-selection rule SHALL be supported by a documented decision table and conformance evidence, with independent reader measurements and their limitations recorded. A paragraph SHALL NOT be deleted solely because all of its run content disappears under projection.

#### Scenario: Merge formatting differs from the existing following-mark assumption

- **GIVEN** a tracked paragraph break whose measured formatting differs from the existing following-paragraph rule
- **WHEN** a replacement rule is implemented
- **THEN** the affected content-survival cases SHALL have regression tests in core and comparison projections
- **AND** the rule SHALL NOT be generalized to unmeasured cases solely to make a reader test pass

#### Scenario: Untracked empty paragraph remains

- **GIVEN** all run content disappears under projection but the paragraph mark is not removed in that projection
- **WHEN** Accept or Reject resolves the revisions
- **THEN** the paragraph SHALL remain, including its applicable formatting

#### Scenario: Selective merge retains following pending property history

- **GIVEN** the leading formatting owner has no property history and the following paragraph carries another author's pending property revisions
- **WHEN** only the paragraph break author's revisions are accepted or rejected
- **THEN** the following author's pending property history SHALL remain unresolved on the merged paragraph
- **AND** selected property revisions SHALL resolve before merged formatting is chosen in unfiltered Reject projections

#### Scenario: Reader evidence does not establish Word behavior

- **GIVEN** a projection has been checked only in LibreOffice
- **WHEN** the repair's evidence is reported
- **THEN** Word projection behavior SHALL remain explicitly unverified
- **AND** any unresolved normative or reader conflict SHALL block a claimed general formatting correction
