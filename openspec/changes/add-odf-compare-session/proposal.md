# Change: ODF (.odt) `compare_documents` — session mode (redline a session's edits against its original)

## Why

`add-odf-compare` (Slice 1, #348) landed ODF `compare_documents` in **two-file mode** only; a
`.odt` on `file_path` (session mode) still returns `UNSUPPORTED_FOR_ODF`. That blocks the common
workflow of opening a `.odt`, editing it through the session tools (`replace_text`,
`insert_paragraph`, `add_comment`, …), and producing a redline of exactly what changed — today the
user must save a copy and run a manual two-file compare. Session mode removes that friction:
compare the live session against the original it was opened from, in one call (issue #357).

## What Changes

- `@usejunior/docx-mcp`:
  - New session-aware entry point `odfCompareDocumentsSession(manager, session, params, metadata)`
    in `tools/odf/compare_documents.ts`, registered in the `dispatchOdf` handler map. It takes the
    original `content.xml` from the session's immutable open-time `originalBuffer` (via a fresh
    `OdfArchive` — the live `session.archive` is stamped with the *edited* content on every `save`,
    so it is not a valid baseline source and must not be poisoned with redline markup), the revised
    `content.xml` from the live `session.doc`, runs the existing `compareOdf` engine, and packages
    the redline `content.xml` into that fresh original archive. Packaging on the original package is
    valid under the current invariant that ODF session edit tools mutate `content.xml` only (the
    same premise `SessionManager.saveOdfTo` rests on).
  - `server.ts` `compare_documents` routing is restructured for **two-file precedence across all
    providers**: when both `original_file_path` and `revised_file_path` are present, two-file mode
    wins (ODF stateless handler for `.odt` inputs, DOCX tool otherwise) even if a stray `file_path`
    is also supplied — previously a stray `.odt` `file_path` preempted a two-`.docx` compare with
    `UNSUPPORTED_FOR_ODF`. Otherwise a `.odt` `file_path` now dispatches through the standard ODF
    session lane (`dispatchOdf`) instead of returning `UNSUPPORTED_FOR_ODF`.
  - Same output-path safety as two-file mode: refuse `save_to_local_path` resolving to the
    session's original file (no `allow_overwrite` escape — comparison inputs are never
    overwritable), and enforce the write-path policy.
  - `tool_catalog.ts` `compare_documents` description updated (ODF now supports both modes);
    `docs/tool-reference.generated.md` regenerated.
- `openspec/changes/add-odf-compare` (pending): the "session mode SHALL return
  `UNSUPPORTED_FOR_ODF`" clause is removed and scenario `[OPCD-04]` is re-pointed at a different
  still-unsupported tool (`accept_changes`), mirroring how #348 re-pointed `[OPLR-08]` when
  two-file compare became supported.
- `@usejunior/odf-core` is **unchanged** — the paragraph-granularity engine from `add-odf-compare`
  is reused as-is, and session mode inherits whatever granularity the engine supports.

## Impact

- Affected specs: `mcp-server` (ADDED requirement: ODF session-mode `compare_documents`; plus an
  amendment inside the pending `add-odf-compare` change's delta).
- Affected code: `packages/docx-mcp/src/server.ts`,
  `packages/docx-mcp/src/tools/odf/compare_documents.ts`, `packages/docx-mcp/src/tool_catalog.ts`,
  `docs/tool-reference.generated.md`; tests in
  `packages/docx-mcp/src/tools/odf/odf_compare_session.test.ts` (new) and
  `packages/docx-mcp/src/tools/odf/odf_compare.test.ts` (OPCD-04 re-point).
