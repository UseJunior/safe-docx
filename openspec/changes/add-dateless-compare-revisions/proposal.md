# Change: Dateless comparison revisions

## Why

Every revision a comparison generates carries `w:date`, defaulting to the
current time (#1495). Callers producing reproducible redlines, or who do not
want to disclose when a comparison ran, could not omit it, although ECMA-376
Part 1 §17.13.5.14 / §17.13.5.18 make the attribute optional ("If this
attribute is omitted, then no date information shall be associated with the
parent annotation type").

## What Changes

- `CompareOptions.date` accepts `null`: the comparison's own revisions carry no
  `w:date` in any story part. `undefined` still means now; a Date still works.
- Revisions already present in an input keep their own dates.
- `docx-comparison` and `safe-docx compare` accept `--no-date`.
- MCP `compare_documents` accepts `revision_date`: `'now'` (default), `'none'`,
  or an ISO 8601 date-time, and echoes the applied value.

## Impact

- Affected specs: docx-comparison, mcp-server
- Affected code: `packages/docx-compare/src/{compare-types,index,revisionDateOmission}.ts`,
  `packages/docx-compare/src/cli/compare-two.ts`,
  `packages/docx-mcp/src/cli/{index,help}.ts`, `packages/docx-mcp/src/cli/commands/compare.ts`,
  `packages/docx-mcp/src/tools/compare_documents.ts`, `packages/docx-mcp/src/tool_catalog.ts`
