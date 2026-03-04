# Change: Add CLI subcommands for all MCP tools

## Why

Safe-Docx is advertised as both an MCP server and a CLI tool, but the CLI currently only exposes `serve` and `compare`. Every other operation (read, replace, insert, save, grep, comments, footnotes, etc.) requires speaking raw JSON-RPC over MCP stdio. This makes the tool unusable from a terminal without an MCP client, and makes scripting/debugging painful.

The open-agreements project demonstrates a better pattern: `--set key=value` flags that map cleanly to tool parameters, with structured JSON output. Safe-docx should offer the same ergonomics.

## What Changes

- **BREAKING**: None. Existing `serve` and `compare` commands are unchanged.
- Add CLI subcommands for all 20+ MCP tools, each mapping tool schema fields to `--flag value` CLI arguments.
- Add a batched `edit` subcommand as the primary editing interface: `safe-docx edit file.docx --replace ... --replace ... --insert-after ... -o output.docx`
- CLI sessions are persistent (session-aware), matching MCP behavior. A session daemon or lockfile keeps state across sequential CLI invocations.
- Paragraph targeting uses bookmark IDs only (consistent with MCP tools, no text-search selectors).
- All CLI output is structured JSON to stdout (consistent with existing `compare` command).

## Impact

- Affected specs: `mcp-server` (new CLI parity requirements)
- Affected code:
  - `packages/docx-mcp/src/cli/index.ts` — router, flag parser
  - `packages/docx-mcp/src/cli/commands/` — new subcommand files
  - `packages/docx-mcp/src/tool_catalog.ts` — introspect Zod schemas for flag generation
  - `packages/docx-mcp/src/cli/session_daemon.ts` — new: persistent session layer
