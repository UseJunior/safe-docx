## 1. CLI output

- [x] 1.1 Format a `DocxMarkdocError` as one `ERROR <code>: <message> (line N)` line per issue, or a single line when it carries none.
- [x] 1.2 Print the stack only under `DEBUG`; keep the stack for other exceptions and exit code 1.

## 2. Evidence

- [x] 2.1 Test the missing-edit-name case with its line, several issues on one document, and the `DEBUG` stack path through the real CLI entry point.
