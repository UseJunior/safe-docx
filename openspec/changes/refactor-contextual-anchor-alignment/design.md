## Context

The atomizer flattens text into punctuation and word atoms before LCS. A visible
marker such as `(i)` is therefore three independent candidates. Repeated markers
can be matched across different legal-list items even when the surrounding item
was replaced wholesale.

## Goals / Non-Goals

- Goals: keep composite anchors indivisible across incompatible item contexts;
  support common parenthetical marker families; preserve minimal diffs inside
  compatible items; remain deterministic and paragraph-local.
- Non-Goals: infer arbitrary document semantics, renumber lists, or replace the
  general atom LCS algorithm.

## Decisions

- A contextual anchor is a parenthetical numeric or alphabetic token at a
  list-item boundary. Roman numerals are covered by the alphabetic syntax rather
  than a special case.
- Its semantic span extends to the next contextual anchor in the same paragraph
  or the paragraph end.
- Candidate anchors are paired monotonically by normalized marker and occurrence.
  Their item bodies are compatible when they have meaningful lexical overlap or
  one side is a short edit of the other.
- Compatibility is computed outside the LCS dynamic-programming loop. The LCS
  receives only an equality guard, preserving its optimality and tie-breaking
  over the permitted match relation.

Alternatives considered:

- Roman-only blocking: rejected because syntax and corpus thresholds leak into
  generic LCS.
- Always treating markers as atomic: rejected because unchanged markers should
  survive ordinary edits.
- Matching markers without item context: rejected because it recreates the
  cross-item identity error.

## Risks / Trade-offs

- Literal parentheticals can resemble markers. Boundary classification excludes
  references such as `Exhibit (v)`, and regressions cover prose and short items.
- Context compatibility requires a threshold. It is isolated behind a named
  policy and tested across marker families rather than embedded in LCS identity.

## Migration Plan

Replace the PR's inline Roman-specific pre-pass with the contextual-anchor module,
retain the public comparison API, and verify the real ILPA pair plus synthetic
insert/delete/reorder and negative controls.

