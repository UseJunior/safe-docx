# Change: Add get_document_outline MCP Tool

## Why

Agents working on long documents (e.g. a 60-page MSA) currently have to `read_file`/`grep` their way through the whole body to locate a section. That burns context window and raises the risk of acting on the wrong clause — the agent has no lightweight map of *where things are* before it starts reading prose.

`docx-core` already detects headings (Word heading styles plus heuristic title/run-in detection) and exposes a stable `_bk_*` id per paragraph through the document view. A cheap structural projection over that data lets an agent read the outline first (hundreds of tokens), see that §4.2 holds the indemnity clause, then `read_file`/`replace_text` only the paragraphs under it. Map first, then targeted read.

## What Changes

- Add a read-only `get_document_outline` MCP tool (DOCX sessions) that returns a compact structural map of the document's headings instead of full text.
- Each outline entry carries the heading `text`, outline `level` (for Word heading styles), heading `source`, and the stable `paragraph_id` (`_bk_*`) so the agent can follow up with a targeted `read_file` / `replace_text` scoped to that region.
- Output defaults to JSON; a `format: "markdown"` option renders an indented Markdown outline for cheap human/agent skimming.
- Heading detection is style-based by default (Word `HeadingN` styles). Heuristic headings (title/run-in/centered-caps) are opt-in via `include_heuristic_headings` so the default outline stays low-noise.

## Impact

- Affected specs: `mcp-server`
- Affected code:
  - `packages/docx-mcp/src/tools/get_document_outline.ts` (new projection over `buildDocumentView`)
  - `packages/docx-mcp/src/tool_catalog.ts` (catalog entry + input schema)
  - `packages/docx-mcp/src/server.ts` (dispatch wiring)

## Out of scope

- Full text extraction (that is `read_file`).
- Semantic classification of clauses (that is the agent's job).
- Section-break and table/figure anchors (follow-up; this change ships headings only).
- ODT / Google Doc sessions (ODF has no equivalent heading projection yet; follow-up).
