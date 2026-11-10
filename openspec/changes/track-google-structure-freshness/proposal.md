# Change: Own Google write planning and structure freshness

## Why
Raw Google writes already mark the structure stale on current main, but subsequent edits still read its old indexes. Concurrent writes and refreshes can also publish an obsolete snapshot. An acknowledged cloud mutation cannot be rolled back when a follow-up read fails.

## What Changes
- Serialize Google request planning, writes and refreshes per document with a local promise queue.
- Distinguish unloaded, current and stale-after-write structure, refreshing before cached-index planning.
- Preserve normal post-edit refreshes and foundation F's confirmed-write accounting.
- Route MCP layout planning through the document queue and refresh insertion/replacement selector prechecks.
- Refresh known-stale Google MCP reads/searches before returning user-facing content or matches; preserve current-state fetch counts and read/search error contracts.

Implementation follows the user's approved remediation plan for K / #1306 in epic #1295; no additional approval is pending. MCP names, parameters and response fields stay compatible.

Supervisor scope adjudication requires stale user-facing reads (review finding L1) within this same freshness state machine. The initial write-planning change merged in #1375 before that hold took effect; the focused follow-up completes read/search freshness without changing synchronous core snapshot getters.

## Impact
- Affected specs: mcp-server
- Affected code: google-docs-core document; Google MCP edit/layout helpers and fake-provider tests
- No session-manager implementation, local DOCX, ODF, save, revision policy or OOXML changes.

## Contributor reconciliation
Reviewed the actual diff and tests in cocvn157's [PR #1343](https://github.com/UseJunior/safe-docx/pull/1343). Credit that contribution for the explicit freshness states, serialized writes and failure-injection direction. Its branch remains unchanged. This implementation uses separate private queue-owned steps instead of a shared reentrancy flag, so concurrent external calls cannot bypass serialization. It additionally serializes explicit refreshes, puts MCP layout request construction inside the queue, refreshes selector prechecks, and preserves main's `confirmedWriteVersion` accounting (anchor maintenance remains separate from user edits). These are acceptance gaps beyond that contribution's three tests; its execution claims are not reused.
