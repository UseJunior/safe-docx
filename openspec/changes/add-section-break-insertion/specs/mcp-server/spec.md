## ADDED Requirements

### Requirement: DOCX Section Break Insertion Tool

The MCP server SHALL expose `insert_section_break` for DOCX sessions. The tool
SHALL target a stable paragraph id, require a supported break type, optionally
control following-section property inheritance, and optionally apply the same
page-number/page-size/margin fields supported by `format_section`.

#### Scenario: Insert and project a section break

- **WHEN** a caller inserts a section break after a current direct body paragraph
- **THEN** the response SHALL return the inserted boundary paragraph id
- **AND** it SHALL return the old and new section indexes and before/after section and paragraph counts
- **AND** `get_sections` SHALL immediately expose the new topology

#### Scenario: Invalid input does not mutate the session

- **WHEN** the paragraph id, break type, inheritance flag, or following-section properties are invalid
- **THEN** the tool SHALL return a structured actionable error
- **AND** the live session SHALL remain unchanged

#### Scenario: AI mutation policy is enforced

- **WHEN** the tool is invoked in an AI-attributed session
- **THEN** revision preflight SHALL verify that the mutation produces supported tracked markup
- **AND** the live mutation SHALL use the same revision context

