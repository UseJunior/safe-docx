## 1. Contract and oracle

- [ ] 1.1 Peer-review the logical-column API and per-row action ambiguity; revise the proposal before implementation.
- [ ] 1.2 Confirm ECMA-376 5th-edition sections and vendored schema shapes for `tblGridChange`, `cellIns`, `cellDel`, `tcPrChange`, and `trPrChange`.
- [ ] 1.3 Capture Word Track Changes oracles for simple and merged-column insert/delete; do not freeze the tracked encoding first.

## 2. Read-only planning and clean edits

- [ ] 2.1 Depend on the #1040 occupancy inventory; reject malformed grids, wrapped rows/cells, pending topology revisions, and nested anchors with coordinates.
- [ ] 2.2 Plan every row's span/cell/offset transformation and validate explicit `rowActions` before mutation.
- [ ] 2.3 Implement clean-only simple/horizontal-span insert/delete first; reject offsets, vertical merges, nested tables, and any supplied `RevisionContext` with coordinates.
- [ ] 2.3a Extend clean edits to offsets and whole vertical rectangles only after phase-one projections and invariants hold.
- [ ] 2.4 Prove transactional failures, bookmark/range validity, nested-table rejection in phase 1, valid trailing cell paragraphs, and explicit `tcW`/`tblW` width bookkeeping.

## 3. Tracked edits and projections

- [ ] 3.1 Ship a separate `report-unresolved-table-cell-revisions` change before tracked columns: accept/reject and MCP SHALL report foreign `tblGridChange`, `cellIns`, and `cellDel` instead of silently retaining them.
- [ ] 3.1a Implement only the Word-oracle-supported native revision representation with atomic per-table grid/cell/property resolution and table-scoped correlation; do not invent a shared OOXML operation ID.
- [ ] 3.2 Prove accept-all equals clean output, reject-all equals normalized source, and selective filters preserve foreign records.
- [ ] 3.3 Validate emitted document XML against the vendored Transitional schema and smoke real public merged-table DOCX files in Word/LibreOffice as appropriate; schema validity alone is not a Word revision oracle.

## 4. Delivery

- [ ] 4.1 Land the initial clean simple/horizontal-span OpenSpec scenarios with mapped conformance-tagged tests; add offset/vertical and tracked scenarios only in their implementation PRs.
- [ ] 4.2 Run the full required pre-submit sequence and strict OpenSpec validation.
- [ ] 4.3 Obtain dynamic peer review, resolve findings, then ship through a focused PR and exact-merge smoke.
