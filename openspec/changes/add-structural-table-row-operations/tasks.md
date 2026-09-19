## 1. Table-shape analysis

- [ ] 1.1 Add a body-level table/row resolver from an anchored paragraph.
- [ ] 1.2 Validate rectangular direct-row occupancy against `w:tblGrid` before mutation, including non-row/non-cell wrapper children.
- [ ] 1.3 Reject spans, vertical merges, row offsets, nested tables, `w:tblPrEx`, topology revisions, malformed cells, and nested anchors with typed coordinate diagnostics.
- [ ] 1.4 Admit pre-existing content revisions and non-anchor row markers so multiple tracked insertions can compose.

## 2. Row mutation primitives

- [ ] 2.1 Add clean insert-before/insert-after operations that build the enumerated safe-property formatting shell.
- [ ] 2.2 Strip cloned bookmarks and exclude fields, comments, drawings, content controls, nested tables, and revisions from inserted content.
- [ ] 2.3 Guarantee one direct populated paragraph per supplied cell, a trailing direct paragraph in every inserted cell, and fresh deterministic paragraph anchors returned to the caller.
- [ ] 2.4 Add clean row deletion while refusing to leave a table with no direct row.
- [ ] 2.5 Preserve bookmark/range validity when deletion removes exactly one endpoint and make removed anchors unresolvable.

## 3. Tracked topology and projections

- [ ] 3.1 Emit schema-ordered `w:trPr > w:ins|w:del` after base properties and before `w:trPrChange`, plus paragraph-mark and run-content revisions with shared author/date and distinct IDs.
- [ ] 3.2 Resolve inserted/deleted row markers in all four accept/reject directions in every story, including explicit whole-row selective-filter semantics.
- [ ] 3.3 Rewrite the completed row-level guard tests/spec expectations for supported resolution, selective foreign-marker preservation, and zero unresolved counts.
- [ ] 3.4 Update the conformance adapter to advertise the newly supported body-level cases.
- [ ] 3.5 Enable and pass the pinned cross-implementation deleted-row and inserted-row scenarios.

## 4. Tests and documentation

- [ ] 4.1 Add shared raw-OOXML fixture helpers rather than local package builders.
- [ ] 4.2 Cover clean insertion/deletion, chained tracked insertions, accept/reject topology, content metadata, formatting-shell exclusions, bookmark stripping, range repair, and transactional failures.
- [ ] 4.3 Cover vMerge, gridSpan, offsets, `w:tblPrEx`, row/cell wrappers, nested tables, trailing paragraphs, topology revisions, heterogeneous rows, duplicate row markers, and final-row deletion.
- [ ] 4.4 Add Word/LibreOffice compatibility evidence proportional to the documented oracle boundary.
- [ ] 4.5 Document the API and the bounded phase-one non-goals.

## 5. Gates

- [ ] 5.1 Run the full repository pre-submit command.
- [ ] 5.2 Run `openspec validate add-structural-table-row-operations --strict`.
- [ ] 5.3 Obtain Claude Fable peer review and resolve all actionable findings.
- [ ] 5.4 Correct the existing ECMA registry's table-row clauses from §17.13.5.16/19 to §17.13.5.12/17, update generated conformance artifacts, and pass citation/document checks.
