# Change: Finalize sessions before publication

## Why
Session creation currently publishes an unfinalized document and retires the previous session before the candidate can fail. Expired sessions lose their registry entry without releasing their temporary artifacts.

## What Changes
- Prepare and finalize DOCX candidates before publication, preserving caller normalization policy and lazy comparison baselines.
- Publish file-backed replacements before retiring old artifacts. Failed preparation preserves the old session; failed retirement retains the directory for retry without failing successful creation.
- Retire expired artifacts on every lookup and list path; make concurrent cleanup idempotent and drain pending removals during clear-all.
- Preserve public MCP names, parameters and responses. No FSM framework or concurrency/open-close coordination changes.

## Approval
Implementation follows Steven's approved state-machine remediation plan (epic #1295, planning ID B, issue #1297) and explicit instruction to implement the plan. No new product decisions are requested.

## Impact
- Affected specs: mcp-server
- Affected code: docx-mcp session manager and explicit open normalization options
- Related contribution: cocvn157's PR #1338; reconciliation and differences are recorded in the issue PR.
