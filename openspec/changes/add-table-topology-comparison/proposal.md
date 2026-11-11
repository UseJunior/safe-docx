# Change: Redline matched-row cell topology as a native row replacement

## Why

Issues #1396 and #1397: when a matched table row gains or loses a cell, merges or splits cells horizontally (`w:gridSpan` or legacy `w:hMerge`), or changes its `w:gridBefore`/`w:gridAfter` offsets, `compareDocuments` throws `UnsupportedTableTopologyComparisonError` and the caller gets no redline at all. The same happens for any change to a vertical merge (`w:vMerge`): creating, extending, shrinking or splitting one, combining it with a horizontal span, or deleting the row where it starts (#1397). Signature grids and label/value tables change like this routinely. The fail-closed guard from `add-table-topology-comparison-gate` (SDX-COMPTABLE-03) was a stopgap against schema-invalid output; the comparison must now produce a full native redline instead.

## What Changes

- A main-body pass (`tableTopologyNormalization.ts`) runs before the table-topology guard. Each matched row whose cell skeleton changed becomes the original row deleted (`w:trPr/w:del`, ECMA-376 Part 1 §17.13.5.12), immediately followed by the revised row inserted (`w:trPr/w:ins`, §17.13.5.17), in the same table. Unchanged rows keep no marker. The table grid does not change, so no `w:tblGridChange` is emitted.
- A change that involves a vertical merge (`w:vMerge`, §17.4.84) is replaced as a band (#1397): the smallest run of consecutive rows that holds every merge chain the change touches, in both documents, published as all of its original rows deleted, immediately followed by all of its revised rows inserted. Each projection then holds whole, unbroken merge chains, and rows outside the band keep their ordinary redline. A merge continuation row deleted or inserted while every other row keeps its skeleton stays a plain whole-row revision.
- Move detection never takes table content, so no move relation ends inside a replaced row; a paragraph moved into a replaced row publishes as a plain deletion and insertion.
- Whole-row marking never adds a second `w:ins` or `w:del` to a `w:trPr` that already carries one (`w:trPr` allows one of each, §17.4.81); the existing pending marker gives the same projection.
- Out of scope, and still refused by the guard: grid column count or width changes (#1398), pending cell-level topology revisions (`w:cellIns`/`w:cellDel`/`w:cellMerge`), and cells inside a cell-level content control, including in a vertical-merge band. Selected header/footer stories keep their own contract (SDX-CMP-STORY-05).
- Representation choice: native `w:cellIns`/`w:cellDel` was probed against Word and LibreOffice and rejected; whole-row replacement is the form both readers accept and reject faithfully. The probe results are recorded in the PR. For a deleted merge-start row, `add-merged-table-row-operations` describes promoting the next cell to `restart` with a `w:tcPrChange`; it needs Word and LibreOffice both to honour it, Word could not be probed, so the band replacement (which LibreOffice accepts and rejects faithfully) is used instead.

## Impact

- Affected specs: `docx-comparison` (modifies the requirement added by `add-table-topology-comparison-gate`; archive that change first, or this delta's MODIFIED header has nothing to match).
- Affected code: `packages/docx-compare/src/tagged/tableTopologyNormalization.ts` (new), `taggedTreeShadow.ts`, `taggedTreeSerializer.ts` (`markWholeTableRow`), tests.
- References: #1396, #1397, #764, #1043, #1227, #1395.
