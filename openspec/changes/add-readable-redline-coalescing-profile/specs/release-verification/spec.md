## MODIFIED Requirements

### Requirement: Authored redline verification distinguishes token minimality from readable whitespace grouping

The independent release verifier SHALL evaluate finished tracked markup under
exactly one declared authored-redline policy. Under `authored-zero-loss`, every
checker-owned common token SHALL remain ordinary. Under
`authored-readable-whitespace-v1`, every common lexical, punctuation, and
structural token SHALL remain ordinary, while a common U+0020-only whitespace
token MAY be classified as allowed readability coalescing only when the
finished tracked markup independently proves that the token occurs on both
sides of one eligible paired replacement group and exact accept-all/reject-all
projections pass. Evidence SHALL report mandatory losses separately from
allowed coalesced whitespace and SHALL NOT describe the latter as token-minimal.

#### Scenario: [REL-VERIFY-04] Surgical edit has zero minimality loss
- **GIVEN** a paragraph with an exact surgical tracked edit
- **WHEN** verification runs under `authored-zero-loss`
- **THEN** lost preservable tokens SHALL equal zero
- **AND** preservation efficiency SHALL equal 100 percent

#### Scenario: [REL-VERIFY-05] Coarse replacement fails despite exact projections
- **GIVEN** a redline that deletes and reinserts lexical, punctuation, structural, or unexplained whitespace content that could remain ordinary
- **AND** accept-all and reject-all are otherwise exact
- **WHEN** authored-redline verification runs
- **THEN** the release certificate SHALL fail with paragraph diagnostics

#### Scenario: [REL-VERIFY-13] Declared readable whitespace is disclosed and passes
- **GIVEN** finished tracked markup containing an eligible paired replacement group with common plain spaces on both revision sides
- **AND** accept-all and reject-all exactly reproduce their operands
- **WHEN** verification runs under `authored-readable-whitespace-v1`
- **THEN** the spaces SHALL be reported as allowed readability coalescing rather than mandatory token loss
- **AND** the certificate SHALL pass without claiming zero-loss token minimality

#### Scenario: [REL-VERIFY-14] Policy mismatch fails closed
- **GIVEN** readable whitespace coalescing in finished tracked markup
- **WHEN** verification runs under `authored-zero-loss`, or the readable shape is not independently eligible
- **THEN** the authored-redline gate SHALL fail
- **AND** evidence SHALL identify the unexplained or disallowed token loss

