## Context

`buildDocumentView` currently derives `heading` from a literal paragraph style
ID match before falling through to existing run-in/title heuristics. Paragraph
formatting resolves alignment and indentation through direct properties and a
`basedOn` chain, but does not resolve `w:outlineLvl`. The numbering model parses
level counters and labels but discards `w:lvl/w:pStyle`.

The default `get_document_outline` projection currently admits only
`source === "word_style"`. Adding deterministic sources without updating that
filter would improve the internal view while leaving the agent-facing outline
incomplete.

## Goals / Non-Goals

- Goals: make explicit OOXML outline intent visible to agents by default.
- Goals: preserve provenance so consumers can distinguish style, numbering, and
  outline-property evidence from heuristic inference.
- Goals: keep classification deterministic, bounded, and cheap enough for the
  existing map-first workflow.
- Goals: avoid breaking the existing `HeadingValue` object or heuristic source
  values.
- Non-Goals: invent semantic headings from arbitrary formatting, mutate source
  documents, or introduce a graphical review surface.

## Decisions

### Extend the existing source union

`HeadingSource` gains `list_metadata` and `outline_level`. `word_style` remains
the public name for built-in-style evidence. Existing heuristic values remain
unchanged, and `HeuristicHeadingSource` is redefined explicitly so adding
deterministic sources cannot accidentally make them heuristic.

This is additive at runtime, but downstream TypeScript consumers with exhaustive
switches will receive an intentional compiler signal to handle the new
provenance.

### Resolve effective outline level like other paragraph properties

`ParagraphFormatting.outlineLevel` is `number | null`. Direct
`w:pPr/w:outlineLvl` wins; otherwise the first value in the paragraph style's
`basedOn` chain wins. Valid heading levels are OOXML values 0 through 8 and map
to public levels 1 through 9. Value 9 means body text and suppresses
`outline_level` classification. Missing, malformed, negative, or out-of-range
values do not produce a heading.

The implementation will register and cite the exact ECMA-376 edition 5 sections
for `w:pPr`, `w:outlineLvl`, `w:lvl`, and `w:pStyle` before making conformance
claims.

### Match built-in heading styles through IDs and a versioned alias table

A pure lookup module owns normalized built-in Heading 1 through Heading 9 names.
It includes at least English, French, German, Spanish, and Japanese aliases and
is covered by one table-driven test per entry. Normalization is Unicode-aware,
trims surrounding whitespace, collapses internal whitespace, and compares using
locale-independent lowercase. It does not strip arbitrary punctuation or use
fuzzy matching, which would turn localization support into a heuristic.

Literal `Heading1` through `Heading9` IDs remain the fastest path. Style display
names are consulted only when the ID is not a built-in heading ID. `TOC` styles
are never aliases.

### Use numbering-level style association only for the active level

Each parsed `NumberingLevel` retains its optional `pStyle`. The public lookup
accepts a paragraph's resolved `numId` and `ilvl`, follows the `w:num` to its
`w:abstractNum`, and returns that exact level definition without mutating
counters.

A paragraph is `list_metadata` only when its active numbering level's `pStyle`
resolves to a recognized built-in heading level. An unrelated heading style on
another list level, a missing level, an unknown style, or a `TOC` style does not
classify the paragraph.

### First deterministic match wins

Classification order is:

1. recognized built-in heading style on the paragraph (`word_style`);
2. active list level linked to a recognized built-in heading style
   (`list_metadata`);
3. effective `w:outlineLvl` (`outline_level`);
4. existing heuristic detectors.

The selected source supplies the level. Explicit paragraph style therefore wins
over inconsistent numbering metadata, and both win over an inconsistent outline
property. Table-cell suppression continues to apply only to heuristics; explicit
deterministic structure remains visible in tables.

### Default outline means all deterministic sources

`get_document_outline` replaces its single-source check with a deterministic
source predicate. `word_style`, `list_metadata`, and `outline_level` appear by
default. Existing heuristic sources still require
`include_heuristic_headings=true`.

JSON preserves levels 1 through 9. Markdown rendering retains its existing ATX
clamp at depth 6 because Markdown has no deeper heading syntax; the structured
JSON remains authoritative for levels 7 through 9.

## Risks / Trade-offs

- Some documents contain inconsistent style, numbering, and outline metadata.
  Fixed precedence makes the result explainable and stable rather than trying to
  reconcile author intent.
- Localized style aliases require maintenance. A narrow data table plus
  table-driven tests is safer than fuzzy matching and easy to extend.
- New union members may break exhaustive consumer switches at compile time.
  This is preferable to silently relabeling the new evidence as `word_style`.

## Migration Plan

No document migration is required. Existing headings retain their current
source values. Consumers that treat only `word_style` as deterministic should
accept the two new deterministic values. Generated MCP documentation will call
out this additive taxonomy change.
