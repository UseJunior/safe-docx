# Safe-DOCX MCP Connectors

How to connect the Safe-DOCX MCP server to your AI editor or desktop client.

## Requirements

| Binary | Minimum version | Notes |
|--------|-----------------|-------|
| `node` | 18.0.0 | Authoritative from `package.json` engines field |
| `npm` / `npx` | Bundled with Node.js | Only needed for the `npx` connector path |

## Summary

| Property | Value |
|----------|-------|
| Transport | stdio |
| Command (default) | `npx` |
| Args | `["-y", "@usejunior/safe-docx@0.9.0"]` (pinned) |
| API keys | None required |
| Path policy | `~/` and system temp dirs (default) |
| Install-time network | npm registry, one-time fetch |
| Runtime network | None |

## Claude Desktop (pinned version, recommended)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "safe-docx": {
      "command": "npx",
      "args": ["-y", "@usejunior/safe-docx@0.9.0"]
    }
  }
}
```

Pinning the version prevents unexpected updates. Check the [CHANGELOG](https://github.com/UseJunior/safe-docx/blob/main/CHANGELOG.md) before bumping.

## Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "safe-docx": {
      "command": "npx",
      "args": ["-y", "@usejunior/safe-docx@0.9.0"]
    }
  }
}
```

## Offline / High-Security Install

For environments where `npx` fetching from npm is unacceptable, install the package manually and invoke the installed binary directly:

```bash
# Install a specific pinned version globally
npm install -g @usejunior/safe-docx@0.9.0
```

Then configure your MCP client to use the installed binary:

```json
{
  "mcpServers": {
    "safe-docx": {
      "command": "safe-docx",
      "args": []
    }
  }
}
```

This eliminates the runtime `npx` fetch entirely. The MCP server has zero outbound network calls once installed.

### Vendored install

To vendor the package into your project without touching a registry at run time:

```bash
npm pack @usejunior/safe-docx@0.9.0
# Inspect the tarball, then:
npm install -g ./usejunior-safe-docx-0.9.0.tgz
```

### Build from source

For maximum auditability:

```bash
git clone https://github.com/UseJunior/safe-docx.git
cd safe-docx
git checkout v0.9.0
npm ci
npm run build
npm link packages/safe-docx
```

## Notes

- **No API keys** — Safe-DOCX runs locally and does not call external services.
- **Path policy** — By default, only files under the home directory (`~/`) and system temp directories are accessible. Symlinks must resolve to allowed roots.
- **Install-time vs runtime network** — The default `npx` connector fetches the package from npm on first run. After install, the server has zero outbound network calls. Use the offline install path above if one-time install fetching is unacceptable.
- **No postinstall scripts** — The package declares no `postinstall`, `preinstall`, or `install` hooks. Verify with `npm view @usejunior/safe-docx scripts`.
- **Provenance** — Releases are published with npm provenance, so each published version can be cryptographically traced back to the GitHub Actions build that produced it.
