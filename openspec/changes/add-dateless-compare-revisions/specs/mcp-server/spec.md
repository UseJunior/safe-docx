## ADDED Requirements

### Requirement: Compare surfaces can omit revision dates

Both compare CLIs SHALL accept `--no-date`, and the MCP `compare_documents`
tool SHALL accept `revision_date` (`'now'` default, `'none'`, or an ISO 8601
date-time). `--no-date` and `revision_date: 'none'` SHALL produce the library
`date: null` output.

#### Scenario: Every compare surface can omit revision dates

- **GIVEN** a pair with replaced and reordered text
- **WHEN** it is compared with `--no-date` on both CLIs and `revision_date: 'none'` on the MCP tool
- **THEN** every output SHALL equal the library `date: null` output and contain no `w:date`

#### Scenario: An invalid revision_date fails cleanly

- **GIVEN** the MCP `compare_documents` tool
- **WHEN** `revision_date` is neither `'now'`, `'none'` nor an ISO 8601 date-time
- **THEN** it SHALL fail with `INVALID_PARAMS` and write no output
