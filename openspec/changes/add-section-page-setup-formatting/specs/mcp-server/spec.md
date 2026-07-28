## ADDED Requirements

### Requirement: DOCX Section Page Setup Formatting
The Safe-DOCX MCP server SHALL extend `format_section` with atomic partial
`page_size` and `margins` inputs while retaining `page_number_start`.

#### Scenario: Mixed page setup request is revisionable
- **GIVEN** a valid section index and page-setup leaf values
- **WHEN** `format_section` changes page numbering, page size, orientation, or
  margins in one call
- **THEN** the response SHALL return previous and resulting section projections
- **AND** one effective edit SHALL be represented by one `w:sectPrChange`

#### Scenario: Page setup objects support partial updates
- **GIVEN** a selected section with existing `w:pgSz` and `w:pgMar`
- **WHEN** `page_size` or `margins` supplies only selected leaf values
- **THEN** the supplied values SHALL change
- **AND** unspecified values SHALL remain unchanged

#### Scenario: Empty or invalid requests are transactional
- **WHEN** no writable leaf is provided, an object is empty, a value is outside
  its accepted integer domain, orientation is invalid, or a missing element
  cannot be created completely
- **THEN** the server SHALL return a structured validation error with a
  corrective hint
- **AND** serialized document XML and edit accounting SHALL remain unchanged

#### Scenario: Identical mixed request does not create an edit
- **GIVEN** every requested section property already has the supplied value
- **WHEN** `format_section` is called
- **THEN** the response SHALL report `changed: false`
- **AND** no revision or edit count SHALL be added

#### Scenario: Existing page-number-only calls remain compatible
- **WHEN** `format_section` is called with only `page_number_start`
- **THEN** it SHALL retain the existing restart behavior and response fields

#### Scenario: Unsupported providers remain rejected
- **WHEN** page setup formatting targets ODT or Google Docs
- **THEN** the server SHALL return a structured unsupported-provider error
- **AND** SHALL NOT mutate the source

### Requirement: DOCX Page Setup Formatting Preserves Document Topology
The extended section formatting tool SHALL preserve document topology and all
untargeted section content.

#### Scenario: Page setup and relationships remain narrowly scoped
- **GIVEN** a selected section with page-number format, columns, break type,
  page borders, and header/footer references
- **WHEN** page size or margins change
- **THEN** all untargeted settings and relationships SHALL remain unchanged
- **AND** section count, paragraph count, anchors, and visible text SHALL remain
  unchanged

#### Scenario: Clean and tracked saves agree on current page setup
- **GIVEN** a successful page-setup mutation
- **WHEN** the session is saved in clean and tracked forms
- **THEN** both outputs SHALL contain the requested current page setup
- **AND** only the tracked output SHALL retain the reviewable prior-properties
  record
