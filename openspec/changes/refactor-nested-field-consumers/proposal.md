# Change: Share nested field traversal with scalar consumers

## Why
Generation rejects valid nested fields and read_file misplaces inline comment
markers after nested fields because these consumers retain a single field phase.

## What Changes
- Extract the existing strict marker stack into a small incremental traversal.
- Reuse it for generation checks and tolerant read comment coordinates.
- Retain state across paragraphs within a story and isolate unrelated stories.
- Preserve the pinned differential validator and optional separators.
- Give differential package characterization an explicit legacy diagnostic policy;
  generation's corrected nesting must not change source/schema evidence or the
  committed strategy-differential manifest.

Implementation follows the user-approved remediation plan for #1308 (M), part
of #1295. That approval authorizes this proposal and implementation.

## Impact
- Affected specs: docx-generation, mcp-server
- Affected code: shared/field-structure.ts, generation/structural-checks.ts,
  docx-mcp/tools/read_file.ts, docx-compare/integration/strategy-differential-harness.ts
- No MCP parameter or response changes; no new dependencies.
