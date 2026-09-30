# @usejunior/safe-docx

Edit Word and OpenDocument files with coding agents.

[![npm version](https://img.shields.io/npm/v/@usejunior/safe-docx)](https://www.npmjs.com/package/@usejunior/safe-docx)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache--2.0-green.svg)](https://github.com/UseJunior/safe-docx/blob/main/LICENSE)

Safe Docx is a local MCP server and CLI for reading, searching, editing, comparing, converting, and saving document files. It preserves DOCX structure and can produce clean or tracked-changes output. Documents are processed on your machine.

## Example

Ask your coding agent:

```text
Edit NDA.docx. Change the governing law from New York to Delaware.
Save a clean copy and a tracked-changes copy. Do not change anything else.
```

Safe Docx finds the clause, applies the targeted edit, and writes both files for review. The rest of the document stays outside the requested edit.

Follow the complete [editing walkthrough](https://github.com/UseJunior/safe-docx/blob/main/docs/tutorial.md).

## Install

```bash
npm install --global @usejunior/safe-docx
safe-docx --help
```

The package installs both `safe-docx` and `safedocx`; use `safe-docx` in new configurations.

## Configure An MCP Client

Locate the installed executable with `command -v safe-docx` (`where safe-docx` on Windows). Desktop applications may not inherit your terminal's `PATH`, so configure clients with that absolute path. The server takes no arguments and uses `stdio`.

Claude Code:

```bash
claude mcp add safe-docx -- /absolute/path/to/safe-docx
```

JSON-based clients, including Antigravity CLI (`~/.gemini/config/mcp_config.json`):

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

See [installation and verification](https://github.com/UseJunior/safe-docx/blob/main/docs/installation.md) for pinning a version, inspecting the package before install, and building from source.

## Tools

- **Read and navigate:** `read_file`, `get_document_outline`, `get_sections`, `grep`
- **Edit:** `replace_text`, `insert_paragraph`, `batch_edit`, `clear_formatting`
- **Format:** `format_layout`, `format_numbering`, `format_section`, `insert_section_break`
- **Tracked changes:** `has_tracked_changes`, `extract_revisions`, `accept_changes`, `accept_ai_edits`, `reject_ai_edits`
- **Compare:** `compare_documents`
- **Comments and footnotes:** `add_comment`, `get_comments`, `delete_comment`, `get_footnotes`, `add_footnote`, `update_footnote`, `delete_footnote`
- **Save and convert:** `save`, `export`, `convert_to_odt`, `get_file_status`, `close_file`

Parameters and behavior for each tool are in the [tool reference](https://github.com/UseJunior/safe-docx/blob/main/packages/docx-mcp/docs/tool-reference.generated.md).

## Not Optimized For

Safe Docx is not a visual editor or layout engine. It does not provide browser rendering, real-time collaboration, or pixel-level pagination guarantees. `.dotx` templates must be converted to `.docx` before use.

## Links

- [Repository](https://github.com/UseJunior/safe-docx)
- [Changelog](https://github.com/UseJunior/safe-docx/blob/main/CHANGELOG.md)
- [TypeScript library (`@usejunior/docx-core`)](https://www.npmjs.com/package/@usejunior/docx-core)
- [Standards conformance](https://usejunior.com/engineering/safe-docx/conformance)
- [Issues](https://github.com/UseJunior/safe-docx/issues)
