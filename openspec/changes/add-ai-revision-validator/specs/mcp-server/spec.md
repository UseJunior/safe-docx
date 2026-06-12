## ADDED Requirements

### Requirement: Post-Write Revision Validation Gate
The MCP server SHALL validate AI-emitted DOCX revision markup after each AI write and SHALL roll back a failed write before returning an error.

#### Scenario: failed post-write validation rolls back the edit
- **GIVEN** an active DOCX session with an AI author and revision id state
- **WHEN** an AI write emits malformed session-owned revision markup
- **THEN** the tool SHALL return `REVISION_VALIDATION_FAILED`
- **AND** the live session document SHALL be restored to its pre-write state
- **AND** the edit count SHALL NOT increment

#### Scenario: pre-existing third-party defects do not block AI edits
- **GIVEN** a document opened with malformed pre-existing revision markup
- **WHEN** an AI write emits valid session-owned revision markup
- **THEN** the write SHALL succeed
- **AND** pre-existing revision defects SHALL remain warnings rather than hard errors

#### Scenario: apply_plan remains step-level transactional
- **GIVEN** an `apply_plan` request with multiple edit steps
- **WHEN** a later step fails post-write revision validation
- **THEN** that failing step SHALL be rolled back
- **AND** earlier successful steps SHALL remain applied

#### Scenario: accept_changes is outside AI write validation
- **WHEN** `accept_changes` consumes existing tracked-change markup
- **THEN** it SHALL NOT be treated as AI revision emission for the post-write validation gate

### Requirement: Save Refuses Session-Caused Revision Errors
The MCP `save` tool SHALL run scoped revision validation before producing artifacts and SHALL refuse to save when session-owned revision markup has validation errors.

#### Scenario: save aborts before writing artifacts
- **GIVEN** a DOCX session containing malformed session-owned revision markup
- **WHEN** `save` is called
- **THEN** the server SHALL return `REVISION_VALIDATION_FAILED`
- **AND** no clean or tracked artifact SHALL be written

#### Scenario: missing baseline degrades global defects to warnings
- **GIVEN** a DOCX session with no validation baseline
- **WHEN** `save` finds revision validation issues that are not session-owned revision elements
- **THEN** the server SHALL report a validation warning
- **AND** SHALL NOT silently promote unknown pre-existing defects to hard errors
