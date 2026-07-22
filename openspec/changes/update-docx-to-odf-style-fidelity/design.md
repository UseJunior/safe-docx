## Context

Phase 1+2 of DOCX → ODT conversion (#401) deliberately downgraded several style classes and
recorded each in the `lossiness` report. The post-merge smoke telemetry on the bundled real
fixtures prioritizes phase 3 (#406): font runs dominate (185 drops on the NVCA COI, 32 on the
Common Paper NDA); everything else is single-digit. The converter consumes the docx-core
document view (`formattingMode: 'full'`) — the same intentionally-lossy semantic model the
markdown/HTML serializers use — so each fidelity class must either come from data the view
already carries, an enrichment of the view, or a narrow raw-DOM supplement.

## Goals / Non-Goals

- Goals: near-zero lossiness on the bundled real fixtures for the six in-scope classes;
  CONV-13 LibreOffice differential stays green; conversion stays native and semantic.
- Non-Goals (unchanged from #331): tracked changes, comments, headers/footers/footnote
  fidelity, `.ods`/`.odp`, pixel-faithful layout.

## Decisions

- **Font runs come from the TOON `<font>` tag, not a raw-DOM pass.** The full-mode tag already
  carries `color` (hex, no `#`), `size` (points), and `face`; the converter's inline emitter
  tracks them as state alongside b/i/u and the `TextStyleRegistry` key grows to include them.
  Used font faces are declared in `office:font-face-decls` (new `svg` namespace) because ODF
  resolves `style:font-name` against declared faces.
- **Highlight color rides the existing TOON tag, full mode only.** `RunFormatting.highlightVal`
  already holds the `w:highlight` enum; `emitFormattingTags` now keeps the value in its active
  tag state and emits `<highlight color="green">` when `formattingMode: 'full'`. Compact mode
  emits the value-less `<highlight>` exactly as before (adjacent different-color runs still
  collapse via `mergeAdjacentTags`, preserving today's compact output byte-for-byte). The
  tokenizer grammar (`TOON_INLINE_TAG_RE`) and the strip helpers accept the attributed form.
  The ECMA-376 ST_HighlightColor palette maps to fixed hex values in odf-core.
- **Paragraph alignment/indents use view data only.** A `ParagraphStyleRegistry` creates deduped
  automatic paragraph styles keyed by (parent style, alignment, left indent, first-line indent),
  created only when something deviates (non-LEFT alignment or non-zero indent). List items get
  alignment only: `text:list` nesting already supplies indentation, and re-applying
  `fo:margin-left` would double-indent.
- **Named styles resolve via the style chain with tri-state semantics.** A new
  `extractStyleRunFormatting(styles, styleId)` returns `null` for properties the chain never
  specifies (unlike `extractEffectiveRunFormatting`, which collapses to defaults) so the ODF
  template only overrides what the source actually declares — e.g. a non-bold source Heading2
  emits `fo:font-weight="normal"`, an unspecified one inherits the template's bold `Heading`
  base. Heading styles are matched by styleId `Heading[1-6]` or name `heading [1-6]`; `Normal`
  seeds `Standard`.
- **Table borders/widths read the raw `w:tbl` directly, not a view enrichment.** The view's
  `table_context.table_index` indexes direct `w:tbl` children of `w:body` — the converter
  resolves the same elements from the already-loaded source and reads `w:tblPr/w:tblBorders`
  (explicitly-none → borderless cell style; declared size/color honored, eighths-of-a-point →
  pt) and `w:tblGrid/w:gridCol` (twips → pt column widths). Borders inherited from a
  `w:tblStyle` chain are out of scope (StyleDef carries no tblPr); such tables keep the
  0.5pt default that matches Word's bordered-by-default reality. Per-cell `w:tcBorders`
  overrides also stay out of scope.
- **Empty paragraphs are a raw-DOM supplement keyed by bookmark identity.** Every paragraph
  (including text-empty ones) gets a `_bk_*` bookmark before view construction;
  `getParagraphBookmarkId` correlates `getParagraphs()` order with surfaced view nodes. Each
  unsurfaced, text-empty, body-level (not inside `w:tc`) paragraph emits an empty `text:p`
  before its nearest following surfaced node (or trailing). Table-cell paragraphs — including
  empty ones — are already surfaced by the view and flow through the grid emitter, so only
  defensive lossiness branches remain for exotic unsurfaced shapes.

## Risks / Trade-offs

- Changing full-mode TOON output could affect other full-mode consumers → the converter is the
  only production consumer (verified by grep); compact mode is bit-identical.
- `</highlight><highlight color="…">` adjacency in full mode no longer merges when colors
  differ — that is the point; identical-format adjacent runs are already merged by
  `normalize()` before tagging.
- LibreOffice differential (CONV-13) projection compares text/headings/tables/lists only, so
  the new styles cannot break it; empty-paragraph preservation is filtered out by the
  projection's empty-text filter.

## Migration Plan

Pure addition behind the existing `convertDocxToOdt` API; the lossiness report shrinks. No
rollback steps beyond reverting the PR.

## Open Questions

- Extending the CONV-13 projection to font/alignment attributes is deferred until the
  LibreOffice oracle's style normalization is characterized (#406 acceptance notes it as
  optional).
