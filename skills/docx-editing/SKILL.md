---
name: docx-editing
description: >-
  Surgically edit existing (brownfield) .docx files with formatting preservation
  and tracked changes via the Safe-DOCX MCP server. Use when user says "edit this
  docx," "change the contract," "redline the document," "compare these Word files,"
  "add a comment to the docx," "read this Word file," or "mark up the agreement."
  Not for from-scratch document generation.
license: MIT
compatibility: >-
  Works with any MCP-compatible agent. Requires Node.js >=18.0.0 and npm
  (for npx) on the host machine. The MCP server runs locally as a stdio
  child process. Install-time: npm registry fetch (one-time, cacheable).
  Runtime: zero network calls, file access limited to ~/ and system temp.
requires:
  binaries:
    - node (>=18.0.0)
    - npx (bundled with npm)
  network:
    install_time: npm registry (registry.npmjs.org) — one-time fetch
    runtime: none
  filesystem:
    - ~/ (home directory)
    - system temp directories
metadata:
  author: safe-docx
  version: "0.3.0"
---

# Editing .docx Files with Safe-DOCX

Safe-DOCX is a local MCP server for surgically editing existing `.docx` files. It preserves formatting, generates tracked-changes redlines, and — once installed — runs entirely on the local filesystem with zero network activity.

## Source Code and Audit

Safe-DOCX is fully open source (MIT license). Review the complete source before installing:

- **GitHub**: https://github.com/UseJunior/safe-docx
- **npm registry**: https://www.npmjs.com/package/@usejunior/safe-docx
- **Code coverage**: Published via Codecov on every release
- **Conformance harness**: Automated spec coverage tests run in CI on every commit
- **No postinstall scripts** — verify: `npm view @usejunior/safe-docx scripts` shows no `postinstall` or `install` hooks

All security claims below are verifiable by reading the source.

## Runtime Requirements

Safe-DOCX requires these binaries to be available on the host:

| Binary | Minimum version | Why |
|--------|-----------------|-----|
| `node` | 18.0.0 | Authoritative version from `packages/safe-docx/package.json` engines field |
| `npx` | Bundled with npm | Used by the recommended MCP connector to launch the server |

If you prefer not to use `npx`, see **Offline / Pinned Installation** below for alternatives.

## Safety Model

Safe-DOCX's safety model has two distinct phases: **install time** (when the package is fetched) and **runtime** (when the MCP server is running).

### Install-Time Behavior (network required, one-time)

- **npm registry fetch** — the recommended connector command `npx -y @usejunior/safe-docx` downloads the package from `registry.npmjs.org` on first run. Subsequent runs use the cached copy unless the cache is cleared.
- **No postinstall scripts** — the package declares no `postinstall`, `preinstall`, or `install` hooks. Verify with `npm view @usejunior/safe-docx scripts`.
- **Provenance** — releases are published with npm provenance (`--provenance`), so you can verify the package was built from the public GitHub repo via GitHub Actions.
- **If you need guaranteed offline install** — pin a specific version and vendor it locally. See the next section.

### Runtime Behavior (zero network)

- **Local-only stdio runtime** — the MCP server runs as a child process, never binds a port. Verify: the entry point (`src/server.ts`) uses `StdioServerTransport` with no HTTP listener. ([source](https://github.com/UseJunior/safe-docx/blob/main/packages/safe-docx/src/server.ts))
- **No outbound network calls** — at runtime, the package makes zero outbound HTTP requests. Verify: `grep -r "fetch\|http\.\|https\.\|net\." packages/safe-docx/src/` returns no matches in application code (test fixtures excluded).
- **Path policy** — only files under `~/` (home directory) and system temp directories are accessible. Symlinks must resolve to allowed roots.
- **Archive guardrails** — zip bomb detection and hostile payload rejection protect against malformed `.docx` inputs.

## Offline / Pinned Installation

For high-security environments where `npx` auto-fetch is unacceptable, install the package manually and pin the version:

```bash
# Option 1: Pin a specific version globally
npm install -g @usejunior/safe-docx@0.9.0

# Then configure your MCP client to invoke it by path:
# command: "safe-docx"
# args: []

# Option 2: Vendor the package into your project
npm pack @usejunior/safe-docx@0.9.0
# Inspect the tarball, then install it from disk:
npm install -g ./usejunior-safe-docx-0.9.0.tgz

# Option 3: Build from source (most auditable)
git clone https://github.com/UseJunior/safe-docx.git
cd safe-docx
git checkout <release-tag>
npm ci
npm run build
npm link packages/safe-docx
```

After any of these, your MCP client config becomes:

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

Using `command: "safe-docx"` (the installed binary) instead of `command: "npx"` eliminates the install-time network fetch on every invocation.

### Always pin the version

Even with `npx`, you can pin the version to prevent unexpected updates:

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

Before upgrading, review the changelog: https://github.com/UseJunior/safe-docx/blob/main/CHANGELOG.md

## When to Use This Skill

Use Safe-DOCX when you need to:

- Change clauses or paragraphs in an existing `.docx`
- Insert or delete content with formatting preservation
- Add comments or footnotes for reviewers
- Produce a tracked-changes redline from edits
- Compare two `.docx` files into a redline
- Extract revisions to structured JSON
- Apply layout formatting (spacing, row heights, cell padding)

## Not for From-Scratch Generation

Safe-DOCX edits already-existing `.docx` files — it does not create documents from blank. For new document generation, use a template-filling workflow (e.g. OpenAgreements). Safe-DOCX can refine generated docs downstream.

## Quick Start

```
1. read_file(file_path="~/doc.docx")        → see paragraphs + _bk_* IDs
2. grep(file_path="~/doc.docx", patterns=["target phrase"])  → find paragraph IDs
3. replace_text(session_id, target_paragraph_id, old_string, new_string, instruction)
4. save(session_id, save_to_local_path="~/doc-edited.docx")
```

## Core Workflow: Read, Locate, Edit, Save

**Step 1 — Read.** Call `read_file` with `format: "toon"` (token-efficient table) to see paragraphs and their stable `_bk_*` IDs.

**Step 2 — Locate.** Use `grep` with regex patterns to find target paragraphs. It returns paragraph IDs with surrounding context.

**Step 3 — Edit.** Use `replace_text` to swap text within a paragraph, or `insert_paragraph` to add new paragraphs before/after an anchor.

**Step 4 — Save.** Call `save` to write output. Default is `save_format: "both"` which produces a clean copy and a tracked-changes redline.

## Gotchas That Will Bite You

### Unique match required

`replace_text` needs `old_string` to match **exactly one** location in the target paragraph. If the text appears multiple times, you get `MULTIPLE_MATCHES`. Fix: include more surrounding context in `old_string`.

```
BAD:  old_string: "the Company"          → 5 matches, fails
GOOD: old_string: "the Company shall indemnify"  → 1 match, succeeds
```

### Footnote markers are display-only

`read_file` shows footnotes as `[^1]`, `[^2]`, etc., but these markers are **not part of the editable text**. You cannot search for or replace `[^1]` via `replace_text`. To modify footnotes, use the dedicated `add_footnote`, `update_footnote`, and `delete_footnote` tools.

### Hyperlinks are read-only

`read_file` shows links as `<a href="...">text</a>`, but you **cannot create new hyperlinks** via `replace_text` or `insert_paragraph`. The `<a>` tag is stripped from new text. Existing hyperlinks are preserved when surrounding text is edited.

### Paragraph identity contract

`_bk_*` paragraph IDs are **deterministic and stable**, not session-scoped. For **identical stored DOCX/OOXML bytes** (the same `.docx` file on disk), each paragraph receives byte-identical `_bk_*` IDs across re-opens, machines, and processes. You MAY persist these IDs in indexes, citation databases, and other external stores keyed off the same source document.

How they're derived:

- If the paragraph has Word's intrinsic `w14:paraId` attribute (Word 2010+), the ID is derived from that paraId. Editing the paragraph's text does NOT change its ID.
- Otherwise, the ID is derived from a deterministic hash of the paragraph's normalized visible text together with its previous and next neighbors and ancestor chain. Editing the paragraph's text — or sometimes its neighbor text — WILL change its ID. This is intentional: stale references break loudly rather than silently retargeting the wrong paragraph.

Inserting a paragraph does not renumber unrelated paragraphs. Duplicate paragraphs remain uniquely addressable via deterministic salt resolution.

Edit tools (`replace_text`, `insert_paragraph`, `apply_plan`, etc.) accept ONLY `_bk_*` IDs as anchors.

### Optional content_fingerprint for citation systems

For citation, archival, or reconciliation pipelines that want a portable hash of paragraph text — independent of safe-docx's internal seed format — pass `include_fingerprint: true` to `read_file` with `format: "json"`:

```json
{
  "id": "_bk_a3f29c10b8e4",
  "content_fingerprint": "sha256:nfkc:5d2e8f1a4c5b7d2e8f1a4c5b7d2e8f1a",
  "clean_text": "The Company shall indemnify the Customer."
}
```

Algorithm: `"sha256:nfkc:" + sha256( stripCfInvisibles(NFKC(visibleText)).replace(/\s+/g, " ").trim() )` truncated to 32 hex chars. Case is preserved (so "Section 5" and "section 5" hash differently); curly quotes and dashes are NOT folded to ASCII. Cf-category invisibles (soft hyphen, ZWJ/ZWNJ, LRM/RLM, bidi controls, variation selectors, BOM) are stripped so byte-level round-trip noise does not change the hash.

`content_fingerprint` is a content hash, not a paragraph key. Paragraphs with identical normalized visible text produce identical fingerprints by design — use `_bk_*` IDs whenever you need per-paragraph identity. The fingerprint is **read-only metadata, not an edit anchor** — edit tools continue to accept only `_bk_*` IDs. The flag has no effect on TOON or simple output, and is silently ignored for Google Docs. The `sha256:nfkc:` prefix is intentional version reservation; future algorithm bumps will emit a different prefix, so store and compare the full prefixed string.

### Smart text matching

`replace_text` is tolerant of:
- Quote variants: straight `"`, curly `\u201c\u201d`, angle `\u00ab\u00bb` all match each other
- Whitespace differences: multiple spaces, tabs, and line breaks are normalized

This means you can copy text from `read_file` output and use it in `old_string` even if the underlying XML uses different quote characters.

## Formatting Tags

When writing `new_string` in `replace_text` or `insert_paragraph`, use inline tags to apply formatting:

| Tag | Effect |
|-----|--------|
| `<b>text</b>` | Bold |
| `<i>text</i>` | Italic |
| `<u>text</u>` | Underline |
| `<highlighting>text</highlighting>` | Yellow highlight |

Tags can be nested: `<b><i>bold italic</i></b>`. Formatting from the original matched text is preserved for untagged replacement text.

## Heading Detection (read_file JSON output)

`read_file(format="json")` returns an optional top-level `heading` object per paragraph:

```ts
heading?: {
  text: string;
  source: 'word_style'
        | 'run_in_header'
        | 'title_with_period'
        | 'title_with_colon'
        | 'title_caps_centered'
        | 'title_bare';
  level: number | null;
};
```

Use `node.heading != null` as the canonical "is this a heading" check.

- If `heading` is present with `source: 'word_style'`, `level` is `1..6` and comes only from an exact `paragraph_style_id` match on `/^Heading([1-6])$/`.
- Style inheritance does not count. Custom styles like `HeadingPara1` / `HeadingPara2` may be based on Word heading styles but still omit `heading` unless their own `paragraph_style_id` is exactly `Heading1`…`Heading6`.
- If `heading` is present with any heuristic source, `level` is always `null`.
- If `heading` is absent, the paragraph is not a heading. The key is omitted entirely in JSON output; it is not set to `null`.
- Heuristic-sourced headings are suppressed inside table cells (`table_context != null`) — ordinary label/value cell text like `"Notice Address:"` or `"Closing."` will NOT surface as a heading. Built-in `word_style` headings still fire inside cells. Consecutive label-style cluster paragraphs (e.g. signature blocks) are also suppressed in a post-pass.

Precedence is fixed: exact Word built-in heading styles win over every heuristic detector. This means a paragraph can still expose `list_metadata.header_style` for explanation while `heading.source` is `word_style`.

`list_metadata.header_style` and `list_metadata.header_text` remain useful, but they are now the per-detector explanation layer rather than the canonical heading predicate:

- `run_in_header` — bold/underline prefix followed by non-header body in the same paragraph (e.g. `**Indemnification.** The Company shall …`). Whole-paragraph bold/underline blocks are intentionally excluded.
- `title_with_period` / `title_with_colon` — inline section header with explicit terminator (e.g. `Governing Law and Venue: this agreement is governed as stated.`).
- `title_caps_centered` — centered, ALL-CAPS, bold standalone title (e.g. `SERIES A PREFERRED STOCK PURCHASE AGREEMENT`). Strict gates: no lowercase letters, ≥ 3 ASCII letters, ≥ 2 word-tokens, no list label, not in a table cell, ≤ 120 chars.
- `title_bare` — short standalone manual title fallback.

Google Docs is intentionally asymmetric: the `packages/google-docs-core` path emits `heading` only for built-in heading styles that normalize to `Heading1`…`Heading6`. The heuristic detectors do not run on the Google Docs renderer, so sources like `title_caps_centered` and `run_in_header` are Word-only today.

## Batch Edits with apply_plan

For 3+ edits on one document, prefer `apply_plan` over sequential `replace_text` calls. It validates all steps before applying any, so you get all-or-nothing transactional semantics.

```
1. read_file / grep  → gather paragraph IDs and text
2. apply_plan(file_path, steps=[
     { step_id: "1", operation: "replace_text", target_paragraph_id, old_string, new_string, instruction },
     { step_id: "2", operation: "insert_paragraph", positional_anchor_node_id, new_string, instruction },
     ...
   ])
3. save(session_id, save_to_local_path)
```

## Insert Paragraphs

`insert_paragraph` adds new content before or after an anchor paragraph.

- `position`: `"BEFORE"` or `"AFTER"` (default `"AFTER"`)
- `style_source_id`: optional `_bk_*` ID of a paragraph whose formatting you want to clone
- Multi-paragraph: separate with `\n\n` in `new_string` (each becomes its own paragraph)

## Comments and Footnotes

**Comments:** `add_comment` anchors to a paragraph (optionally to a text span via `anchor_text`). Use `get_comments` to list, `delete_comment` to remove. Supports threaded replies via `parent_comment_id`.

**Footnotes:** `add_footnote` inserts a footnote marker in a paragraph (optionally after specific text via `after_text`). Use `get_footnotes`, `update_footnote`, `delete_footnote` to manage.

## Comparing Documents

Two modes:
- **Two files:** `compare_documents(original_file_path, revised_file_path, save_to_local_path)` — produces a redline
- **Session edits:** `compare_documents(session_id)` — compares current session state against the original

Use `extract_revisions` on any document with tracked changes to get structured JSON diffs.

## Accepting Tracked Changes

Call `accept_changes(session_id)` to flatten all tracked changes into a clean document. This removes all revision markup.

## Session Behavior

- Sessions auto-create when you first use `file_path` with any tool
- Sessions expire after **1 hour** of inactivity (each tool call resets the timer)
- Call `clear_session` to clean up when done
- Documents are **normalized on open**: format-identical runs are merged and proof-error markers removed, which improves text matching reliability

## Layout Formatting

`format_layout` applies paragraph spacing, table row height, and cell padding without touching text content. Units are in twips (1/20 of a point) or DXA (1/635 of an inch).

## Path Restrictions

By default, only files under `~/` (home directory) and system temp directories are accessible. Symlinks must resolve to allowed roots.

## Related Skills

- **Open Agreements** (`open-agreements`) — fill standard legal templates (NDAs, SAFEs, cloud service agreements) and produce signable DOCX files: `clawhub install open-agreements/open-agreements`
- **Outlook Email Management** (`outlook-email-management`) — manage Outlook email with AI agents: `clawhub install stevenobiajulu/outlook-email-management`

## Connectors

For MCP server setup instructions (Claude Desktop, Cursor, Claude Code), see [CONNECTORS.md](./CONNECTORS.md).

## Feedback

If this skill helped, star us on GitHub: https://github.com/UseJunior/safe-docx
On ClawHub: `clawhub star usejunior/docx-editing`
