## ADDED Requirements

### Requirement: CLI Mutating Subcommands Never Report Success For A Discarded Edit
The `safe-docx` CLI SHALL NOT report success for an edit that is discarded when its one-shot process exits. Every tool subcommand whose catalog entry is not read-only, other than those that write their own output or end the session (`save`, `export`, `convert-to-odt`, `close-file`), SHALL accept `-o, --output <path>` and save the edited document there. When such a subcommand, or `safe-docx edit`, finishes with unsaved in-memory edits and no output path, it SHALL exit non-zero and print `success: false` with error code `UNSAVED_EDITS_DISCARDED` and a hint naming the output-path option. It SHALL NOT print `success: true` alongside a warning. Google Docs sessions, whose edits are applied remotely, are exempt.

#### Scenario: [SDX-CLI-01] A mutating subcommand without an output path is refused and the file is unchanged
- **GIVEN** a `.docx` on disk
- **WHEN** `safe-docx replace-text` (or another mutating subcommand, or `safe-docx edit`) applies an edit to it without `-o/--output`
- **THEN** the process SHALL exit non-zero
- **AND** stderr SHALL carry `success: false` with `error.code` `UNSAVED_EDITS_DISCARDED` and a hint naming `--output <path>`
- **AND** no `success: true` SHALL be printed
- **AND** the input file SHALL be byte-for-byte unchanged

#### Scenario: [SDX-CLI-02] A mutating subcommand with an output path saves the edit
- **GIVEN** a `.docx` on disk
- **WHEN** `safe-docx replace-text` applies an edit with `--output <path>`
- **THEN** the command SHALL succeed and the file at `<path>` SHALL contain the edit
- **AND** the input file SHALL be unchanged

#### Scenario: [SDX-CLI-03] Read-only subcommands are unaffected
- **WHEN** a read-only subcommand (`read-file`, `grep`, `get-*`, `extract-revisions`, `has-tracked-changes`) runs without an output path
- **THEN** it SHALL succeed and print its result as before

#### Scenario: [SDX-CLI-04] Help states the output-path requirement
- **WHEN** top-level help or a mutating subcommand's `--help` is shown
- **THEN** it SHALL document `-o, --output <path>` and the `UNSAVED_EDITS_DISCARDED` refusal
