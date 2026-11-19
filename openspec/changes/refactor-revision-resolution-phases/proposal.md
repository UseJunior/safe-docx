# Change: Name and protect tracked revision resolution phases

## Why
Accept/reject currently depend on ordered inline passes: row removal precedes
paragraph discovery, bookmark analysis precedes wrapper removal, and property
restoration precedes paragraph merging. Naming those boundaries makes their
preconditions reviewable without introducing another revision policy.

## What Changes
- Extract private passes with explicit inputs/results in the two owning modules.
- Protect existing ordering, selector calls, counters, object order and deferred
  structural-revision behavior with synthetic regression tests.
- Keep move-range pairing defect #1020 separate; no selector/API changes.

## Authorization
Implementation follows Steven's approved #1295 remediation plan and explicit
“Implement the plan” instruction for #1313. No new architectural decision is
requested here. Foundations #1301 and #1318 are merged and postverified.

## Impact
- Affected specs: docx-primitives.
- Affected code: accept_changes.ts, reject_changes.ts and focused core tests.
- Low-level DOM operations still mutate in place and are not atomic. The MCP
  unpublished mutation fork owns publication safety on failure.
