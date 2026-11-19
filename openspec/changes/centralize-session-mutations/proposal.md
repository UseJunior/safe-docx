# Change: centralize session mutation publication

## Why
Document writes and session bookkeeping currently have separate commit points. A failed attribution step or overlapping mutation can leave document contents, revisions and cached exports inconsistent.

## What Changes
- Serialize mutations by active session identity and stage local changes on unpublished document forks.
- Publish document, revision allocator, counters, manifests and invalidation synchronously after checking the active session generation.
- Preserve source serialization metadata and current positional ODF identity when forking; stable ODF IDs remain separate issue #1316.
- Record confirmed Google remote success even if a subsequent refresh fails; expose stale structure separately.
- Keep successful batch steps independently committed, preserving the existing partial-success contract.

## Approval
Implementation follows the user-approved remediation plan for F (#1301). The user explicitly instructed “Implement the plan”; no new architecture decision is requested. Stable ODF IDs remain a separate PR under #1316.

## Impact
- Affected spec: mcp-server
- Affected code: session manager, exported production mutation handlers, official DOCX/ODF fork APIs, Google remote-write confirmation.
- MCP names, parameters and response contracts remain compatible, including current ODF insertion invalidation fields.
