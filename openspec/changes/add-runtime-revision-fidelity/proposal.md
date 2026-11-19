# Change: Runtime revision-fidelity refusal

## Why
Tracked edits must not publish a candidate whose Accept All or Reject All projection loses intended content or fails to recover its source. Comparison already has publication checks; editing needs the same shared fail-closed boundary.

## What Changes
- Add a portable core guard comparing effective text, paragraph/table structure, formatting, selected stories, note content, drawings and object payload identities.
- Preview the intended untracked mutation independently before publishing an editing candidate.
- Validate final comparison output before returning bytes; carry structured side/part/location diagnostics.
- Default on, with library `revisionFidelity: false` and MCP `SAFE_DOCX_REVISION_FIDELITY=0` performance opt-outs.

## Impact
- Affected capabilities: docx-primitives, mcp-server; comparison publication uses the shared core primitive.
- Owner approved implementation/shipping scope in issue #1537 after #1538 merged.
