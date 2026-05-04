# Safe Docx Tool Reference (Generated)

This file is generated from `src/tool_catalog.ts`.
Do not edit manually. Regenerate with:

`npm run docs:generate:tools -w @usejunior/safe-docx`

## `read_file`

Read document content (DOCX or Google Doc). Output is token-limited (~14k tokens) by default with pagination metadata (has_more, next_offset). Use offset/limit to paginate.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |
| `offset` | `number` | no | 1-based paragraph offset for pagination. Negative values count from end. |
| `limit` | `number` | no | Max paragraphs to return. When omitted, output is token-limited to ~14k tokens with pagination. |
| `node_ids` | `array<string>` | no |  |
| `format` | `enum("toon", "json", "simple")` | no |  |
| `comment_rendering` | `enum("none", "paragraph_notes", "endnotes", "inline_markers")` | no | How to render comments in read_file output. Use "paragraph_notes" (default) for paragraph-local comment threads, "inline_markers" to add `[cm-start:N]`/`[cm-end:N]` milestones in TOON output (combined with the thread blocks), "endnotes" to collect threaded comments into a trailing #COMMENTS block in TOON output, or "none" for the legacy output with no comment rendering. |
| `show_formatting` | `boolean` | no | When true (default), shows inline formatting tags (<b>, <i>, <u>, <highlighting>, <a>). When false, emits plain text with no inline tags. |

## `grep`

Search paragraphs with regex. Use file_path for session-based search, file_paths for stateless multi-file search, or google_doc_id for Google Docs.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |
| `file_paths` | `array<string>` | no | Multiple file paths for stateless multi-file search. No session created. |
| `patterns` | `array<string>` | no |  |
| `pattern` | `string` | no |  |
| `case_sensitive` | `boolean` | no |  |
| `whole_word` | `boolean` | no |  |
| `max_results` | `number` | no |  |
| `context_chars` | `number` | no |  |
| `dedupe_by_paragraph` | `boolean` | no |  |
| `search_xml` | `boolean` | no | When true, search raw XML (word/document.xml) instead of paragraph text. |
| `include_context` | `boolean` | no | When false, skip document view context (list labels, headers) for faster results. Default: true. |

## `init_plan`

Initialize revision-bound context metadata for coordinated multi-agent planning.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX file. |
| `plan_name` | `string` | no |  |
| `orchestrator_id` | `string` | no |  |

## `merge_plans`

Deterministically merge multiple sub-agent plans and detect hard conflicts before apply.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `plans` | `array<object>` | yes |  |
| `fail_on_conflict` | `boolean` | no |  |
| `require_shared_base_revision` | `boolean` | no |  |

## `apply_plan`

Validate and apply a batch of edit steps (replace_text, insert_paragraph) to a document in one call. Validates all steps first; applies only if all pass. Accepts inline steps or a plan_file_path. Compatible with merge_plans output.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX file. |
| `steps` | `array<object>` | no | JSON array of edit steps. Each step needs step_id, operation, and operation-specific fields. |
| `plan_file_path` | `string` | no | Path to a .json file containing an array of edit steps. Mutually exclusive with steps. |

## `replace_text`

Replace text in a paragraph by _bk_* id, preserving formatting. Supports DOCX and Google Docs.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |
| `target_paragraph_id` | `string` | yes |  |
| `old_string` | `string` | yes |  |
| `new_string` | `string` | yes |  |
| `instruction` | `string` | yes |  |
| `normalize_first` | `boolean` | no | Merge format-identical adjacent runs before searching. Useful when text is fragmented across runs. |

## `insert_paragraph`

Insert a paragraph before/after an anchor paragraph by _bk_* id. Supports DOCX and Google Docs.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |
| `positional_anchor_node_id` | `string` | yes |  |
| `new_string` | `string` | yes |  |
| `instruction` | `string` | yes |  |
| `position` | `enum("BEFORE", "AFTER")` | no |  |
| `style_source_id` | `string` | no | Paragraph _bk_* ID to clone formatting (pPr and template run) from instead of the positional anchor. Falls back to anchor with a warning if not found. |

## `save`

Save document. For DOCX: saves clean and/or tracked changes output. For Google Docs: checkpoint (default) returns revisionId, or snapshot exports as DOCX.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |
| `save_to_local_path` | `string` | yes |  |
| `clean_bookmarks` | `boolean` | no |  |
| `save_format` | `enum("clean", "tracked", "both")` | no |  |
| `allow_overwrite` | `boolean` | no |  |
| `tracked_save_to_local_path` | `string` | no |  |
| `tracked_changes_author` | `string` | no |  |
| `tracked_changes_engine` | `enum("auto", "atomizer")` | no |  |
| `fail_on_rebuild_fallback` | `boolean` | no | When true, return an error instead of a destructive output if the comparison engine falls back to rebuild mode (which destroys table structure). Default: false. |

## `format_layout`

Apply layout controls (paragraph spacing, table row height, cell padding). Google Docs supports paragraph spacing only.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |
| `strict` | `boolean` | no |  |
| `paragraph_spacing` | `object` | no |  |
| `row_height` | `object` | no |  |
| `cell_padding` | `object` | no |  |

## `accept_changes`

Accept all tracked changes in the document body, producing a clean document with no revision markup. Returns acceptance stats.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX file. |

## `has_tracked_changes`

Check whether the document body contains tracked-change markers (insertions, deletions, moves, and property-change records). Read-only.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX file. |

## `get_file_status`

Get file/session metadata including edit count, normalization stats, and cache info. Supports DOCX and Google Docs.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |

## `close_file`

Close an open file session, or close all sessions with explicit confirmation. Supports DOCX and Google Docs.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |
| `clear_all` | `boolean` | no |  |
| `confirm` | `boolean` | no |  |

## `add_comment`

Add a comment or threaded reply to a document. Provide target_paragraph_id + anchor_text for root comments, or parent_comment_id for replies.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX file. |
| `target_paragraph_id` | `string` | no | Paragraph ID to anchor the comment to (for root comments). |
| `anchor_text` | `string` | no | Text within the paragraph to anchor the comment to. If omitted, anchors to entire paragraph. |
| `parent_comment_id` | `number` | no | Parent comment ID for threaded replies. |
| `author` | `string` | yes | Comment author name. |
| `text` | `string` | yes | Comment body text. |
| `initials` | `string` | no | Author initials (defaults to first letter of author name). |

## `get_comments`

Get all comments from the document with IDs, authors, dates, text, and anchored paragraph IDs. Includes threaded replies. Read-only.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX file. |

## `delete_comment`

Delete a comment and all its threaded replies from the document. Cascade-deletes all descendants.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX file. |
| `comment_id` | `number` | yes | Comment ID to delete. |

## `compare_documents`

Compare two DOCX documents and produce a tracked-changes output document. Provide original_file_path + revised_file_path for standalone comparison, or file_path to compare session edits against the original.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `original_file_path` | `string` | no | Path to the original DOCX file. |
| `revised_file_path` | `string` | no | Path to the revised DOCX file. |
| `file_path` | `string` | no | Path to the DOCX file. |
| `save_to_local_path` | `string` | yes | Path to save the tracked-changes DOCX output. |
| `author` | `string` | no | Author name for track changes. Default: 'Comparison'. |
| `engine` | `enum("auto", "atomizer")` | no | Comparison engine. Default: 'auto'. |

## `get_footnotes`

Get all footnotes from the document with IDs, display numbers, text, and anchored paragraph IDs. Read-only.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX file. |

## `add_footnote`

Add a footnote anchored to a paragraph. Optionally position the reference after specific text using after_text. Note: [^N] markers in read_file output are display-only and not part of the editable text used by replace_text.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX file. |
| `target_paragraph_id` | `string` | yes | Paragraph ID to anchor the footnote to. |
| `after_text` | `string` | no | Text after which to insert the footnote reference. If omitted, appends at end of paragraph. |
| `text` | `string` | yes | Footnote body text. |

## `update_footnote`

Update the text content of an existing footnote.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX file. |
| `note_id` | `number` | yes | Footnote ID to update. |
| `new_text` | `string` | yes | New footnote body text. |

## `delete_footnote`

Delete a footnote and its reference from the document.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX file. |
| `note_id` | `number` | yes | Footnote ID to delete. |

## `clear_formatting`

Clear specific run-level formatting (bold, italic, underline, highlight, color, font) from paragraphs.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX file. |
| `paragraph_ids` | `array<string>` | no | Paragraph IDs to clear formatting from. If omitted, clears from all paragraphs. |
| `clear_highlight` | `boolean` | no | Remove highlight formatting. |
| `clear_bold` | `boolean` | no | Remove bold formatting. |
| `clear_italic` | `boolean` | no | Remove italic formatting. |
| `clear_underline` | `boolean` | no | Remove underline formatting. |
| `clear_color` | `boolean` | no | Remove font color. |
| `clear_font` | `boolean` | no | Remove font family and size. |

## `extract_revisions`

Extract tracked changes as structured JSON with before/after text per paragraph, revision details, and comments. Supports pagination via offset and limit. Read-only - does not modify the document.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX file. |
| `offset` | `number` | no | 0-based offset for pagination. Default: 0. |
| `limit` | `number` | no | Max entries per page (1-500). Default: 50. |
