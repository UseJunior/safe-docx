# Change: Encapsulate managed revision ID readiness

## Why
Revision ID readiness currently lives in session-level null checks and a separate
promise map. Atomic mutation candidates now clone plain revision state, so a
class or pending promise cannot replace that data without an explicit fork.

## What Changes
- Add a managed allocator with unseeded/seeding/ready states, shared concurrent
  seeds, retry after failure, and detached fork/checkpoint/publication operations.
- Keep synchronous emitters and the plain `RevisionIdState` contract intact.
- Seed current supported stories; preserve the logical grouping policy in #926.
- Publish candidate counters only with a changed, live document and reject a
  conflicting direct allocation without rewinding the active counter.

## Impact
- Affected specs: mcp-server
- Affected code: docx-core revision allocation/story inventory; MCP session mutation boundary
- Implements the user-approved remediation plan for #1299, part of #1295. The user
  explicitly approved implementation, including necessary architectural proposals.
- Contributor reconciliation: #1340 by @cocvn157 identified a useful allocator and
  current-story scan. This implementation retains those ideas but keeps plain
  state cloneable and adds mutation publication/rollback coverage required by the
  subsequently merged #1301. The contributor branch and PR remain unchanged.
