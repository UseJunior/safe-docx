## ADDED Requirements

### Requirement: Subcommand help and one-line usage errors

Every `docx-markdoc` subcommand SHALL print its usage, arguments, options and
outputs to stdout and exit 0 when its arguments include `--help` or `-h`.
`create --help` SHALL also list every frontmatter key with its values, the
`{% section %}` attributes, and every block and inline tag with its
attributes, read from the creation grammar's constants. A usage error SHALL
print one `ERROR CLI_USAGE: <message> Run 'docx-markdoc <command> --help' for
usage.` line to stderr and exit 1, and a file-system error on a named path
SHALL print one `ERROR <code>: <message>` line; neither SHALL print a stack
unless `DEBUG` is set. Any other exception SHALL keep printing its stack.

#### Scenario: [SDX-MDOC-CLIHELP-01] every subcommand prints its help and exits 0
- **GIVEN** each subcommand: import, validate, inspect, compile, verify, compile-greenfield, create, export-edits and comments-to-footnotes
- **WHEN** it runs with `--help`, with `-h`, or with `--help` after other arguments
- **THEN** stdout SHALL hold its usage, arguments, options and outputs, stderr SHALL be empty, and the exit code SHALL be 0
- **AND** the top-level `--help` SHALL list every subcommand's synopsis

#### Scenario: [SDX-MDOC-CLIHELP-02] usage errors print one line and no stack
- **GIVEN** an unknown option, a missing or extra argument, an option without its value, an unknown command, no command, and a missing input file
- **WHEN** the CLI runs each, in-process and through the real entry point
- **THEN** stderr SHALL be one `ERROR` line naming the command's `--help` (or the file-system code), with no stack frame, and the exit code SHALL be 1
- **AND** with `DEBUG` set the stack SHALL follow, and an exception that is neither a usage, file-system nor `DocxMarkdocError` SHALL print its stack

#### Scenario: [SDX-MDOC-CLIHELP-03] create help lists the whole creation grammar from its constants
- **GIVEN** the creation grammar constants: frontmatter keys, running-text keys, block and inline tags with their attributes, and the closed value sets
- **WHEN** `create --help` is printed
- **THEN** it SHALL list every key with a described value, every section attribute, every tag with each attribute, and every closed value
- **AND** a key added to the constants without a description SHALL be marked undocumented, which the test detects

### Requirement: Validate a creation source without building it

The CLI SHALL lint a creation source with `docx-markdoc validate --create
<document.mdoc> [--style-profile profile.json]`, which SHALL run the checks `create` runs on a source before it
renders anything (source characters, frontmatter, the closed tag grammar, the
running-text keys and the section structure), SHALL print the same
`ERROR <code>: <message>` lines with the same line numbers that `create`
prints for the same source, SHALL exit 1 on any problem, and SHALL write
nothing. `validate` without `--create` SHALL keep its brownfield behaviour
and SHALL NOT detect creation sources.

#### Scenario: [SDX-MDOC-CLIHELP-04] the issue's creation source passes and nothing is written
- **GIVEN** the creation source of #1223 gap 5 (frontmatter, bold text, a `{% section footer %}` and a `{% signer %}`)
- **WHEN** `validate --create` runs on it
- **THEN** it SHALL exit 0 and print a JSON summary with its sections and frontmatter
- **AND** the directory holding the source SHALL list the same files, with the same sizes and modification times, as before

#### Scenario: [SDX-MDOC-CLIHELP-05] a bad creation source fails with the message and line create prints
- **GIVEN** creation sources with an unknown frontmatter key, a frontmatter `header-align` without header text, a `{% section header-align %}` without header text, and an empty section
- **WHEN** `validate --create` and `create --no-pdf` each run on them
- **THEN** both SHALL exit 1 and print the same `ERROR` lines, including the tag's line where there is one
- **AND** an anchored source with `--create`, or `--style-profile` without `--create`, SHALL be a usage error

#### Scenario: [SDX-MDOC-CLIHELP-06] brownfield validate is unchanged
- **GIVEN** a brownfield `.mdoc` imported from a DOCX, and the creation source of #1223 gap 5
- **WHEN** `validate` runs on each without `--create`
- **THEN** the imported file SHALL print the same JSON as `requireMarkdoc`, and the creation source SHALL still fail with the brownfield grammar's errors
