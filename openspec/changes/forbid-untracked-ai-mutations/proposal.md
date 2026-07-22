# Change: Forbid untracked AI mutations within the supported surface

## Why

The Anthropic differentiator (#118) is that AI-authored edits in the *supported
revisionable surface* (#119) cannot be untracked. Today every write tool routes
through the write-time tracked-change emitter (#120) and validator (#121), but
the contract is implicit: nothing classifies each tool as revisionable versus
package-mutation, and package-level mutations that have no native OOXML revision
wrapper (comment/footnote side parts, relationships, content types) land
silently. Removing whole-document comparison from the default finalization path
(#126) depends on those untracked mutations being *accounted for* rather than
caught after the fact by a diff.

## What Changes

- Classify every MCP tool's write surface as `revisionable`, `package-mutation`,
  or `internal`, mirroring the ratified inventory in `packages/docx-core/SUPPORT.md`.
  The classification is advertised in each tool's description and in the exported
  tool metadata (`surface`, `emitsNonRevisionChanges`).
- Add a session **non-revision change manifest**: dual-surface tools
  (`add_comment`, `delete_comment`, `add_footnote`) record the package parts they
  mutate without a tracked-change wrapper, and the `save` report surfaces the
  manifest alongside the revisions list.
- Add a revisionable-surface property test asserting that every fresh-emission
  edit tool produces at least one valid AI-authored tracked-change element
  (validity delegated to the #121 validator) and that AI-inserted body text is
  never left as untracked content.

## Impact

- Affected specs: `mcp-server`
- Affected code: `packages/docx-mcp/src/tool_catalog.ts`,
  `packages/docx-mcp/src/session/manager.ts`,
  `packages/docx-mcp/src/tools/{add_comment,delete_comment,add_footnote,save}.ts`,
  `packages/docx-core/SUPPORT.md`
- Unblocks: #126 (remove comparison from the default finalization path)
