## 1. Table-shape analysis

- [x] 1.1 Add a body-level table/row resolver from an anchored paragraph.
- [x] 1.2 Validate rectangular direct-row occupancy against `w:tblGrid` before mutation, including non-row/non-cell wrapper children.
- [x] 1.3 Extend `SafeDocxError` additively with `detail?: unknown`, then reject spans, vertical merges, row offsets, nested tables, `w:tblPrEx`, topology revisions, malformed cells, and nested anchors with typed coordinate diagnostics.
- [x] 1.4 Admit pre-existing content revisions and non-anchor row markers so multiple tracked insertions can compose.

## 2. Row mutation primitives

- [x] 2.1 Add clean insert-before/insert-after operations that build the enumerated safe-property formatting shell.
- [x] 2.2 Strip cloned bookmarks and exclude fields, comments, drawings, content controls, nested tables, and revisions from inserted content.
- [x] 2.3 Guarantee one direct populated paragraph per supplied cell, a trailing direct paragraph in every inserted cell, and fresh deterministic paragraph anchors returned to the caller.
- [x] 2.4 Add clean row deletion while refusing to leave a table with no direct row.
- [x] 2.5 Preserve bookmark/range validity when deletion removes exactly one endpoint and make removed anchors unresolvable.

## 3. Tracked topology and projections

- [x] 3.1 Emit schema-ordered `w:trPr > w:ins|w:del` after base properties and before `w:trPrChange`, plus paragraph-mark and run-content revisions with shared author/date and distinct IDs.
- [x] 3.2 Resolve inserted/deleted row markers in all four accept/reject directions in every story, including explicit whole-row selective-filter semantics.
- [x] 3.3 Rewrite `packages/docx-core/test-primitives/row_level_revision_guard.test.ts` (`SDX-ROWREV-01/02/06`), `packages/docx-mcp/src/tools/guard_row_level_revision_resolution.test.ts` (`SDX-ROWREV-MCP-01/02`), and `cross-implementation-suite.test.ts` (`XIMPL-08`) for supported resolution, selective foreign-marker preservation, and zero unresolved counts.
- [x] 3.4 Update the conformance adapter to advertise the newly supported body-level cases.
- [x] 3.5 Enable and pass the pinned cross-implementation deleted-row and inserted-row scenarios.
- [x] 3.6 Teach the primitives coverage validator to mark an archived scenario `superseded` when a later delta removes or modifies its requirement, exclude it from that archived feature's strict missing check, and cover the behavior with a validator unit test.

## 4. Tests and documentation

- [x] 4.1 Add shared raw-OOXML fixture helpers rather than local package builders.
- [x] 4.2 Cover clean insertion/deletion, chained tracked insertions, accept/reject topology, content metadata, formatting-shell exclusions, bookmark stripping, range repair, and transactional failures.
- [x] 4.3 Cover vMerge, gridSpan, offsets, `w:tblPrEx`, row/cell wrappers, nested tables, trailing paragraphs, topology revisions, heterogeneous rows, duplicate row markers, and final-row deletion.
- [x] 4.4 Add Word/LibreOffice compatibility evidence proportional to the documented oracle boundary (six generated DOCX fixtures opened and rendered through LibreOffice; the pinned cross-implementation row suite passed 9/9; Microsoft Word remains outside the automated oracle boundary).
- [x] 4.5 Document the API and the bounded phase-one non-goals.

## 5. Gates

- [x] 5.1 Run the full repository pre-submit command.
- [x] 5.2 Run `openspec validate add-structural-table-row-operations --strict`.
- [x] 5.3 Obtain Claude Fable peer review and resolve all actionable findings (approved without blockers in round 5 after resolving the round-4 schema-order and story-wide range-repair findings).
- [x] 5.4 Correct the existing ECMA registry's table-row clauses from §17.13.5.16/19 to §17.13.5.12/17, update generated conformance artifacts, and pass citation/document checks.
- [x] 5.5 Archive the change on a scratch OpenSpec copy and verify totals `+3, ~1, -1`, all eight `SDX-TABLEROW` scenarios in the resulting canonical spec, and zero superseded `Unresolvable Row-Level Revision Preservation` requirements.
