## MODIFIED Requirements

### Requirement: Suite Revision Is SHA-Pinned

The self-check SHALL pin docx-platform-tests PR #57 merge commit
`ba9936af06cc18249e892dc594ed9bcefaf98463`, execute both content-control
scenarios through the real neutral runner, and validate outcomes according to
their oracle class.

#### Scenario: [XIMPL-09] Both neutral content-control scenarios pass at the reviewed pin

- **GIVEN** docx-platform-tests at commit `ba9936af06cc18249e892dc594ed9bcefaf98463`
- **WHEN** the safe-docx adapter runs both content-control scenarios
- **THEN** the normative scenario SHALL report only `pass` or `pass-divergent`
- **AND** the metamorphic scenario SHALL report only `invariant-pass`
- **AND** ordinary adapter results SHALL NOT be presented as forced-rebuild evidence
