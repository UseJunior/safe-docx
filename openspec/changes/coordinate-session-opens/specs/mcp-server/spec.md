## ADDED Requirements

### Requirement: Provider opening and closure coordination
The manager SHALL coordinate provider single-flight work by canonical session key, registering pending work before execution and removing it only by identity. Closing a path or all sessions SHALL permanently invalidate affected opening tickets, including opens without published sessions. A cancelled opener SHALL NOT publish a session and SHALL retire candidate artifacts without removing a newer session or pending entry. Cancellation SHALL survive close/reopen sequences without reusing ticket identity.

#### Scenario: Close during provider opening
- **WHEN** close targets an in-flight DOCX, ODF, or Google Docs open, or clears all sessions
- **THEN** the opener SHALL return `SESSION_CLOSED` and no cancelled candidate SHALL become active
- **AND** local candidate artifacts SHALL be retired
- **AND** cancellation during canonical key resolution SHALL be retained for the matching key without cancelling unrelated paths

#### Scenario: Reopen survives late old completion
- **WHEN** an old open is invalidated, a new open starts, and the old open completes or fails last
- **THEN** the new pending entry and published session SHALL survive
- **AND** concurrent new callers SHALL share that new open

#### Scenario: Immediate provider failure permits retry
- **WHEN** provider work fails immediately or throws synchronously
- **THEN** its pending entry SHALL be removed
- **AND** a later open SHALL execute fresh work

#### Scenario: Explicit local open respects closure
- **WHEN** close invalidates an explicit `open_document` during loading or finalization
- **THEN** it SHALL return `SESSION_CLOSED`, retire its candidate, and preserve a later reopened session
