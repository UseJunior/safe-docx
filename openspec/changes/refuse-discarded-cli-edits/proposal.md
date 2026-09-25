# Change: Refuse to report success for a CLI edit that is discarded

## Why

Every MCP tool is also a `safe-docx <tool>` subcommand, but each invocation runs in a fresh in-memory session and exits. A mutating subcommand such as `replace-text` therefore reported `success: true` and a non-zero `edit_count` while the file on disk was unchanged and the edit was thrown away (#1048). `safe-docx edit` without `-o` did the same.

## What Changes

- Every tool subcommand whose catalog entry is not read-only, other than `save`, `export`, `convert-to-odt` and `close-file` (which write their own output or end the session), accepts `-o, --output <path>` and saves the edited document there. `--save-format <clean|tracked|both>` (with `-o`) is passed to the save, so a selective `accept-ai-edits` / `reject-ai-edits` can be kept as tracked output.
- A tool subcommand or `safe-docx edit` that finishes with in-memory edits and no output path exits non-zero and prints `success: false` with code `UNSAVED_EDITS_DISCARDED` and a hint pointing to `--output`. The tool's own response, which says `success: true`, is not echoed. There is no warning-plus-success mode.
- Google Docs sessions are exempt: their edits are applied to the remote document as they are made.
- If the requested save fails, only the save error is printed (no nested `success: true`).
- Top-level, per-tool and `edit --help` state the requirement (`edit --help` previously failed with a stack).
- Read-only subcommands are unaffected.

## Impact

- Affected specs: `mcp-server`
- Affected code: `packages/docx-mcp/src/cli/` (`tool_runner.ts`, `output_option.ts`, `index.ts`, `flag_parser.ts`, `help.ts`, `commands/edit.ts`), `SessionManager.listSessions`
- Behaviour change: a script that relied on `success: true` from an unsaved CLI edit now fails, which is the intent; its edit was never persisted.
