## ADDED Requirements

### Requirement: get_footnotes Tool
The `get_footnotes` MCP tool SHALL return all footnotes with their IDs, display numbers, text, and anchored paragraph IDs.

#### Scenario: read all footnotes
- **GIVEN** a document with 2 footnotes
- **WHEN** `get_footnotes` is called
- **THEN** the response SHALL include 2 footnote entries with id, display_number, text, and anchored_paragraph_id

#### Scenario: empty document returns empty array
- **GIVEN** a document with no footnotes
- **WHEN** `get_footnotes` is called
- **THEN** the response SHALL include an empty footnotes array

### Requirement: add_footnote Tool
The `add_footnote` MCP tool SHALL create a footnote anchored to a target paragraph with optional text positioning.

#### Scenario: add footnote successfully
- **GIVEN** a valid session and paragraph ID
- **WHEN** `add_footnote` is called with target_paragraph_id and text
- **THEN** the response SHALL include the allocated note_id and session_id

#### Scenario: error when anchor paragraph not found
- **WHEN** `add_footnote` is called with a non-existent target_paragraph_id
- **THEN** the response SHALL have error code `ANCHOR_NOT_FOUND`

#### Scenario: error when after_text not found
- **WHEN** `add_footnote` is called with after_text that does not exist in the paragraph
- **THEN** the response SHALL have error code `TEXT_NOT_FOUND`

### Requirement: update_footnote Tool
The `update_footnote` MCP tool SHALL update the text content of an existing footnote.

#### Scenario: update footnote successfully
- **GIVEN** a document with a footnote
- **WHEN** `update_footnote` is called with note_id and new_text
- **THEN** the response SHALL confirm success with session_id

#### Scenario: error when note not found
- **WHEN** `update_footnote` is called with a non-existent note_id
- **THEN** the response SHALL have error code `NOTE_NOT_FOUND`

### Requirement: delete_footnote Tool
The `delete_footnote` MCP tool SHALL remove a footnote and its reference from the document.

#### Scenario: delete footnote successfully
- **GIVEN** a document with a footnote
- **WHEN** `delete_footnote` is called with note_id
- **THEN** the response SHALL confirm success

#### Scenario: error when note not found
- **WHEN** `delete_footnote` is called with a non-existent note_id
- **THEN** the response SHALL have error code `NOTE_NOT_FOUND`

#### Scenario: error when deleting reserved type
- **WHEN** `delete_footnote` is called for a reserved footnote (separator/continuationSeparator)
- **THEN** the response SHALL have error code `RESERVED_TYPE`

### Requirement: Inline Footnote Markers in read_file
The `read_file` output SHALL show `[^N]` markers where footnote references appear in paragraph text.

#### Scenario: markers present in document view
- **GIVEN** a document with footnote references in paragraphs
- **WHEN** `read_file` is called
- **THEN** the output SHALL include `[^N]` tokens at the reference positions

#### Scenario: markers absent from edit matching
- **GIVEN** a paragraph containing a footnote reference
- **WHEN** `replace_text` is called on that paragraph
- **THEN** the matching SHALL NOT include `[^N]` markers in the searchable text
