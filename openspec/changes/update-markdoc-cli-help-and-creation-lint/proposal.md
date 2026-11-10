# Change: Subcommand help, one-line usage errors, and `validate --create`

## Why

`docx-markdoc --help` printed usage, but every subcommand treated `--help` as
input (#1223, gap 3). `create`, `compile` and `compile-greenfield` printed
`Unknown option --help.` with a stack trace, `import` and `export-edits` threw
`Error: Usage: …` with a stack trace, and `validate --help` tried to open a file
named `--help`. An agent could learn a command's flags and outputs only from
the README or the source, and the creation grammar `create` admits surfaced
only in its error messages.

`validate` knew only the brownfield grammar (#1223, gap 5), so a creation
source that `create` builds failed with `tag-undefined` for `section` and
`signer` and `MISSING_SOURCE`. The only way to lint a creation source was a
throwaway `create --no-pdf` into a scratch directory.

## What Changes

- `--help` or `-h` on any subcommand prints that command's usage, arguments,
  options and outputs to stdout and exits 0. Each command's help is registered
  once (`src/cli-help.ts`); the top-level usage lists the same synopses.
- `create --help` also lists the creation grammar: every frontmatter key with
  its values, the `{% section %}` attributes, and every block and inline tag
  with its attributes. The keys, tags, attributes and closed value sets are
  read from the constants in `create/validate.ts`, not copied.
- A usage error (an unknown command or option, a missing or extra argument, a
  missing option value, flags that cannot be combined) prints one
  `ERROR CLI_USAGE: <message> Run 'docx-markdoc <command> --help' for usage.`
  line to stderr and exits 1, with no stack. Every subcommand now parses its
  arguments strictly; `comments-to-footnotes` used to ignore unknown flags and
  `compile`/`verify` extra positional arguments. A Node file-system error on a
  named path (`ENOENT`, `EEXIST`, …) prints one `ERROR <code>: <message>` line.
  Both append their stack under `DEBUG`. Any other exception keeps printing
  its stack, so a defect stays visible.
- `validate --create <document.mdoc> [--style-profile profile.json]` lints a
  creation source with the checks `create` runs before rendering (source
  characters, frontmatter, the closed tag grammar, running-text keys, section
  structure), prints the same `ERROR <code>: <message> (line N)` lines `create`
  would, writes nothing, and prints a JSON summary on success.
- Creation sources are linted only on request. `validate` without `--create`
  is unchanged; it does not detect creation sources, so no existing brownfield
  result changes.
- The CLI logic moves from `cli.ts` to `cli-run.ts` (`runCli(argv, io)`), so
  tests run it in-process; `cli.ts` only connects it to the process.

## Impact

- Affected specs: docx-markdoc
- Affected code: `packages/docx-markdoc/src/cli.ts`, `cli-run.ts`,
  `cli-help.ts`, `cli-options.ts`, `errors.ts`, `create/cli-create.ts`,
  `create/validate.ts`, README
- Related issue: #1223 (gaps 3 and 5; gap 4, `pull`, is separate)
