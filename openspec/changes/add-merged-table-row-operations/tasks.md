## 1. Contract and evidence

- [ ] 1.1 Review and approve the opt-in API, occupancy model, restart-promotion semantics, and tracked revision representation before implementation.
- [ ] 1.2 Confirm the relevant ECMA-376 5th-edition sections and vendored schemas; run a Word Track Changes oracle for restart-row deletion before freezing `w:tcPrChange` versus `w:cellMerge` representation.
- [ ] 1.3 Archive `add-structural-table-row-operations` before adding this change's MODIFIED requirement; dry-run this change's archive on a scratch copy.
- [ ] 1.4 Merge this approval-only proposal with green required checks and one mapped, currently true default-guard scenario; add the merge-aware operation delta together with its mapped tests in the implementation PR.

## 2. Read-only occupancy inventory

- [ ] 2.1 Normalize direct `w:tblGrid`, `w:gridBefore`/`w:gridAfter`, physical-cell `w:gridSpan`, and `w:vMerge` chains into logical grid coordinates without changing source XML.
- [ ] 2.2 Diagnose missing/mismatched grid, overlapping owners, orphan continuations, non-rectangular two-dimensional spans, and topology revisions with row/column/physical-cell coordinates.
- [ ] 2.3 Preserve nested-table content as opaque inside unaffected cells; reject nested anchors and wrapped row/cell containers.

## 3. Merge-aware clean row operations

- [ ] 3.1 Extend the existing row API with an explicit opt-in mode; leave default rectangular behavior unchanged.
- [ ] 3.2 Insert a row from the adjacent physical-cell layout, preserve horizontal spans and offsets, and apply the enumerated before-restart/interior/after-terminal vertical-merge boundary rules with empty continuation text.
- [ ] 3.3 Delete interior/final merge continuations and promote a following continuation to restart when deleting a restart; reject cases whose surviving rectangle cannot be represented uniquely.
- [ ] 3.4 Validate clean output occupancy, trailing cell paragraphs, preserved unaffected XML, bookmark/range integrity, and transactional failure before publication.

## 4. Tracked rows and projections

- [ ] 4.1 Emit native row and content revisions using the existing row convention; represent any surviving-cell restart promotion with a schema-valid property revision.
- [ ] 4.2 Prove reject-all equals reject-all source and accept-all equals accept-all clean output, including pre-existing unrelated revisions, selective filters, and removal of any empty `w:trPr` created solely by reject resolution.
- [ ] 4.3 Model bounded pending merge-property revisions in both accept and reject occupancy maps so a second tracked row operation can compose in one table; reject unknown topology revisions.
- [ ] 4.4 Test every merge orientation, row-boundary case, malformed/ambiguous negative case, revision-ID nonconsumption, and repeated operations.
- [ ] 4.5 Validate emitted `document.xml` against the vendored schema and use a real-world merged table for reader compatibility evidence.

## 5. Delivery

- [ ] 5.1 Extend the `docx-primitives` delta with mapped `SDX-MERGEDROW-01..06` and updated `SDX-TABLEROW-07/08` tests; reconcile or retire the overlapping default-guard wording so the canonical spec has one consistent contract; run full repository pre-submit and strict OpenSpec validation.
- [ ] 5.2 Obtain dynamic peer review, resolve findings, and ship via a focused PR with post-merge smoke.
