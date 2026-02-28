---
name: docx-editing
description: >-
  Surgically edit existing (brownfield) .docx files with formatting preservation
  and tracked changes via the Safe-DOCX MCP server. Use when reading, searching,
  editing, commenting on, or comparing Word documents — not for from-scratch generation.
---

# Editing .docx Files with Safe-DOCX

Safe-DOCX is a local MCP server for surgically editing existing `.docx` files. It preserves formatting, generates tracked-changes redlines, and runs entirely on the local filesystem — no hosted endpoint, no data leaves the machine.

## Safety Model

- **Local-only stdio runtime** — the MCP server runs as a child process, never binds a port.
- **Path policy** — only files under `~/` (home directory) and system temp directories are accessible. Symlinks must resolve to allowed roots.
- **Archive guardrails** — zip bomb detection and hostile payload rejection protect against malformed `.docx` inputs.

## When to Use This Skill

Use Safe-DOCX when you need to:

- Change clauses or paragraphs in an existing `.docx`
- Insert or delete content with formatting preservation
- Add comments or footnotes for reviewers
- Produce a tracked-changes redline from edits
- Compare two `.docx` files into a redline
- Extract revisions to structured JSON
- Apply layout formatting (spacing, row heights, cell padding)

## Not for From-Scratch Generation

Safe-DOCX edits already-existing `.docx` files — it does not create documents from blank. For new document generation, use a template-filling workflow (e.g. OpenAgreements). Safe-DOCX can refine generated docs downstream.

## Quick Start

```
1. read_file(file_path="~/doc.docx")        → see paragraphs + _bk_* IDs
2. grep(file_path="~/doc.docx", patterns=["target phrase"])  → find paragraph IDs
3. replace_text(session_id, target_paragraph_id, old_string, new_string, instruction)
4. save(session_id, save_to_local_path="~/doc-edited.docx")
```

## Core Workflow: Read, Locate, Edit, Save

**Step 1 — Read.** Call `read_file` with `format: "toon"` (token-efficient table) to see paragraphs and their stable `_bk_*` IDs.

**Step 2 — Locate.** Use `grep` with regex patterns to find target paragraphs. It returns paragraph IDs with surrounding context.

**Step 3 — Edit.** Use `replace_text` to swap text within a paragraph, or `insert_paragraph` to add new paragraphs before/after an anchor.

**Step 4 — Save.** Call `save` to write output. Default is `save_format: "both"` which produces a clean copy and a tracked-changes redline.

## Gotchas That Will Bite You

### Unique match required

`replace_text` needs `old_string` to match **exactly one** location in the target paragraph. If the text appears multiple times, you get `MULTIPLE_MATCHES`. Fix: include more surrounding context in `old_string`.

```
BAD:  old_string: "the Company"          → 5 matches, fails
GOOD: old_string: "the Company shall indemnify"  → 1 match, succeeds
```

### Footnote markers are display-only

`read_file` shows footnotes as `[^1]`, `[^2]`, etc., but these markers are **not part of the editable text**. You cannot search for or replace `[^1]` via `replace_text`. To modify footnotes, use the dedicated `add_footnote`, `update_footnote`, and `delete_footnote` tools.

### Hyperlinks are read-only

`read_file` shows links as `<a href="...">text</a>`, but you **cannot create new hyperlinks** via `replace_text` or `insert_paragraph`. The `<a>` tag is stripped from new text. Existing hyperlinks are preserved when surrounding text is edited.

### Paragraph IDs are session-scoped

The `_bk_*` bookmark IDs are generated when a document is opened and are **tied to that session**. Do not store or reuse IDs across sessions. Always re-read the document to get fresh IDs.

### Smart text matching

`replace_text` is tolerant of:
- Quote variants: straight `"`, curly `\u201c\u201d`, angle `\u00ab\u00bb` all match each other
- Whitespace differences: multiple spaces, tabs, and line breaks are normalized

This means you can copy text from `read_file` output and use it in `old_string` even if the underlying XML uses different quote characters.

## Formatting Tags

When writing `new_string` in `replace_text` or `insert_paragraph`, use inline tags to apply formatting:

| Tag | Effect |
|-----|--------|
| `<b>text</b>` | Bold |
| `<i>text</i>` | Italic |
| `<u>text</u>` | Underline |
| `<highlighting>text</highlighting>` | Yellow highlight |

Tags can be nested: `<b><i>bold italic</i></b>`. Formatting from the original matched text is preserved for untagged replacement text.

## Batch Edits with apply_plan

For 3+ edits on one document, prefer `apply_plan` over sequential `replace_text` calls. It validates all steps before applying any, so you get all-or-nothing transactional semantics.

```
1. read_file / grep  → gather paragraph IDs and text
2. apply_plan(file_path, steps=[
     { step_id: "1", operation: "replace_text", target_paragraph_id, old_string, new_string, instruction },
     { step_id: "2", operation: "insert_paragraph", positional_anchor_node_id, new_string, instruction },
     ...
   ])
3. save(session_id, save_to_local_path)
```

## Insert Paragraphs

`insert_paragraph` adds new content before or after an anchor paragraph.

- `position`: `"BEFORE"` or `"AFTER"` (default `"AFTER"`)
- `style_source_id`: optional `_bk_*` ID of a paragraph whose formatting you want to clone
- Multi-paragraph: separate with `\n\n` in `new_string` (each becomes its own paragraph)

## Comments and Footnotes

**Comments:** `add_comment` anchors to a paragraph (optionally to a text span via `anchor_text`). Use `get_comments` to list, `delete_comment` to remove. Supports threaded replies via `parent_comment_id`.

**Footnotes:** `add_footnote` inserts a footnote marker in a paragraph (optionally after specific text via `after_text`). Use `get_footnotes`, `update_footnote`, `delete_footnote` to manage.

## Comparing Documents

Two modes:
- **Two files:** `compare_documents(original_file_path, revised_file_path, save_to_local_path)` — produces a redline
- **Session edits:** `compare_documents(session_id)` — compares current session state against the original

Use `extract_revisions` on any document with tracked changes to get structured JSON diffs.

## Accepting Tracked Changes

Call `accept_changes(session_id)` to flatten all tracked changes into a clean document. This removes all revision markup.

## Session Behavior

- Sessions auto-create when you first use `file_path` with any tool
- Sessions expire after **1 hour** of inactivity (each tool call resets the timer)
- Call `clear_session` to clean up when done
- Documents are **normalized on open**: format-identical runs are merged and proof-error markers removed, which improves text matching reliability

## Layout Formatting

`format_layout` applies paragraph spacing, table row height, and cell padding without touching text content. Units are in twips (1/20 of a point) or DXA (1/635 of an inch).

## Path Restrictions

By default, only files under `~/` (home directory) and system temp directories are accessible. Symlinks must resolve to allowed roots.
