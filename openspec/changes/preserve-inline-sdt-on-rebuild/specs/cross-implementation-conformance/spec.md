## ADDED Requirements

### Requirement: Neutral content-control scenarios remain pinned and distinguished from forced rebuild evidence

The repository SHALL pin docx-platform-tests commit
`fe0ee99602e6f982255ecaa2b45d4936a7f46150`, execute both neutral content-control
scenarios through the SafeDocX adapter, and refresh the capability projection.
Passing those ordinary edit scenarios SHALL NOT be represented as evidence that
comparison rebuild preserves inline content controls; the repo-local forced-
rebuild scenario is the distinguishing evidence for that behavior.

#### Scenario: [XIMPL-09] Both neutral content-control scenarios pass at the reviewed pin

- **GIVEN** docx-platform-tests at commit `fe0ee99602e6f982255ecaa2b45d4936a7f46150`
- **WHEN** both neutral content-control scenarios run through the SafeDocX adapter
- **THEN** the normative scenario SHALL report only `pass` or `pass-divergent`
- **AND** the metamorphic scenario SHALL report only `invariant-pass`
- **AND** `unsupported` or `error` SHALL remain non-pass outcomes and SHALL NOT be accepted through a global pass-like set
- **AND** the capability projection SHALL reference the refreshed pinned registry without claiming forced-rebuild coverage
