# Supported Revisionable AI Editing Surface

This document defines the contract surface for the umbrella tracked-changes architecture in [#118](https://github.com/UseJunior/safe-docx/issues/118). It records which `@usejunior/docx-core` primitives and `@usejunior/docx-mcp` tools belong to the native OOXML revision guarantee, which ones fall under the separate package-mutation contract, and which files are internal/read-only helpers outside that contract. As stated in [#118](https://github.com/UseJunior/safe-docx/issues/118):

> For the supported revisionable AI editing surface, SafeDocX preserves first-class OOXML revision provenance at write time, validates AI-emitted revisions before they land, and supports selective accept/reject of the AI actor without re-diffing the whole document. Whole-document comparison remains available as an opt-in redlining tool but is removed from the default finalization path. Package-level mutations that have no native revision wrapper (theme replacement, side-part creation, relationship rewrites, content-type updates) are explicitly out of scope for this guarantee and are described to users under a separate contract.

Issue [#119](https://github.com/UseJunior/safe-docx/issues/119) ratifies the inventory below. The tables describe the intended contract surface, even where current implementation paths still mutate OOXML directly and therefore need follow-on canonical tracked-change emission work in [#120](https://github.com/UseJunior/safe-docx/issues/120).

## Table A: Revisionable surface

The "OOXML revision element" column uses ECMA-376 element names from the tracked-change vocabulary: `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`, `w:moveFromRangeStart`, `w:moveFromRangeEnd`, `w:moveToRangeStart`, `w:moveToRangeEnd`, `w:pPrChange`, `w:rPrChange`, `w:sectPrChange`, `w:tblPrChange`, `w:tblPrExChange`, `w:tblGridChange`, `w:trPrChange`, `w:tcPrChange`, `w:cellIns`, `w:cellDel`, `w:cellMerge`, and `w:numberingChange`. The current repo surface only exercises a subset of that list today.

| Primitive / tool | Source path | OOXML revision element | Notes |
| --- | --- | --- | --- |
| `text.ts` — `replaceParagraphTextRange` | `packages/docx-core/src/primitives/text.ts` | `w:ins`, `w:del`, *`w:rPrChange` (pending #173)* | Run-level text replacement; current implementation emits `w:ins`/`w:del` only. `w:rPrChange` for formatting-aware replacements is tracked as **#173**. **Verified by [120.8] (#143) regression test (locks ins/del behavior).** |
| `layout.ts` — `setParagraphSpacing` | `packages/docx-core/src/primitives/layout.ts` | `w:pPrChange` | Paragraph spacing mutations change paragraph properties, not spacer-paragraph structure. **Verified by [120.8] (#143) regression test.** |
| `layout.ts` — `setTableRowHeight` | `packages/docx-core/src/primitives/layout.ts` | `w:trPrChange` | Row geometry changes belong under row-property revisions. **Verified by [120.8] (#143) regression test.** |
| `layout.ts` — `setTableCellPadding` | `packages/docx-core/src/primitives/layout.ts` | `w:tcPrChange` | Cell padding changes belong under cell-property revisions. **Verified by [120.8] (#143) regression test.** |
| `comments.ts` — `addComment` | `packages/docx-core/src/primitives/comments.ts` | `w:ins` | The comment anchor inserted into the body story and the initial comment text are revisionable content. Companion package bootstrap is listed in Table B. **Verified by [120.8] (#143) regression test.** |
| `comments.ts` — `deleteComment` | `packages/docx-core/src/primitives/comments.ts` | `w:del` | Deleting a comment removes body anchors and comment/reply text. Cleanup of `commentsExtended.xml` remains the Table B companion. **Verified by [120.8] (#143) regression test.** |
| `footnotes.ts` — `addFootnote` | `packages/docx-core/src/primitives/footnotes.ts` | `w:ins` | The inserted `w:footnoteReference` in the body story and the new footnote text both belong to the revisionable surface. Companion package bootstrap is listed in Table B. **Verified by [120.8] (#143) regression test.** |
| `footnotes.ts` — `updateFootnoteText` | `packages/docx-core/src/primitives/footnotes.ts` | `w:ins`, `w:del` | Updating note text is a content revision inside the footnote body. **Verified by [120.8] (#143) regression test.** |
| `footnotes.ts` — `deleteFootnote` | `packages/docx-core/src/primitives/footnotes.ts` | `w:del` | Deleting a note removes both the body reference and the note text. **Verified by [120.8] (#143) regression test.** |
| `replace_text` | `packages/docx-mcp/src/tools/replace_text.ts` | `w:ins`, `w:del`, `w:rPrChange` | MCP wrapper over `text.ts`; the supported contract is native tracked insertion/deletion plus any explicit inline formatting deltas. **Verified by [120.8] (#143) regression test.** |
| `insert_paragraph` | `packages/docx-mcp/src/tools/insert_paragraph.ts` | `w:ins`, `w:pPrChange`, `w:rPrChange` | Paragraph insertion is body-content creation. Paragraph/run formatting inherited from `style_source_id` stays inside the revisionable surface. **Verified by [120.8] (#143) regression test.** |
| `apply_plan` | `packages/docx-mcp/src/tools/apply_plan.ts` | `w:ins`, `w:del`, `w:pPrChange`, `w:rPrChange` | Plan execution is only an orchestrator, but every applied step delegates to revisionable body-edit primitives. **Verified by [120.8] (#143) regression test.** |
| `clear_formatting` | `packages/docx-mcp/src/tools/clear_formatting.ts` | `w:rPrChange` | Run-property clearing is a run formatting revision, not a package mutation. **Verified by [120.8] (#143) regression test.** |
| `format_layout` | `packages/docx-mcp/src/tools/format_layout.ts` | `w:pPrChange`, `w:trPrChange`, `w:tcPrChange` | Deterministic OOXML geometry edits belong under native property-change revisions. **Verified by [120.8] (#143) regression test.** |
| `add_comment` | `packages/docx-mcp/src/tools/add_comment.ts` | `w:ins` | Root comment anchors and reply/comment text are part of the revisionable surface. Missing comment infrastructure is the Table B companion. **Verified by [120.8] (#143) regression test.** |
| `delete_comment` | `packages/docx-mcp/src/tools/delete_comment.ts` | `w:del` | Comment deletion removes body anchors and user-authored comment text. `commentsExtended.xml` cleanup is the Table B companion. **Verified by [120.8] (#143) regression test.** |
| `add_footnote` | `packages/docx-mcp/src/tools/add_footnote.ts` | `w:ins` | Footnote reference insertion and note-body creation are revisionable content. Missing footnote infrastructure is the Table B companion. **Verified by [120.8] (#143) regression test.** |
| `update_footnote` | `packages/docx-mcp/src/tools/update_footnote.ts` | `w:ins`, `w:del` | Note text replacement belongs inside the revisionable surface. **Verified by [120.8] (#143) regression test.** |
| `delete_footnote` | `packages/docx-mcp/src/tools/delete_footnote.ts` | `w:del` | Footnote deletion removes both reference and note text. **Verified by [120.8] (#143) regression test.** |
| `compare_documents` | `packages/docx-mcp/src/tools/compare_documents.ts` | `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`, `w:moveFromRangeStart`/`End`, `w:moveToRangeStart`/`End`, `w:pPrChange`, `w:rPrChange` | Opt-in whole-document redlining tool. The atomizer engine runs move detection and format detection, so the actual emission set is broader than `w:ins`/`w:del`. Comparison-time emission, not write-time. `#118` removes it from the default finalization path for supported AI edits but leaves it available as a legacy redlining tier. |
| `save` (tracked branch) | `packages/docx-mcp/src/tools/save.ts` | `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`, `w:moveFromRangeStart`/`End`, `w:moveToRangeStart`/`End`, `w:pPrChange`, `w:rPrChange` | Only the tracked-output branch belongs here, because it delegates to `compareDocuments(...)`. Comparison-time emission, not write-time. Clean-only save is just serialization. |

## Table B: Package-level (non-revisionable) mutations

Use the alternate contract below whenever a primitive/tool mutates relationships, content types, or non-body companion parts that have no native OOXML revision wrapper.

| Primitive / tool | Source path | What it mutates | Alternate contract |
| --- | --- | --- | --- |
| `comments.ts` — `bootstrapCommentParts` | `packages/docx-core/src/primitives/comments.ts` | Creates `word/comments.xml`, `word/commentsExtended.xml`, and `word/people.xml`; updates `word/_rels/document.xml.rels`; updates `[Content_Types].xml`. Companion body/comment-text rows are in Table A. | Recorded in the session's non-revision change manifest (per #122) and surfaced in the save report. Not wrapped in OOXML revision markup. |
| `comments.ts` — threaded comment metadata (`addComment`, `addCommentReply`, `deleteComment`) | `packages/docx-core/src/primitives/comments.ts` | Maintains `commentsExtended.xml` reply graph and `people.xml` author metadata that Word needs for comments and threaded replies. `addCommentReply` is classified here because replies are side-part metadata writes with no body anchor per reply; `addComment` always writes author metadata to `people.xml`, even for root comments without a thread. Companion root-comment/deletion content rows are in Table A. | Recorded in the session's non-revision change manifest (per #122) and surfaced in the save report. Not wrapped in OOXML revision markup. |
| `footnotes.ts` — `bootstrapFootnoteParts` | `packages/docx-core/src/primitives/footnotes.ts` | Creates `word/footnotes.xml`; updates `word/_rels/document.xml.rels`; updates `[Content_Types].xml`. Companion reference/note-text rows are in Table A. | Recorded in the session's non-revision change manifest (per #122) and surfaced in the save report. Not wrapped in OOXML revision markup. |
| `add_comment` | `packages/docx-mcp/src/tools/add_comment.ts` | Always writes author metadata to `people.xml`. May also trigger comment-part bootstrap (`comments.xml`, `commentsExtended.xml`, relationships, content types) when the package lacks comment infrastructure, and writes to `commentsExtended.xml` for threaded replies. Companion anchor/text row is in Table A. | Recorded in the session's non-revision change manifest (per #122) and surfaced in the save report. Not wrapped in OOXML revision markup. |
| `delete_comment` | `packages/docx-mcp/src/tools/delete_comment.ts` | Removes threaded-comment companion metadata from `commentsExtended.xml` alongside the Table A content deletion. | Recorded in the session's non-revision change manifest (per #122) and surfaced in the save report. Not wrapped in OOXML revision markup. |
| `add_footnote` | `packages/docx-mcp/src/tools/add_footnote.ts` | May trigger footnote-part bootstrap and companion package registration when the document has no footnote infrastructure yet. Companion reference/text row is in Table A. | Recorded in the session's non-revision change manifest (per #122) and surfaced in the save report. Not wrapped in OOXML revision markup. |

No current file under `packages/docx-core/src/primitives/*.ts` or `packages/docx-mcp/src/tools/*.ts` directly exposes theme replacement, header/footer part creation, image-part insertion, or `core.xml` / `app.xml` metadata editing. If those surfaces are added later, they belong in Table B unless OOXML supplies a first-class revision wrapper for that exact mutation.

## Internal / non-contract utilities

These files are intentionally outside the revisionable-surface contract. Some perform XML mutations (e.g., bookmark scaffolding, run normalization, style elevation) but those mutations are internal/non-AI-attributable rather than user-directed edits. Others consume or normalize existing tracked changes instead of creating them. Either way, none are part of the promised AI-authored revision contract.

### `docx-core` primitive files

- `accept_changes.ts` — tracked-change consumer that accepts existing `w:ins` / `w:del` / property-change markup in `document.xml` and supported side-story parts (`footnotes.xml`, `endnotes.xml`, `comments.xml`) instead of creating new AI-authored revisions.
- `bookmarks.ts` — internal paragraph-bookmark scaffolding for stable selectors and anchor lookup, not user-visible AI content authorship.
- `document.ts` — `DocxDocument` facade that routes to lower-level primitives; the contract is defined at the delegated primitive level, not this wrapper.
- `document_view.ts` — read-only projection layer for toon/json/simple views, style discovery, and footnote marker display.
- `dom-helpers.ts` — generic DOM mutation helpers reused by other primitives, not a standalone AI edit surface.
- `errors.ts` — error taxonomy only.
- `extract_revisions.ts` — tracked-change reader that extracts existing revision metadata for reporting.
- `formatting_tags.ts` — rendering helper for inline formatting tags in previews and document views.
- `index.ts` — barrel export module re-exporting public primitive APIs; no logic of its own.
- `list_labels.ts` — text parser for list-label recognition.
- `matching.ts` — text matching and normalization utilities used to find paragraph/range anchors.
- `merge_runs.ts` — normalization helper that coalesces compatible runs; useful internally but not part of the promised AI-authored revision contract.
- `namespaces.ts` — OOXML namespace constants only.
- `numbering.ts` — read-only numbering model parser and label formatter.
- `prevent_double_elevation.ts` — internal style-normalization helper for reference styles, not a user-directed AI mutation contract.
- `reject_changes.ts` — tracked-change consumer that rejects existing revisions in `document.xml` and supported side-story parts (`footnotes.xml`, `endnotes.xml`, `comments.xml`) instead of creating new ones.
- `relationships.ts` — read-only relationship parser.
- `semantic_tags.ts` — string-level inline-tag helpers.
- `simplify_redlines.ts` — post-processing helper that simplifies existing tracked-change markup instead of originating it.
- `styles.ts` — read-only style model parser and formatting extractor.
- `tables.ts` — read-only table extraction helpers.
- `validate_document.ts` — validator over existing OOXML and tracked-change markup.
- `xml.ts` — XML parse/serialize helpers.
- `zip.ts` — DOCX zip I/O abstraction.

### `docx-mcp` read-only, orchestration, and session files

- `accept_changes.ts` — MCP wrapper that consumes existing tracked changes by accepting them.
- `close_file.ts` — session lifecycle control only.
- `comparison_defaults.ts` — comparison configuration constant, not an MCP mutation surface by itself.
- `docx_archive_guard.ts` — archive safety validator that checks zip bomb and entry-size limits before load.
- `extract_revisions.ts` — MCP wrapper that reads existing revisions and returns structured JSON.
- `get_comments.ts` — read-only comment tree retrieval.
- `get_file_status.ts` — session/document metadata only.
- `get_footnotes.ts` — read-only footnote retrieval.
- `get_session_status.ts` — session metadata and open-document state only.
- `grep.ts` — read/search tool with no mutation behavior.
- `has_tracked_changes.ts` — tracked-change presence detector over existing OOXML.
- `init_plan.ts` — plan-session metadata initializer only.
- `merge_plans.ts` — read/merge validator for plan JSON, not a document mutator by itself.
- `open_document.ts` — session/bootstrap entrypoint that opens a document and reports available tools.
- `pagination.ts` — token-budget estimation and pagination math only.
- `path_policy.ts` — filesystem policy enforcement only.
- `preview.ts` — result/error preview helpers only.
- `provider_guard.ts` — tool-availability guard for Google Docs compatibility.
- `read_file.ts` — read-only renderer for toon/simple/json document views.
- `session_resolution.ts` — path/session resolution and document loading helpers.
- `tag_parser.ts` — inline tag parser used before edit primitives run.
- `types.ts` — MCP response helpers only.

## Open sub-decision: AI author identity

Issue [#119](https://github.com/UseJunior/safe-docx/issues/119) ratifies the supported surface, but it does not settle the `w:author` strategy. The repo currently already shows divergent author defaults (`"Comparison"` in the atomizer comparison pipeline and `tracked_changes_author ?? author ?? "Safe-Docx"` in `save.ts`), which is exactly why the contract should stay explicit here.

**Deferred decision:** choose between a single fixed `w:author="SafeDocX"` actor and a per-MCP-client identity scheme. Resolution is deferred until [#123](https://github.com/UseJunior/safe-docx/issues/123) lands selective accept/reject, where revision-id remains the correctness key and `w:author` remains display metadata.

## Cross-references

- Umbrella: [#118](https://github.com/UseJunior/safe-docx/issues/118)
- This issue: [#119](https://github.com/UseJunior/safe-docx/issues/119)
- Canonical emission: [#120](https://github.com/UseJunior/safe-docx/issues/120)
- Validator: [#121](https://github.com/UseJunior/safe-docx/issues/121)
- Forbid untracked: [#122](https://github.com/UseJunior/safe-docx/issues/122)
- Selective accept: [#123](https://github.com/UseJunior/safe-docx/issues/123)
- Invariant corpus: [#124](https://github.com/UseJunior/safe-docx/issues/124)
- Mixed-author corpus: [#125](https://github.com/UseJunior/safe-docx/issues/125)

## Appendix A: Coverage index

This appendix is deliberately mechanical. It makes it easy to audit that every non-test primitive file and every non-test MCP tool file has been classified somewhere in this document, even when the operative contract row lives in Table A or Table B instead of the utility section.

### `packages/docx-core/src/primitives`

- `accept_changes.ts` — Internal / non-contract utilities
- `bookmarks.ts` — Internal / non-contract utilities
- `comments.ts` — Table A and Table B
- `document.ts` — Internal / non-contract utilities
- `document_view.ts` — Internal / non-contract utilities
- `dom-helpers.ts` — Internal / non-contract utilities
- `errors.ts` — Internal / non-contract utilities
- `extract_revisions.ts` — Internal / non-contract utilities
- `footnotes.ts` — Table A and Table B
- `formatting_tags.ts` — Internal / non-contract utilities
- `index.ts` — Internal / non-contract utilities
- `layout.ts` — Table A
- `list_labels.ts` — Internal / non-contract utilities
- `matching.ts` — Internal / non-contract utilities
- `merge_runs.ts` — Internal / non-contract utilities
- `namespaces.ts` — Internal / non-contract utilities
- `numbering.ts` — Internal / non-contract utilities
- `prevent_double_elevation.ts` — Internal / non-contract utilities
- `reject_changes.ts` — Internal / non-contract utilities
- `relationships.ts` — Internal / non-contract utilities
- `semantic_tags.ts` — Internal / non-contract utilities
- `simplify_redlines.ts` — Internal / non-contract utilities
- `styles.ts` — Internal / non-contract utilities
- `tables.ts` — Internal / non-contract utilities
- `text.ts` — Table A
- `validate_document.ts` — Internal / non-contract utilities
- `xml.ts` — Internal / non-contract utilities
- `zip.ts` — Internal / non-contract utilities

### `packages/docx-mcp/src/tools`

- `accept_changes.ts` — Internal / non-contract utilities
- `add_comment.ts` — Table A and Table B
- `add_footnote.ts` — Table A and Table B
- `apply_plan.ts` — Table A
- `clear_formatting.ts` — Table A
- `close_file.ts` — Internal / non-contract utilities
- `compare_documents.ts` — Table A
- `comparison_defaults.ts` — Internal / non-contract utilities
- `delete_comment.ts` — Table A and Table B
- `delete_footnote.ts` — Table A
- `docx_archive_guard.ts` — Internal / non-contract utilities
- `extract_revisions.ts` — Internal / non-contract utilities
- `format_layout.ts` — Table A
- `get_comments.ts` — Internal / non-contract utilities
- `get_file_status.ts` — Internal / non-contract utilities
- `get_footnotes.ts` — Internal / non-contract utilities
- `get_session_status.ts` — Internal / non-contract utilities
- `grep.ts` — Internal / non-contract utilities
- `has_tracked_changes.ts` — Internal / non-contract utilities
- `init_plan.ts` — Internal / non-contract utilities
- `insert_paragraph.ts` — Table A
- `merge_plans.ts` — Internal / non-contract utilities
- `open_document.ts` — Internal / non-contract utilities
- `pagination.ts` — Internal / non-contract utilities
- `path_policy.ts` — Internal / non-contract utilities
- `preview.ts` — Internal / non-contract utilities
- `provider_guard.ts` — Internal / non-contract utilities
- `read_file.ts` — Internal / non-contract utilities
- `replace_text.ts` — Table A
- `save.ts` — Table A
- `session_resolution.ts` — Internal / non-contract utilities
- `tag_parser.ts` — Internal / non-contract utilities
- `types.ts` — Internal / non-contract utilities
- `update_footnote.ts` — Table A

## Appendix B: Canonical revision elements not yet directly surfaced by a dedicated file

These ECMA-376 elements stay in the canonical vocabulary even though the current repo snapshot does not expose a dedicated primitive or MCP tool file for each one yet.

- `w:moveFrom`, `w:moveTo`, `w:moveFromRangeStart`, `w:moveFromRangeEnd`, `w:moveToRangeStart`, and `w:moveToRangeEnd` — no dedicated move primitive is surfaced today.
- `w:sectPrChange` — no dedicated section-layout mutation file is surfaced today.
- `w:tblPrChange`, `w:tblPrExChange`, and `w:tblGridChange` — no dedicated table-wide property/grid mutation file is surfaced today.
- `w:cellIns`, `w:cellDel`, and `w:cellMerge` — no dedicated cell-topology mutation file is surfaced today.
- `w:numberingChange` — no dedicated numbering mutation file is surfaced today.
- `w:rPrChange` and `w:pPrChange` already apply to accept/reject flow as well as live AI formatting/property edits.
- `compare_documents.ts` and `save.ts` still rely on comparison-time reconstruction today, which is why `#120` remains the next required implementation step.
