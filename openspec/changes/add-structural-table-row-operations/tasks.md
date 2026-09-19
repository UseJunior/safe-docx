## 1. Table-shape analysis

- [ ] 1.1 Add a body-level table/row resolver from an anchored paragraph.
- [ ] 1.2 Validate rectangular direct-row occupancy against `w:tblGrid` before mutation.
- [ ] 1.3 Reject spans, vertical merges, row offsets, nested tables, revisions, malformed cells, and nested anchors with coordinate diagnostics.

## 2. Row mutation primitives

- [ ] 2.1 Add clean insert-before/insert-after operations that build a formatting-only row shell.
- [ ] 2.2 Strip cloned bookmarks and exclude fields, comments, drawings, content controls, nested tables, and revisions from inserted content.
- [ ] 2.3 Guarantee one direct populated paragraph per supplied cell and a trailing direct paragraph in every inserted cell.
- [ ] 2.4 Add clean row deletion while refusing to leave a table with no direct row.

## 3. Tracked topology and projections

- [ ] 3.1 Emit schema-ordered `w:trPr > w:ins` and `w:trPr > w:del` metadata.
- [ ] 3.2 Resolve body-level inserted/deleted row markers in all four accept/reject directions, including selective filters.
- [ ] 3.3 Preserve unsupported side-story row markers and accurate `unresolvedRowRevisions` counts.
- [ ] 3.4 Update the conformance adapter to advertise the newly supported body-level cases.

## 4. Tests and documentation

- [ ] 4.1 Add shared raw-OOXML fixture helpers rather than local package builders.
- [ ] 4.2 Cover clean insertion/deletion, tracked accept/reject topology, metadata, formatting-shell retention, bookmark stripping, and transactional failures.
- [ ] 4.3 Cover vMerge, gridSpan, nested-table, trailing-paragraph, existing-revision, heterogeneous-row, and final-row deletion guards.
- [ ] 4.4 Add Word/LibreOffice compatibility evidence proportional to the documented oracle boundary.
- [ ] 4.5 Document the API and the bounded phase-one non-goals.

## 5. Gates

- [ ] 5.1 Run the full repository pre-submit command.
- [ ] 5.2 Run `openspec validate add-structural-table-row-operations --strict`.
- [ ] 5.3 Obtain Claude Fable peer review and resolve all actionable findings.
