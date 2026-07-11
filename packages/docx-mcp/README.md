# @usejunior/docx-mcp

MCP tools for reading, editing, and comparing `.docx` and `.odt` files.

[![npm](https://img.shields.io/npm/v/%40usejunior%2Fdocx-mcp)](https://www.npmjs.com/package/@usejunior/docx-mcp)
[![Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-green.svg)](../../LICENSE)

End users should run the wrapper package:

```bash
npm install --global @usejunior/safe-docx
safe-docx
```

See [installation and verification](../../docs/installation.md) for pinned versions, package inspection, source builds, and MCP client configuration.

## Tools

- read and search document content;
- apply text, paragraph, formatting, comment, and footnote edits;
- inspect and accept tracked changes;
- save clean and tracked copies;
- compare two documents;
- export documents and structured revisions.

See the [generated tool reference](docs/tool-reference.generated.md) for the complete schemas.

## Development

```bash
npm run build -w @usejunior/docx-mcp
npm run test:run -w @usejunior/docx-mcp
```

Tool definitions live in `src/tool_catalog.ts`. Read the repository [architecture](../../docs/architecture.md) and [contribution guide](../../CONTRIBUTING.md) before changing the public surface.
