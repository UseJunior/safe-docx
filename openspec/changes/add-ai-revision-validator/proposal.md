# Change: Add AI-emitted revision validation

## Why
Issue #121 is the next unblocked part of umbrella #118: SafeDocX is moving from comparison-based tracked-change reconstruction to first-class write-time emission, and malformed AI revisions must be rejected before they can land in a session or saved artifact.

## What Changes
- Add a core revision validator with rule-table coverage for tracked-change wrappers, move/customXml markers, property changes, table/cell revision types, range balance, field structure, and deletion text placement.
- Track the first session-owned revision id so validation can hard-error only on AI-emitted revisions while warning on pre-existing third-party revision defects.
- Add MCP post-write validation with snapshot rollback for AI write tools and a save-time gate that aborts on session-caused revision validation errors.
- Defer package-level invariant validation and the comments.xml root-comment tracked-text SUPPORT.md drift to follow-up work.

## Impact
- Affected specs: `docx-primitives`, `mcp-server`
- Affected code: `packages/docx-core/src/primitives/validate_revisions.ts`, revision id state, document snapshot APIs, MCP session baseline, guarded mutating tools, and save validation.
