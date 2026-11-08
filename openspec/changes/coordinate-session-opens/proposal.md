# Change: Coordinate provider opens with session closure

## Why
Issue #1298 (C in #1295) remains reproducible after B (#1359): closing a path or all sessions does not invalidate pending provider work. A late opener can publish after close or remove a newer pending entry.

## What Changes
- Give each in-flight open a unique cancellation ticket owned by its session manager.
- Register provider single-flight work before executing it and clean pending entries by promise identity.
- Invalidate tickets and detach pending work on close, including paths without a published session.
- Retain close events only for the lifetime of unresolved canonical-key lookups, covering early close without an unbounded per-path generation registry.
- Check cancellation at the finalized publication boundary, retire cancelled candidates, and preserve existing successful response metadata and normalization policy.

Implementation follows the user-approved remediation plan; the user explicitly authorized implementation and necessary OpenSpec proposals. No additional architecture decision is pending.

## Impact
- Affected spec: `mcp-server`.
- Affected code: session manager, provider resolution, explicit local document opening.
- No MCP tool name or parameter changes. Interrupted open calls return `SESSION_CLOSED`.
- No document-format or rendering behavior changes.

## Contributor reconciliation
Reviewed [contribution #1345](https://github.com/UseJunior/safe-docx/pull/1345) by @cocvn157 at `3871006db7e3a82f0280804f553735d776861e0e`. Credit its centralized coordination, close invalidation, and identity-cleanup approach. This implementation is independently adapted to current main after B: retain finalized-before-publication and non-throwing retirement; use unique tickets released by identity rather than persistent numeric epochs/listeners; test late success and failure across close/reopen for all providers. The contributor branch is untouched. Its Vercel authorization failure is not bypassed.
