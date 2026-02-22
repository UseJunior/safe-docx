# @usejunior/safe-docx

Local MCP server for editing Microsoft Word `.docx` files with coding agents.

Built for developers who occasionally need to handle contracts, forms, and other paperwork without switching to a separate document-automation stack.

## Quickstart (2 minutes)

```bash
npx -y @usejunior/safe-docx
```

Add to your MCP client:

- **Command:** `npx`
- **Args:** `["-y", "@usejunior/safe-docx"]`
- **Transport:** `stdio`

## What You Can Do

- Apply edits to one document while preserving formatting (`replace_text`, `insert_paragraph`, `format_layout`)
- Save outputs as clean and/or tracked-changes variants (`download`)
- Compare an original and revised document to generate a tracked-changes comparison output (`compare_documents`; tracked changes are computed at comparison time, not tracked incrementally during edits)
- Extract revision data as JSON for downstream review flows (`extract_revisions`)
- Check whether tracked-change markers are present (`has_tracked_changes`)
- Add comments and manage footnotes (`add_comment`, `get_footnotes`, `add_footnote`, `update_footnote`, `delete_footnote`)

## Golden Prompts

Use these known-good prompt patterns:

- `packages/safe-docx/docs/golden-prompts.md`

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

- Runs in a local process on your machine
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

build-time tooling for advanced rendering is optional and not required by the default `npx` runtime.

## Tool Reference (Generated)

Tool input schemas are defined in Zod 4 and exported to JSON Schema for MCP/tool docs.

- Source of truth: `packages/safe-docx/src/tool_catalog.ts`
- Generated reference: `packages/safe-docx/docs/tool-reference.generated.md`
- Regenerate: `npm run docs:generate:tools -w @usejunior/safe-docx`

## Conformance and Reliability Evidence

- Assumptions and verification matrix:
  - `packages/safe-docx/assumptions.md`
- Conformance guide:
  - `docs/safe-docx/sprint-3-conformance.md`
- Conformance assets:
  - `packages/safe-docx/conformance/README.md`

Commands:

```bash
npm run conformance:smoke -w @usejunior/safe-docx
npm run conformance:run -w @usejunior/safe-docx
```

Optional OpenAgreements fixture root:

```bash
SAFE_DOCX_CONFORMANCE_OPEN_AGREEMENTS_ROOT=/path/to/open-agreements npm run conformance:run -w @usejunior/safe-docx
```

## Development (Repo)

```bash
npm run build -w @usejunior/safe-docx
npm run test:run -w @usejunior/safe-docx
```
