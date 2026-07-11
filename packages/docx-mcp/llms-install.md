# SafeDocX MCP Server — Installation Guide

SafeDocX (`@usejunior/safe-docx`) is a local MCP server for AI-powered DOCX editing with tracked changes, redlining, and formatting preservation.

**Install:** Follow [`docs/installation.md`](../../docs/installation.md), then use the installed executable's absolute path as the server command.
**Transport:** stdio
**Runtime:** Node.js >= 18

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "safe-docx": {
      "command": "/absolute/path/to/safe-docx",
      "args": []
    }
  }
}
```

## Claude Code

Run in your terminal:

```bash
claude mcp add safe-docx -- /absolute/path/to/safe-docx
```

## Gemini CLI

Install from the extension gallery (requires `gemini-cli-extension` GitHub topic on the repo), or add manually to your Gemini CLI settings:

```json
{
  "mcpServers": {
    "safe-docx": {
      "command": "/absolute/path/to/safe-docx",
      "args": []
    }
  }
}
```

## Cline / VS Code

Add to your Cline MCP settings (`cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "safe-docx": {
      "command": "/absolute/path/to/safe-docx",
      "args": []
    }
  }
}
```

## Generic MCP Client

Any MCP client that supports stdio transport can use SafeDocX. Configure with:

- **Command:** the absolute path returned by `command -v safe-docx` or `where safe-docx`
- **Arguments:** none
- **Transport:** stdio

Example JSON config:

```json
{
  "mcpServers": {
    "safe-docx": {
      "command": "/absolute/path/to/safe-docx",
      "args": []
    }
  }
}
```
