# Change: Expose comment range metadata in the public get_comments MCP tool

## Why

#129 (PR #134) taught the primitive `Comment` type to resolve `commentRangeStart`/`commentRangeEnd`
markers into structural range metadata (`endParagraphId`, `startRunIndex`, `startCharOffset`,
`endRunIndex`, `endCharOffset`), and #130 (PR #150) consumes it internally for the
`inline_markers` comment rendering. The public `get_comments` MCP tool still drops these fields,
so an AI consumer knows *that* a comment exists on a paragraph but not *where* within it the
comment anchors. Workflows like "replace the commented span" need structural offsets, not
inline markers parsed back out of rendered text.

## What Changes

- `McpComment` in `packages/docx-mcp/src/tools/get_comments.ts` gains optional snake_case
  range fields: `end_paragraph_id`, `start_run_index`, `start_char_offset`, `end_run_index`,
  `end_char_offset`.
- `mapComment` passes the primitive range data through unchanged for root comments and
  threaded replies.
- Comments without range markers (legacy paragraph-attached comments) leave the new fields
  undefined, so existing clients see byte-identical behavior.
- Tool catalog description and the generated tool reference document mention the new
  optional fields.

## Impact

- Affected specs: mcp-server (Comment and Reply Retrieval — new orthogonal requirement)
- Affected code: `packages/docx-mcp/src/tools/get_comments.ts`,
  `packages/docx-mcp/src/tool_catalog.ts`,
  `packages/docx-mcp/docs/tool-reference.generated.md`
- Backwards compatible: additive optional response fields only.
- Closes #152.
