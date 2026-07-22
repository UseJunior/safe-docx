## ADDED Requirements

### Requirement: Selective Accept/Reject by Revision Identity

The MCP server SHALL provide `accept_ai_edits` and `reject_ai_edits` tools that
resolve tracked changes only within a target set — named by explicit
`revision_ids` (`w:id` values) or by `author` — and leave every non-targeted
revision byte-untouched across document.xml and supported side-story parts.

`accept_ai_edits` SHALL apply the targeted revisions (insertions promoted,
deletions removed, property/paragraph-mark changes resolved). `reject_ai_edits`
SHALL revert them (insertions removed, deletions restored, properties reverted).
Each SHALL require at least one of `revision_ids` or `author`.

#### Scenario: accept ai edits by author preserves foreign revisions
- **GIVEN** a session document with interleaved AI-authored and reviewer-authored revisions
- **WHEN** `accept_ai_edits` is called with the AI author
- **THEN** the AI revisions SHALL be accepted
- **AND** the reviewer's revisions SHALL remain present and unchanged

#### Scenario: reject ai edits by author preserves foreign revisions
- **GIVEN** a session document with interleaved AI-authored and reviewer-authored revisions
- **WHEN** `reject_ai_edits` is called with the AI author
- **THEN** the AI revisions SHALL be reverted
- **AND** the reviewer's revisions SHALL remain present and unchanged

#### Scenario: accept ai edits by explicit revision ids
- **GIVEN** a session document containing several AI revisions
- **WHEN** `accept_ai_edits` is called with a subset of `revision_ids`
- **THEN** only the listed revisions SHALL be accepted
- **AND** the response SHALL report the `selected_revision_ids` actually resolved

#### Scenario: missing selector is rejected
- **GIVEN** a session document
- **WHEN** `accept_ai_edits` is called with neither `revision_ids` nor `author`
- **THEN** the server SHALL reject the request with error code `MISSING_PARAMETER`

#### Scenario: ambiguous overlap hard-errors with structured overlaps
- **GIVEN** a session document where an AI revision structurally contains a reviewer revision
- **WHEN** `accept_ai_edits` is called for the AI author without `normalize_first`
- **THEN** the server SHALL fail with error code `AMBIGUOUS_REVISION_OVERLAP`
- **AND** the response SHALL include a structured `overlaps` list naming the offending revision pair

#### Scenario: normalize first bypasses the ambiguity error
- **GIVEN** a session document with an ambiguous revision overlap
- **WHEN** `accept_ai_edits` is called with `normalize_first` set
- **THEN** the operation SHALL succeed on a best-effort basis
- **AND** the non-targeted revision SHALL still be present
