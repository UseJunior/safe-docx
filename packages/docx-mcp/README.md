# @usejunior/docx-mcp

[![npm version](https://img.shields.io/npm/v/%40usejunior%2Fdocx-mcp)](https://www.npmjs.com/package/@usejunior/docx-mcp)
[![CI](https://github.com/UseJunior/safe-docx/actions/workflows/ci.yml/badge.svg)](https://github.com/UseJunior/safe-docx/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/UseJunior/safe-docx/blob/main/LICENSE)

Local MCP server for surgical editing of existing Microsoft Word `.docx` files with coding agents.

Safe Docx is built for brownfield paperwork workflows: apply accepted AI edits to real Word documents while preserving formatting and review semantics.

For end-user installation, use the canonical wrapper package: `npx -y @usejunior/safe-docx`.

## Quickstart

```bash
npx -y @usejunior/safe-docx
```

Add to your MCP client:

- Command: `npx`
- Args: `["-y", "@usejunior/safe-docx"]`
- Transport: `stdio`

## Primary Workflows

- Apply targeted edits while preserving formatting (`replace_text`, `insert_paragraph`, `format_layout`)
- Produce clean and tracked variants for human review (`save`)
- Compare original vs revised documents into tracked output (`compare_documents`)
- Extract revisions as structured JSON (`extract_revisions`)
- Manage comments and footnotes as first-class operations

## Tool Categories

- Read/Search: `read_file`, `grep`, `has_tracked_changes`, `get_session_status`
- Edit/Layout: `replace_text`, `insert_paragraph`, `format_layout`, `accept_changes`
- Planning/Batch: `init_plan`, `merge_plans`, `apply_plan`
- Compare/Revision: `compare_documents`, `extract_revisions`, `save`
- Comments/Footnotes: `add_comment`, `get_comments`, `delete_comment`, `get_footnotes`, `add_footnote`, `update_footnote`, `delete_footnote`
- Session/Safety: `clear_session`, path-policy + archive guardrails

## Document Families

### Automated fixture coverage in this repo

- Common Paper style mutual NDA fixtures
- Bonterms mutual NDA fixture
- Letter of Intent fixture
- ILPA limited partnership agreement redline fixtures

### Designed for complex legal and business `.docx` classes

- NVCA financing forms
- YC SAFEs
- Offering memoranda
- Order forms and services agreements
- Limited partnership agreements

## Install By Client

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\\Claude\\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "safe-docx": {
      "command": "npx",
      "args": ["-y", "@usejunior/safe-docx"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add safe-docx -- npx -y @usejunior/safe-docx
```

### Gemini CLI

Install from the extension gallery, or add manually:

```json
{
  "mcpServers": {
    "safe-docx": {
      "command": "npx",
      "args": ["-y", "@usejunior/safe-docx"]
    }
  }
}
```

### Cline / VS Code

Add to `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "safe-docx": {
      "command": "npx",
      "args": ["-y", "@usejunior/safe-docx"]
    }
  }
}
```

## Trust Boundary

Safe Docx in this package is local runtime only:

- Runs as a local process on your machine
- Reads/writes local filesystem paths allowed by path policy
- Does not expose a hosted Safe Docx editor endpoint

More detail:

- `docs/safe-docx/trust-checklist.md`
- `docs/safe-docx/mcp-docs-checklist.md`

Runtime safety guardrails:

- Path policy defaults to `HOME` and system temp roots
- Symlink-resolved paths must remain inside allowed roots
- `.docx` archive guardrails reject suspicious archives:
  - `SAFE_DOCX_MAX_ARCHIVE_ENTRIES` (default `2000`)
  - `SAFE_DOCX_MAX_UNCOMPRESSED_BYTES` (default `209715200`)
  - `SAFE_DOCX_MAX_ENTRY_UNCOMPRESSED_BYTES` (default `52428800`)
  - `SAFE_DOCX_MAX_COMPRESSION_RATIO` (default `200`)

Build-time tooling for advanced rendering is optional and not required by default `npx` runtime usage.

## Where It Runs

No native binaries and no .NET prerequisite for supported runtime usage. Safe Docx operates on `Uint8Array` / `Buffer` inputs via `jszip` + `@xmldom/xmldom`:

- Local MCP server (default)
- Cloudflare Workers / Durable Objects
- Vercel Functions / workflow steps
- AWS Lambda / Lambda@Edge
- Docker / any container runtime
- Any V8 isolate or Node.js process

If you need direct library imports in app code, use `@usejunior/docx-core`.

## Reliability and Evidence

- Tool catalog source: `packages/docx-mcp/src/tool_catalog.ts`
- Generated tool reference: `packages/docx-mcp/docs/tool-reference.generated.md`
- OpenSpec traceability matrix: `packages/docx-mcp/src/testing/SAFE_DOCX_OPENSPEC_TRACEABILITY.md`
- Assumption matrix: `packages/docx-mcp/assumptions.md`
- Conformance assets: `packages/docx-mcp/conformance/README.md`
- Conformance guide: `docs/safe-docx/sprint-3-conformance.md`

Commands:

```bash
npm run conformance:smoke -w @usejunior/docx-mcp
npm run conformance:run -w @usejunior/docx-mcp
```

Optional OpenAgreements fixture root:

```bash
SAFE_DOCX_CONFORMANCE_OPEN_AGREEMENTS_ROOT=/path/to/open-agreements npm run conformance:run -w @usejunior/docx-mcp
```

## FAQ

### Is this for editing existing Word files or generating new ones?

This package is for editing existing `.docx` files. For from-scratch generation, use packages such as [`docx`](https://www.npmjs.com/package/docx).

### Does it preserve formatting?

That is a core objective. The edit tools are built for surgical mutation while preserving run/paragraph formatting semantics.

### Is TOON output token-efficient for agent workflows?

Yes. `read_file` supports `toon` output specifically for compact, agent-friendly reads of existing documents.

### Does this require Python, .NET, or LibreOffice?

No for supported runtime paths. The default MCP runtime is TypeScript/Node-based.

### Can it add and delete comment bubbles?

Yes. Use `add_comment`, `get_comments`, and `delete_comment`.

### Can it add and delete footnotes?

Yes. Use `get_footnotes`, `add_footnote`, `update_footnote`, and `delete_footnote`.

### Can it produce tracked changes for review?

Yes. Use `save` with tracked variants or `compare_documents` for standalone original/revised comparisons.

### Is processing local-only?

Yes for this package. It runs as a local process and does not require a hosted Safe Docx editor endpoint.

### What document families are explicitly fixture-tested here?

Mutual NDA variants, Letter of Intent, and ILPA redline fixtures.

### Is this only for legal teams?

No. It is useful anywhere teams edit DOCX paperwork with agents: legal, procurement, sales ops, finance, and HR.

## Golden Prompts

Use these known-good prompt patterns:

- `packages/docx-mcp/docs/golden-prompts.md`

## Development

```bash
npm run build -w @usejunior/docx-mcp
npm run test:run -w @usejunior/docx-mcp
```
