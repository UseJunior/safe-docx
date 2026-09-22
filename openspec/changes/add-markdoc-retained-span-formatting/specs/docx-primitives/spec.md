## ADDED Requirements

### Requirement: Text-preserving run-range formatting is bounded

The docx-primitives library SHALL provide a bounded run-range operation that
changes only explicitly declared direct character properties while preserving
the interval's visible text, undeclared properties, and surrounding structure.

#### Scenario: [SDX-RUNFMT-01] Range formatting preserves text and neighboring structure
- **GIVEN** an admitted paragraph interval within one coalesced formatting class
- **WHEN** direct highlight is removed from that interval
- **THEN** boundary runs MAY be split at exact visible-text offsets
- **AND** text, undeclared properties, wrappers, embedded content, and neighboring runs SHALL remain semantically unchanged

#### Scenario: [SDX-RUNFMT-02] Unsupported run structure fails transactionally
- **GIVEN** a requested interval that crosses embedded content or an unsupported wrapper boundary
- **WHEN** run-range formatting is requested
- **THEN** the operation SHALL fail before mutation with a stable diagnostic
