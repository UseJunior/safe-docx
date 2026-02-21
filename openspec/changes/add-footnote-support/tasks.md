## 1. docx-primitives: Footnote Primitives
- [ ] 1.1 Add footnote namespace constants to `namespaces.ts`
- [ ] 1.2 Create `footnotes.ts` with types, bootstrap, CRUD functions
- [ ] 1.3 Add DocxDocument wrapper methods in `document.ts`
- [ ] 1.4 Export `footnotes.ts` from `index.ts`
- [ ] 1.5 Create `footnotes.test.ts` with allure BDD-style tests

## 2. safe-docx: MCP Tools
- [ ] 2.1 Create `get_footnotes.ts` MCP tool
- [ ] 2.2 Create `add_footnote.ts` MCP tool
- [ ] 2.3 Create `update_footnote.ts` MCP tool
- [ ] 2.4 Create `delete_footnote.ts` MCP tool
- [ ] 2.5 Register all 4 tools in `server.ts`

## 3. Inline Footnote Markers
- [ ] 3.1 Modify `document_view.ts` to render `[^N]` markers at footnote reference positions

## 4. Tests and Verification
- [ ] 4.1 All footnote primitives unit tests pass
- [ ] 4.2 All MCP tool tests pass
- [ ] 4.3 Type check passes across monorepo
- [ ] 4.4 View/edit isolation verified (replace_text works on paragraphs with footnote references)
