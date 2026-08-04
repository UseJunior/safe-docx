# Change: Add compare output option

## Why

The `compare` command accepts an output path only as a third positional argument, even though `-o`/`--output` is the established CLI convention. Worse, unknown single-dash options are currently absorbed as positional arguments and produce a misleading arity error.

## What Changes

- Accept `-o <path>` and `--output <path>` for `safe-docx compare`.
- Preserve the existing positional output form for compatibility.
- Reject conflicting output forms and unknown single-dash options with explicit errors.
- Advertise the output option in top-level CLI help.

## Impact

- Affected specs: `mcp-server`
- Affected code: `packages/docx-mcp/src/cli/index.ts`, CLI help, and CLI routing tests
