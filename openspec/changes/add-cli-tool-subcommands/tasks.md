## 1. CLI Framework & Router

- [ ] 1.1 Extend `cli/index.ts` router to support 20+ subcommands (evaluate if custom parser scales or if a lightweight library like `citty` is needed)
- [ ] 1.2 Add schema-driven flag parser: introspect Zod schemas from `SAFE_DOCX_TOOL_CATALOG` to generate `--flag` definitions
- [ ] 1.3 Add auto-generated `--help` per subcommand from tool description + Zod schema
- [ ] 1.4 Add command grouping in top-level `--help` (read, edit, session, meta categories)

## 2. Session Persistence Layer

- [ ] 2.1 Design session lockfile format (`.safedocx-session.json` with session ID, file path, timestamp, TTL)
- [ ] 2.2 Implement `cli/session_store.ts`: save/load/expire session state to filesystem
- [ ] 2.3 Integrate session store with `resolveSessionForTool()` path in CLI context
- [ ] 2.4 Add `clear-session` subcommand for explicit cleanup

## 3. Individual Tool Subcommands

- [ ] 3.1 `read-file` — Read document with `--format`, `--offset`, `--limit`, `--node-ids` flags
- [ ] 3.2 `grep` — Search paragraphs with `--pattern`, `--context` flags
- [ ] 3.3 `replace-text` — Replace text with `--para`, `--old`, `--new`, `--instruction` flags
- [ ] 3.4 `insert-paragraph` — Insert paragraph with `--before`/`--after`, `--text`, `--instruction` flags
- [ ] 3.5 `save` — Save with `-o`/`--output`, `--format`, `--author` flags
- [ ] 3.6 `get-session-status` — Session info
- [ ] 3.7 `has-tracked-changes` — Check for revision markup
- [ ] 3.8 `accept-changes` — Accept all tracked changes
- [ ] 3.9 `apply-plan` — Batch apply edit plan
- [ ] 3.10 `format-layout` — Apply spacing/layout controls
- [ ] 3.11 `add-comment`, `get-comments`, `delete-comment` — Comment management
- [ ] 3.12 `add-footnote`, `get-footnotes`, `update-footnote`, `delete-footnote` — Footnote management
- [ ] 3.13 `extract-revisions` — Extract tracked changes as JSON
- [ ] 3.14 `clear-formatting` — Remove run-level formatting
- [ ] 3.15 `compare-documents` — Alias/enhancement of existing `compare` (unified flag style)

## 4. Batched `edit` Command

- [ ] 4.1 Implement `edit` subcommand with repeatable `--replace` and `--insert-after`/`--insert-before` flags
- [ ] 4.2 Parse multi-value `--replace <para_id> <old> <new>` flag syntax
- [ ] 4.3 Add `--instruction` flag (applied to all operations in the batch)
- [ ] 4.4 Add `-o`/`--output` flag for auto-save after batch
- [ ] 4.5 Execute operations sequentially in a single session

## 5. Testing

- [ ] 5.1 Unit tests for schema-driven flag parser (Zod → CLI flags)
- [ ] 5.2 Unit tests for session persistence layer (save/load/expire/clear)
- [ ] 5.3 Integration tests for each subcommand (mock file I/O)
- [ ] 5.4 Integration tests for batched `edit` command
- [ ] 5.5 E2E test: `safe-docx read-file ... | safe-docx replace-text ... | safe-docx save ...` pipeline
- [ ] 5.6 E2E test: `safe-docx edit --replace ... --replace ... -o ...` batched workflow

## 6. Documentation & Help

- [ ] 6.1 Auto-generate `--help` text from Zod schemas + tool descriptions
- [ ] 6.2 Update top-level `safe-docx --help` with command categories and examples
- [ ] 6.3 Add usage examples to each subcommand's help text
