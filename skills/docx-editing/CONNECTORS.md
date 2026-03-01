# Safe-DOCX MCP Connectors

How to connect the Safe-DOCX MCP server to your AI editor or desktop client.

## Summary

| Property | Value |
|----------|-------|
| Transport | stdio |
| Command | `npx` |
| Args | `["-y", "@usejunior/safe-docx"]` |
| API keys | None required |
| Path policy | `~/` and system temp dirs (default) |

## Claude Desktop

Add to `claude_desktop_config.json`:

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

## Cursor

Add to `.cursor/mcp.json` in your project root:

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

## Notes

- **No API keys** — Safe-DOCX runs locally and does not call external services.
- **Path policy** — By default, only files under the home directory (`~/`) and system temp directories are accessible. Symlinks must resolve to allowed roots.
- **Node.js required** — `npx` requires Node.js 18+ on the host machine.
