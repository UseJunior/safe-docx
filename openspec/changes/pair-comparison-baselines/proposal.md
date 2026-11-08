# Change: Publish comparison baselines as one resource

## Why
Current main already prepares both buffers locally and shares an in-flight promise, but readiness trusts only the clean field and late generation can publish into a retired session. Comparison must consume a complete normalized original independently of live edits and skip-normalization policy.

## What Changes
- Keep loading/ready resource state outside cloneable session metadata.
- Return the paired clean/bookmarked resource from ensureBaselines; retain legacy buffer fields as compatibility mirrors only.
- Publish only after both serializations succeed and the original source/session still owns the attempt. Share failures and allow retries.
- Reconstruct from the immutable original, never the live document or its serialization baseline.

## Approval
Implementation follows Steven's approved remediation plan and instruction to implement it (#1295, E, #1300). No additional product decisions are introduced.

## Impact
Only the session manager, comparison consumer, dedicated regression tests and leaf documentation change. MCP contracts, mutation transactions, revision policies and save artifacts remain compatible. Contributor cocvn157's #1344 informed the paired return contract; reconciliation is in docs/comparison-baselines.md.
