# Safe Docx Tool Reference (Generated)

This file is generated from `src/tool_catalog.ts`.
Do not edit manually. Regenerate with:

`npm run docs:generate:tools -w @usejunior/safe-docx`

## `read_file`

Read document content (DOCX, ODT, or Google Doc). Output is token-limited (~14k tokens) by default with pagination metadata (has_more, next_offset). Use offset/limit to paginate.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX or ODT file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |
| `offset` | `number` | no | 1-based paragraph offset for pagination. Negative values count from end. |
| `limit` | `number` | no | Max paragraphs to return. When omitted, output is token-limited to ~14k tokens with pagination. |
| `node_ids` | `array<string>` | no | Paragraph selectors. Each accepts a safe-docx `_bk_*` id, or (DOCX only) any other bookmark name — e.g. a host application's own stable paragraph bookmark — whose w:id-paired range covers exactly one paragraph. Exact name match; a point bookmark or a multi-paragraph range is refused. Returned rows always report the paragraph's canonical `_bk_*` id, even when selected by another bookmark name; results are de-duplicated and returned in document order. |
| `format` | `enum("toon", "json", "simple")` | no |  |
| `comment_rendering` | `enum("none", "paragraph_notes", "endnotes", "inline_markers")` | no | How to render comments in read_file output. Use "paragraph_notes" (default) for paragraph-local comment threads, "inline_markers" to add `[cm-start:N]`/`[cm-end:N]` milestones in TOON output (combined with the thread blocks), "endnotes" to collect threaded comments into a trailing #COMMENTS block in TOON output, or "none" for the legacy output with no comment rendering. |
| `show_formatting` | `boolean` | no | When true (default), shows inline formatting tags (<b>, <i>, <u>, <highlighting>, <a>). When false, emits plain text with no inline tags. |
| `include_fingerprint` | `boolean` | no | When true and format="json", include a portable content_fingerprint ("sha256:nfkc:<32hex>") on each paragraph. Read-only metadata derived from the paragraph's normalized visible text; NOT an edit anchor. Edit tools accept a `_bk_*` ID, or (DOCX only) any other bookmark name whose w:id-paired range covers exactly that one paragraph. No effect on TOON/simple output. Ignored for Google Docs and ODT. |
| `include_fingerprint_ordinal` | `boolean` | no | When true together with include_fingerprint and format="json", add duplicate-disambiguation metadata to each paragraph: `content_fingerprint_ordinal` (1-based document-order position among paragraphs sharing the same content_fingerprint), `content_fingerprint_count_in_document` (total paragraphs sharing it, document-wide even under pagination), and `portable_paragraph_ref` ("<content_fingerprint>#<ordinal>"). Read-only disambiguator, NOT an edit anchor; reordering duplicates may change ordinals. No effect without include_fingerprint, and no effect on TOON/simple output. Ignored for Google Docs and ODT. Default: false. |
| `include_footnotes` | `boolean` | no | Single-call body + footnotes retrieval. When true and format="json", the response gains a document-wide TOP-LEVEL `footnotes` array — each entry is {id, display_number, ref_paragraph_ids (an ARRAY of the paragraph ids that reference it), paragraphs[] ({text, tagged_text with run-level formatting tags, style})} — preserving multi-paragraph bodies and footnote-internal bold/italic/citation formatting. This top-level array is NOT inlined into content[], so the 1:1 content[] index invariant is preserved. For backward compatibility a lightweight per-node `footnotes` array ({id, display_number, text}) is ALSO attached to each paragraph node it anchors, windowed to the returned slice. When true and format="toon", a trailing `#FOOTNOTES` sidecar block is appended (symmetric with `#COMMENTS`). Footnotes with an empty body or display_number 0 are excluded. No effect on simple output. Ignored for Google Docs and ODT. Default: false. |

## `get_document_outline`

Get a compact structural map of a document's headings (DOCX only). Each entry is `{paragraph_id, text, level, source}`. Deterministic sources are `word_style`, `list_metadata`, and `outline_level`, selected in that precedence order and included by default. Heuristic sources are `run_in_header`, `title_with_period`, `title_with_colon`, `title_caps_centered`, and `title_bare`; set include_heuristic_headings=true to include them. JSON preserves levels 1-9; Markdown clamps visual ATX depth to 6. Read-only.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX file. |
| `format` | `enum("json", "markdown")` | no | Output format: 'json' (default, structured outline array) or 'markdown' (indented ATX outline under `content`). |
| `include_heuristic_headings` | `boolean` | no | When true, also include heuristic title/run-in/centered-caps headings alongside deterministic word_style, list_metadata, and outline_level headings. Default: false (all deterministic sources only). |

## `get_sections`

Read DOCX main-document sections in document order. Returns zero-based session-relative section_index values, paragraph/body boundary metadata, page numbering, page size, margins, and header/footer relationship references. Call again after any operation that changes section topology. Read-only.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX or ODT file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |

## `grep`

Search paragraphs with regex. Use file_path for session-based search, file_paths for stateless multi-file search, or google_doc_id for Google Docs. ODT supported via file_path (single-file) only.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX or ODT file. |
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

## `batch_edit`

Single-agent front door for applying multiple edit steps (replace_text, insert_paragraph) to a document in one call. Validates all steps first, rejects conflicts before applying anything, then executes valid steps sequentially. Accepts inline steps or a plan_file_path JSON array. Surface: revisionable — every applied step emits native OOXML tracked changes.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX or ODT file. |
| `steps` | `array<object>` | no | JSON array of edit steps. Each step needs step_id, operation, and operation-specific fields. |
| `plan_file_path` | `string` | no | Path to a .json file containing an array of edit steps. Mutually exclusive with steps. |

## `replace_text`

Replace text in a paragraph by provider paragraph id, preserving formatting where supported. Supports DOCX, ODT, and Google Docs. To delete an ordinary DOCX body paragraph, pass its complete visible text as old_string and an empty new_string; a clean save removes the paragraph and a tracked save keeps the deletion for review. Do not use this shortcut for paragraphs that carry section properties, are structurally required by a table cell, or own bookmark/comment anchors without inspecting the structure first. Surface: revisionable — DOCX edits emit native OOXML tracked changes (w:ins/w:del/w:rPrChange).

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX or ODT file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |
| `target_paragraph_id` | `string` | yes | Paragraph anchor. Accepts a safe-docx `_bk_*` id, or (DOCX only) any other bookmark name — e.g. a host application's own stable paragraph bookmark — whose w:id-paired range covers exactly this one paragraph. Exact name match; a point bookmark or a multi-paragraph range is refused. |
| `old_string` | `string` | yes |  |
| `new_string` | `string` | yes |  |
| `instruction` | `string` | yes |  |
| `normalize_first` | `boolean` | no | Merge format-identical adjacent runs before searching. Useful when text is fragmented across runs. |

## `insert_paragraph`

Insert a paragraph before/after an anchor paragraph by paragraph id. Supports DOCX, ODT, and Google Docs. (ODT paragraph ids are positional and shift after insertion — re-read before further edits.) Surface: revisionable — DOCX insertions emit native OOXML tracked changes.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX or ODT file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |
| `positional_anchor_node_id` | `string` | yes | Anchor paragraph. Accepts a safe-docx `_bk_*` id, or (DOCX only) any other bookmark name — e.g. a host application's own stable paragraph bookmark — whose w:id-paired range covers exactly this one paragraph. Exact name match; a point bookmark or a multi-paragraph range is refused. |
| `new_string` | `string` | yes |  |
| `instruction` | `string` | yes |  |
| `position` | `enum("BEFORE", "AFTER")` | no |  |
| `style_source_id` | `string` | no | Paragraph anchor to clone formatting (pPr and template run) from instead of the positional anchor. Accepts a `_bk_*` ID, or (DOCX only) any other bookmark name whose w:id-paired range covers exactly that one paragraph. Falls back to anchor with a warning if not found. |

## `save`

Persist the current in-memory document session. For DOCX: saves clean and/or tracked changes output. For ODT: saves an .odt package. For Google Docs: checkpoint (default) returns revisionId, or snapshot exports as DOCX. Surface: revisionable — the save report lists both the AI revisions applied and a non-revision change manifest of any package-level mutations (comment/footnote side parts, relationships) that have no tracked-change wrapper.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX or ODT file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |
| `save_to_local_path` | `string` | yes |  |
| `clean_bookmarks` | `boolean` | no | Controls removal of internal bookmarks from DOCX output. Behavior is intentionally three-way: OMIT (recommended for tracked/persistence saves) preserves the document's own bookmarks — only safe-docx paragraph anchors (`_bk_*`) are removed. Explicit `true` ALSO strips harness edit-span bookmarks (`edit-*`) to produce a clean deliverable; do NOT pass it when the tracked output feeds a redline pipeline, because that reproduces the pre-#609 loss of `edit-*` anchors. `false` keeps all bookmarks. Omitting is NOT equivalent to passing `true` — they differ precisely in whether original `edit-*` bookmarks survive. |
| `save_format` | `enum("clean", "tracked", "both")` | no |  |
| `allow_overwrite` | `boolean` | no |  |
| `allow_discard_preserved_revisions` | `boolean` | no | Explicitly allow a clean artifact to auto-accept remaining revisions by the session AI author after accept_ai_edits/reject_ai_edits selectively left revisions unresolved. Default: false. |
| `tracked_save_to_local_path` | `string` | no |  |
| `tracked_changes_author` | `string` | no |  |
| `tracked_changes_engine` | `enum("auto", "atomizer")` | no | Deprecated and ignored (#126). The redline is now the session's write-time tracked markup, serialized directly — there is no comparison engine to select. Use the compare_documents tool for comparison-based redlines. |
| `fail_on_rebuild_fallback` | `boolean` | no | Deprecated and ignored (#126). The default save no longer runs the comparison reconstruction engine, so there is no rebuild fallback to guard against; accepted for backward compatibility only. |

## `export`

Export a document to a portable rendering (Markdown, semantic HTML, or plain text). Writes an output file (default: source path with the format extension, e.g. .md, .html, or .txt) and returns its path, byte count, and the rendered content (under `content`). Intentionally lossy (no round-trip); HTML is the semantic tier, not pixel-faithful. DOCX only — Google Docs is not supported.

- readOnly: `false`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX or ODT file. |
| `format` | `enum("markdown", "html", "plaintext")` | no | Output format: 'markdown' (default, writes .md), 'html' (writes .html), or 'plaintext' (writes .txt). |
| `output_path` | `string` | no | Where to write the rendering. Defaults to the source path with the format extension. |
| `allow_overwrite` | `boolean` | no | Overwrite output_path if it already exists. Default: false. |
| `include_markdown` | `boolean` | no | Include the rendered content (under `content`) in the response. Default: true; set false for large documents. |

## `convert_to_odt`

Convert a DOCX document to OpenDocument Text (.odt) using the native model-to-model converter (no LibreOffice involved). Writes the .odt (default: source path with the .odt extension), validates ODF packaging safety before writing, and returns the output path plus a `lossiness` summary itemizing every downgraded construct. Conversion is semantic and intentionally lossy: text, headings, bold/italic/underline, hyperlinks, lists, and tables are mapped; richer styling, tracked changes, comments, and headers/footers are not. DOCX in, ODT out — Google Docs and .odt inputs are not supported.

- readOnly: `false`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX or ODT file. |
| `output_path` | `string` | no | Where to write the .odt. Defaults to the source path with the .odt extension. |
| `allow_overwrite` | `boolean` | no | Overwrite output_path if it already exists. Default: false. |

## `format_layout`

Apply layout controls (paragraph spacing, table row height, cell padding). Google Docs supports paragraph spacing only. Surface: revisionable — DOCX geometry edits emit native property-change revisions (w:pPrChange/w:trPrChange/w:tcPrChange).

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX or ODT file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |
| `strict` | `boolean` | no |  |
| `paragraph_spacing` | `object` | no |  |
| `row_height` | `object` | no |  |
| `cell_padding` | `object` | no |  |

## `format_numbering`

Change one DOCX body paragraph’s direct numbering reference. Use remove=true to drop direct w:numPr, match_paragraph_id to adopt another paragraph’s explicit numbering, or num_id with ilvl to reference an existing numbering definition. This tool does not create numbering definitions or change style-inherited numbering. Effective edits emit a native w:pPrChange; identical requests are no-ops.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX or ODT file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |
| `target_paragraph_id` | `string` | yes | Target paragraph anchor returned by read_file. |
| `remove` | `boolean` | no | Set true to remove the target paragraph’s direct w:numPr. |
| `match_paragraph_id` | `string` | no | Copy this paragraph’s complete direct num_id and ilvl to the target. |
| `num_id` | `string` | no | Existing positive decimal w:numId from this DOCX; requires ilvl. |
| `ilvl` | `integer` | no | Existing numbering level for num_id; requires num_id. |

## `format_section`

Partially update one DOCX section’s page-number restart, page dimensions/orientation, or margins using a zero-based section_index from get_sections. Effective calls emit one native w:sectPrChange and preserve section topology, page-number format, columns, break type, and header/footer references. Orientation is literal and does not automatically swap dimensions. This tool does not create sections or edit header/footer content.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX or ODT file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |
| `section_index` | `integer` | yes | Zero-based session-relative index returned by get_sections. |
| `page_number_start` | `integer` | no | Non-negative page number at which this section starts. |
| `page_size` | `object` | no | Partial page-size update. Both dimensions are required when w:pgSz is absent. |
| `margins` | `object` | no | Partial margin update in twips. All seven values are required when w:pgMar is absent. |

## `insert_section_break`

Insert a tracked DOCX section break after a stable direct-body paragraph. The new boundary preserves the containing section’s page setup and header/footer relationship references. The following section inherits current properties by default; set inherit_properties=false to reset non-relationship properties, and optionally provide page-number/page-size/margin overrides in new_section. Call get_sections again after success because section indexes change.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX or ODT file. |
| `paragraph_id` | `string` | yes | Stable paragraph id returned by read_file; must identify a direct main-body paragraph that does not already end a section. |
| `break_type` | `enum("nextPage", "nextColumn", "continuous", "evenPage", "oddPage")` | yes | OOXML start behavior for the following section. |
| `inherit_properties` | `boolean` | no | Whether the following section retains current non-relationship properties. Default: true. Header/footer references are always preserved. |
| `new_section` | `object` | no | Optional page-number and page-setup overrides for the following section. Complete page size/margins are required when reset removes those elements. |

## `accept_changes`

Accept every tracked change in the document body that the engine can resolve. Revision records it cannot resolve (currently row-level table revisions) are preserved and reported as unresolvedRowRevisions rather than silently stripped. Returns acceptance stats.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX or ODT file. |

## `accept_ai_edits`

Selectively accept tracked changes by revision id or author in the in-memory session, leaving all other (e.g. third-party reviewer) revisions byte-untouched. This does not write file_path; call save to persist the mutation. Provide revision_ids (array of w:id values) to target specific revisions, or author to accept every revision by one actor. Sweeps document.xml and supported side-story parts (footnotes, endnotes, comments). An ambiguous overlap — a targeted revision structurally containing, or contained by, a non-targeted revision (nested ins/del/move) — hard-errors with code AMBIGUOUS_REVISION_OVERLAP and a structured `overlaps` list unless normalize_first is set (best-effort, no byte-identical promise).

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX or ODT file. |
| `revision_ids` | `array<unknown>` | no | w:id values of the revisions to accept. Mutually preferred over author. |
| `author` | `string` | no | Accept every revision authored by this w:author. Convenience alternative to revision_ids. |
| `normalize_first` | `boolean` | no | Attempt best-effort resolution on an ambiguous (overlapping) revision graph instead of hard-erroring. No byte-identical guarantee. Default: false. |

## `reject_ai_edits`

Selectively reject tracked changes by revision id or author in the in-memory session (restoring their pre-edit state), leaving all other revisions byte-untouched. This does not write file_path; call save to persist the mutation. Symmetric to accept_ai_edits: provide revision_ids or author, sweeps document.xml and supported side-story parts, and hard-errors on an ambiguous overlap (code AMBIGUOUS_REVISION_OVERLAP with a structured `overlaps` list) unless normalize_first is set.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX or ODT file. |
| `revision_ids` | `array<unknown>` | no | w:id values of the revisions to reject. Mutually preferred over author. |
| `author` | `string` | no | Reject every revision authored by this w:author. Convenience alternative to revision_ids. |
| `normalize_first` | `boolean` | no | Attempt best-effort resolution on an ambiguous (overlapping) revision graph instead of hard-erroring. No byte-identical guarantee. Default: false. |

## `has_tracked_changes`

Check whether the document body contains tracked-change markers (insertions, deletions, moves, and property-change records). Read-only.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX or ODT file. |

## `get_file_status`

Get file/session metadata including edit count, normalization stats, and cache info. Supports DOCX, ODT, and Google Docs.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX or ODT file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |

## `close_file`

Close an open file session, or close all sessions with explicit confirmation. Supports DOCX, ODT, and Google Docs.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | no | Path to the DOCX or ODT file. |
| `google_doc_id` | `string` | no | Google Doc ID or URL (alternative to file_path). Extract from URL: docs.google.com/document/d/{ID}/edit |
| `clear_all` | `boolean` | no |  |
| `confirm` | `boolean` | no |  |

## `add_comment`

Add a comment or threaded reply to a document. Provide target_paragraph_id + anchor_text for root comments, or parent_comment_id for replies. Supports DOCX and ODT (ODT backs comments with office:annotation; threaded replies are DOCX-only). Surface: revisionable + package-mutation — the body-story comment reference is tracked (w:ins), while comment text and author metadata are recorded in the save report non-revision change manifest.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX or ODT file. |
| `target_paragraph_id` | `string` | no | Paragraph ID to anchor the comment to (for root comments). |
| `anchor_text` | `string` | no | Text within the paragraph to anchor the comment to. If omitted, anchors to entire paragraph. |
| `parent_comment_id` | `number` | no | Parent comment ID for threaded replies. |
| `author` | `string` | yes | Comment author name. |
| `text` | `string` | yes | Comment body text. |
| `initials` | `string` | no | Author initials (defaults to first letter of author name). |

## `get_comments`

Get all comments from the document with IDs, authors, dates, text, and anchored paragraph IDs. Range-anchored DOCX comments also expose optional end_paragraph_id, start_run_index, start_char_offset, end_run_index, and end_char_offset fields describing the covered span. Includes threaded replies (DOCX). Supports DOCX and ODT. Read-only.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX or ODT file. |

## `delete_comment`

Delete a comment and all its threaded replies from the document. Cascade-deletes all descendants. Surface: revisionable + package-mutation — the body-story comment reference removal is tracked (w:del), while comment/reply text cleanup is recorded in the save report non-revision change manifest.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX or ODT file. |
| `comment_id` | `number` | yes | Comment ID to delete. |

## `compare_documents`

Compare two documents and produce a tracked-changes output document. Provide original_file_path + revised_file_path for standalone comparison, or file_path to compare session edits against the original. DOCX and ODF (.odt) support both modes. DOCX stats count insertions/deletions as contiguous ranges, expose atom totals as insertedAtoms/deletedAtoms, and report formatChanges separately from modifiedParagraphs. ODF compares at inline granularity (a modified paragraph is marked up in place — only the changed spans are struck or inserted).

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `original_file_path` | `string` | no | Path to the original DOCX or .odt file. |
| `revised_file_path` | `string` | no | Path to the revised DOCX or .odt file. |
| `file_path` | `string` | no | Path to the DOCX or ODT file. |
| `save_to_local_path` | `string` | yes | Path to save the tracked-changes output (DOCX or .odt). |
| `author` | `string` | no | Author name for track changes. Default: 'Comparison' (DOCX) or the configured AI author (ODF). |
| `engine` | `enum("auto", "atomizer")` | no | Comparison engine (DOCX only). Default: 'auto'. |
| `ignore_formatting` | `boolean` | no | Ignore formatting differences (DOCX only). Default: false. |
| `compare_moves` | `boolean` | no | Detect moved content (DOCX only). Default: true. |
| `base_side` | `enum("original", "revised")` | no | Input package used as the comparison output base (DOCX only). Default: 'revised'. |

## `get_footnotes`

Get all footnotes from the document with IDs, display numbers, text, and anchored paragraph IDs. Read-only.

- readOnly: `true`
- destructive: `false`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX or ODT file. |

## `add_footnote`

Add a footnote anchored to a paragraph. Optionally position the reference after specific text using after_text. Note: [^N] markers in read_file output are display-only and not part of the editable text used by replace_text. Surface: revisionable + package-mutation — the footnote reference and note text are tracked (w:ins), while footnote-part creation and registration are recorded in the save report non-revision change manifest.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX or ODT file. |
| `target_paragraph_id` | `string` | yes | Paragraph ID to anchor the footnote to. |
| `after_text` | `string` | no | Text after which to insert the footnote reference. If omitted, appends at end of paragraph. |
| `text` | `string` | yes | Footnote body text. |

## `update_footnote`

Update the text content of an existing footnote. Surface: revisionable — note-text changes emit native OOXML tracked changes (w:ins/w:del) inside the footnote body.

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX or ODT file. |
| `note_id` | `number` | yes | Footnote ID to update. |
| `new_text` | `string` | yes | New footnote body text. |

## `delete_footnote`

Delete a footnote and its reference from the document. Surface: revisionable — the reference and note text are removed as native OOXML tracked deletions (w:del).

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX or ODT file. |
| `note_id` | `number` | yes | Footnote ID to delete. |

## `clear_formatting`

Clear specific run-level formatting (bold, italic, underline, highlight, color, font) from paragraphs. Surface: revisionable — clearing emits a native run-property-change revision (w:rPrChange).

- readOnly: `false`
- destructive: `true`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | `string` | yes | Path to the DOCX or ODT file. |
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
| `file_path` | `string` | yes | Path to the DOCX or ODT file. |
| `offset` | `number` | no | 0-based offset for pagination. Default: 0. |
| `limit` | `number` | no | Max entries per page (1-500). Default: 50. |
