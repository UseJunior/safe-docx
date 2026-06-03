## 1. Implementation
- [x] 1.1 Create `packages/docx-mcp/src/tools/get_comments.ts`
- [x] 1.2 Add `get_comments` entry to `tool_catalog.ts`
- [x] 1.3 Add import + dispatch case to `server.ts`

## 2. Testing
- [x] 2.1 Create `packages/docx-mcp/src/tools/get_comments.test.ts` with OpenSpec-mapped scenarios

## 3. Verification
- [x] 3.1 Build succeeds
- [x] 3.2 All existing tests pass
- [x] 3.3 New tests pass
- [x] 3.4 `openspec validate add-comment-read-tool --strict` passes
