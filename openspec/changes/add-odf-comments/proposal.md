# Change: Extend the ODF (.odt) lane with `add_comment` and `get_comments`

## Why
Phases 1/2a (`add-odf-core`, `add-odf-grep-insert`) wired a provider-aware ODF lane so an agent
can `open → read_file → grep → replace_text → insert_paragraph → save` a real `.odt`. The next
capability an editing/reviewing agent reaches for is comments. ODF comments are a real
simplification versus DOCX: they live **inline in `content.xml`** as `office:annotation`
elements — there is no separate `comments.xml` part, no rels, and no `commentsExtended.xml`. This
makes comments the lighter of the two remaining Phase-2 tools (the heavier `compare_documents`
tracked-changes atomizer stays deferred to a later phase).

## What Changes
- `@usejunior/odf-core`:
  - Extract the private `buildSegments` / `Segment` from `document.ts` into a shared
    `shared/odf/text_segments.ts` so comments reuse the visible-text↔node mapping without an
    import cycle. The extracted walk and `collectBlocks` SHALL skip `office:annotation` /
    `office:annotation-end` subtrees so an annotation's body `text:p` never leaks into the anchor
    paragraph's visible text nor registers as a phantom block.
  - New `comments.ts`: read all `office:annotation`s into a structured list; insert an annotation
    either over a whole paragraph (structural: first inline child … last inline child) or over a
    `anchor_text` substring (single-`#text`-node split). Cross-node ranged matches return
    `MATCH_SPANS_MULTIPLE_NODES`.
  - `OdfDocument.addComment(...)` / `OdfDocument.getComments()` delegating to `comments.ts`;
    export `OdfComment`.
- `@usejunior/docx-mcp`: add `add_comment` and `get_comments` to the ODF supported-tool set; add
  `tools/odf/{add_comment,get_comments}.ts` handlers mirroring the DOCX param/response shapes; add
  `isOdfRequest` dispatch branches; update `tool_catalog.ts` provider text + regenerated docs.
- Comment **replies** (`parent_comment_id`) on a `.odt` return `UNSUPPORTED_FOR_ODF` — ODF has no
  first-class reply graph and a thread convention is deliberately deferred.

## Impact
- Affected specs: `mcp-server` (ADDED: ODF comment support, OPCM-01..05); `odf-core` (ADDED: ODF
  annotations read/write, OANN-01..05).
- Affected code: `packages/odf-core/src/{document,index}.ts`,
  `packages/odf-core/src/shared/odf/{namespaces,text_segments}.ts`,
  `packages/odf-core/src/comments.ts`; `packages/docx-mcp/src/tools/{provider_guard,session_resolution}.ts`,
  `packages/docx-mcp/src/tools/odf/{add_comment,get_comments}.ts`,
  `packages/docx-mcp/src/server.ts`, `tool_catalog.ts` + regenerated tool docs. DOCX and Google
  Docs paths unchanged.
- Amends the sibling active `add-odf-grep-insert` spec wording (drops `add_comment` from its
  "still-unsupported" example, since it becomes supported here).
- `odf-core` stays `private: true` (optional-lazy provider, not a published dependency of docx-mcp).
- Out of scope: `compare_documents`, comment replies/threads, `delete_comment` for ODF, durable
  injected `xml:id` anchors, `.ods`/`.odp`.
