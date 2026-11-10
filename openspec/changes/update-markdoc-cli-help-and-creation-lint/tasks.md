## 1. Spec

- [x] 1.1 Add the `Subcommand help and one-line usage errors` and
      `Validate a creation source without building it` requirements with
      scenarios `SDX-MDOC-CLIHELP-01`–`-06`.

## 2. Implementation

- [x] 2.1 Register each subcommand's usage, arguments, options and outputs,
      and print it for `--help`/`-h` (`cli-help.ts`, `cli-run.ts`).
- [x] 2.2 Derive the `create --help` grammar from the `create/validate.ts`
      constants; export the inline tags and fill-in modes there.
- [x] 2.3 Parse every subcommand's arguments strictly and report usage and
      file-system errors on one line (`errors.ts`, `cli-options.ts`,
      `create/cli-create.ts`).
- [x] 2.4 Add `validate --create` through `lintCreationSource`
      (`create/cli-create.ts`).
- [x] 2.5 Document both in the README.

## 3. Verification

- [x] 3.1 Tests: help and usage errors for every subcommand in-process and
      through the real entry point, help coverage of every grammar constant
      with a negative control, `validate --create` on the issue's repro and
      negative controls compared with `create`, no files written, and
      brownfield `validate` unchanged.
