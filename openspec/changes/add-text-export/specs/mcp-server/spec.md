## ADDED Requirements

### Requirement: Plain Text Export Format

The Safe-Docx MCP server's `export` tool SHALL support a `plaintext` format that renders a
DOCX document to plain text (no markup) and writes it to a `.txt` file. The rendered content
is returned under a generic `content` field (the canonical rendered-content key for every
format); for the `plaintext` format the deprecated `markdown` alias is NOT present. As with
other formats, the tool is not read-only and is subject to the existing overwrite and write-
path guards. DOCX only.

#### Scenario: plaintext export writes a .txt file and returns its content
- **GIVEN** an open DOCX session
- **WHEN** `export` is called with `format` `plaintext`
- **THEN** the response SHALL be successful
- **AND** it SHALL include `format`, `output_path`, `bytes_written`, and `content`
- **AND** the file at `output_path` SHALL exist and contain the returned content

#### Scenario: plaintext export does not return a markdown field
- **GIVEN** an open DOCX session
- **WHEN** `export` is called with `format` `plaintext`
- **THEN** the response SHALL include `content`
- **AND** the response SHALL NOT include a `markdown` field

#### Scenario: plaintext default output path swaps the extension for .txt
- **GIVEN** an open DOCX session for a file ending in `.docx`
- **WHEN** `export` is called with `format` `plaintext` and no `output_path`
- **THEN** `output_path` SHALL be the source path with its extension replaced by `.txt`

#### Scenario: plaintext export strips inline formatting
- **GIVEN** an open DOCX session
- **WHEN** `export` is called with `format` `plaintext`
- **THEN** the returned content SHALL carry no inline formatting tags

#### Scenario: plaintext overwrite is blocked by default
- **GIVEN** a `.txt` file already exists at the target `output_path`
- **WHEN** `export` is called with `format` `plaintext` and without `allow_overwrite`
- **THEN** the response SHALL be an `OVERWRITE_BLOCKED` error
- **AND** the existing file SHALL be left unchanged
