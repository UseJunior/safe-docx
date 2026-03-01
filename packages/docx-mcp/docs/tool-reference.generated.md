# Safe Docx Tool Reference (Generated)

This file is generated from `src/tool_catalog.ts`.
Do not edit manually. Regenerate with:

`npm run docs:generate:tools -w @usejunior/safe-docx`

## `read_file`

Read document content with paragraph IDs. Accepts session_id or file_path.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
| `offset` | `number` | no |  |
| `limit` | `number` | no |  |
| `node_ids` | `array<string>` | no |  |
| `format` | `enum("toon", "json", "simple")` | no |  |
| `show_formatting` | `boolean` | no | When true (default), shows inline formatting tags (<b>, <i>, <u>, <highlighting>, <a>). When false, emits plain text with no inline tags. |

## `grep`

Search paragraphs with regex. Accepts session_id or file_path.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
| `patterns` | `array<string>` | yes |  |
| `case_sensitive` | `boolean` | no |  |
| `whole_word` | `boolean` | no |  |
| `max_results` | `number` | no |  |
| `context_chars` | `number` | no |  |
| `dedupe_by_paragraph` | `boolean` | no |  |

## `init_plan`

Initialize revision-bound context metadata for coordinated multi-agent planning. Accepts session_id or file_path.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
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

Validate and apply a batch of edit steps (replace_text, insert_paragraph) to a session document in one call. Validates all steps first; applies only if all pass. Accepts inline steps or a plan_file_path. Compatible with merge_plans output.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
| `steps` | `array<object>` | no | JSON array of edit steps. Each step needs step_id, operation, and operation-specific fields. |
| `plan_file_path` | `string` | no | Path to a .json file containing an array of edit steps. Mutually exclusive with steps. |

## `replace_text`

Replace text in a paragraph by _bk_* id, preserving formatting. Accepts session_id or file_path.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
| `target_paragraph_id` | `string` | yes |  |
| `old_string` | `string` | yes |  |
| `new_string` | `string` | yes |  |
| `instruction` | `string` | yes |  |
| `normalize_first` | `boolean` | no | Merge format-identical adjacent runs before searching. Useful when text is fragmented across runs. |

## `insert_paragraph`

Insert a paragraph before/after an anchor paragraph by _bk_* id. Accepts session_id or file_path.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
| `positional_anchor_node_id` | `string` | yes |  |
| `new_string` | `string` | yes |  |
| `instruction` | `string` | yes |  |
| `position` | `enum("BEFORE", "AFTER")` | no |  |
| `style_source_id` | `string` | no | Paragraph _bk_* ID to clone formatting (pPr and template run) from instead of the positional anchor. Falls back to anchor with a warning if not found. |

## `save`

Save clean and/or tracked changes output back to the local filesystem. Defaults to both clean and tracked outputs when no format override is provided. Accepts session_id or file_path.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
| `save_to_local_path` | `string` | yes |  |
| `clean_bookmarks` | `boolean` | no |  |
| `save_format` | `enum("clean", "tracked", "both")` | no |  |
| `allow_overwrite` | `boolean` | no |  |
| `tracked_save_to_local_path` | `string` | no |  |
| `tracked_changes_author` | `string` | no |  |
| `tracked_changes_engine` | `enum("auto", "atomizer", "diffmatch")` | no |  |
| `fail_on_rebuild_fallback` | `boolean` | no | When true, return an error instead of a destructive output if the comparison engine falls back to rebuild mode (which destroys table structure). Default: false. |

## `format_layout`

Apply deterministic OOXML layout controls (paragraph spacing, table row height, cell padding). Accepts session_id or file_path.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
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
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |

## `has_tracked_changes`

Check whether the document body contains tracked-change markers (insertions, deletions, moves, and property-change records). Read-only.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |

## `get_session_status`

Get session metadata. Accepts session_id or file_path.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |

## `clear_session`

Clear one session, all sessions for a file path, or all sessions with explicit confirmation.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
| `clear_all` | `boolean` | no |  |
| `confirm` | `boolean` | no |  |

## `add_comment`

Add a comment or threaded reply to a document. Provide target_paragraph_id + anchor_text for root comments, or parent_comment_id for replies.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
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
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |

## `delete_comment`

Delete a comment and all its threaded replies from the document. Cascade-deletes all descendants.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
| `comment_id` | `number` | yes | Comment ID to delete. |

## `compare_documents`

Compare two DOCX documents and produce a tracked-changes output document. Provide original_file_path + revised_file_path for standalone comparison, or session_id/file_path to compare session edits against the original.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `original_file_path` | `string` | no | Path to the original DOCX file. |
| `revised_file_path` | `string` | no | Path to the revised DOCX file. |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
| `save_to_local_path` | `string` | yes | Path to save the tracked-changes DOCX output. |
| `author` | `string` | no | Author name for track changes. Default: 'Comparison'. |
| `engine` | `enum("auto", "atomizer", "diffmatch")` | no | Comparison engine. Default: 'auto'. |

## `get_footnotes`

Get all footnotes from the document with IDs, display numbers, text, and anchored paragraph IDs. Read-only.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |

## `add_footnote`

Add a footnote anchored to a paragraph. Optionally position the reference after specific text using after_text. Note: [^N] markers in read_file output are display-only and not part of the editable text used by replace_text.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
| `target_paragraph_id` | `string` | yes | Paragraph ID to anchor the footnote to. |
| `after_text` | `string` | no | Text after which to insert the footnote reference. If omitted, appends at end of paragraph. |
| `text` | `string` | yes | Footnote body text. |

## `update_footnote`

Update the text content of an existing footnote.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
| `note_id` | `number` | yes | Footnote ID to update. |
| `new_text` | `string` | yes | New footnote body text. |

## `delete_footnote`

Delete a footnote and its reference from the document.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
| `note_id` | `number` | yes | Footnote ID to delete. |

## `clear_formatting`

Clear specific run-level formatting (bold, italic, underline, highlight, color, font) from paragraphs. Accepts session_id or file_path.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
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
| `session_id` | `string` | no |  |
| `file_path` | `string` | no |  |
| `offset` | `number` | no | 0-based offset for pagination. Default: 0. |
| `limit` | `number` | no | Max entries per page (1-500). Default: 50. |
