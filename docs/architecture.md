# Architecture

Safe Docx is a local, package-based document stack. There is no required hosted service: an MCP client starts a local Node.js process, tools operate on permitted filesystem paths, and outputs are written back to disk.

The system has four phases:

1. **Read**: open a document package and expose a compact, addressable view.
2. **Locate**: find paragraphs and document structures without flattening the source file.
3. **Mutate**: apply targeted edits to the in-memory document session.
4. **Write**: serialize clean, tracked, compared, or structured outputs.

```text
MCP client
    |
    v
@usejunior/safe-docx
    |
    v
@usejunior/docx-mcp
    |
    +--> DOCX session --> OOXML primitives --> clean / tracked DOCX
    |
    +--> ODT session  --> ODF primitives   --> clean / tracked ODT
    |
    +--> Google Docs provider              --> remote document operations
```

## Repository Layout

```text
safe-docx/
├── packages/              Published libraries and the MCP server
├── skills/                Agent instructions for document editing
├── docs/                  User and maintainer documentation
├── spec-compliance/       ECMA-376 registry, schemas, and generated status
├── verification/          Invariant registry and optional Lean verification
├── openspec/              Behavioral specifications and change records
├── tests/                 Cross-package fixtures and integration coverage
└── site/                  Public documentation site
```

## Package Model

| Package | Responsibility |
|---|---|
| `@usejunior/safe-docx` | Stable executable name for end users |
| `@usejunior/docx-mcp` | MCP schemas, tool dispatch, sessions, path policy, and output orchestration |
| `@usejunior/docx-core` | OOXML package primitives, generation, revision handling, and shared DOCX operations |
| `@usejunior/docx-compare` | Comparison engine and tracked redline construction |
| `@usejunior/odf-core` | ODF package primitives, edits, and native tracked-change comparison |
| `@usejunior/google-docs-core` | Google Docs API reads, writes, and anchor management |
| `@usejunior/test-narrative` | Shared metadata for human-readable test evidence |

The wrapper package contains very little behavior. The MCP package owns the public agent interface. Format-specific behavior remains in the document engines.

## MCP Server

Entry point:

```bash
safe-docx
```

The server is responsible for:

- publishing tool schemas from a single catalog;
- validating tool arguments and filesystem access;
- opening or resolving a document session;
- dispatching work to the correct format provider;
- returning structured results and actionable failures;
- writing requested output artifacts.

The generated [tool reference](../packages/docx-mcp/docs/tool-reference.generated.md) is derived from the same catalog used at runtime.

## Document Sessions

An edit begins when a tool opens a document path. Safe Docx parses the archive and keeps a live representation for subsequent calls against that file.

```text
file path
    |
    v
format detection
    |
    v
session + parsed document state
    |
    +--> reads and searches
    +--> ordered mutations
    +--> status and revision queries
    +--> save, export, or close
```

Sessions let several tool calls operate on one parsed document. The original file is not overwritten unless the caller deliberately chooses that output path.

## Reading And Identity

`read_file` exposes document content in compact text, TOON, or structured JSON. `get_document_outline` provides a lower-cost structural view. `grep` searches document content without requiring the model to read the entire file.

Paragraphs receive IDs such as `_bk_a3f29c10b8e4`. Edit tools use these IDs as canonical anchors. For identical stored DOCX bytes, IDs are deterministic across reopens, processes, and machines. IDs based on intrinsic `w14:paraId` survive text changes; fallback IDs may change when paragraph or neighboring text changes.

Structured reads may also include `content_fingerprint`, a normalized-text hash intended for reconciliation and citation systems. A fingerprint identifies content, not a unique paragraph, and cannot be used as an edit anchor.

## Mutation Model

Safe Docx uses narrow operations rather than whole-document text regeneration:

| Operation | Purpose |
|---|---|
| `replace_text` | Replace exact content inside one anchored paragraph |
| `insert_paragraph` | Add a paragraph at a structural location |
| `batch_edit` | Apply several ordered mutations |
| `format_layout` | Change supported paragraph, run, table, and page settings |
| comment and footnote tools | Manage document side parts and references |
| revision tools | Inspect, accept, or reject tracked changes |

Mutation code preserves unrelated package parts and formatting structures where the operation does not require changing them. Each format provider owns the serialization details for its document standard.

## Clean And Tracked Output

`save` can produce two views of the same editing session:

- a **tracked** document containing the session's authored insertions and deletions;
- a **clean** document with those agent-authored changes accepted.

Pre-existing revisions from other authors remain distinct from the current session's changes. A save is not a full two-document comparison.

For an independent redline between an original and a revised document, use `compare_documents`. The DOCX comparison path delegates to `@usejunior/docx-compare`; the ODT path emits native ODF tracked changes.

## Generation

`@usejunior/docx-core` also exposes a declarative, JSON-serializable `DocumentSpec` compiler:

```ts
import { generateDocx } from '@usejunior/docx-core';

const document = await generateDocx({
  sections: [
    {
      blocks: [
        { kind: 'paragraph', runs: [{ kind: 'text', text: 'Hello' }] },
      ],
    },
  ],
});
```

Generation is a library API. The MCP server is currently oriented around existing documents and does not expose a `generate_document` tool.

## Path And Archive Boundaries

The local MCP process reads and writes only paths permitted by its path policy. Resolved symlinks must remain inside allowed roots. Archive limits guard against excessive entry counts, uncompressed sizes, per-entry sizes, and compression ratios.

Document content is parsed inside the local process. Safe Docx does not send document bytes to a Safe Docx service. A connected model provider may still receive content returned through MCP; that boundary belongs to the MCP client and model configuration.

See [Trust and conformance](trust-and-conformance.md) for the precise assurance model and configuration controls.

## Evidence Model

Behavior is described and checked through several complementary systems:

```text
OpenSpec requirements
    + ECMA-376 citations and schemas
    + unit, integration, fixture, and differential tests
    + generated tool and conformance documents
    + invariant registry and optional Lean checker
```

No single layer proves the entire implementation. Generated documents, tests, schema validation, runtime checks, and formal artifacts each cover a defined surface.

## Extension Points

Common extension paths are:

1. Add or change an MCP tool in the central tool catalog and dispatch layer.
2. Add a general OOXML primitive in `@usejunior/docx-core`.
3. Add format-specific behavior behind the provider boundary.
4. Add a comparison rule in `@usejunior/docx-compare` or `@usejunior/odf-core`.
5. Add ECMA-376 citations, fixtures, and OpenSpec scenarios for the affected behavior.

Read [CONTRIBUTING.md](../CONTRIBUTING.md) before changing public behavior or OOXML handling.
