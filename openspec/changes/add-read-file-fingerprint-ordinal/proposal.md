# Change: Add opt-in fingerprint duplicate-disambiguation metadata to read_file

## Why

`read_file(format="json", include_fingerprint=true)` already gives consumers a portable
`content_fingerprint` (`sha256:nfkc:<32hex>`) that is stable across reads, machines, and
re-uploads. The remaining gap is **duplicate disambiguation**: when the same normalized
paragraph text appears multiple times in one document, every occurrence shares one
fingerprint, so a downstream consumer cannot reference "the second occurrence of WHEREAS …"
without computing its own document-order ordinal.

Today every consumer that hits this (e.g. legal-context's manual-DOCX ingest / citation
pipeline) has to re-implement the same four steps: request fingerprints, group paragraphs by
fingerprint, assign document-order ordinals per group, and build a composite key. That logic
is small but easy to drift on across consumers. (Issue #205.)

## What Changes

### safe-docx (MCP)

- MODIFIED: `read_file` tool (`tools/read_file.ts`) — new opt-in
  `include_fingerprint_ordinal: boolean` (default `false`). When it is `true` **and**
  `include_fingerprint=true` **and** `format="json"` for a DOCX session, each paragraph node
  gains three additional fields:
  - `content_fingerprint_ordinal`: 1-based position of the paragraph among all paragraphs in
    the document sharing its `content_fingerprint`, in document order.
  - `content_fingerprint_count_in_document`: total number of paragraphs in the document
    sharing that fingerprint (document-wide, not windowed to the returned slice).
  - `portable_paragraph_ref`: the convenience composite `"<content_fingerprint>#<ordinal>"`.
  - **Document-wide**: ordinals and counts are computed over the full document in document
    order, so a paginated / `node_ids`-filtered read still reports stable ordinals and the
    full document count.
  - **No effect without `include_fingerprint`**: if `include_fingerprint_ordinal=true` is
    passed without `include_fingerprint=true`, no ordinal fields are emitted (the
    disambiguator sits on top of the existing fingerprint surface).
  - **Read-only disambiguator**: ordinals are NOT edit anchors. Reordering duplicate
    paragraphs may change ordinals. Edit tools continue to accept only `_bk_*` IDs.
- MODIFIED: `tool_catalog.ts` — `read_file` input schema gains `include_fingerprint_ordinal`.

## Impact

- Affected specs: `mcp-server` (read_file gains opt-in fingerprint ordinal disambiguation).
- Purely additive. Default off; existing consumers see byte-identical output. `id` (`_bk_*`),
  edit-anchor semantics, and the `content_fingerprint` algorithm are all unchanged.
- JSON-only: TOON/simple output is unchanged regardless of the flag (same contract as
  `include_fingerprint`). Google Docs and ODT sessions ignore the flag.
- Affected code: `packages/docx-mcp/src/tools/read_file.ts`,
  `packages/docx-mcp/src/tool_catalog.ts`. Regenerated:
  `packages/docx-mcp/docs/tool-reference.generated.md`.

## Out of scope

- Replacing `_bk_*` with content-addressable `_p_*` IDs.
- Making portable references valid edit anchors.
- Changing TOON / simple / Google Docs output.
- Any new normalization algorithm or shorter hash format.
- Footnote / endnote / comment fingerprints.
