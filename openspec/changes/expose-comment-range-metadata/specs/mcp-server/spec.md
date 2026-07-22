## ADDED Requirements

### Requirement: Comment Range Metadata Exposure

The Safe-Docx MCP server `get_comments` tool SHALL expose the structural range metadata
resolved from `commentRangeStart`/`commentRangeEnd` markers as optional snake_case fields
on each comment: `end_paragraph_id` (string or null), `start_run_index`, `start_char_offset`,
`end_run_index`, and `end_char_offset` (numbers). Comments without range markers SHALL leave
these fields undefined so the existing response shape is unchanged for legacy documents.

#### Scenario: single-paragraph range comment exposes range metadata
- **GIVEN** a document with a comment whose range markers cover a span within one paragraph
- **WHEN** `get_comments` is called
- **THEN** the comment SHALL include `end_paragraph_id` equal to `anchored_paragraph_id`
- **AND** SHALL include numeric `start_run_index`, `start_char_offset`, `end_run_index`,
  and `end_char_offset` describing the covered span

#### Scenario: multi-paragraph range comment exposes start and end paragraph ids
- **GIVEN** a document with a comment whose range starts in one paragraph and ends in a later paragraph
- **WHEN** `get_comments` is called
- **THEN** the comment's `anchored_paragraph_id` SHALL identify the paragraph containing
  `commentRangeStart`
- **AND** `end_paragraph_id` SHALL identify the distinct paragraph containing `commentRangeEnd`

#### Scenario: comment without range markers leaves range fields undefined
- **GIVEN** a document with a comment that has a `commentReference` but no
  `commentRangeStart`/`commentRangeEnd` markers
- **WHEN** `get_comments` is called
- **THEN** `end_paragraph_id`, `start_run_index`, `start_char_offset`, `end_run_index`,
  and `end_char_offset` SHALL be absent from the serialized comment
- **AND** all previously specified fields SHALL be unchanged

#### Scenario: threaded replies pass range metadata through
- **GIVEN** a document with a reply nested under a range-anchored root comment
- **WHEN** `get_comments` is called
- **THEN** each entry in `replies` SHALL carry the same optional range fields as root
  comments, populated from the reply's own resolved range metadata when present
