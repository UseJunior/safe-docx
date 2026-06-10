# Tasks

## docx-mcp
- [x] `tools/odf/compare_documents.ts`: add `odfCompareDocumentsSession(manager, session, params, metadata)` — baseline `content.xml` from a fresh `OdfArchive.load(session.originalBuffer)`, revised from `session.doc.toXml()`, `compareOdf`, package redline on the fresh original archive (NOT `session.archive`; state the content.xml-only invariant in the handler comment), refuse `save_to_local_path` resolving to `session.originalPath` (no `allow_overwrite`), `enforceWritePathPolicy`, `manager.touch(session)`, response `{ mode:'session', provider:'odf', original_file_path, saved_to, size_bytes, author, granularity:'paragraph', stats, message, ...metadata }`. Update the file header + two-file `MISSING_PARAMS` hint (session mode now supported)
- [x] `server.ts`: register `compare_documents` in `loadOdfHandlers`; restructure the `compare_documents` case for two-file precedence across all providers (both input paths present → two-file even with stray `file_path`); `.odt` `file_path` → `dispatchOdf`; update the routing comment
- [x] `tool_catalog.ts`: update `compare_documents` description (ODF supports both modes); regenerate `docs/tool-reference.generated.md`; `npm run check:tool-docs`

## OpenSpec
- [x] Amend pending `add-odf-compare` delta: drop the "session mode SHALL return UNSUPPORTED_FOR_ODF" clause; re-point `[OPCD-04]` at `accept_changes` (still-unsupported example)
- [x] `openspec validate add-odf-compare-session --strict` and `openspec validate add-odf-compare --strict`

## Tests & verification
- [x] New `tools/odf/odf_compare_session.test.ts` (`TEST_FEATURE = 'add-odf-compare-session'`, `testAllure as it`, driven through `dispatchToolCall`, fresh `SessionManager` per test): OPCS-01..07, including the serialization-sensitive no-op fixture (OPCS-02) and the session-not-mutated save check (OPCS-06)
- [x] Update `odf_compare.test.ts` `[OPCD-04]` test to the re-pointed scenario (`accept_changes` on an open ODF session → `UNSUPPORTED_FOR_ODF`), with a comment noting the flip
- [x] Full CI gate locally: `npm run build && npm run lint:workspaces && npm run test:run && npm run check:spec-coverage && npm run check:conformance-citations && npm run check:conformance-doc`
- [x] Document-shaped `.odt` smoke: open a realistic `.odt`, `replace_text` + `insert_paragraph` (+ `add_comment`), session-mode `compare_documents`; stats reflect the edits; redline reopens
- [x] LibreOffice oracle: accept-all on the session redline reproduces the edited text; reject-all reproduces the original
