# Change: Extend the ODF (.odt) lane with `grep` and `insert_paragraph`

## Why
Phase 1 (`add-odf-core`) wired a provider-aware ODF lane so an agent can
`open → read_file → replace_text → save` a real `.odt`. The next two tools an editing
agent reaches for are `grep` (locate text before editing) and `insert_paragraph` (add
content). Both extend the existing five-tool ODF lane and the `OdfDocument` view without
the heavy machinery that `compare_documents` / comments require (a tracked-changes
atomizer + `office:annotation`), which stay deferred to a later phase.

## What Changes
- `@usejunior/odf-core`: add `OdfDocument.insertParagraph(id, text, BEFORE|AFTER)` — creates
  one or more `text:p` blocks (blank lines split into separate paragraphs; single newlines
  become `text:line-break`), inheriting the anchor's `text:style-name` only when the anchor
  is a body paragraph (never propagating a heading style), and returns the inserted blocks'
  freshly recomputed positional IDs.
- `@usejunior/docx-mcp`: add `grep` and `insert_paragraph` to the ODF supported-tool set;
  add `tools/odf/{grep,insert_paragraph}.ts` handlers; add `isOdfRequest` dispatch branches;
  extract a shared, pure `tools/grep_core.ts` (behavior-preserving refactor of the DOCX grep
  search core) reused by both lanes.
- ODF `grep` is session-mode (`file_path`) only; multi-file `file_paths` stays on the DOCX
  lane. ODF paragraphs carry no list-label / header context, so those fields are empty.
- `insert_paragraph` responses carry machine-actionable ID-invalidation fields
  (`invalidates_paragraph_ids_after`, `requires_reread_before_next_edit`) because ODF
  paragraph IDs are positional and shift on insertion.

## Impact
- Affected specs: `mcp-server` (ADDED: extended ODF tool support, OPLR-06/OPLR-07);
  `odf-core` (ADDED: paragraph insertion).
- Affected code: `packages/odf-core/src/{document,index}.ts`;
  `packages/docx-mcp/src/tools/{grep.ts, grep_core.ts, provider_guard.ts, session_resolution.ts,
  odf/grep.ts, odf/insert_paragraph.ts}`; `packages/docx-mcp/src/server.ts`;
  `tool_catalog.ts` + regenerated tool docs. DOCX and Google Docs paths unchanged.
- `odf-core` stays `private: true` (no name-squatting; optional-lazy provider, not a
  published dependency of docx-mcp).
- Out of scope: `compare_documents`, comments, durable injected `xml:id` anchors,
  cross-span `replace_text`, multi-file ODF grep, `.ods`/`.odp`.
