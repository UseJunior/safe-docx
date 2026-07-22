I have conducted a dynamic review of your design for Phase 2a, including inspecting the source files, testing assumptions, and executing small verifications.

### Verification Methodology
1. **Repository state & assumptions**:
   - I used the `view_file` tool to inspect `packages/docx-mcp/src/tools/session_resolution.ts`, `packages/docx-mcp/src/server.ts`, `packages/docx-mcp/src/tools/provider_guard.ts`, `packages/docx-mcp/src/tools/insert_paragraph.ts`, and `packages/odf-core/src/document.ts`.
   - I confirmed that `resolveSessionForTool` currently guards against `.odt` via `path.extname` and `existingSession.provider !== 'docx'`, rejecting correctly with `UNSUPPORTED_FOR_ODF`. Your assumption holds—this is a purely additive change.
2. **Test validation**:
   - I ran the workspace tests using `npm test --workspaces --if-present` via a background task. It exited `0` with `Test Files 78 passed (78) Tests 804 passed (804)` for `docx-mcp`. The baseline is perfectly stable.
   - I explicitly ran `npx vitest run src/tools/grep.test.ts` to confirm the existing grep suite passes (`5 tests passed`), giving high confidence in refactoring safety.
3. **xmldom behavior check**:
   - I wrote and executed a small script (`scratch/test_xmldom.ts`) to parse a dummy ODF, append a paragraph via `createElementNS(ODF_NS.TEXT, 'text:p')`, add attributes via `setAttributeNS`, and serialize it.
   - The stdout was `<text:p text:style-name="Standard">Hello World</text:p>`, verifying that the `xmldom` package correctly serializes the namespaces for ODF.

### Feedback on Open Questions
1. **Positional-ID-shift on insert**
   - **Verdict**: Acceptable for Phase 2a, but requires a strong `ids_note`.
   - **Why**: Your `OdfDocument.replaceTextById` performs a strict `findText` check (`visible.indexOf(findText)`). If an agent attempts to edit using a shifted ID, the check cleanly fails with `TEXT_NOT_FOUND` rather than silently corrupting data.
   - **Action**: Ensure the `ids_note` explicitly instructs the agent: *"ODF paragraph IDs shift after insertion. Call read_file to get updated IDs before making further edits."*
2. **grep-core extraction vs duplication**
   - **Verdict**: Extract it. It's well worth the DRY win.
   - **Why**: The logic handling `dedupe_by_paragraph`, truncation flags, multi-match counts, and context generation is complex (~150 lines). Decoupling it into a pure function `searchParagraphsCore(paras: {id, text}[], re, opts, locatorById?)` that doesn't depend on `DocxDocument` is the right architectural move. The robust test suite ensures behavior preservation.
3. **Style inheritance**
   - **Verdict**: Inherit styles for `<text:p>`, but drop them if the anchor is `<text:h>`.
   - **Why**: If an agent inserts a paragraph after a heading (`<text:h text:style-name="Heading_2">`), blindly copying the style onto the new `<text:p>` will make it visually appear as a heading but structurally remain a paragraph, causing semantic confusion. Check `anchor.localName === 'h'`—if true, omit the style attribute (falling back to default).
4. **`\n` vs `\n\n` for paragraphs**
   - **Verdict**: You MUST split on `\n\n` to maintain tool parity.
   - **Why**: In `insert_paragraph.ts` (line 165), DOCX agents expect `\n\n` to map to multiple paragraphs (`split(/\n{2,}/)`). If the ODF lane maps all newlines to `text:line-break` inside a single `<text:p>`, an agent generating multi-paragraph content will unexpectedly create a massive run-on block. Retain parity: split `\n\n` into multiple `<text:p>` nodes, and map single `\n` to `text:line-break`.
5. **Dispatch ordering / session-key hazards**
   - **Verdict**: Safe; no collision hazard.
   - **Why**: `isGDocsRequest` keys off `google_doc_id`, while `isOdfRequest` keys off `file_path`. The only intersection is `grep` multi-file, which uses an array `file_paths`. Because `args.file_path` is undefined there, `isOdfRequest` cleanly evaluates to `false`, falling back to the DOCX handler. The DOCX handler's `validateAndLoadDocxFromPath` safely rejects `.odt` files gracefully.

**Conclusion**: The plan is structurally sound and safe. Proceed with the implementation (~12 files), keeping in mind the parity fix for `\n\n` paragraph splitting and the edge-case for heading styles. No CI blockers identified.
