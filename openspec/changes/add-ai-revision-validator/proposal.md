# Change: Add AI revision validator

## Why

SafeDocX is moving toward tracked changes as the canonical representation for AI-authored document mutations. Today the server emits and preserves revision markup, but there is no AI-scoped validator that can reject malformed AI-authored revisions before they corrupt a live session or saved redline artifact.

## What Changes

- Add a docx-core AI revision validator that checks ECMA-376 tracked-change vocabulary, required metadata, field structure, paired range markers, placement rules, and package invariants.
- Classify validation findings by authorship: AI-authored revision failures are hard errors; foreign revision anomalies are warnings.
- Treat authorless structures through operation context so AI-touched comments, bookmarks, relationships, and content-type side parts can be hard-failed while pre-existing structures remain warnings.
- Share one tracked-change vocabulary constant across validator, save-time diagnostics, and revision-id seeding.
- Enforce transactional MCP writes by validating cloned mutation results before committing changes to the live session.
- Add save-time hard failure for invalid AI revisions instead of silently producing a malformed redline artifact.

## Impact

- Affected specs: `docx-primitives`, `mcp-server`
- Affected code: `packages/docx-core/src/primitives/`, `packages/docx-core/src/primitives/document.ts`, `packages/docx-core/src/baselines/atomizer/pipeline.ts`, `packages/docx-mcp/src/session/manager.ts`, `packages/docx-mcp/src/tools/*`, `packages/docx-mcp/src/tools/save.ts`
- Follow-on changes: #122 can consume the shared vocabulary and validator for surface classification; #123 can reuse validator checks after selective accept/reject.
