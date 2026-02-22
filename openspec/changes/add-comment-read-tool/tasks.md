## 1. Implementation
- [ ] 1.1 Create `packages/safe-docx/src/tools/get_comments.ts`
- [ ] 1.2 Add `get_comments` entry to `tool_catalog.ts`
- [ ] 1.3 Add import + dispatch case to `server.ts`

## 2. Testing
- [ ] 2.1 Create `packages/safe-docx/src/tools/get_comments.test.ts` with OpenSpec-mapped scenarios

## 3. Verification
- [ ] 3.1 Build succeeds
- [ ] 3.2 All existing tests pass
- [ ] 3.3 New tests pass
- [ ] 3.4 `openspec validate add-comment-read-tool --strict` passes
