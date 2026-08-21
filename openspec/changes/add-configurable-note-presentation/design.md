## Context

OOXML comments are ranged annotations stored in comment parts. Footnotes are
single body references linked to definitions in `footnotes.xml`. Converting
between them therefore requires mapping a comment range to one deterministic
insertion boundary while preserving operative text and unrelated package parts.

## Goals / Non-Goals

### Goals

- Author or select notes independently from their presentation.
- Import brownfield comment and footnote bodies into canonical Markdoc rather
  than leaving them opaque in the pinned source package.
- Preserve the source anchor geometry and presentation needed to regenerate the
  original annotation faithfully.
- Convert eligible comments transactionally and report every disposition.
- Style a footnote label separately from its separator and body.
- Preserve substantive footnotes and unrelated comments.
- Fail closed on unsupported cross-paragraph ranges and threads by default.

### Non-Goals

- Infer internal/external audience from prose or author metadata.
- Convert substantive footnotes by default.
- Invent a selected text range for an imported footnote.
- Restore an interactive reply graph after flattening it into a footnote.
- Put drafting text directly in the operative document body.
- Complete the paragraph-index SSOT refactor tracked by #904 in this change.

## Decisions

### Semantic notes and presentation are separate

A canonical annotation owns its editable body, audience, optional operation
association, source metadata, source presentation, and anchor independently of
how a particular DOCX renders it. A normalized profile maps each audience to
`preserve`, `comment`, `footnote`, or `omit`; an explicit per-annotation choice
takes precedence. Prefix, separator, and body are structured runs rather than
embedded HTML.

Imported audience defaults to `unspecified`. Import MUST NOT infer that a Word
comment is external-facing merely because it arrived in a brownfield document,
or internal merely because of its author. Export profiles therefore route
`unspecified` annotations explicitly and fail closed if the chosen profile has
no rule for them.

### Canonical annotations preserve semantic content and source provenance

The Markdoc IR admits first-class annotations not limited to edit rationales.
Each annotation has a stable ID; an editable structured body; optional author,
initials, creation time, and reply-parent metadata; an explicit audience; a
semantic role of `drafting-note`, `substantive-footnote`, or `unspecified`; and
`sourcePresentation` of `comment`, `footnote`, or `authored`; an immutable
`sourceAnchor`; and a current editable `anchor`. Imported bodies
are readable Markdoc content, not opaque OOXML or text hidden only in the pinned
source package. `sourcePresentation` is immutable provenance; an editable
presentation preference is stored separately.

Existing rationale blocks normalize into the same annotation collection with
an operation association. Imported annotations need not bind to an edit:
counterparty comments and substantive footnotes often discuss unchanged text.
The import preserves supported thread structure as metadata. A presentation
that cannot retain a reply graph remains an explicitly lossy projection and
does not destroy the canonical thread.

Import does not infer that a footnote is merely a drafting note. An imported
footnote defaults to `substantive-footnote` unless an explicit mapping classifies
it otherwise. Audience-wide conversion or omission rules apply automatically to
drafting notes only; changing or omitting a substantive or unspecified
annotation requires an explicit per-annotation choice. This preserves ordinary
legal footnotes under the default profile.

### Anchor geometry is an explicit union

An annotation anchor is either:

- a half-open range with exact start and end positions, used by imported ranged
  comments; or
- one point position, used by imported footnote references and point comments.

Both `sourceAnchor` and the current `anchor` use the same union. Positions use stable paragraph identity plus the canonical visible-text
coordinate defined by the paragraph-index work in #904. Until that index lands,
import and export may adapt existing structural coordinates internally, but the
Markdoc schema has one anchor representation rather than parallel ad hoc run
lists.

Import never manufactures missing geometry. A footnote therefore imports as a
point even if nearby words appear semantically related to its body. A comment's
range remains a range, including a zero-width point comment.

Text edits validate and remap anchors through the canonical paragraph index.
If an edit makes an anchor unresolvable or ambiguous, compilation fails with an
annotation-specific diagnostic rather than silently moving it. Direct anchor
editing changes only the current anchor and preserves `sourceAnchor` as
immutable provenance.

### Presentation projection has deterministic geometry rules

`preserve` uses `sourcePresentation` when it exists and otherwise uses the
authored-note default (`comment` unless explicitly set). Projecting a range as a
comment preserves both boundaries. Projecting a range as a footnote places the
reference at its end boundary while retaining the range in canonical Markdoc.
Projecting a point as a footnote preserves the point. Projecting a point as a
comment emits a point comment transparently; it MUST NOT expand to a guessed
word, sentence, or paragraph. An editor may later replace the point anchor with
an explicit range, after which later comment exports use that range.

Changing footnote styling or changing comment/footnote presentation recompiles
from the same canonical annotation and never requires a destructive
comment-to-footnote-to-comment chain.

### The first implementation slice converts comments to footnotes

The buffer-level API loads an isolated document, preflights the complete root
comment selection, mutates only after preflight, and publishes only a successful
serialization. The document-level method exposes the same report for callers
that already own transactional session boundaries.

### Comment ranges collapse at their visible endpoint

The footnote reference is inserted at the comment range's absolute visible-text
endpoint. Structural run indexes are retained for compatibility, but visible
coordinates avoid mismatches caused by zero-width comment-reference runs. A
future canonical paragraph index will make this coordinate system the SSOT
(#904).

### Threads are explicitly lossy

Threaded comments fail by default. `flattenThreads` serializes root and replies
in deterministic order and marks the report as lossy. In the Markdoc path,
flattening affects only that output projection; the canonical reply graph stays
available for later comment export.

### Styling is structured and fail-closed

The initial admitted annotation-body vocabulary is paragraphs and text runs
with bold, italic, underline, six-digit RGB color, and Word highlight values.
It excludes tables, drawings, fields, tracked changes, embedded objects, and
other body constructs until separately specified. Footnote references carry both the semantic
`FootnoteReference` style and explicit superscript so documents with a missing
or redefined character style still render correctly.

## Risks / Trade-offs

- Repeated visible prefixes can make substring-based insertion ambiguous;
  migrate insertion to a direct visible-offset-to-DOM mapping under #904.
- Direct superscript duplicates a conforming style declaration but prevents
  silently flat markers in documents with incomplete styles.
- Footnotes change pagination; package/text invariants, not page identity, are
  the automated compatibility boundary.
- Audience is metadata, not a disclosure or privilege guarantee.
- OOXML footnotes do not carry a selected range; point-comment export is honest
  but less ergonomic until an author supplies a range.
- Some rich comment or footnote content may fall outside the admitted structured
  body vocabulary; import must report and fail closed rather than silently drop
  negotiation content.

## Migration Plan

1. Land comment-to-footnote conversion and structured styling as a draft slice.
2. Add canonical annotation IR plus brownfield comment/footnote import.
3. Add Markdoc audience and per-annotation presentation projection.
4. Add provenance-aware comment/footnote regeneration from canonical annotations.
5. Migrate coordinate consumers to the canonical paragraph index from #904.
