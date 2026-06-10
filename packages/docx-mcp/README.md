# @usejunior/docx-mcp

[![npm version](https://img.shields.io/npm/v/%40usejunior%2Fdocx-mcp)](https://www.npmjs.com/package/@usejunior/docx-mcp)
[![CI](https://github.com/UseJunior/safe-docx/actions/workflows/ci.yml/badge.svg)](https://github.com/UseJunior/safe-docx/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/UseJunior/safe-docx/blob/main/LICENSE)

**Install via the canonical package:** `npx -y @usejunior/safe-docx` — [see setup guide](../../README.md)

Local MCP server for surgical editing of existing Microsoft Word `.docx` files with coding agents. The same tool surface also services OpenDocument `.odt` files — including `compare_documents` redlines (two files, or a live session against its original) written as native ODF tracked changes with inline (run-level) granularity.

Safe Docx is built for brownfield paperwork workflows: apply accepted AI edits to real Word documents while preserving formatting and review semantics.

Mission: enable coding agents to do paperwork too. This package focuses on deterministic brownfield edits to existing Word documents rather than from-scratch generation.

For end-user installation, use the canonical wrapper package: `npx -y @usejunior/safe-docx`.

## Why This Package

- purpose-built MCP tool surface for existing-document operations
- local-first runtime with no Python/LibreOffice requirement for supported paths
- auditable behavior through tests, traceability, and conformance assets

## Quickstart

```bash
npx -y @usejunior/safe-docx
```

Add to your MCP client:

- Command: `npx`
- Args: `["-y", "@usejunior/safe-docx"]`
- Transport: `stdio`

## Primary Workflows

- Apply targeted edits while preserving formatting (`replace_text`, `insert_paragraph`, `format_layout`)
- Produce clean and tracked variants for human review (`save`)
- Compare original vs revised documents into tracked output (`compare_documents`)
- Extract revisions as structured JSON (`extract_revisions`)
- Manage comments and footnotes as first-class operations

## Tool Categories

- Read/Search: `read_file`, `grep`, `has_tracked_changes`, `get_session_status`
- Edit/Layout: `replace_text`, `insert_paragraph`, `format_layout`, `accept_changes`
- Planning/Batch: `init_plan`, `merge_plans`, `apply_plan`
- Compare/Revision: `compare_documents`, `extract_revisions`, `save`
- Comments/Footnotes: `add_comment`, `get_comments`, `delete_comment`, `get_footnotes`, `add_footnote`, `update_footnote`, `delete_footnote`
- Session/Safety: `clear_session`, path-policy + archive guardrails

## Heading detection in `read_file(format="json")`

Each paragraph node in the JSON output may expose a top-level `heading` object:

```ts
heading?: {
  text: string;
  source: 'word_style' | 'run_in_header' | 'title_with_period' | 'title_with_colon' | 'title_caps_centered' | 'title_bare';
  level: number | null;
}
```

Use `node.heading != null` as the canonical heading check.

- `source: 'word_style'` wins whenever `paragraph_style_id` matches `/^Heading([1-6])$/` exactly, and only then. Inherited styles like `HeadingPara1` do not count.
- Heuristic sources (`run_in_header`, `title_with_period`, `title_with_colon`, `title_caps_centered`, `title_bare`) always emit `level: null`.
- Body paragraphs omit the `heading` key entirely.

`list_metadata.header_style` remains the per-detector explanation layer, not the canonical "is heading" predicate. See [`skills/docx-editing/SKILL.md`](../../skills/docx-editing/SKILL.md) for the full precedence rule and the Google Docs asymmetry: the GDocs path only emits `heading` for built-in heading styles and does not run the Word heuristics.

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

- Runs as a local process on your machine
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

Build-time tooling for advanced rendering is optional and not required by default `npx` runtime usage.

## Where It Runs

No native binaries and no .NET prerequisite for supported runtime usage. Safe Docx operates on `Uint8Array` / `Buffer` inputs via `jszip` + `@xmldom/xmldom`:

- Local MCP server (default)
- Cloudflare Workers / Durable Objects
- Vercel Functions / workflow steps
- AWS Lambda / Lambda@Edge
- Docker / any container runtime
- Any V8 isolate or Node.js process

If you need direct library imports in app code, use `@usejunior/docx-core`.

## Paragraph Identity

`read_file` returns paragraphs with `id` fields like `_bk_a3f29c10b8e4`. These identifiers are **deterministic and stable**, not session-scoped.

| Field | Role | Editable anchor? | Stability |
|-------|------|------------------|-----------|
| `id` (`_bk_<12hex>`) | Canonical edit anchor — only thing edit tools accept | ✅ | Byte-identical across reopens, machines, and processes for **identical stored DOCX/OOXML bytes**. Intrinsic branch (Word 2010+ `w14:paraId`) is robust to text edits; fallback branch changes when paragraph or neighbor text changes. |
| `content_fingerprint` (opt-in) | Portable normalized-text hash for citation/reconciliation systems | ❌ — read-only metadata | Same normalized text → same hash on any machine. Changes when normalized text changes. **Not unique per paragraph** — two paragraphs with identical normalized text fingerprint identically. |

Consumers MAY persist `_bk_*` identifiers in indexes, citation databases, and other external stores keyed off the same source document.

For citation systems that want a portable hash whose canonicalization is documented and recomputable independent of safe-docx internals, pass `include_fingerprint: true` to `read_file` with `format: "json"`:

```jsonc
{
  "id": "_bk_a3f29c10b8e4",
  "content_fingerprint": "sha256:nfkc:5d2e8f1a4c5b7d2e8f1a4c5b7d2e8f1a",
  "clean_text": "The Company shall indemnify the Customer."
}
```

The fingerprint is computed as `"sha256:nfkc:" + sha256( stripCfInvisibles(NFKC(visibleText)).replace(/\s+/g, " ").trim() )`, truncated to 32 hex chars. Case is preserved; curly quotes and dashes are NOT folded to ASCII. Cf-category invisibles (soft hyphen, ZWJ/ZWNJ, LRM/RLM, bidi controls, variation selectors, BOM) are stripped so byte-level round-trip noise does not change the hash. The flag has no effect on `format: "toon"` or `format: "simple"`, and is silently ignored for Google Docs sessions.

`content_fingerprint` is a content hash, not a paragraph key. Paragraphs with identical normalized visible text produce identical fingerprints by design; use `_bk_*` IDs whenever you need per-paragraph identity. Edit tools (`replace_text`, `insert_paragraph`, `apply_plan`, etc.) accept ONLY `_bk_*` IDs as anchors — `content_fingerprint` is never an edit anchor. The `sha256:nfkc:` prefix is intentional version reservation; future algorithm bumps will emit a different prefix (e.g. `sha256:nfkc-strip:`), so consumers should store and compare the full prefixed string.

## Reliability and Evidence

- Tool catalog source: `packages/docx-mcp/src/tool_catalog.ts`
- Generated tool reference: `packages/docx-mcp/docs/tool-reference.generated.md`
- OpenSpec traceability matrix: `packages/docx-mcp/src/testing/SAFE_DOCX_OPENSPEC_TRACEABILITY.md`
- Assumption matrix: `packages/docx-mcp/assumptions.md`
- Conformance assets: `packages/docx-mcp/conformance/README.md`
- Conformance guide: `docs/safe-docx/sprint-3-conformance.md`

Commands:

```bash
npm run conformance:smoke -w @usejunior/docx-mcp
npm run conformance:run -w @usejunior/docx-mcp
```

Optional OpenAgreements fixture root:

```bash
SAFE_DOCX_CONFORMANCE_OPEN_AGREEMENTS_ROOT=/path/to/open-agreements npm run conformance:run -w @usejunior/docx-mcp
```

## FAQ

### Is this for editing existing Word files or generating new ones?

This package is for editing existing `.docx` files. For from-scratch generation, use packages such as [`docx`](https://www.npmjs.com/package/docx).

### Does it preserve formatting?

That is a core objective. The edit tools are built for surgical mutation while preserving run/paragraph formatting semantics.

### Is TOON output token-efficient for agent workflows?

Yes. `read_file` supports `toon` output specifically for compact, agent-friendly reads of existing documents.

### Does this require Python, .NET, or LibreOffice?

No for supported runtime paths. The default MCP runtime is TypeScript/Node-based.

### Can it add and delete comment bubbles?

Yes. Use `add_comment`, `get_comments`, and `delete_comment`.

### Can it add and delete footnotes?

Yes. Use `get_footnotes`, `add_footnote`, `update_footnote`, and `delete_footnote`.

### Can it produce tracked changes for review?

Yes. Use `save` with tracked variants or `compare_documents` for standalone original/revised comparisons.

### Is processing local-only?

Yes for this package. It runs as a local process and does not require a hosted Safe Docx editor endpoint.

### What document families are explicitly fixture-tested here?

Mutual NDA variants, Letter of Intent, and ILPA redline fixtures.

### Is this only for legal teams?

No. It is useful anywhere teams edit DOCX paperwork with agents: legal, procurement, sales ops, finance, and HR.

## Golden Prompts

Use these known-good prompt patterns:

- `packages/docx-mcp/docs/golden-prompts.md`

## Development

```bash
npm run build -w @usejunior/docx-mcp
npm run test:run -w @usejunior/docx-mcp
```
