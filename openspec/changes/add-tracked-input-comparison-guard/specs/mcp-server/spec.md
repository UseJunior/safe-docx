## ADDED Requirements

### Requirement: Tracked-Input Refusal in the Compare Documents Tool

The `compare_documents` tool and the `safe-docx compare` CLI command SHALL surface the comparison library's
tracked-input refusal as a deliberate, recoverable outcome. The MCP tool SHALL map `TrackedInputRevisionError` to
the distinct error code `INPUT_HAS_TRACKED_CHANGES` — never the catch-all `COMPARE_ERROR` — with a message naming
the offending operand and part and a hint pointing the caller at accepting or rejecting the input's revisions
first. The hint SHALL be actionable for the named part: `accept_changes` covers the document body and the
revisionable side stories but not headers or footers, so a detection in a header or footer part SHALL NOT
recommend `accept_changes` and SHALL instead direct the caller to produce a fully accepted or rejected copy of
the input. The refusal applies to session-mode comparison as well as two-file mode. The CLI command SHALL
propagate the error so the process exits nonzero with a message naming the offending operand. Neither surface
SHALL write an output file for a refused comparison. Clean inputs SHALL be unaffected.

#### Scenario: [SDX-TRKIN-MCP-01] compare_documents refuses tracked inputs with a distinct error code
- **GIVEN** a clean original and a revised file that already carries `w:ins` markup
- **WHEN** `compare_documents` is called in two-file mode
- **THEN** the response SHALL be an `INPUT_HAS_TRACKED_CHANGES` error, not `COMPARE_ERROR`
- **AND** the message SHALL name the `revised` operand and `word/document.xml`, with a hint referencing
  `accept_changes`
- **AND** no file SHALL be written to `save_to_local_path`

#### Scenario: [SDX-TRKIN-MCP-02] the compare CLI command surfaces the tracked-input refusal
- **GIVEN** a tracked original staged on disk
- **WHEN** the `safe-docx compare` command runs with its real default dependencies
- **THEN** the command SHALL reject with `TrackedInputRevisionError` naming the `original` operand, producing a
  nonzero process exit
- **AND** no output file SHALL be written

#### Scenario: [SDX-TRKIN-MCP-04] header and footer refusals carry an actionable hint
- **GIVEN** a revised file whose only tracked markup lives in `word/header1.xml`
- **WHEN** `compare_documents` is called in two-file mode
- **THEN** the response SHALL be an `INPUT_HAS_TRACKED_CHANGES` error naming `word/header1.xml`
- **AND** the hint SHALL NOT recommend `accept_changes`, which cannot clean headers or footers
- **AND** no output file SHALL be written

#### Scenario: [SDX-TRKIN-MCP-05] session-mode comparison of a tracked document is refused
- **GIVEN** an open session whose document already carries `w:ins` markup
- **WHEN** `compare_documents` is called in session mode
- **THEN** the response SHALL be an `INPUT_HAS_TRACKED_CHANGES` error
- **AND** no output file SHALL be written

#### Scenario: [SDX-TRKIN-MCP-03] compare_documents with clean inputs is unaffected
- **GIVEN** two clean documents with an ordinary edit between them
- **WHEN** `compare_documents` is called in two-file mode
- **THEN** the comparison SHALL succeed and the redline SHALL be written as before
