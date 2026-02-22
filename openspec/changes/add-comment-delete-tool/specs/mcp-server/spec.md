## ADDED Requirements
### Requirement: Comment Deletion Tool
The Safe-Docx MCP server SHALL provide a `delete_comment` tool that removes a comment
(and all its descendants, if any) from the document.

#### Scenario: delete comment successfully
- **GIVEN** a document with a comment (ID N) and no replies
- **WHEN** `delete_comment` is called with `comment_id` N
- **THEN** the response SHALL include `comment_id` and `session_id`
- **AND** `success` SHALL be true
- **AND** subsequent `get_comments` SHALL NOT include the deleted comment

#### Scenario: delete comment with replies cascades
- **GIVEN** a root comment with threaded replies (possibly multi-level)
- **WHEN** `delete_comment` is called with the root comment's ID
- **THEN** the root comment AND all descendant replies SHALL be removed
- **AND** subsequent `get_comments` SHALL return neither parent nor any descendants

#### Scenario: delete a single leaf reply
- **GIVEN** a root comment with a reply
- **WHEN** `delete_comment` is called with the reply's ID
- **THEN** only the reply SHALL be removed
- **AND** the parent comment SHALL remain with an empty replies array

#### Scenario: delete a non-leaf reply cascades to descendants
- **GIVEN** a root comment with a reply that itself has a nested reply
- **WHEN** `delete_comment` is called with the middle reply's ID
- **THEN** the middle reply AND its nested reply SHALL be removed
- **AND** the root comment SHALL remain intact

#### Scenario: missing comment_id returns error
- **WHEN** `delete_comment` is called without `comment_id`
- **THEN** the response SHALL be a `MISSING_PARAMETER` error

#### Scenario: comment not found returns error
- **WHEN** `delete_comment` is called with a `comment_id` that does not exist
- **THEN** the response SHALL be a `COMMENT_NOT_FOUND` error

#### Scenario: delete_comment supports session-or-file resolution
- **WHEN** `delete_comment` is called with `file_path` and no `session_id`
- **THEN** the server SHALL resolve a session per standard resolution rules

#### Scenario: missing session context returns error
- **WHEN** `delete_comment` is called without `session_id` or `file_path`
- **THEN** the response SHALL be a `MISSING_SESSION_CONTEXT` error
