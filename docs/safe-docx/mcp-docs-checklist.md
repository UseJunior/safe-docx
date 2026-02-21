# MCP Docs Checklist (Safe Docx)

This checklist captures documentation patterns shared by widely adopted MCP servers and MCP platform docs.

## Sources Reviewed

- MCP quickstart and server publishing docs:
  - https://modelcontextprotocol.io/quickstart/server
  - https://modelcontextprotocol.io/legacy/concepts/tools
  - https://modelcontextprotocol.io/legacy/concepts/transports
  - https://developers.openai.com/apps-sdk/guides/model-context-protocol
- MCP Registry docs:
  - https://registry.modelcontextprotocol.io/docs
  - https://registry.modelcontextprotocol.io/docs/providers/package-types
  - https://registry.modelcontextprotocol.io/docs/providers/server-json
  - https://registry.modelcontextprotocol.io/docs/providers/remote-servers
- Successful server docs:
  - https://github.com/github/github-mcp-server/blob/main/docs/index.md
  - https://developers.notion.com/docs/mcp
- Desktop extension packaging context:
  - https://www.anthropic.com/engineering/desktop-extensions

## Invariants To Include

- One-command install path at top of README (before architecture details).
- Explicit transport/runtime contract (`stdio` vs HTTP/SSE/streamable HTTP, Node version, local vs hosted).
- Authentication and permission model stated in plain language.
- Tool catalog with required params, optional params, and read-only/destructive flags.
- 2-3 golden prompts that reliably produce first-success runs.
- A "compare two files" workflow and an "apply edits to one file" workflow documented separately.
- Troubleshooting section for common startup/config/path issues.
- Versioned changelog or release notes link.
- Registry-ready metadata (clear description, keywords, compatibility, install snippets).

## Deletion-First Heuristics

Before adding more docs, trim anything that matches one of these:

- Duplicated tool parameter descriptions in multiple files when one generated reference exists.
- Legacy alias names that are not actually callable in current MCP surface.
- Historical sprint details that point to moved paths or old package names.
- Marketing language that hides execution mode (local vs remote).

## Safe Docx Action Checklist

- [x] Restore missing trust/conformance docs in this repo.
- [x] Keep tool schemas in one source of truth (`src/tool_catalog.ts` with Zod 4).
- [x] Generate tool docs from schema source (`docs/tool-reference.generated.md`).
- [x] Add three golden prompts.
- [ ] Publish `.mcpb` artifact in CI release flow.
- [ ] List public package in MCP Registry when open-source launch is ready.
- [ ] Add concise troubleshooting section in package README after first support feedback cycle.
