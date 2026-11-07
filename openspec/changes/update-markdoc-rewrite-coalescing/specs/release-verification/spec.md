## ADDED Requirements

### Requirement: Authored redline evidence discloses rewrite coalescing

The independent release verifier SHALL report, from finished tracked markup
alone, the common lexical, punctuation, and whitespace tokens that appear on
both sides of one content-bearing deletion-to-insertion group. Such tokens
SHALL be classified as disclosed rewrite coalescing rather than lost only when
the group's paragraph meets the declared changed-share gate and each absorbed
island is below the declared bound. Every other common token SHALL remain a
mandatory zero-loss obligation.

#### Scenario: [REL-VERIFY-16] Bounded rewrite coalescing is disclosed, not lost
- **GIVEN** a tracked paragraph whose changed share meets the declared gate and whose absorbed islands are each below the declared bound
- **WHEN** verification runs
- **THEN** the absorbed tokens SHALL be reported as disclosed rewrite coalescing
- **AND** lost preservable tokens SHALL equal zero

#### Scenario: [REL-VERIFY-17] Coalescing outside the bound still fails
- **GIVEN** a tracked paragraph that absorbs an island at or above the declared bound, or whose changed share is below the gate
- **WHEN** verification runs
- **THEN** the absorbed tokens SHALL count as lost by class
- **AND** the gate SHALL fail
