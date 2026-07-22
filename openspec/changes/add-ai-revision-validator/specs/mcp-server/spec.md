## ADDED Requirements

### Requirement: Transactional AI Revision Guard

The MCP server SHALL validate AI-authored revision markup before committing write-tool mutations to a live DOCX session.

Write-tool validation SHALL run on a cloned mutation result. If validation fails, the live session document, edit revision, cached document view, and download cache SHALL remain unchanged.

#### Scenario: invalid AI revision mutation is rejected
- **GIVEN** a write tool would produce malformed AI-authored tracked-change markup
- **WHEN** the tool is invoked
- **THEN** the server SHALL reject the request with error code `AI_REVISION_VALIDATION_FAILED`
- **AND** the response SHALL include structured validator diagnostics

#### Scenario: failed validation leaves session unchanged
- **GIVEN** a session with a known edit revision and document content
- **WHEN** a write tool mutation fails AI revision validation
- **THEN** the session edit revision SHALL remain unchanged
- **AND** subsequent `read_file` output SHALL match the pre-call session content
- **AND** no stale save artifacts SHALL be invalidated or regenerated

#### Scenario: foreign revision anomalies do not block AI writes
- **GIVEN** a session document contains malformed foreign-authored revision markup
- **WHEN** an AI write operation produces valid AI-authored revision markup
- **THEN** the write SHALL succeed
- **AND** the validation diagnostics MAY include warnings for the foreign-authored anomalies

### Requirement: Save Rejects Invalid AI Revisions

The `save` tool SHALL run AI revision validation before writing redline artifacts from a DOCX session.

#### Scenario: save fails on invalid AI revisions
- **GIVEN** a session containing malformed AI-authored revision markup
- **WHEN** `save` is called for a redline artifact
- **THEN** the server SHALL fail the request with error code `INVALID_AI_REVISIONS`
- **AND** no malformed redline artifact SHALL be written

#### Scenario: save reports foreign revision warnings
- **GIVEN** a session containing valid AI-authored revisions and malformed foreign-authored revisions
- **WHEN** `save` is called
- **THEN** the save SHALL NOT fail solely because of the foreign-authored revisions
- **AND** the response SHALL include validator warnings when diagnostics are returned
