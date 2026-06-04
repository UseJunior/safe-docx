## ADDED Requirements

### Requirement: HTML Export Format

The Safe-Docx MCP server's `export` tool SHALL support rendering a DOCX document to semantic
HTML in addition to Markdown. When `format` is `html` the tool writes an `.html` file and
returns the rendered HTML under a format-agnostic `content` key. The tool remains DOCX only and
is not read-only.

#### Scenario: html export writes a file and returns its path and content
- **GIVEN** an open DOCX session
- **WHEN** `export` is called with `format` `html`
- **THEN** the response SHALL be successful
- **AND** it SHALL include `format` `html`, `output_path`, `bytes_written`, and `content`
- **AND** the file at `output_path` SHALL exist and contain the returned HTML

#### Scenario: default html output path derives from the source path
- **GIVEN** an open DOCX session for a file ending in `.docx`
- **WHEN** `export` is called with `format` `html` and no `output_path`
- **THEN** `output_path` SHALL be the source path with its extension replaced by `.html`

#### Scenario: html overwrite of an existing output file is blocked by default
- **GIVEN** a file already exists at the target `.html` `output_path`
- **WHEN** `export` is called with `format` `html` and without `allow_overwrite`
- **THEN** the response SHALL be an `OVERWRITE_BLOCKED` error
- **AND** the existing file SHALL be left unchanged

#### Scenario: include_markdown false omits the rendered html content
- **WHEN** `export` is called with `format` `html` and `include_markdown` false
- **THEN** the response SHALL still include `output_path` and `bytes_written`
- **AND** the response SHALL NOT include the `content` value

#### Scenario: html export rejects a Google Docs source
- **WHEN** `export` is called with `format` `html` and a `google_doc_id`
- **THEN** the response SHALL be an `UNSUPPORTED_FOR_PROVIDER` error
