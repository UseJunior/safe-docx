# Change: ODF (.odt) `compare_documents` — paragraph-granularity tracked-changes redline (Slice 1)

## Why
Phases 1/2a/2b-1 (`add-odf-core`, `add-odf-grep-insert`, `add-odf-comments`) wired a
provider-aware ODF lane covering `read_file → grep → replace_text → insert_paragraph →
add_comment → get_comments → save`. The one Phase-2 tool still returning
`UNSUPPORTED_FOR_ODF` is `compare_documents` — the tracked-changes redline. The DOCX path
produces a `w:ins`/`w:del` redline via docx-core's atomizer; the ODF analogue needs a fresh
emitter because ODF stores deletions **out-of-line** in a `text:tracked-changes` /
`text:changed-region` container (with only lightweight in-body markers) rather than inline.

This change lands the first, shippable slice: **paragraph-granularity, two-file mode**. It
diffs two `.odt` files at the whole-paragraph level (LCS keyed on paragraph text) and emits a
valid redline `.odt` that LibreOffice opens with the insertions/deletions visible and
acceptable. Intra-paragraph (run-level) diffs and session-mode comparison are deliberately
deferred to follow-up changes so each PR stays reviewable.

## What Changes
- `@usejunior/odf-core`:
  - New `compare/` module — `compare/diff.ts` (pure paragraph-level LCS over `{id,text}[]`,
    no DOM), `compare/emit.ts` (ODF tracked-changes emitter), `compare/index.ts`
    (`compareOdf(originalContentXml, revisedContentXml, opts)` orchestrating diff → emit).
    The diff stays separable from emission (own module, own unit tests), mirroring docx-core's
    `atomLcs.ts` ↔ `documentReconstructor.ts` split.
  - `compareOdf` takes `content.xml` **strings** and parses each exactly once internally; no
    DOM Element crosses the package boundary and no public DOM getter is added to
    `OdfDocument`. To avoid duplicating the block walk, `collectBlocks` (and a new
    `isTrackedChangesSubtree` predicate) are extracted into `shared/odf/` and reused by both
    `OdfDocument` and `compare/index.ts`.
  - `collectBlocks` and the visible-text walk SHALL skip the `text:tracked-changes` container
    (its `text:p`s are deleted-content storage, not body paragraphs) so deleted content never
    leaks into `getParagraphs()`.
  - Add `XML` (`http://www.w3.org/XML/1998/namespace`, for `xml:id`) to `ODF_NS`.
  - Export `compareOdf` + its result type from `index.ts`.
- `@usejunior/docx-mcp`:
  - New `tools/odf/compare_documents.ts` — a **stateless** handler
    `odfCompareDocuments(manager, args, metadata)` (NOT the `(manager, session, …)` shape):
    two-file compare cannot route through `dispatchOdf`, because the shared
    `resolveOdfSessionForTool` requires `file_path` and returns `MISSING_FILE_PATH` before any
    handler runs. It loads both `.odt`s via `validateAndLoadOdfFromPath`, calls `compareOdf`,
    writes the redline, and returns the DOCX-parallel response shape with ODF-appropriate
    fields (`granularity: 'paragraph'`, `stats`, no `engine`/`reconstruction_mode`).
  - `server.ts` replaces the `compare_documents` guard: a `.odt` two-file input dispatches to
    `odfCompareDocuments` directly; a `.odt` session `file_path` returns `UNSUPPORTED_FOR_ODF`
    ("session-mode compare for .odt not yet supported"); otherwise the DOCX tool runs.
  - Add `compare_documents` to `ODF_SUPPORTED_TOOLS`; update the guard hint + the two
    `session_resolution.ts` hints; update `tool_catalog.ts` provider text + regenerate docs.

## Impact
- Affected specs: `mcp-server` (ADDED: ODF two-file `compare_documents`, OPCD-01..05);
  `odf-core` (ADDED: ODF paragraph comparison + tracked-changes emission + no-leak, OCMP-01..06).
- Affected code: `packages/odf-core/src/{document,index}.ts`,
  `packages/odf-core/src/shared/odf/{namespaces,text_segments,*block-walk*}.ts`,
  `packages/odf-core/src/compare/{diff,emit,index}.ts`;
  `packages/docx-mcp/src/tools/{provider_guard,session_resolution}.ts`,
  `packages/docx-mcp/src/tools/odf/compare_documents.ts`, `packages/docx-mcp/src/server.ts`,
  `tool_catalog.ts` + regenerated tool docs. DOCX and Google Docs paths unchanged.
- `odf-core` stays `private: true` (optional-lazy provider, not a published dependency of docx-mcp).
- Out of scope (separate changes): intra-paragraph (run-level) diffs; session-mode compare;
  `.ods`/`.odp`; accepting/rejecting ODF tracked changes; docx→odf conversion; durable injected
  `xml:id` paragraph anchors.
