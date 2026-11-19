# Change: One revision-grouping default across compare surfaces

## Why

The MCP `compare_documents` tool defaulted to `readable-semantic` grouping while
the library's `compareDocuments` and the `docx-comparison` CLI defaulted to
`token-minimal`, so the same pair gave different redlines on different surfaces
(#1494). The compare CLIs also had no way to choose a grouping or turn move
detection off.

## What Changes

- **BREAKING (output only):** `compareDocuments` defaults to
  `revisionGrouping: 'readable-semantic'`. Accept All and Reject All are
  unchanged; pass `revisionGrouping: 'token-minimal'` for the previous output.
- Define the default once as `DEFAULT_COMPARE_REVISION_GROUPING` in
  `@usejunior/docx-compare`; the MCP tool and both CLIs import it.
- `docx-comparison` and `safe-docx compare` accept
  `--grouping <readable-semantic|token-minimal>` and `--no-moves`, and reject an
  unknown grouping value with the accepted values.

## Impact

- Affected specs: mcp-server (the compare CLIs and MCP tool ship from docx-mcp; the library default is in the docx-comparison delta of add-readable-semantic-revision-grouping)
- Affected code: `packages/docx-compare/src/{compare-types,index}.ts`,
  `packages/docx-compare/src/cli/compare-two.ts`,
  `packages/docx-mcp/src/cli/{index,help}.ts`,
  `packages/docx-mcp/src/cli/commands/compare.ts`,
  `packages/docx-mcp/src/tools/compare_documents.ts`
