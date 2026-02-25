# SafeDocX — AI Document Editing (MCP Server)

SafeDocX is a local MCP server for editing `.docx` files with full formatting preservation and tracked changes. It runs via `npx -y @usejunior/safe-docx` using stdio transport.

## Trust Boundary

SafeDocX runs **locally only** — no data leaves the machine. All document reads and writes happen on the local filesystem. There is no remote endpoint.

## Available Tools

### Reading and Navigation

- **read_file** — Read document content with stable paragraph IDs (`_bk_*`). Supports `toon`, `json`, and `simple` output formats. Use `offset`/`limit` for pagination.
- **grep** — Regex search across paragraphs. Returns paragraph anchors with match context. Use `dedupe_by_paragraph` (default true) to get one result per paragraph.
- **get_session_status** — Get session metadata including edit count and normalization stats.
- **has_tracked_changes** — Check whether the document contains tracked-change markers (insertions, deletions, moves, property changes). Read-only.

### Planning and Batch Operations

- **init_plan** — Initialize revision-bound context metadata for coordinated multi-agent planning.
- **merge_plans** — Merge multiple sub-agent plans and detect hard conflicts before apply.
- **apply_plan** — Validate and apply a batch of edit steps (replace_text, insert_paragraph) in one call. All-or-nothing.

### Editing

- **replace_text** — Find-and-replace within a single paragraph by `_bk_*` ID. Preserves formatting across run boundaries. Supports inline tags: `<b>`, `<i>`, `<u>`, `<highlighting>`.
- **insert_paragraph** — Insert a new paragraph before or after an anchor paragraph by `_bk_*` ID. Optional `style_source_id` to clone formatting from a different paragraph.
- **add_comment** — Add comments or threaded replies anchored to paragraphs.
- **get_comments** — Get all comments with IDs, authors, dates, anchored paragraphs, and threaded replies. Read-only.
- **delete_comment** — Delete a comment and all its threaded replies.
- **accept_changes** — Accept all tracked changes in the document body, producing a clean document.

### Footnotes

- **get_footnotes** — Get all footnotes with IDs, display numbers, text, and anchored paragraph IDs. Read-only.
- **add_footnote** — Add a footnote anchored to a paragraph with optional positioning via `after_text`.
- **update_footnote** — Update the text content of an existing footnote.
- **delete_footnote** — Delete a footnote and its reference from the document.

### Layout

- **format_layout** — Apply deterministic paragraph spacing, table row height, and cell padding without changing text content.

### Output

- **download** — Save edited document as clean output, tracked-changes redline, or both. Default is both.
- **compare_documents** — Compare two DOCX files and produce a redline with track changes.
- **extract_revisions** — Extract tracked changes as structured JSON with before/after text per paragraph. Supports pagination.

### Session Management

- **clear_session** — Clear one session, all sessions for a file, or all sessions.
- **duplicate_document** — Copy a source `.docx` and open a fresh session for the copy.

## Key Usage Patterns

### Edit a Document

1. Call `read_file` with `file_path` to see content and get `_bk_*` IDs.
2. Use `grep` to find specific text and get target paragraph IDs.
3. Call `replace_text` with `target_paragraph_id`, `old_string`, `new_string`, and `instruction`.
4. Call `download` with `save_to_local_path` to save (defaults to both clean + tracked outputs).

### Batch Edits (Multi-Agent)

1. Call `init_plan` with `file_path` to get a revision-bound planning context.
2. Build edit steps as JSON (each with `step_id`, `operation`, and operation-specific fields).
3. Call `apply_plan` with `steps` to validate and apply all edits atomically.

### Compare Two Documents

1. Call `compare_documents` with `original_file_path`, `revised_file_path`, and `save_to_local_path`.
2. Call `extract_revisions` with the saved redline `file_path` to get structured diffs.

### Review Tracked Changes

1. Call `extract_revisions` with `file_path` pointing to a document with tracked changes.
2. Review the structured JSON output with `before_text`, `after_text`, and revision details per paragraph.

## Session Behavior

- Tools accept `file_path` directly for session auto-resolution.
- The server auto-resolves sessions per file path, reusing the most recent active session.
- Documents are automatically normalized on open (run merging, redline simplification) for better text matching.
