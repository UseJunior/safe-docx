# Change: ODF `compare_documents` — intra-paragraph (run-level) tracked changes (Slice 2)

## Why
Slice 1 (`add-odf-compare`, issue #348) made two-file `.odt` `compare_documents` work at
**whole-paragraph** granularity: any paragraph whose text changed at all is emitted as a delete
of the entire old paragraph plus an insert of the entire new one. For real review work —
especially legal prose, where paragraphs are long — that is coarse and noisy: a one-word edit
shows the whole clause struck through and re-inserted, and `stats.modifications` is hard-wired
to `0` because there is no notion of an in-place modification. The DOCX path already diffs down
to the run/atom level within a matched paragraph; this change brings the ODF lane to parity
(issue #356).

## What Changes
- `@usejunior/odf-core`:
  - `compare/diff.ts`: new `modify` EditOp variant plus `pairModifications(ops, original,
    revised, similarityThreshold)` — a post-pass over the Slice-1 LCS that converts similar
    delete/insert pairs inside each gap into `modify` ops via an order-constrained,
    deterministic DP (maximize pair count, then total Jaccard word-overlap; pairs admissible at
    `similarityThreshold`, default 0.25 mirroring docx-core's reference point).
  - New `compare/inline_diff.ts`: pure token-level LCS over a modify pair's visible text
    (tokens = maximal whitespace / non-whitespace runs; common token prefix/suffix trimmed),
    returning char-offset `SpanOp`s on clean word boundaries.
  - New `compare/inline_map.ts`: visible-offset → DOM mapping that splits `#text` nodes and
    `text:s` runs at span boundaries (`resolveOffset`) and clones a visible range's inline
    content for out-of-line deletion storage (`extractVisibleRange`).
  - `shared/odf/text_segments.ts`: the `virtual` Segment variant additionally carries its host
    `Element` and a `virtual: 'space' | 'tab' | 'line-break'` discriminator (additive).
  - `compare/emit.ts`: explicit `equal | insert | delete | modify` planning lanes. A modify
    pair's revised paragraph stays in place; inserted spans are bracketed inline by
    `text:change-start`/`text:change-end`, deleted spans leave an inline `text:change` point
    marker and move their content into the `text:deletion` changed-region (no merge-artifact
    paragraph — no paragraph break died). Pairs that cannot be mapped cleanly degrade to the
    Slice-1 whole-paragraph delete+insert (correctness valve).
  - `compare/index.ts`: `OdfCompareOptions.similarityThreshold`; meaningful stats (see spec
    delta): one `modifications` per successful pair, inner spans counted toward
    `insertions`/`deletions` (one per changed-region, keeping rough parity with the DOCX
    atom-level counts).
- `@usejunior/docx-core`: `integration/libreoffice-oracle.ts` gains an `.odt` format dimension
  (FilterName `writer8`, `content.xml` extraction) so a soffice-gated round-trip test can
  assert accept-all reproduces the revised text and reject-all the original.
- `@usejunior/docx-mcp`: ODF `compare_documents` reports `granularity: 'inline'` with an
  updated message; tool catalog + generated docs updated.

## Supersedes (archive-time resolution)
`add-odf-compare` is merged but not yet archived. This change supersedes two of its clauses:
- odf-core: "A modified paragraph SHALL be emitted as a deletion plus an insertion, so
  `modifications` SHALL be `0`" — now only the below-threshold fallback behaves that way.
- mcp-server: `granularity: 'paragraph'` and the "counts run higher than the DOCX atom-level
  path" message — now `granularity: 'inline'`.
When both changes archive, the requirements in THIS change's deltas are the surviving text for
those clauses.

## Impact
- Affected specs: `odf-core` (intra-paragraph comparison requirement), `mcp-server` (inline
  granularity surface).
- Affected code: `packages/odf-core/src/compare/*`, `packages/odf-core/src/shared/odf/
  text_segments.ts`, `packages/docx-core/src/integration/libreoffice-oracle.ts`,
  `packages/docx-mcp/src/tools/odf/compare_documents.ts`, `packages/docx-mcp/src/
  tool_catalog.ts` + regenerated tool reference.
- Out of scope (unchanged from Slice 1's deferrals): session-mode ODF compare, `.ods`/`.odp`,
  accept/reject of ODF tracked changes, DOCX↔ODF conversion.
