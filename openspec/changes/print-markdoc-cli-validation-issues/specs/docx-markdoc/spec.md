## ADDED Requirements

### Requirement: CLI reports validation issues by code and line

When a `docx-markdoc` command fails with a `DocxMarkdocError`, the CLI SHALL
write one `ERROR <code>: <message>` line to stderr per validation issue the
error carries, appending ` (line N)` when the issue has a line, or a single
`ERROR <code>: <message>` line when the error carries no issues. The CLI SHALL
print the error's stack only when the `DEBUG` environment variable is set, SHALL
keep printing the stack of any other exception, and SHALL exit with code 1.

#### Scenario: [SDX-MDOC-151] A missing edit name is reported with its line
- **GIVEN** a Markdoc document whose `change` tag has an empty `edit=` name
- **WHEN** `docx-markdoc validate` runs on it without `DEBUG`
- **THEN** stderr SHALL contain a line `ERROR MISSING_EDIT_NAME: <message> (line N)` naming the tag's line
- **AND** stderr SHALL contain no stack trace
- **AND** the process SHALL exit with code 1

#### Scenario: [SDX-MDOC-152] Several issues print one line each
- **GIVEN** a Markdoc document that fails validation with more than one issue
- **WHEN** `docx-markdoc validate` runs on it
- **THEN** stderr SHALL contain exactly one `ERROR <code>: <message> (line N)` line per issue, in validation order
- **AND** a `DocxMarkdocError` carrying no issues SHALL print a single `ERROR <code>: <message>` line

#### Scenario: [SDX-MDOC-153] DEBUG appends the stack
- **GIVEN** the same invalid Markdoc document
- **WHEN** `docx-markdoc validate` runs on it with `DEBUG` set
- **THEN** stderr SHALL print the `ERROR` lines followed by the error's stack
- **AND** an exception that is not a `DocxMarkdocError` SHALL print its stack whether or not `DEBUG` is set
