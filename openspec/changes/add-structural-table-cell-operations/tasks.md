## 1. Proposal and oracle

- [x] 1.1 Peer-review the split/absorb API, width rules, and delete-content semantics before implementation.
- [x] 1.2 Confirm ECMA-376 5th-edition schema order and registry citations for `gridSpan`, `tcW`, `cellIns`, `cellDel`, `cellMerge`, and property changes.
- [ ] 1.3 Obtain a Word Track Changes **cell-operation** oracle before any tracked-cell output; do not infer native records from schema validity or from `table-examples.docx`, which only shows horizontal-span whole-row deletions.
- [x] 1.4 Obtain approval of this Stage A proposal before implementation; land proposal and implementation together so the strict primitive scenario-coverage gate is not bypassed or left red.

## 2. Clean first phase

- [x] 2.1 Reuse #1040 occupancy inventory and extract the shipped #1072 column-edit anchor, detail, width parsing/validation, shell exclusion list, pending-revision and range-cleanup policies into a shared table-edit helper; reject unsupported topology with coordinates. Keep the public `TableColumnEditDetail` export and column diagnostic wording intact, parameterize the cell-edit operation label, map split's `columnIndex` to its boundary and absorb's to the target start, and leave existing column-operation tests passing unchanged.
- [x] 2.2 Preflight all split/absorb geometry, widths, content-loss, pending revisions, and bookmark/range effects before in-place mutation.
- [x] 2.3 Implement clean `splitTableCell` and `absorbTableCell` with deterministic preferred widths and the same safe new-cell shell as #1072; add split's grid-sum equality and two-width assignment rule, reject `pct` on split or the absorbing sibling, and reject pending `w:trPr/w:ins|del` on the target row.
- [x] 2.4 Map every clean OpenSpec scenario to conformance-tagged tests; prove exact unaffected-subtree preservation, transactional failures, schema validity, and real public DOCX smoke. Use the user-supplied Word file only as a pending-row-deletion rejection fixture, not as a cell-operation oracle.

## 3. Stage A delivery

- [x] 3.1 Run full pre-submit and strict OpenSpec validation.
- [ ] 3.2 Obtain dynamic peer review of implementation, resolve findings, and ship through a focused PR and exact-merge smoke. The PR body uses `Refs #1042`, never `Closes`, `Fixes`, or `Resolves #1042`; re-open the issue if an automatic link closes it prematurely.

## 4. Stage B: Word-style cell shifting (separate change)

- [ ] 4.1 Obtain Word-authored before/after and tracked examples for candidate shift-right/shift-down insertions and shift-left/shift-up deletions, including row-boundary cases.
- [ ] 4.2 Create and peer-review a separate OpenSpec delta defining only the shift operations supported by those oracles, their content order, occupancy, width rules, and transactional rejection.
- [ ] 4.3 Implement the approved clean shifting subset in a separate focused PR with schema and real-DOCX smoke evidence. Its PR body uses `Refs #1042`, not an auto-closing keyword.

## 5. Tracked follow-up

- [ ] 5.1 Ship `report-unresolved-table-cell-revisions` as the explicit unresolved grid/cell revision prerequisite.
- [ ] 5.2 Add only Word-oracle-supported tracked records and atomic accept/reject for both admitted operation families, including selective filters and foreign revision preservation.
- [ ] 5.3 Add tracked scenarios to follow-up OpenSpec deltas and round-trip tests. Do not close #1042 before both families have supported tracked paths; partial tracked PRs also use `Refs #1042` only.
