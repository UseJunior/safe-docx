## 1. Implementation

- [x] 1.1 Extend `McpComment` in `packages/docx-mcp/src/tools/get_comments.ts` with optional
      `end_paragraph_id`, `start_run_index`, `start_char_offset`, `end_run_index`,
      `end_char_offset` fields and pass them through in `mapComment` (replies included)
- [x] 1.2 Update the `get_comments` entry in `packages/docx-mcp/src/tool_catalog.ts` to
      document the optional range fields, and regenerate
      `packages/docx-mcp/docs/tool-reference.generated.md`
- [x] 1.3 Add traceability tests (`TEST_FEATURE = 'expose-comment-range-metadata'`) covering
      single-paragraph range comments, multi-paragraph range comments, whole-paragraph
      comments without range markers, and threaded replies
- [x] 1.4 Run build, lint, tests, spec-coverage, and tool-docs checks
