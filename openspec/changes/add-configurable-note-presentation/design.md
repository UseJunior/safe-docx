## Context

OOXML comments are ranged annotations stored in comment parts. Footnotes are
single body references linked to definitions in `footnotes.xml`. Converting
between them therefore requires mapping a comment range to one deterministic
insertion boundary while preserving operative text and unrelated package parts.

## Goals / Non-Goals

### Goals

- Author or select notes independently from their presentation.
- Convert eligible comments transactionally and report every disposition.
- Style a footnote label separately from its separator and body.
- Preserve substantive footnotes and unrelated comments.
- Fail closed on unsupported cross-paragraph ranges and threads by default.

### Non-Goals

- Infer internal/external audience from prose or author metadata.
- Convert substantive footnotes by default.
- Restore an interactive reply graph after flattening it into a footnote.
- Put drafting text directly in the operative document body.
- Complete the paragraph-index SSOT refactor tracked by #904 in this change.

## Decisions

### Semantic notes and presentation are separate

A normalized profile maps each audience to `comment`, `footnote`, or `omit`.
Prefix, separator, and body are structured runs rather than embedded HTML.

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
in deterministic order and marks the report as lossy.

### Styling is structured and fail-closed

The admitted subset is bold, italic, underline, six-digit RGB color, and Word
highlight values. Footnote references carry both the semantic
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

## Migration Plan

1. Land comment-to-footnote conversion and structured styling as a draft slice.
2. Add Markdoc audience profile projection.
3. Add provenance-gated reverse conversion for generated note-footnotes.
4. Migrate coordinate consumers to the canonical paragraph index from #904.
