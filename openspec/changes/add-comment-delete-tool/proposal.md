# Change: Add comment deletion

## Why
Comments currently have add + read but no delete. An LLM agent that adds a comment by
mistake has no way to remove it. The footnotes subsystem already has full CRUD including
delete — comments should have parity for the destructive path at minimum.

The primitives layer has **no** `deleteComment` function today. This change adds it at
both the primitives and MCP layers.

## Dependencies
This change builds on `add-comment-read-tool` (which added `get_comments`). That change
should be merged first or concurrently.

## What Changes

### docx-primitives
- NEW: `deleteComment()` in `comments.ts` — removes comment from `comments.xml`,
  cleans up range markers in `document.xml`, and removes entries from
  `commentsExtended.xml`. Transitive cascade-deletes all descendants.
- MODIFIED: `document.ts` — add `deleteComment()` wrapper method on `DocxDocument`
  (marks dirty, clears caches).

### safe-docx (MCP)
- NEW: `delete_comment` MCP tool (`tools/delete_comment.ts`)
- MODIFIED: `tool_catalog.ts` — add catalog entry
- MODIFIED: `server.ts` — add import + dispatch case
- NEW: `delete_comment.test.ts` — dedicated test file with feature `add-comment-delete-tool`

## Design Decisions

### 1. Transitive cascade for any deleted node
Deleting any comment (root or reply) auto-deletes all its descendants via
`paraIdParent` graph closure. This applies uniformly — not just to root comments.

Rationale:
- Orphaned replies with no parent are invalid OOXML and confuse Word
- Legal workflows treat comment threads as atomic units
- Matches how Word itself behaves (`Comment.Delete` removes replies)
- Multi-level nesting IS supported by the primitives layer (tested: reply-to-reply
  creates a real tree), so cascade must be recursive, not single-level

No `delete_replies` flag — auto-cascade is the only behavior.

### 2. Safe element-level removal for commentReference
Do NOT remove the containing `<w:r>` run wholesale. Instead:
1. Remove only the `<w:commentReference>` element from the run
2. Remove the containing run only if it has no visible content afterward

This matches the footnote delete pattern (`footnotes.ts:653-657`) and prevents
accidental text loss when the reference shares a run with user content.

### 3. commentEx removal is "if present"
Root comments created by `addComment` do NOT get a `<w15:commentEx>` entry — that
entry is only created by `ensureCommentExEntry` during reply creation. The delete
function must handle the case where no `commentEx` exists for a root comment without
erroring.

### 4. commentsIds.xml — defensive guard, not full implementation
Investigation results:
- The Bylaws smoke test document does NOT contain `commentsIds.xml`
- 0 of 22 project DOCX fixtures contain it
- 0 source code references to it exist
- It's an Office 2016+ (`w16cid` namespace) feature for durable comment IDs

**v1 approach:** If `word/commentsIds.xml` exists in the archive, log a warning but
proceed with deletion from the three known parts. Do not attempt cleanup of
`commentsIds.xml` — Word is expected to reconcile this part on next save. If this
proves insufficient, a follow-up change can add explicit cleanup.

Justification: no real-world documents in the project use this part, and implementing
blind cleanup for an untested format risks introducing corruption.

### 5. No people.xml cleanup
The author entry in `people.xml` is NOT removed. The same author may appear on other
comments or tracked changes. Consistent with footnote delete behavior.

### 6. Document.xml cleanup scope: body only (v1 boundary)
Range markers (`commentRangeStart`, `commentRangeEnd`, `commentReference`) are removed
from `document.xml` body only. Comments anchored in headers, footers, or text boxes are
out of scope for v1. This is consistent with `addComment`, which only creates markers in
the document body.

### 7. MCP error mapping contract
Following the `delete_footnote` pattern:
| Primitives error | MCP error code | When |
|---|---|---|
| Comment ID not found | `COMMENT_NOT_FOUND` | ID doesn't exist in `comments.xml` |
| Missing `comments.xml` | `COMMENT_NOT_FOUND` | No comment infrastructure at all |
| Missing `comment_id` param | `MISSING_PARAMETER` | Required field not provided |
| No session/file context | `MISSING_SESSION_CONTEXT` | Neither `session_id` nor `file_path` |
| Unexpected error | `COMMENT_ERROR` | Catch-all fallback |

## Non-Goals
- `update_comment` — out of scope per user decision
- Batch delete (multiple IDs in one call) — single-comment delete is sufficient for v1
- `commentsIds.xml` cleanup — deferred (see decision #4)
- Header/footer/textbox comment cleanup — deferred (see decision #6)

## Impact
- Affected specs: `docx-primitives`, `mcp-server`
- Affected code:
  - `packages/docx-primitives/src/comments.ts` (add `deleteComment`)
  - `packages/docx-primitives/src/document.ts` (add wrapper)
  - `packages/safe-docx/src/tools/delete_comment.ts` (new)
  - `packages/safe-docx/src/tools/delete_comment.test.ts` (new)
  - `packages/safe-docx/src/tool_catalog.ts`
  - `packages/safe-docx/src/server.ts`
