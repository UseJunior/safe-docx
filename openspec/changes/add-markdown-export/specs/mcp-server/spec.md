## ADDED Requirements

### Requirement: Document Export

The Safe-Docx MCP server SHALL provide an `export` tool that renders a DOCX document to a
portable text format (Markdown initially) and writes the result to a file. The tool is not
read-only: it writes an output file and returns the written path, the byte count, and — by
default — the rendered content.

#### Scenario: markdown export writes a file and returns its path and content
- **GIVEN** an open DOCX session
- **WHEN** `export` is called with `format` `markdown`
- **THEN** the response SHALL be successful
- **AND** it SHALL include `format`, `output_path`, `bytes_written`, and `markdown`
- **AND** the file at `output_path` SHALL exist and contain the returned Markdown

#### Scenario: default output path derives from the source path
- **GIVEN** an open DOCX session for a file ending in `.docx`
- **WHEN** `export` is called without `output_path`
- **THEN** `output_path` SHALL be the source path with its extension replaced by `.md`

#### Scenario: explicit output_path is honored
- **WHEN** `export` is called with an `output_path`
- **THEN** the Markdown SHALL be written to that path
- **AND** `output_path` in the response SHALL reflect it

#### Scenario: overwrite of an existing output file is blocked by default
- **GIVEN** a file already exists at the target `output_path`
- **WHEN** `export` is called without `allow_overwrite`
- **THEN** the response SHALL be an `OVERWRITE_BLOCKED` error
- **AND** the existing file SHALL be left unchanged

#### Scenario: allow_overwrite permits replacing an existing output file
- **GIVEN** a file already exists at the target `output_path`
- **WHEN** `export` is called with `allow_overwrite` true
- **THEN** the response SHALL be successful
- **AND** the file SHALL contain the freshly rendered Markdown

#### Scenario: unknown export format is rejected
- **WHEN** `export` is called with a `format` other than a supported value
- **THEN** the response SHALL be an `INVALID_FORMAT` error

#### Scenario: include_markdown false omits the rendered content
- **WHEN** `export` is called with `include_markdown` false
- **THEN** the response SHALL still include `output_path` and `bytes_written`
- **AND** the response SHALL NOT include the `markdown` content

#### Scenario: export resolves a session from file_path
- **WHEN** `export` is called with `file_path` and no `session_id`
- **THEN** the server SHALL resolve a session per standard resolution rules and export it

#### Scenario: export rejects a Google Docs source
- **WHEN** `export` is called with a `google_doc_id`
- **THEN** the response SHALL be an `UNSUPPORTED_FOR_PROVIDER` error
