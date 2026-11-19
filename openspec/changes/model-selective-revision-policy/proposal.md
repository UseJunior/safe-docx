# Change: Model selective revision preservation explicitly

## Why
Issue #1303 (epic #1295, H) currently uses the presence of last-action metadata
as export policy. Current main already preserves the correct sticky behavior;
the approved remediation makes that policy explicit without changing it.

## What Changes
- Represent ordinary versus selective-preservation mode as plain cloneable data,
  with last-action metadata nested separately in the preservation state.
- Publish policy only with changed document contents at the atomic mutation boundary.
- Capture the authoritative state before save exports and retain the identity guard.
- Derive remaining AI revisions from captured document contents, across Word parts.
- Preserve tool parameters, save precedence and diagnostic payload keys.

## Impact
- Affected specs: mcp-server
- Affected code: session/manager.ts, tools/save.ts and regression tests.
- Session-only state; no new persisted DOCX metadata or reopen behavior.

## Authorization and revalidation
Implementation follows Steven's explicitly approved remediation plan and
"Implement the plan" authorization. Dependencies F, D, E, K and U are merged
and postverified; current main is 6c4238eb. The initial owned working tree is clean.
The deficiency is implicit policy representation, not a claim that current main
loses sticky preservation. Tests must retain #1084, #586, #926 and #1243/#1253.

## Contributor reconciliation
Reviewed the actual diff of cocvn157's contribution #1342 (264fa136).
Its policy/action separation and live revision derivation are sound directions.
Its clear-on-accept_changes transition conflicts with the approved sticky lifetime;
its stale-base manager changes also predate atomic candidate publication and save's
captured-generation identity guard. This implementation credits those directions
but uses a small typed state, no reset/armed-revision API, and current atomic/save
boundaries. The contributor's branch, PR and permissions remain unchanged.
