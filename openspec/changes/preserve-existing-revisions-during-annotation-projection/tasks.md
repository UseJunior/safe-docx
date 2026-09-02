## 1. Implementation

- [x] 1.1 Detect and snapshot existing revisions across document, header, footer, footnote, endnote, and comment stories (revisions inside comment and footnote bodies are rejected at import).
- [x] 1.2 Admit annotation-only projection while rejecting mixed operative edits before mutation.
- [x] 1.3 Verify source revision XML, metadata, semantics, relative order, and story placement after projection, naming missing revisions in diagnostics.
- [x] 1.4 Compare accept/reject output against the matching source projections.

## 2. Verification

- [x] 2.1 Cover insertion plus ranged-comment body editing.
- [x] 2.2 Cover deletion plus point-comment body editing.
- [x] 2.3 Cover footnote body editing and footnote-to-comment projection.
- [x] 2.4 Cover structured fail-closed behavior for mixed operative edits.
- [x] 2.5 Cover reply topology beside an existing revision.
- [x] 2.7 Cover in-place body edits for comments inside, spanning, and adjacent to existing insertion/deletion containers.
- [x] 2.8 Cover property-change-only sources rejecting operative edits.
- [x] 2.6 Run focused tests and the full repository pre-submit suite.
