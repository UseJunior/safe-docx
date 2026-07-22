# Architecture

Safe Docx is a local Node.js process for working with document files. An agent can use it through MCP or invoke its tools through the command-line interface. There is no required Safe Docx hosted service.

The common path is a DOCX file on disk:

```text
agent or user
    |
    v
MCP or CLI
    |
    v
DOCX session
    |
    v
read, search, edit, compare, convert, or save
```

ODT and Google Docs are alternative document sources for supported operations. They are not steps after a DOCX session.

## Main Packages

| Package | Responsibility |
|---|---|
| `@usejunior/safe-docx` | Installed `safe-docx` command |
| `@usejunior/docx-mcp` | MCP server, CLI commands, sessions, tool schemas, and filesystem policy |
| `@usejunior/docx-core` | DOCX parsing, editing primitives, revisions, and document generation |
| `@usejunior/docx-compare` | Comparison of original and revised DOCX files |

`@usejunior/odf-core` and `@usejunior/google-docs-core` support the alternative ODT and Google Docs paths.

## MCP And CLI

Running `safe-docx` with no command starts the MCP server. The CLI can also invoke tools directly:

```bash
safe-docx grep "governing law" contract.docx
safe-docx compare original.docx revised.docx comparison.docx
safe-docx export --file-path contract.docx --format markdown
```

Both interfaces use the same document operations. The server:

- publishes tool schemas;
- validates tool arguments and filesystem access;
- opens or reuses document sessions;
- returns structured results or actionable errors;
- writes requested output files.

See the [tool reference](../packages/docx-mcp/docs/tool-reference.generated.md) for the current operation schemas.

## Document Sessions

Most operations begin with a file path. Safe Docx detects the format, parses the document, and creates or reuses a session:

```text
file path
    |
    v
format detection
    |
    v
session + parsed document
    |
    +--> read or search
    +--> edit and save
    +--> compare or convert
    +--> inspect status or revisions
```

Reading and searching are useful on their own. An edit changes the in-memory session; `save` writes the requested clean or tracked output. The original file is not overwritten unless the caller explicitly selects that path and permits overwrite.

## Reading And Search

`read_file` reads document content and returns paragraph IDs alongside the text. It can return compact text, TOON, or structured JSON.

`grep` searches document text and returns matching paragraphs with enough context to target a later edit.

`get_document_outline` is an experimental, lower-cost structural view. Most users should begin with `read_file` or `grep`.

Paragraph IDs look like `_bk_a3f29c10b8e4`. Edit operations use these IDs as anchors. For identical stored DOCX bytes, IDs are deterministic across reopens, processes, and machines. IDs based on Word's intrinsic `w14:paraId` survive text edits; fallback IDs may change when the paragraph or neighboring text changes.

Structured reads can optionally include `content_fingerprint`, a normalized-text hash for citation and reconciliation systems. It identifies content, not a unique paragraph, and is not an edit anchor.

## Editing

Safe Docx applies targeted changes rather than regenerating a document from extracted text:

| Operation | Purpose |
|---|---|
| `replace_text` | Replace exact text inside one paragraph |
| `insert_paragraph` | Insert text before or after an anchored paragraph |
| `format_layout` | Change supported run, paragraph, table, or page formatting |
| comment tools | Add, read, or delete comments |
| footnote tools | Add, read, update, or delete footnotes |
| revision tools | Inspect, accept, or reject tracked changes |

`batch_edit` is a convenience wrapper that submits several replacement or insertion operations together; it is not a separate editing primitive.

Comments, footnotes, relationships, and other DOCX package parts are handled automatically. Callers work with document operations rather than managing package references themselves.

## Saving And Comparing

`save` can write:

- a **tracked** document containing the session's authored insertions and deletions;
- a **clean** document with those changes accepted;
- both variants in one call.

Pre-existing revisions from other authors remain distinct from the current session's changes.

For a fresh comparison between an original and a revised document, use `compare_documents`. It produces a DOCX whose tracked changes describe the difference between those two files.

## Conversion

`export` converts DOCX content to Markdown, semantic HTML, or plain text. These formats are intentionally lossy and intended for reading, indexing, or downstream processing rather than DOCX round-tripping.

`convert_to_odt` converts a DOCX file to OpenDocument Text without invoking LibreOffice. It returns a lossiness summary for constructs that cannot be represented with the same fidelity.

## Generation

`@usejunior/docx-core` exposes `generateDocx(DocumentSpec)` for creating a new DOCX from a JSON-serializable specification. Generation is currently a library API rather than an installed CLI command. [Issue #573](https://github.com/UseJunior/safe-docx/issues/573) tracks a first-class `safe-docx generate` command.

## Local Runtime Boundary

The MCP or CLI process reads and writes only paths permitted by its filesystem policy. Resolved symlinks must remain inside allowed roots. Archive limits guard against excessive entry counts, expanded sizes, per-entry sizes, and compression ratios.

Safe Docx does not send document bytes to a Safe Docx service. An MCP client may send text returned by a read operation to its configured model provider; that boundary belongs to the client and provider configuration.

See [Trust and conformance](trust-and-conformance.md) for safety and standards boundaries. See [Testing and evidence](testing-and-evidence.md) for the repository's behavioral and verification model.
