## Context

Issue #363. Both existing oracles are formatting-blind, so rebuild's formatting loss is invisible to every gate. The campaign needs (1) a way to quantify what rebuild currently drops on each fallback shape, and (2) a per-fix gate asserting inplace output's formatting fidelity ≥ rebuild's.

## Goals / Non-Goals

- Goals: deterministic in-engine comparison of two `document.xml` views; per-property divergence report; scalar score usable as a gate; insensitivity to run-split and revision-markup granularity noise.
- Non-Goals: LibreOffice-based formatting oracling (LO rewrites formatting on load/save); style-sheet resolution (`styles.xml` cascade — compares direct formatting only); wiring the check into the pipeline's fallback decision (measurement first, gating per-fix later).

## Decisions

- **Content-anchored alignment, not raw XML diff.** Paragraphs are aligned by their visible text (`w:t` + `w:delText`) via LCS; only aligned pairs are compared for formatting. This compares formatting *of the same content* and keeps content divergence (the text oracle's job) out of the formatting tallies.
- **Character-weighted run comparison.** Within an aligned paragraph each character carries the canonical key of its nearest `w:r`'s `w:rPr`. Comparing per character makes the check agnostic to run splits — rebuild and inplace legitimately split runs differently — and weights divergence by how much text it affects.
- **Canonical property keys.** Property containers are canonicalized by deep serialization with sorted attributes and sorted children, excluding revision-tracking elements (`w:rPrChange`, `w:pPrChange`, `w:tblPrChange`, `w:trPrChange`, `w:tcPrChange`, `w:sectPrChange`, `w:ins`, `w:del`, `w:cellIns`, `w:cellDel`, `w:cellMerge`). `w:sectPr` is excluded from `w:pPr` comparison and handled by the section dimension instead.
- **Table formatting compared per paragraph via the enclosing chain.** Each paragraph carries the `w:tblPr`/`w:trPr`/`w:tcPr` chain of its enclosing tables (outermost-first). This captures table-property loss aligned to content without a separate table-grid alignment.
- **Score = alignment coverage × mean of defined dimension scores.** Each dimension (run chars, paragraphs, paragraphs-in-tables, section breaks) scores `(compared − divergent) / compared`, or 1 when nothing was compared. Coverage is `2·aligned / (expectedParagraphs + actualParagraphs)`. Exact preservation scores exactly 1.0, so the score works as an exact-preservation gate as well as a ranking metric.
- **Projection wrapper for candidate-vs-candidate use.** `compareProjectedFormattingFidelity` compares accept-all projections and reject-all projections (reusing `acceptAllChanges`/`rejectAllChanges` from `trackChangesAcceptorAst`), returning both reports and `min(accept.score, reject.score)`. Mirrors the projection-to-projection oracle stance from #347.
- **`@xmldom/xmldom` via the existing `parseDocumentXml`** — project convention; no new XML dependency.

## Risks / Trade-offs

- O(n·m) LCS over paragraphs on very large documents → acceptable for a measurement/gate tool; documented on the entry point.
- Section breaks are aligned by document-order index, not content; if content alignment shifts section breaks the section dimension may misattribute a divergence. Acceptable for the prototype; coverage already degrades the score when content diverges.
- Paragraph-mark run properties (`w:pPr > w:rPr`) are included in paragraph comparison (revision marks stripped); benign mark-formatting differences between modes will surface as signal, which is the point of a discovery tool.

## Migration Plan

Pure addition — no behavior change to comparison output. Follow-ups wire the check into per-fix gates as inplace shapes are fixed.

## Open Questions

- Whether to weight dimensions by unit counts instead of the unweighted mean once real fallback-surface measurements exist.
