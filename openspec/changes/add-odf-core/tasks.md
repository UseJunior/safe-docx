## 1. odf-core package scaffold
- [x] 1.1 Create `packages/odf-core` with `package.json` (`@usejunior/odf-core`, **`private: true`**), `tsconfig.json`, and `src/index.ts`, mirroring `google-docs-core`'s build wiring (build/test/lint scripts, vitest)
- [x] 1.2 Confirm `check:release-isolation` passes (odf-named package is private)

## 2. ODF archive layer
- [x] 2.1 `OdfArchive` (clone `DocxArchive`): ODF part-path constants; `load()` asserts `content.xml` + `META-INF/manifest.xml`
- [x] 2.2 `save()` emits `mimetype` first + stored uncompressed (rebuilds a fresh zip — verified necessary across a load→save round trip); preserves untouched entries with byte-identical decompressed content
- [x] 2.3 `validateOdfArchiveSafety` reusing docx-core `inspectZipEntries` + ODF mimetype assertion
- [x] 2.4 `shared/odf/namespaces.ts` (`text:`/`office:`/`style:`/`table:`)

## 3. ODF document view
- [x] 3.1 Parse `content.xml` (namespace-aware via `parseXml` + `localName`); enumerate `text:p`/`text:h` in document order incl. `table:table-cell`
- [x] 3.2 Deterministic structural paragraph IDs (byte-stable across reopen); visible-text model expanding `text:s`/`text:tab`; `getParagraphTextById`
- [x] 3.3 `replaceTextById(id, findText, replaceWith)`: replace only when the match is contiguous within a single `#text` node; reject span-crossing / `text:s`/`text:tab`-spanning matches with `MATCH_SPANS_MULTIPLE_NODES`; `TEXT_NOT_FOUND` / anchor-not-found errors

## 4. Provider-aware MCP wiring (docx-mcp) — parallel ODF lane, DOCX/gdocs untouched
- [ ] 4.1 Add `OdfSession` to the `Session` union; `createOdfSession` + ODF save path in `SessionManager`
- [ ] 4.2 `validateAndLoadOdfFromPath` + `resolveOdfSessionForTool` (mirror the gdocs resolver, incl. concurrent auto-open dedup); file-first `.odt` auto-opens
- [ ] 4.3 `isOdfRequest(manager,args)` discriminant (existing OdfSession at path OR `.odt` extension) + `checkOdfSupport(toolName)` guard returning `UNSUPPORTED_FOR_ODF` for non-Phase-1 tools
- [ ] 4.4 `loadOdfHandlers` set for `read_file`/`replace_text`/`save`/`get_file_status`/`close_file`; wire `dispatchOdf` into `dispatchToolCall` after the gdocs branch
- [ ] 4.5 Extension-aware `open_document.ts` — `.odt` → `validateOdfArchiveSafety` + ODF session; keep `INVALID_FILE_TYPE` for genuinely unsupported types
- [ ] 4.6 Confirm DOCX + gdocs resolution/types are unchanged (no widening of `resolveSessionForTool`)

## 5. Fixtures and verification
- [x] 5.1 Add a real LibreOffice-authored `.odt` fixture under `odf-core`
- [x] 5.2 Round-trip test: open → replace_text → save → reopen; assert mimetype first + method 0 (STORE) after the load→save cycle, untouched entries decompressed-content-identical, well-formed `content.xml`, edited text present, unchanged paragraphs preserved
- [x] 5.2a replace_text edge tests: plain single-node match, `text:s`-adjacent match, `text:tab` case, and a span-crossing match (expects `MATCH_SPANS_MULTIPLE_NODES`)
- [x] 5.3 LibreOffice `soffice --headless --convert-to` open smoke (skipped+logged when `soffice` absent)
- [x] 5.4 `npm run build` green across workspaces (odf-core lint + cycles + release-isolation guard pass); DOCX + gdocs untouched (no source changes yet)
- [ ] 5.5 Gate on ~3 green CI runs before expanding to Phase 2 breadth

## 6. OpenSpec
- [x] 6.1 `openspec validate add-odf-core --strict` passes
- [x] 6.2 Peer review (Codex executed: 4 findings — JSZip mimetype round-trip trap, provider-wiring underscope, replace semantics, mimetype validation — all folded in; Gemini degraded/discarded)
