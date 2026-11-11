## 1. Evidence

- [x] 1.1 Reproduce the abort (RED) for a gridSpan merge, a split, a cell insert, a cell delete, gridBefore/gridAfter changes and a legacy hMerge merge through public `compareDocuments`.
- [x] 1.2 Probe row replacement and native `w:cellIns`/`w:cellDel` with LibreOffice (`runLibreOfficeOracle`) and the local Word accept/reject oracle; record results in the PR.

## 2. Implementation

- [x] 2.1 Replace skeleton-changed matched rows with a deleted original row followed by an inserted revised row before the table-topology guard (main body only).
- [x] 2.2 Pin that a paragraph moved into a replaced row publishes as a plain deletion and insertion, never a half move.
- [x] 2.3 Stop `markWholeTableRow` from adding a second marker of a kind the row's `w:trPr` already carries.

## 3. Verification

- [x] 3.1 Flip SDX-COMPTABLE-03; accept-all equals revised and reject-all equals original with both the comparison acceptor and docx-core `acceptChanges`/`rejectChanges`, on text and `bodyTableFootprint`; emitted-document schema gate passes.
- [x] 3.2 Keep vertical merges, pending cell-topology revisions and wrapped cells refused (SDX-COMPTABLE-09).
- [x] 3.3 LibreOffice accept/reject reproduce the revised and original tables.
- [ ] 3.4 Real NVCA smoke after merge.

## 4. Vertical merges (#1397)

- [x] 4.1 Reproduce the abort (RED) for two- and three-row merges created, extended, shrunk and split, a merge with a horizontal span, and deleting a merge-start or merge-end row.
- [x] 4.2 Replace each vertical-merge band (every merge chain the change touches, in both documents) as its original rows deleted then its revised rows inserted; keep bands minimal and leave bands holding unreplaceable cells to the guard.
- [x] 4.3 Accept/reject parity with both acceptors on text and `bodyTableFootprint`, schema gate, crossing bookmarks, and the comment anchors pinned at their pre-existing shape.
- [x] 4.4 LibreOffice accept/reject reproduce the revised and original tables, including row spans.
- [ ] 4.5 Real NVCA smoke after merge; Word reader evidence deferred.
