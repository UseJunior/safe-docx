## 1. Evidence and proposal

- [x] 1.1 Reproduce column, cell-merge, grid-width, whole-table, row, and text controls through public `compareDocuments`, accept/reject, and vendored schema validation.
- [x] 1.2 Peer-review the guard boundary, tagged table/row alignment, diagnostics, and statistics before implementation.
- [x] 1.3 Verify relevant ECMA-376 citations and shared synthetic DOCX fixture usage.

## 2. Supported row revisions and statistics

- [x] 2.1 Pin whole-row insert/delete output and exact accept/reject projections, without weakening existing text fidelity checks.
- [x] 2.2 Encode whole-table insert/delete with native markers on every row (including nested tables), exact projections, and schema-valid output.
- [x] 2.3 Remove a table in `trackChangesAcceptorAst` only if row-marker resolution changes that same table from at least one row container to none, counting direct `tr` and `sdt`/`customXml`-wrapped rows. Test insert-reject, delete-accept, nested, adjacent-table, and unrelated pre-existing empty-table controls with both acceptors and structural projections; include the surviving-wrapped-row control on both acceptors now that #1073/#1074 has landed.
- [x] 2.4 Count only comparison-generated row markers, including nested/whole-table rows, in new `CompareStats` fields and aggregate through selected stories.

## 3. Fail-closed unsupported topology

- [x] 3.1 Compare matched main-body table grids unconditionally and changed matched-row structural skeletons/occupancy intervals before serialization; leave text/property-only edits in `tblPrEx` and `sdt`-wrapped-row tables working.
- [x] 3.2 Throw a typed diagnostic for changed grid, cell, span, or offset shape; leave inputs and output allocation untouched. Preserve selected-story SDX-CMP-STORY-05 behavior.
- [x] 3.3 Keep ordinary cell text and safe property edits working; prove invalid column/cell/grid-width candidates are no longer returned.
- [x] 3.4 Schema-validate representative emitted outputs and run real public table DOCX smoke.
- [x] 3.5 Extend the publication projection gate with an ordered table-bearing top-level block-kind sequence and depth-first `(nestingDepth, rowContainerCount)` per-table structure check, counting wrapped rows but excluding ordinary paragraph-count differences, so a schema-valid empty-table shell cannot pass on text equivalence alone.

## 4. Delivery

- [x] 4.1 Map every initial OpenSpec scenario to Allure/conformance-tagged tests.
- [x] 4.2 Run full required pre-submit and strict OpenSpec validation.
- [ ] 4.3 Obtain dynamic implementation peer review, resolve findings, then ship a focused PR with automerge and exact-merge smoke.
