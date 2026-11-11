# Change: Redline matched-row cell topology as a native row replacement

## Why

Issue #1396: when a matched table row gains or loses a cell, merges or splits cells horizontally (`w:gridSpan` or legacy `w:hMerge`), or changes its `w:gridBefore`/`w:gridAfter` offsets, `compareDocuments` throws `UnsupportedTableTopologyComparisonError` and the caller gets no redline at all. Signature grids and label/value tables change like this routinely. The fail-closed guard from `add-table-topology-comparison-gate` (SDX-COMPTABLE-03) was a stopgap against schema-invalid output; the comparison must now produce a full native redline instead.

## What Changes

- A main-body pass (`tableTopologyNormalization.ts`) runs before the table-topology guard. Each matched row whose cell skeleton changed becomes the original row deleted (`w:trPr/w:del`, ECMA-376 Part 1 §17.13.5.12), immediately followed by the revised row inserted (`w:trPr/w:ins`, §17.13.5.17), in the same table. Unchanged rows keep no marker. The table grid does not change, so no `w:tblGridChange` is emitted.
- Move detection never takes table content, so no move relation ends inside a replaced row; a paragraph moved into a replaced row publishes as a plain deletion and insertion.
- Whole-row marking never adds a second `w:ins` or `w:del` to a `w:trPr` that already carries one (`w:trPr` allows one of each, §17.4.81); the existing pending marker gives the same projection.
- Out of scope, and still refused by the guard: grid column count or width changes (#1398), vertical merges (#1397), pending cell-level topology revisions (`w:cellIns`/`w:cellDel`/`w:cellMerge`), and cells inside a cell-level content control. Selected header/footer stories keep their own contract (SDX-CMP-STORY-05).
- Representation choice: native `w:cellIns`/`w:cellDel` was probed against Word and LibreOffice and rejected; whole-row replacement is the form both readers accept and reject faithfully. The probe results are recorded in the PR.

## Impact

- Affected specs: `docx-comparison` (modifies the requirement added by `add-table-topology-comparison-gate`; archive that change first, or this delta's MODIFIED header has nothing to match).
- Affected code: `packages/docx-compare/src/tagged/tableTopologyNormalization.ts` (new), `taggedTreeShadow.ts`, `taggedTreeSerializer.ts` (`markWholeTableRow`), tests.
- References: #1396, #764, #1043, #1227, #1395.
