# Change: Optionally inline footnote bodies in read_file

## Why

`read_file(format="json")` renders paragraphs with inline `[^N]` footnote markers, but the
footnote *bodies* require a separate `get_footnotes` call joined on `anchored_paragraph_id`.
Workflows that need a faithful single-call rendering of "the document plus its footnotes"
(Markdown export, citation-text generation, archival ingest) must coordinate two MCP calls.
Footnotes are load-bearing content in legal documents — the NVCA October 2025 SPA fixture
carries 109 footnotes (~42KB) of drafting guidance, and a downstream skill that called only
`read_file` silently dropped all of them (`UseJunior/legal-context#225`).

Comments already solve this exact problem in `read_file`: they attach to the paragraphs that
anchor them, windowed to the returned slice. Footnotes should follow the same pattern.
(Issue #158.)

## What Changes

### safe-docx (MCP)

- MODIFIED: `read_file` tool (`tools/read_file.ts`) — new opt-in `include_footnotes: boolean`
  (default `false`). When true and `format` is `json`, each paragraph node gains a `footnotes`
  array (`{id, display_number, text}`) listing the footnotes anchored to it.
  - **Windowed**: attachment runs on the already-paginated slice, so a paginated walk returns
    each footnote exactly once, on the page whose slice contains its anchor paragraph.
  - **Budget-aware**: the payload is attached before the budget renderer, so it counts toward
    the existing ~14k-token read budget with no exemption.
  - **Eligibility**: footnotes with `display_number == 0` or an empty body (bootstrap
    scaffolding) and orphaned footnotes (no anchored paragraph) are excluded from inline
    output. `get_footnotes` remains the authoritative full enumeration and still returns them.
  - **Degraded, not failed**: a footnote part that cannot be loaded surfaces as
    `footnote_load_error` metadata (mirroring `comment_load_error`); the read still succeeds.
- MODIFIED: `tool_catalog.ts` — `read_file` input schema gains `include_footnotes`.

## Impact

- Affected specs: `mcp-server` (read_file gains opt-in inline footnote bodies).
- Purely additive. Default off; existing consumers see byte-identical output.
- v1 is JSON-only: TOON/simple output is unchanged regardless of the flag (same contract as
  `include_fingerprint`).

## Out of scope

- Inline editing of footnotes via `read_file` (use `add_footnote` / `update_footnote` /
  `delete_footnote`).
- Endnotes (`word/endnotes.xml`).
- TOON/simple/markdown rendering of footnote bodies — future work with an explicit rendering
  decision.
- Comments — already inline in `read_file` output.
