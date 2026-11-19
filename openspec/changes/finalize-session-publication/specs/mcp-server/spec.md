## ADDED Requirements

### Requirement: Finalized session publication and artifact retirement
The manager SHALL publish only prepared, finalized sessions. Failed candidate preparation SHALL preserve the prior active session. Successful publication SHALL remain successful even if retiring old artifacts fails, retaining cleanup information for retry. Expiry SHALL retire artifacts idempotently and exclude expired sessions from all lookups and listings. Clear-all SHALL drain scheduled cleanup and retry failed removals.

#### Scenario: Finalized DOCX publication
- **WHEN** a DOCX candidate is created
- **THEN** normalization according to the caller's initial policy and paragraph anchoring SHALL complete before publication
- **AND** repeated finalization SHALL preserve that policy and paragraph identity
- **AND** comparison baselines SHALL remain lazy

#### Scenario: Failed candidate preserves prior resource
- **WHEN** loading, writing or finalizing a replacement fails
- **THEN** the prior active session and its artifacts SHALL remain usable
- **AND** any candidate artifacts SHALL be retired

#### Scenario: Retirement failure after publication
- **WHEN** removing the prior session's directory fails after replacement publication
- **THEN** creation SHALL return the usable replacement
- **AND** the old directory SHALL remain available for cleanup retry

#### Scenario: Expiry and repeated cleanup
- **WHEN** a session expires and is looked up or sessions are listed
- **THEN** it SHALL be excluded immediately and its artifacts SHALL be scheduled for removal
- **AND** clear-all SHALL drain pending removals safely even after repeated calls
