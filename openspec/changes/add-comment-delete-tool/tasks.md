## Dependencies
- Requires `add-comment-read-tool` to be merged first or concurrently.

## 1. Primitives Implementation
- [ ] 1.1 Add `deleteComment()` function to `packages/docx-primitives/src/comments.ts`
  - Transitive cascade: collect all descendants via `paraIdParent` graph closure
  - Remove comment elements from `comments.xml`
  - Remove `commentEx` entries from `commentsExtended.xml` (if present)
  - Remove `commentRangeStart`, `commentRangeEnd` from `document.xml` (root only)
  - Remove `commentReference` element from run; remove run only if empty afterward
  - Throw if comment ID not found
- [ ] 1.2 Add `deleteComment()` wrapper to `packages/docx-primitives/src/document.ts`
  - Mark dirty, clear `documentViewCache`

## 2. MCP Tool Implementation
- [ ] 2.1 Create `packages/safe-docx/src/tools/delete_comment.ts`
  - Follow `delete_footnote.ts` pattern
  - Error mapping: `COMMENT_NOT_FOUND`, `MISSING_PARAMETER`, `COMMENT_ERROR`
- [ ] 2.2 Add `delete_comment` entry to `tool_catalog.ts`
  - `destructiveHint: true`, `readOnlyHint: false`
- [ ] 2.3 Add import + dispatch case to `server.ts`

## 3. Testing
- [ ] 3.1 Create `packages/safe-docx/src/tools/delete_comment.test.ts` (dedicated file)
  - Feature: `add-comment-delete-tool`
  - Scenarios:
    1. Delete root comment with no replies — verify removed from `get_comments`
    2. Delete root comment cascades to all replies
    3. Delete single leaf reply — parent remains intact
    4. Delete non-leaf reply — cascades to its descendants
    5. Comment not found → `COMMENT_NOT_FOUND`
    6. Missing `comment_id` → `MISSING_PARAMETER`
    7. Missing session context → `MISSING_SESSION_CONTEXT`
    8. Session-or-file resolution works
    9. Tool registration: `destructiveHint: true`, `readOnlyHint: false`

## 4. Verification
- [ ] 4.1 Build succeeds
- [ ] 4.2 All existing tests pass
- [ ] 4.3 New tests pass
