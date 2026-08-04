## ADDED Requirements

### Requirement: Compare CLI output option

The Safe-DOCX CLI SHALL allow a comparison output path to be supplied with either `-o <path>` or `--output <path>`, while preserving the existing third positional output argument for compatibility. It SHALL reject ambiguous output declarations and SHALL report unrecognized single-dash options as options rather than absorbing them as positional arguments.

#### Scenario: [CLI-OUTPUT-01] Compare accepts the short output option

- **WHEN** a user runs `safe-docx compare original.docx revised.docx -o result.docx`
- **THEN** the comparison output path is `result.docx`

#### Scenario: [CLI-OUTPUT-02] Compare accepts the long output option

- **WHEN** a user runs `safe-docx compare --output result.docx original.docx revised.docx`
- **THEN** the comparison output path is `result.docx`

#### Scenario: [CLI-OUTPUT-03] Compare rejects conflicting output forms

- **WHEN** a user supplies both the positional output and `-o` or `--output`
- **THEN** the command fails with an error identifying the conflicting output forms

#### Scenario: [CLI-OUTPUT-04] Compare rejects unknown single-dash options

- **WHEN** a user supplies an unrecognized single-dash token such as `-x`
- **THEN** the command fails with an unknown-option error that names the token
