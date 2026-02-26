# @usejunior/safe-docx

[![npm version](https://img.shields.io/npm/v/%40usejunior%2Fsafe-docx)](https://www.npmjs.com/package/@usejunior/safe-docx)
[![CI](https://github.com/UseJunior/safe-docx/actions/workflows/ci.yml/badge.svg)](https://github.com/UseJunior/safe-docx/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/UseJunior/safe-docx/blob/main/LICENSE)

Canonical npm install name for Safe Docx MCP workflows.

Use this package when you want coding agents to perform surgical edits on existing Word `.docx` documents with formatting preservation.

## Install and Run

```bash
npx -y @usejunior/safe-docx
```

Implementation is provided by `@usejunior/docx-mcp`; this package re-exports the public API and CLI entrypoint under the canonical name.

## Scope

`@usejunior/safe-docx` is focused on brownfield editing of existing `.docx` files.

If your primary use case is creating new documents from scratch, use generation-oriented packages such as [`docx`](https://www.npmjs.com/package/docx).

## Full Docs

- `packages/docx-mcp/README.md`
- `packages/docx-mcp/docs/tool-reference.generated.md`
