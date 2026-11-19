## ADDED Requirements

### Requirement: Compare documents revision grouping parameter

The `compare_documents` tool SHALL accept an optional `revision_grouping`
parameter with the values `readable-semantic` and `token-minimal`. DOCX
comparisons SHALL default to `readable-semantic`, pass the value to the
comparator, and report the applied value as `revision_grouping` in the response.
An unsupported value SHALL fail with `INVALID_PARAMS` before any comparison or
file write.

#### Scenario: compare_documents defaults to readable semantic grouping

- **GIVEN** an original and a heavily rewritten DOCX paragraph
- **WHEN** `compare_documents` runs without `revision_grouping`
- **THEN** the response SHALL report `revision_grouping: "readable-semantic"`
- **AND** the rewrite SHALL be saved as one deletion followed by one insertion with exact Accept All and Reject All text

#### Scenario: compare_documents honors token-minimal grouping on request

- **GIVEN** the same document pair
- **WHEN** `compare_documents` runs with `revision_grouping: "token-minimal"`
- **THEN** the response SHALL report `revision_grouping: "token-minimal"`
- **AND** the saved redline SHALL contain the word-level deletion/insertion alternation

#### Scenario: compare_documents rejects an unsupported revision grouping

- **GIVEN** a valid document pair
- **WHEN** `compare_documents` runs with an unsupported `revision_grouping` value
- **THEN** the tool SHALL fail with `INVALID_PARAMS`
- **AND** no output file SHALL be written
