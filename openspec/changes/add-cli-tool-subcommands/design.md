## Context

Safe-Docx has a rich set of 20+ MCP tools but only 2 CLI commands (`serve`, `compare`). Users and scripts interacting from a terminal must spin up an MCP server and speak JSON-RPC, which is impractical for one-off edits, debugging, and shell pipelines.

The open-agreements project demonstrates a clean `--set key=value` pattern. Safe-docx needs an equivalent that feels native to its document-editing workflow.

## Goals / Non-Goals

### Goals
- Full CLI parity: every MCP tool accessible as a CLI subcommand
- Session-aware: persistent sessions across CLI invocations (matches MCP behavior)
- Batched editing: primary `edit` command for multi-operation workflows
- Introspectable: generate CLI flags from existing Zod tool schemas (single source of truth)
- Consistent: JSON output to stdout, errors to stderr (matches existing `compare` command)

### Non-Goals
- Interactive/TUI editing interface (out of scope)
- Text-search paragraph targeting (bookmark IDs only, per user decision)
- GUI or web interface
- Breaking changes to existing `serve` or `compare` commands

## Decisions

### 1. Session persistence via filesystem lockfile

**Decision**: Use a `.safedocx-session.json` file in a temp directory (keyed by absolute file path hash) to persist session state across CLI invocations.

**Why**: Simpler than a daemon process. The SessionManager already serializes/deserializes sessions. A lockfile approach:
- No background process to manage
- Survives terminal crashes (sessions have TTL-based expiry)
- `safe-docx clear-session` cleans up explicitly

**Alternatives considered**:
- Unix socket daemon: More complex, requires lifecycle management, overkill for CLI usage
- Re-open on every invocation: Loses edit state, defeats the purpose of sessions
- In-memory only: No persistence across commands

### 2. Schema-driven flag generation

**Decision**: Generate CLI `--flag` definitions by introspecting the Zod schemas in `SAFE_DOCX_TOOL_CATALOG`. Each Zod field maps to a CLI flag:
- `z.string()` → `--flag <value>`
- `z.number()` → `--flag <number>`
- `z.boolean()` → `--flag` (presence = true) or `--flag true|false`
- `z.enum([...])` → `--flag <choice1|choice2|...>`
- `z.string().optional()` → flag is optional
- `z.array(z.string())` → repeatable `--flag <value>` (collected into array)

**Why**: Single source of truth. Adding a new parameter to a tool's Zod schema automatically surfaces it in the CLI. No manual sync needed.

**Alternatives considered**:
- Manual flag definitions per command: Duplicate maintenance, drift risk
- Codegen at build time: More complex build pipeline, but could be a future optimization

### 3. Batched `edit` command as primary interface

**Decision**: Introduce `safe-docx edit <file> [--replace ...] [--insert-after ...] [-o output]` as the primary CLI editing command. Individual subcommands (`safe-docx replace-text`, `safe-docx insert-paragraph`) exist but are secondary.

**Why**: Real editing workflows involve multiple operations. Batching avoids the concurrent race condition entirely (all operations run sequentially in one process with one session) and matches how Claude's parallel tool use works.

**Syntax**:
```bash
# Batched edit (primary)
safe-docx edit ~/Downloads/Bylaws.docx \
  --replace _bk_721a "Section 1.1" "Article 1.1" \
  --replace _bk_3bc6 "ACME Corp" "WXY Corp" \
  --insert-after _bk_721a "Effective January 1, 2026." \
  -o ~/Downloads/Bylaws-edited.docx

# Individual subcommands (secondary)
safe-docx replace-text ~/Downloads/Bylaws.docx \
  --para _bk_721a \
  --old "Section 1.1" \
  --new "Article 1.1" \
  --instruction "rename to article"
```

### 4. Command naming: kebab-case matching tool names

**Decision**: CLI subcommand names match MCP tool names but with kebab-case:
- `read_file` → `safe-docx read-file`
- `replace_text` → `safe-docx replace-text`
- `insert_paragraph` → `safe-docx insert-paragraph`
- `get_session_status` → `safe-docx get-session-status`

**Why**: Predictable mapping. Users familiar with MCP tool names can guess CLI command names.

### 5. Output format

**Decision**: JSON to stdout (matching existing `compare` command). Errors to stderr with non-zero exit code.

```bash
# Successful read
safe-docx read-file ~/Downloads/Bylaws.docx
# → {"success": true, "session_id": "ses_...", "content": "...", ...}

# Failed operation
safe-docx read-file /nonexistent.docx
# stderr: Error: FILE_NOT_FOUND — File not found: /nonexistent.docx
# exit code: 1
```

### 6. Session context flags

**Decision**: All session-aware commands accept:
- Positional `<file_path>` as first argument (most common case)
- `--session <session_id>` flag for explicit session reference
- `--file <file_path>` as an alias for the positional argument

```bash
# These are equivalent:
safe-docx read-file ~/Downloads/Bylaws.docx
safe-docx read-file --file ~/Downloads/Bylaws.docx

# Explicit session:
safe-docx read-file --session ses_abc123
```

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Session lockfile corruption on crash | TTL-based expiry. `clear-session` for manual cleanup. Lockfile stores session ID + timestamp. |
| Schema-driven flags may produce awkward CLI ergonomics for complex types | Manual overrides for specific commands (e.g., `edit` batched syntax). Schema-driven is the default, not the only option. |
| Large surface area (20+ subcommands) | Group under help categories (read, edit, session, meta). Prioritize `edit`, `read-file`, `save`, `grep` in docs. |
| Custom parser may not scale to 20+ subcommands | Consider adopting a lightweight parser library if manual parsing becomes unwieldy. The current custom parser works for 2 commands but may need enhancement. |

## Open Questions

1. Should `safe-docx edit` auto-save if `-o` is provided, or require an explicit `--save` flag?
2. Should session state persist to `$TMPDIR` (auto-cleaned by OS) or to `~/.safedocx/sessions/` (user-managed)?
3. Should we add a `safe-docx interactive` REPL mode in a future phase?
4. For the `edit` command's `--replace` flag, what's the best syntax for the 3 required values (para_id, old_string, new_string)? Options:
   - `--replace _bk_id "old" "new"` (positional within the flag)
   - `--replace para=_bk_id,old="old",new="new"` (key=value within the flag)
   - `--replace _bk_id --old "old" --new "new"` (separate flags per replace — but then how to batch?)
