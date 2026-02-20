# @usejunior/safe-docx

Safe Docx is an MCP (Model Context Protocol) server that enables AI assistants to safely edit `.docx` files while preserving formatting, using DOM-based OOXML editing (`@xmldom/xmldom`).
In this package, Safe Docx runs as a local MCP server and local desktop extension runtime (stdio), not a hosted editor service.
OpenAgreements project, built by the UseJunior team.

## Trust Boundary

Safe Docx editor is local-only in this package:

- Fully local package execution (`npx -y @usejunior/safe-docx`)
- Local Claude extension/stdio workflows

Safe Docx document editing is not offered as a hosted remote MCP endpoint.
Remote MCP usage in the broader stack is for separate template/form-filling flows, not the Safe Docx editor runtime.

### Quick Decision

- If you are editing `.docx` content, use local Safe Docx package execution.
- If you want remote convenience for structured template fill, use a separate form/template MCP flow (not Safe Docx editor).

Mode-by-mode data flow summary: `docs/safe-docx/trust-checklist.md`.

## Run (Local Package Execution)

```bash
npx -y @usejunior/safe-docx
```

## Installation

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

Install from the Gemini CLI extension gallery, or add manually to your Gemini CLI settings:

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

Add to your Cline MCP settings (`cline_mcp_settings.json`):

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

### Generic MCP Client

Any MCP client supporting stdio transport can use SafeDocX:

- **Command:** `npx`
- **Arguments:** `["-y", "@usejunior/safe-docx"]`
- **Transport:** stdio

## Development (Repo)

```bash
npm run build -w @usejunior/safe-docx
npm run test:run -w @usejunior/safe-docx
```

Assumptions and verification matrix:

- See `packages/safe-docx/assumptions.md` for key assumptions, exact test commands, and expected outcomes.
- See `docs/safe-docx/sprint-3-conformance.md` for fixture-conformance harness usage and report interpretation.

## Conformance Harness (Sprint 3)

Deterministic fixture conformance checks are available for trust/reliability evidence:

```bash
npm run conformance:smoke -w @usejunior/safe-docx
npm run conformance:run -w @usejunior/safe-docx
```

Optional OpenAgreements fixture root (if present locally):

```bash
SAFE_DOCX_CONFORMANCE_OPEN_AGREEMENTS_ROOT=/Users/stevenobiajulu/Projects/open-agreements npm run conformance:run -w @usejunior/safe-docx
```

Pinned fixture manifest:

- `packages/safe-docx/conformance/fixtures.manifest.json`

Security guardrails (runtime):

- path policy defaults to `HOME` and system temp directory roots
- symlink-resolved read/write paths must remain inside allowed roots
- override allowed roots with `SAFE_DOCX_ALLOWED_ROOTS` (path-delimited)
- archive safety guards reject suspicious `.docx` archives:
  - `SAFE_DOCX_MAX_ARCHIVE_ENTRIES` (default `2000`)
  - `SAFE_DOCX_MAX_UNCOMPRESSED_BYTES` (default `209715200`)
  - `SAFE_DOCX_MAX_ENTRY_UNCOMPRESSED_BYTES` (default `52428800`)
  - `SAFE_DOCX_MAX_COMPRESSION_RATIO` (default `200`)

## Tools

Session handling:

- Document tools (`read_file`, `grep`, `smart_edit`, `smart_insert`, `download`, `get_session_status`) accept either `session_id` or `file_path`.
- When called with `file_path`, Safe-Docx auto-resolves a session:
  - reuses the most-recently-used active session for that file (with warning metadata), or
  - opens a new session when none exists.
- Responses include session-resolution metadata (`session_resolution`, `resolved_session_id`, `resolved_file_path`).
- `open_document` remains available but is deprecated as the primary entry workflow.

### `read_file`

`read_file` supports multiple output formats:

- Default (`format="toon"`): TOON with schema
  - `#SCHEMA id | list_label | header | style | text`
- `format="simple"`: backward-compatible
  - `#TOON id | text`
- `format="json"`: machine-readable DocumentView nodes (for parity tooling/tests)
  - includes `style_fingerprint`, `header_formatting`, and numbering metadata

Style/fingerprint notes:

- `style` is a stable, fingerprint-derived style ID for LLM-safe references.
- `style_fingerprint` intentionally ignores volatile OOXML attributes (`w:rsid*`, revision IDs/dates) so equivalent formatting maps consistently.

Pagination parity notes:

- `offset` is 1-based for positive values (`offset=1` is the first paragraph)
- negative offsets count from the end (`offset=-1` is the last paragraph)
- `offset=0` is treated as start-of-document (same behavior as omitting `offset`)

### `grep`

`grep` searches paragraph text with regex patterns and returns paragraph anchors.

Default behavior:

- `dedupe_by_paragraph=true` (default): returns at most one row per matching paragraph
- each row includes:
  - `para_id` (stable anchor)
  - `para_index_1based` (read-order position)
  - `list_label` and `header` locator context
  - `match_count_in_paragraph`
  - `match_text` and `context` (first match in that paragraph)

Full-match mode:

- set `dedupe_by_paragraph=false` to return one row per regex hit.

Result-limit signaling:

- `total_matches` always counts all regex hits in the document.
- `max_results` limits only returned rows in `matches`.
- `matches_truncated=true` + `truncation_note` indicate capped output.

### `smart_edit`

`smart_edit` performs a unique find/replace within a single paragraph (`jr_para_*`).

Supported inline edit tags in `new_string`:

- `<b>...</b>` -> bold
- `<i>...</i>` -> italic
- `<u>...</u>` -> underline
- `<highlighting>...</highlighting>` -> Word highlight (`w:highlight`, default yellow)

Backward-compatible semantic tags:

- `<header>...</header>` and `<RunInHeader>...</RunInHeader>` are accepted and rendered as run-in header semantics.

Definition tags:

- Default behavior: `<definition>...</definition>` is normalized to plain quoted text with no role-model formatting.
- Legacy compatibility behavior (optional): set `SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS=1` to restore role-model `<definition>` handling.

### `format_layout`

`format_layout` applies deterministic OOXML geometry controls without inserting spacer paragraphs.

Supported operations:

- `paragraph_spacing`
  - selectors: `paragraph_ids` (`jr_para_*`)
  - values: `before_twips`, `after_twips`, `line_twips`, `line_rule` (`auto | exact | atLeast`)
- `row_height`
  - selectors: `table_indexes`, optional `row_indexes`
  - values: `value_twips`, `rule` (`auto | exact | atLeast`)
- `cell_padding`
  - selectors: `table_indexes`, optional `row_indexes`, optional `cell_indexes`
  - values: `top_dxa`, `bottom_dxa`, `left_dxa`, `right_dxa`

Validation and safety:

- strict mode is enabled by default (`strict=true`)
- invalid units/enums/selectors return structured validation errors
- paragraph count is invariant-checked to prevent spacer-paragraph workarounds

Example:

```json
{
  "session_id": "ses_abc123def456",
  "paragraph_spacing": {
    "paragraph_ids": ["jr_para_0a1b2c3d4e5f"],
    "before_twips": 120,
    "after_twips": 240,
    "line_twips": 360,
    "line_rule": "auto"
  },
  "row_height": {
    "table_indexes": [0],
    "row_indexes": [1],
    "value_twips": 420,
    "rule": "exact"
  },
  "cell_padding": {
    "table_indexes": [0],
    "row_indexes": [1],
    "cell_indexes": [0],
    "top_dxa": 80,
    "bottom_dxa": 120,
    "left_dxa": 60,
    "right_dxa": 60
  }
}
```

Unit semantics:

- `twips`: twentieths of a point (`20 twips = 1 pt`)
- `dxa`: same underlying OOXML unit as twips for table cell margins
- `line_rule`:
  - `auto`: proportional line spacing
  - `exact`: exact fixed line spacing
  - `atLeast`: minimum line spacing

Recommended legal-doc defaults:

- body paragraphs: `after_twips: 120` (6pt) to `160` (8pt)
- table cover terms: row height `360-480 twips` and cell padding `40-80 dxa`
- headings/run-ins: keep tighter spacing and set explicit values only where needed

### `download`

`download` supports clean output, tracked-changes output, or both:

- `download_format: "both"` (default) writes both edited clean + tracked output.
- `download_format: "clean"` writes only the edited clean document.
- `download_format: "tracked"` writes a redline (`w:ins`/`w:del`) by comparing original vs edited.
- `download_format: "both"` writes clean output to `save_to_local_path` and tracked output to:
  - `tracked_save_to_local_path` when provided
  - otherwise `<save_to_local_path base>.redline.<YYYYMMDD-HHMMSSZ>.docx` (UTC timestamp)

Tracked output options:

- `tracked_changes_author` (default: `Safe-Docx`)
- `tracked_changes_engine` (`auto`, `atomizer`, `diffmatch`; default: `atomizer`)

Backward-compatible aliases (older prompts/agents):

- `track_changes: true` -> treated as `download_format: "tracked"`
- `track_changes: false` -> treated as `download_format: "clean"`
- `author` -> treated as `tracked_changes_author`

Overwrite protection:

- By default, `download` refuses to overwrite the originally opened file path.
- Set `allow_overwrite: true` only when you intentionally want in-place overwrite.

### `clear_session`

Explicitly clear session state:

- clear one session: `{ "session_id": "ses_..." }`
- clear all sessions for one file: `{ "file_path": "/path/to/doc.docx" }`
- clear all sessions: `{ "clear_all": true, "confirm": true }`

Safety behavior:

- `clear_all=true` requires `confirm=true`
- `clear_all` cannot be combined with `session_id` or `file_path`

### `duplicate_document`

Create a copy of a source `.docx` and auto-open a fresh editing session for the copy.

- required: `source_file_path`
- optional: `destination_file_path`
- optional: `overwrite` (default: `false`)

If `destination_file_path` is omitted, Safe-Docx creates:

- `<basename>.copy.<YYYYMMDDTHHMMSSZ>.docx` in the source directory.

## Build-Time Template Formatting (Optional)

For local template-authoring workflows, you can apply `format_layout` in scripts during build-time and commit the resulting `.docx` artifacts.

- This is optional operational tooling.
- Safe-Docx runtime remains Node/TypeScript-only with no Aspose/Python runtime dependency.

Typical flow:

1. Open a source `.docx` with `open_document` (or call tools file-first).
2. Call `read_file` to collect `jr_para_*` IDs and identify table indexes.
3. Apply `format_layout` with explicit selectors and numeric values.
4. Export with `download` (`clean` or `both`) and review in Word.

## Publish (NPM)

This package depends on `@usejunior/docx-comparison` and `@usejunior/docx-primitives`, so publish in this order:

```bash
npm publish -w @usejunior/docx-comparison --access public
npm publish -w @usejunior/docx-primitives --access public
npm publish -w @usejunior/safe-docx --access public
```

If your machine has a broken npm cache ownership, add `--cache /tmp/npm-cache`.
