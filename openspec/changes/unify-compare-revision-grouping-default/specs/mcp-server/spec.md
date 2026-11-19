## ADDED Requirements

### Requirement: Compare surfaces share one revision-grouping default

Every compare surface SHALL default to `readable-semantic` revision grouping: the library `compareDocuments`, the `docx-comparison` CLI, the `safe-docx compare` CLI and the MCP `compare_documents` tool, with the default defined once as `DEFAULT_COMPARE_REVISION_GROUPING`.
Both compare CLIs SHALL accept `--grouping <readable-semantic|token-minimal>` and
`--no-moves`, SHALL pass them to the comparator, and SHALL reject any other
`--grouping` value with an error naming the accepted values before reading inputs.

#### Scenario: Every compare surface gives the same default redline

- **GIVEN** a paragraph in which a three-word phrase is replaced by four words
- **WHEN** the pair is compared through the library, both CLIs and the MCP tool with no grouping option
- **THEN** every surface SHALL produce byte-identical document XML
- **AND** the change SHALL be one deletion followed by one insertion

#### Scenario: The grouping flag selects token-minimal output

- **GIVEN** the same pair
- **WHEN** either CLI runs with `--grouping token-minimal`
- **THEN** the output SHALL equal the library's explicit `token-minimal` output

#### Scenario: An unknown grouping value fails cleanly

- **GIVEN** either compare CLI
- **WHEN** it runs with `--grouping` set to an unsupported value
- **THEN** it SHALL fail with an error naming the accepted values
- **AND** no output file SHALL be written

#### Scenario: The no-moves flag suppresses move markup

- **GIVEN** a pair whose paragraphs are reordered and compare with moves by default
- **WHEN** either CLI runs with `--no-moves`
- **THEN** the output SHALL contain no `w:moveFrom` or `w:moveTo` markup
