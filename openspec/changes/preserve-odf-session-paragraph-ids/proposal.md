# Change: Preserve ODF session paragraph identities

## Why
Insertion currently retargets every later `pN` anchor. Callers can silently edit a different paragraph, and internal transaction forks must not behave like a new session.

## What Changes
- Keep the `pN` shape, assign initial IDs in stored order, and allocate new IDs monotonically using bidirectional element maps.
- Preserve identities and allocator state in transaction forks and comment anchors.
- **BREAKING**: ODF insertion retains its response keys but reports `invalidates_paragraph_ids_after: null` and `requires_reread_before_next_edit: false`.
- Actual reopen deterministically renumbers stored order; add no identity markup to ODF.

## Impact
- Affected specs: mcp-server (ODF provider contract).
- Affected code: odf-core document/comment view, MCP ODF insertion and generated tool reference.
- Approval: implementation follows the detailed remediation plan explicitly approved by the user for #1316 (U), part of #1295. The user selected this identity/reopen policy; no new decision is pending.
- Foundation B (#1297) and transaction boundary #1301 are merged on main. No new session-manager interface is needed.
- Contributor reconciliation and public contract details: `docs/odf-session-ids-1316.md`.
