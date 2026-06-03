## ADDED Requirements
### Requirement: Comment and Reply Retrieval
The Safe-Docx MCP server SHALL provide a `get_comments` read-only tool that returns all
comments from the document as a threaded tree structure.

#### Scenario: get_comments returns comment metadata and text
- **GIVEN** a document containing comments
- **WHEN** `get_comments` is called
- **THEN** each comment SHALL include `id`, `author`, `date` (string or null), `initials`,
  `text`, and `anchored_paragraph_id` (string or null)
- **AND** the response SHALL include `session_id`

#### Scenario: threaded replies are nested under parent comments
- **GIVEN** a document with reply threads on comments
- **WHEN** `get_comments` is called
- **THEN** replies SHALL appear in the parent comment's `replies` array
- **AND** each reply SHALL have the same fields as root comments

#### Scenario: document with no comments returns empty array
- **GIVEN** a document with no comments
- **WHEN** `get_comments` is called
- **THEN** the response SHALL contain an empty `comments` array
- **AND** SHALL NOT return an error

#### Scenario: get_comments supports session-or-file resolution
- **WHEN** `get_comments` is called with `file_path` and no `session_id`
- **THEN** the server SHALL resolve a session per standard resolution rules
- **AND** return `session_id` in the response

#### Scenario: missing session context returns error
- **WHEN** `get_comments` is called without `session_id` or `file_path`
- **THEN** the response SHALL be a `MISSING_SESSION_CONTEXT` error

#### Scenario: get_comments does not mutate session state
- **GIVEN** a session with edit revision N
- **WHEN** `get_comments` is called
- **THEN** the session edit revision SHALL remain N
- **AND** no edit count increment SHALL occur
