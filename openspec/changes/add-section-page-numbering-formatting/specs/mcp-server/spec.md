## ADDED Requirements

### Requirement: DOCX Section Discovery Tool
The Safe-DOCX MCP server SHALL provide a read-only DOCX `get_sections` tool that
returns canonical main-document section properties in document order.

#### Scenario: Section discovery returns selectable boundaries
- **WHEN** `get_sections` is called for a DOCX session
- **THEN** each section SHALL include its zero-based `section_index`,
  `location`, and nullable `anchor_paragraph_id`
- **AND** each section SHALL project its existing page-number, page-size,
  margin, and header/footer-reference metadata

#### Scenario: File-first and session reuse are supported
- **WHEN** `get_sections` is called with a DOCX `file_path`
- **THEN** the server SHALL resolve or reuse a session under the standard
  file-first contract
- **AND** repeated reads SHALL NOT increment edit accounting

### Requirement: DOCX Section Page Number Formatting Tool
The Safe-DOCX MCP server SHALL provide a revisionable DOCX `format_section` tool
that sets `page_number_start` on one section selected by `section_index`.

#### Scenario: Page numbering restarts at the requested value
- **GIVEN** a valid section index and non-negative safe integer
- **WHEN** `format_section` sets `page_number_start`
- **THEN** the resulting section SHALL report that restart
- **AND** an effective edit SHALL be represented by `w:sectPrChange`

#### Scenario: Identical restart does not create an edit
- **GIVEN** a section already using the requested restart
- **WHEN** `format_section` is called
- **THEN** the response SHALL report `changed: false`
- **AND** session edit accounting SHALL remain unchanged

#### Scenario: Invalid input is transactional
- **WHEN** `section_index` is absent, negative, unsafe, or out of range, or
  `page_number_start` is not a non-negative safe integer
- **THEN** the server SHALL return a structured validation or not-found error
- **AND** serialized document XML SHALL remain unchanged

#### Scenario: Unsupported providers are rejected
- **WHEN** `get_sections` or `format_section` targets ODT or Google Docs
- **THEN** the server SHALL return a structured unsupported-provider error
- **AND** SHALL NOT mutate the source

### Requirement: Section Formatting Preserves Untargeted Content
The section formatting tool SHALL limit its live-document mutation to the
selected section's page-number restart and tracked prior-properties record.

#### Scenario: Page setup and references survive formatting
- **GIVEN** a selected section with page size, margins, page-number format,
  columns, and header/footer references
- **WHEN** `format_section` changes its restart
- **THEN** all those untargeted settings and relationships SHALL remain unchanged
- **AND** section count, paragraph count, anchors, and visible text SHALL remain
  unchanged

#### Scenario: Clean and tracked saves agree on current state
- **GIVEN** a successful section restart mutation
- **WHEN** the session is saved in clean and tracked forms
- **THEN** both outputs SHALL contain the requested current restart
- **AND** only the tracked output SHALL retain the reviewable prior-properties
  record
