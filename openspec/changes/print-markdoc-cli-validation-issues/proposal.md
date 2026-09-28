# Change: Print Markdoc validation issues from the CLI instead of a stack trace

## Why

When a `.mdoc` fails validation, `requireMarkdoc` throws a `DocxMarkdocError`
whose `issues` carry each problem's code, message and line, but the CLI's
top-level handler printed only the error's stack. An agent running
`docx-markdoc validate` or `compile` learned that the file was invalid but not
why, while warnings already printed one readable line each.

## What Changes

- The CLI prints one `ERROR <code>: <message> (line N)` line per validation
  issue on a `DocxMarkdocError`, or a single `ERROR <code>: <message>` line
  when the error carries no issues.
- The stack of a `DocxMarkdocError` prints only when `DEBUG` is set; other
  exceptions keep printing their stack. The exit code stays 1.

## Impact

- Affected specs: docx-markdoc
- Affected code: `packages/docx-markdoc/src/cli.ts`, `cli-options.ts`, tests
- Related issue: #1107
