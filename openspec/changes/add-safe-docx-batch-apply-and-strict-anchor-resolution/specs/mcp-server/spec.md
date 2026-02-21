## ADDED Requirements

### Requirement: Canonical Edit and Insert Naming Only
The Safe-Docx MCP surface SHALL expose canonical mutation tool names and SHALL NOT expose legacy smart aliases.

#### Scenario: canonical names are advertised
- **WHEN** clients request the MCP tool catalog
- **THEN** canonical names `replace_text` and `insert_paragraph` are listed

#### Scenario: legacy aliases are unavailable
- **WHEN** clients inspect the MCP tool catalog
- **THEN** `smart_edit` and `smart_insert` are not listed

#### Scenario: legacy aliases are rejected inside plan operations
- **GIVEN** a merge plan step declares `operation: smart_edit` or `operation: smart_insert`
- **WHEN** `merge_plans` validates that step
- **THEN** the step is rejected with an unsupported operation conflict

### Requirement: MCP Tool Catalog Uses File-First Entry Without open_document
The MCP-exposed tool surface SHALL rely on file-first session entry and SHALL NOT expose `open_document` as a callable MCP tool.

#### Scenario: MCP catalog omits open_document
- **WHEN** clients request the MCP tool catalog
- **THEN** `open_document` is not listed
- **AND** file-first document tools remain available for session auto-resolution

#### Scenario: open_document call is rejected as unsupported
- **WHEN** a client attempts to call `open_document` via MCP
- **THEN** the server returns an unknown/unsupported tool error
- **AND** error guidance directs callers to file-first tool calls (`read_file`, `grep`, `replace_text`, `insert_paragraph`, `download`, `get_session_status`)

## MODIFIED Requirements

### Requirement: Tool Session Entry for Safe-Docx MCP
The Safe-Docx MCP server SHALL support file-first entry for document tools while preserving explicit session semantics.

#### Scenario: document tools accept file-first entry without pre-open
- **WHEN** any document tool (`read_file`, `grep`, `replace_text`, `insert_paragraph`, `download`, `get_session_status`) is called with `file_path` and without `session_id`
- **THEN** the server SHALL resolve a session for that file (reusing an active one or creating a new one)
- **AND** return `resolved_session_id` and `resolved_file_path` in response metadata
