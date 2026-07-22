## ADDED Requirements

### Requirement: Write-Time Canonical Redline on Save
The `save` tool SHALL produce its redline artifact by serializing the session document's write-time tracked markup directly, without comparison or reconstruction. Comparison-based redlining SHALL be available only through the `compare_documents` tool. The clean artifact SHALL be produced by accepting the AI author's tracked edits, preserving pre-existing third-party revisions and leaving body blocks the AI never touched byte-identical to the source.

#### Scenario: default save serializes write-time tracked markup without comparison
- **GIVEN** a tracked session whose AI author has edited a paragraph
- **WHEN** `save` is called with tracked (or both) output
- **THEN** the redline artifact SHALL contain the write-time `w:ins`/`w:del` markup as authored
- **AND** the response SHALL report `tracked_changes_source` as `write-time`
- **AND** no comparison or reconstruction engine SHALL be invoked

#### Scenario: clean artifact accepts AI edits and preserves untouched blocks
- **GIVEN** a tracked session with an edit to one paragraph among several
- **WHEN** the clean artifact is generated
- **THEN** the edited paragraph SHALL carry the accepted final text with no residual tracked-change markup
- **AND** paragraphs the AI never touched SHALL remain byte-identical to the source document (issue #408)

#### Scenario: comparison-only fields are absent from the save report
- **WHEN** `save` completes on a tracked session
- **THEN** the response SHALL NOT include `tracked_reconstruction_mode`, `tracked_fallback_reason`, or `tracked_blocks_restored`
- **AND** the `tracked_changes_engine` and `fail_on_rebuild_fallback` parameters, if supplied, SHALL be accepted without affecting the output
