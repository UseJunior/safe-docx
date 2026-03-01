# Safe DOCX Suite

[![CI](https://github.com/usejunior/safe-docx/actions/workflows/ci.yml/badge.svg)](https://github.com/usejunior/safe-docx/actions/workflows/ci.yml)
[![codecov](https://img.shields.io/codecov/c/github/usejunior/safe-docx/main)](https://app.codecov.io/gh/usejunior/safe-docx)

Use coding agents for paperwork too.

Safe Docx is an open-source TypeScript stack for surgical editing of existing Microsoft Word `.docx` files. It is built for workflows where an agent proposes changes and a human still needs reliable, formatting-preserving document edits.

If you review contracts with AI, the slowest step is often applying accepted recommendations in Word. Safe Docx turns that into deterministic tool calls.

## Why This Exists

AI coding CLIs are great with code and text files but weak on brownfield `.docx` editing. Business and legal workflows still run on Word documents, so we built a native TypeScript path for:

- reading and searching existing documents in token-efficient formats
- making surgical edits without destroying formatting
- producing clean/tracked outputs and revision extraction artifacts

## Start Here

For setup and daily usage, go to:

- `packages/docx-mcp/README.md`

Quick run:

```bash
npx -y @usejunior/safe-docx
```

## What Safe Docx Is Optimized For

- Brownfield editing of existing `.docx` files
- Formatting-preserving text replacement and paragraph insertion
- Comment and footnote workflows
- Tracked-changes outputs for review (`download`, `compare_documents`)
- Revision extraction as structured JSON (`extract_revisions`)

## What Safe Docx Is Not Optimized For

Safe Docx is not a from-scratch document generation toolkit.

If your primary need is generating new `.docx` files from templates/programmatic layout, use packages such as [`docx`](https://www.npmjs.com/package/docx).

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

## Packages

- `@usejunior/docx-core`: primitives + comparison engine for existing `.docx` documents
- `@usejunior/docx-mcp`: MCP server implementation and tool surface
- `@usejunior/safe-docx`: canonical end-user install name (`npx -y @usejunior/safe-docx`)
- `@usejunior/safedocx-mcpb`: private MCP bundle wrapper

## Reliability and Trust Surface

- Tool schemas are generated from `packages/docx-mcp/src/tool_catalog.ts`.
- OpenSpec traceability matrix: `packages/docx-mcp/src/testing/SAFE_DOCX_OPENSPEC_TRACEABILITY.md`
- Assumption matrix: `packages/docx-mcp/assumptions.md`
- Conformance guide: `docs/safe-docx/sprint-3-conformance.md`

## FAQ

### What is Safe Docx?

A TypeScript-first DOCX editing stack for coding-agent workflows that need deterministic, formatting-preserving edits on existing Word documents.

### Does this preserve formatting during edits?

That is a core design goal. The tool surface is built around surgical operations (`replace_text`, `insert_paragraph`, layout controls) that preserve document structure and formatting semantics as much as possible.

### Does this require .NET, Python, or LibreOffice in normal runtime usage?

No. Supported runtime usage is JavaScript/TypeScript with `jszip` + `@xmldom/xmldom`.

### Can this generate contracts from scratch?

Not the primary focus. For from-scratch generation, use packages such as [`docx`](https://www.npmjs.com/package/docx).

### What document types has this been tested on in-repo fixtures?

Mutual NDAs (including Common Paper/Bonterms-style fixtures), Letter of Intent, and ILPA limited partnership agreement redline fixtures.

### Is this only for lawyers?

No. The same brownfield `.docx` editing problems appear in HR, procurement, finance, sales ops, and other paperwork-heavy workflows.

### Where should I start as an MCP user?

Use `@usejunior/safe-docx` via `npx`, then follow setup examples in `packages/docx-mcp/README.md`.

### Where can I inspect the tool schemas?

See the generated reference at `packages/docx-mcp/docs/tool-reference.generated.md`.

## Development

```bash
npm ci
npm run build
npm run lint --workspaces --if-present
npm run test:run
npm run check:spec-coverage
npm run test:coverage:packages
npm run coverage:packages:check
npm run coverage:matrix
```

## Governance

- [Contributing Guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

