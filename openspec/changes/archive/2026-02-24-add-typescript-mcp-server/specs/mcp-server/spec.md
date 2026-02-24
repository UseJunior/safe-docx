# mcp-server Spec Delta: TypeScript MCP Server

## ADDED Requirements

### Requirement: MCP Server Core Functionality

The SafeDocX MCP server SHALL provide DOCX document editing capabilities via the Model Context Protocol, including session management, tool registration, and cross-platform compatibility.

#### Scenario: Zero-friction installation on Claude Desktop
- **GIVEN** a user has Claude Desktop installed
- **WHEN** the SafeDocX MCP server is configured
- **THEN** the server starts and registers all core tools without additional setup

#### Scenario: NPM package availability
- **GIVEN** the SafeDocX package is published to npm
- **WHEN** a user installs the package
- **THEN** the package includes type definitions and all required assets

#### Scenario: Read-only tools annotated correctly
- **GIVEN** the MCP server is running
- **WHEN** tool annotations are inspected
- **THEN** read-only tools are annotated as non-destructive

#### Scenario: Destructive tools annotated correctly
- **GIVEN** the MCP server is running
- **WHEN** tool annotations are inspected
- **THEN** destructive tools are annotated as such

### Requirement: Session Management

The server SHALL manage document editing sessions with creation, expiration, and concurrency support.

#### Scenario: Session creation
- **GIVEN** a valid DOCX file path
- **WHEN** open_document is called
- **THEN** a new session is created with a unique ID

#### Scenario: Session expiration
- **GIVEN** an existing session
- **WHEN** the session TTL elapses
- **THEN** the session is expired and resources are released

#### Scenario: Concurrent sessions
- **GIVEN** multiple DOCX files
- **WHEN** multiple sessions are created concurrently
- **THEN** each session operates independently

### Requirement: Cross-Platform Compatibility

The server SHALL work correctly on macOS and Windows, handling platform-specific path conventions.

#### Scenario: macOS compatibility
- **GIVEN** a macOS environment with tilde paths
- **WHEN** the server processes file paths
- **THEN** tilde expansion works correctly via stdio transport

#### Scenario: Windows compatibility
- **GIVEN** a Windows environment with backslash paths
- **WHEN** the server processes file paths
- **THEN** backslash paths are handled correctly via stdio transport

### Requirement: Error Handling

The server SHALL return meaningful error responses for common failure modes.

#### Scenario: File not found error
- **GIVEN** a non-existent file path
- **WHEN** open_document is called
- **THEN** a clear file-not-found error is returned

#### Scenario: Invalid file type error
- **GIVEN** a non-DOCX file path
- **WHEN** open_document is called
- **THEN** a clear invalid-file-type error is returned

#### Scenario: Session not found error
- **GIVEN** an invalid session ID
- **WHEN** a session-dependent tool is called
- **THEN** a clear session-not-found error is returned

### Requirement: Tool Registration

Each MCP tool SHALL be registered and functional.

#### Scenario: open_document tool
- **GIVEN** a valid DOCX file
- **WHEN** open_document is called
- **THEN** the document is opened and a session is returned

#### Scenario: read_file tool
- **GIVEN** an active session
- **WHEN** read_file is called
- **THEN** the document content is returned

#### Scenario: grep tool
- **GIVEN** an active session with document content
- **WHEN** grep is called with a search pattern
- **THEN** matching content is returned

#### Scenario: replace_text tool
- **GIVEN** an active session
- **WHEN** replace_text is called with target and replacement text
- **THEN** the text is replaced in the document

#### Scenario: insert_paragraph tool
- **GIVEN** an active session
- **WHEN** insert_paragraph is called
- **THEN** a new paragraph is inserted at the specified location

#### Scenario: download tool
- **GIVEN** an active session with modifications
- **WHEN** download is called
- **THEN** the modified DOCX file is produced

#### Scenario: get_session_status tool
- **GIVEN** an active session
- **WHEN** get_session_status is called
- **THEN** the session status information is returned

### Requirement: Edit Integrity

Document edits SHALL preserve formatting and use bookmark-based targeting without corrupting the XML structure.

#### Scenario: Format-preserving text replacement
- **GIVEN** a document with formatted text
- **WHEN** text is replaced via replace_text
- **THEN** the original formatting is preserved

#### Scenario: Bookmark-based targeting
- **GIVEN** a document with internal bookmarks
- **WHEN** an edit targets a bookmarked location
- **THEN** the edit is applied at the correct bookmark position

#### Scenario: No XML corruption
- **GIVEN** a session with multiple edits
- **WHEN** edits, inserts, and downloads are performed in sequence
- **THEN** the resulting DOCX has valid XML structure
