# Change: Add formatting-fidelity comparison check

## Why

The rebuild-elimination campaign (#347 → #358/#359) needs to *measure* formatting loss, and no current gate can: the round-trip safety oracle compares text projections only, and the LibreOffice oracle's `paragraphShape()` records only paragraph count + visible-text presence. Rebuild mode reconstructs `document.xml` from atoms and silently drops formatting that inplace mode preserves — and that loss passes every existing check.

## What Changes

- Add a deterministic, in-engine formatting-fidelity comparison (`compareFormattingFidelity`) that aligns two `word/document.xml` views by paragraph text content and reports per-property divergence across run (`w:rPr`), paragraph (`w:pPr`), table (`w:tblPr`/`w:trPr`/`w:tcPr`), and section (`w:sectPr`) formatting, plus a scalar fidelity score in [0, 1].
- Run formatting is compared character-by-character so differing run splits with identical formatting (the normal inplace-vs-rebuild structural difference) score perfect fidelity.
- Add a projection-based wrapper (`compareProjectedFormattingFidelity`) that compares accept-all and reject-all projections of two candidates, making the check insensitive to revision-markup granularity differences — the same projection-to-projection stance the round-trip oracle adopted in #347.
- LibreOffice is deliberately NOT used: it rewrites formatting on load/save (adds default `w:pPr`/`w:rPr`), so this must be an in-engine comparison over our own emitted XML.

## Impact

- Affected specs: `docx-comparison`
- Affected code: `packages/docx-core/src/baselines/atomizer/formattingFidelity.ts` (new), `packages/docx-core/src/index.ts` (export)
- Ref: #363 (enabler for the rebuild-elimination campaign behind the preserve semantics adopted in #347)
