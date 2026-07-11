# Installation

Install Safe Docx before adding it to an MCP client. This separates package review from execution and avoids downloading an unpinned package each time the server starts.

## Install From npm

Install the published package globally:

```bash
npm install --global @usejunior/safe-docx
```

Confirm the executable is available:

```bash
safe-docx --help
```

The package publishes both `safe-docx` and `safedocx`; use `safe-docx` in new configurations.

## Pin A Version

For controlled environments, inspect the available version and install it explicitly:

```bash
npm view @usejunior/safe-docx version
npm install --global @usejunior/safe-docx@<version>
```

An explicit version prevents a later release from being selected during installation. Record the chosen version in your environment configuration or deployment documentation.

## Inspect Before Installing

Review the package metadata and tarball contents:

```bash
npm view @usejunior/safe-docx
npm pack @usejunior/safe-docx@<version> --dry-run
```

npm publishes an integrity digest with each package version and verifies downloaded tarballs during installation. In a project installation, commit `package-lock.json` and use `npm ci` to reproduce the resolved dependency tree. npm also supports registry-signature verification through `npm audit signatures`.

The canonical package is [published on npm](https://www.npmjs.com/package/@usejunior/safe-docx). Its manifest is [`packages/safe-docx/package.json`](../packages/safe-docx/package.json), and the wrapper executable is [`packages/safe-docx/bin/safe-docx.js`](../packages/safe-docx/bin/safe-docx.js).

## Install From Source

To review and build the repository yourself:

```bash
git clone https://github.com/UseJunior/safe-docx.git
cd safe-docx
npm ci
npm run build
node packages/safe-docx/bin/safe-docx.js --help
```

Check out a release tag or commit before running `npm ci` when reproducibility matters.

## Configure An MCP Client

After a global npm install, the server command is:

| Setting | Value |
|---|---|
| Command | `safe-docx` |
| Arguments | none |
| Transport | `stdio` |

Claude Code:

```bash
claude mcp add safe-docx -- safe-docx
```

JSON-based clients:

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

Some desktop applications do not inherit the same `PATH` as an interactive shell. If the client cannot find `safe-docx`, use the absolute path returned by:

```bash
command -v safe-docx
```

On Windows, use `where safe-docx`.

## Update Or Remove

```bash
npm update --global @usejunior/safe-docx
npm uninstall --global @usejunior/safe-docx
```

Review release notes before updating a pinned or controlled installation.
