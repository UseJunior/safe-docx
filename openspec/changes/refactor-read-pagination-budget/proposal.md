# Centralize read pagination budget transitions

## Why

Issue #1317 (V in #1295) remains reproducible on main after #1310: local
TOON/simple/JSON and Google reads maintain independent admission counters.
Google's implicit-budget branch ignores the selected format, and text loops
can close the same table twice when admission stops inside it.

## What Changes

- Share a small typed accumulator for consumed input, rendered characters,
  first-node overflow and stopped/exhausted state.
- Share equivalent local/Google budget renderers, using the package-root
  serializer iterator for contiguous table boundaries while admitting individual
  nodes (JSON and text retain their own accounting and framing).
- Keep explicit offset/limit/node_ids bypass, one-based response offsets,
  comments, document-wide footnotes, and first-node overflow behavior.
- Exercise empty and oversized input, boundaries, repeated tables and complete
  cursor walks; use Google fakes with no remote writes.

## Impact

Docx-mcp reading helpers, tests and the associated measured coverage floors.
The initial CI run improved MCP line coverage from its 89.12% baseline to 90.21%,
triggering the positive-drift ratchet; refresh the floor without lowering any
floor or changing ratchet policy. No new MCP parameters or cursor API,
serializer changes, mutation/session/save changes, or ODF provider changes.
Implementation follows Steven's explicitly approved remediation plan; approval
to implement and ship reviewed, passing PRs was supplied in the task brief.

## Contributor reconciliation

Credit cocvn157's #1337 for the shared renderer extraction and Google format
regressions. This implementation revalidates on main and adds shared admission
state rather than copying the original loops. It leaves ODF and the contributor's
branch, PR and deployment authorization untouched. Actual source/test comparison
and execution evidence accompany the PR; no contributor validation claims are
adopted without execution.
