# SafeDocX — AI Document Editing (MCP Server)

SafeDocX is a local MCP server for editing `.docx` files with full formatting preservation and tracked changes. It runs via `npx -y @usejunior/safe-docx` using stdio transport.

## Trust Boundary

SafeDocX runs **locally only** — no data leaves the machine. All document reads and writes happen on the local filesystem. There is no remote endpoint.

## Available Tools

### Reading and Navigation

- **read_file** — Read document content with stable paragraph IDs (`jr_para_*`). Supports `toon`, `json`, and `simple` output formats. Use `offset`/`limit` for pagination.
- **grep** — Regex search across paragraphs. Returns paragraph anchors with match context. Use `dedupe_by_paragraph` (default true) to get one result per paragraph.
- **get_session_status** — Get session metadata including edit count and normalization stats.

### Editing

- **smart_edit** — Find-and-replace within a single paragraph by `jr_para_*` ID. Preserves formatting across run boundaries. Supports inline tags: `<b>`, `<i>`, `<u>`, `<highlighting>`.
- **smart_insert** — Insert a new paragraph before or after an anchor paragraph by `jr_para_*` ID.
- **add_comment** — Add comments or threaded replies anchored to paragraphs.
- **accept_changes** — Accept all tracked changes in the document body, producing a clean document.

### Layout

- **format_layout** — Apply deterministic paragraph spacing, table row height, and cell padding without changing text content.

### Output

- **download** — Save edited document as clean output, tracked-changes redline, or both. Default is both.
- **compare_documents** — Compare two DOCX files and produce a redline with track changes.
- **extract_revisions** — Extract tracked changes as structured JSON with before/after text per paragraph.

### Session Management

- **open_document** — Explicitly open a document session (deprecated; prefer passing `file_path` directly to other tools).
- **clear_session** — Clear one session, all sessions for a file, or all sessions.
- **duplicate_document** — Copy a source `.docx` and open a fresh session for the copy.

## Key Usage Patterns

### Edit a Document

1. Call `read_file` with `file_path` to see content and get `jr_para_*` IDs.
2. Use `grep` to find specific text and get target paragraph IDs.
3. Call `smart_edit` with `target_paragraph_id`, `old_string`, `new_string`, and `instruction`.
4. Call `download` with `save_to_local_path` to save (defaults to both clean + tracked outputs).

### Compare Two Documents

1. Call `compare_documents` with `original_file_path`, `revised_file_path`, and `save_to_local_path`.
2. Call `extract_revisions` with the saved redline `file_path` to get structured diffs.

### Review Tracked Changes

1. Call `extract_revisions` with `file_path` pointing to a document with tracked changes.
2. Review the structured JSON output with `before_text`, `after_text`, and revision details per paragraph.

## Session Behavior

- Tools accept `file_path` directly — no need to call `open_document` first.
- The server auto-resolves sessions per file path, reusing the most recent active session.
- Documents are automatically normalized on open (run merging, redline simplification) for better text matching.
