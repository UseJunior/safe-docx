## Context and reproduced evidence

The current tagged serializer knows how to mark an original-only or revised-only `w:tr` with `w:trPr/w:del` or `w:trPr/w:ins`. It does not encode grid/cell topology changes as native table revisions. A synthetic `buildDocxFromBodyXml` probe against main after #1071 found:

| Input difference | Current public result | Vendored schema |
| --- | --- | --- |
| Add a third `gridCol` and one cell per row | success; `w:ins` under `tblGrid` and direct `tr` | invalid |
| Merge two cells in one row via `gridSpan` | success; direct extra `tc` under `tr` | invalid |
| Change one `gridCol/@w` only | success; `w:del`/`w:ins` under `tblGrid` | invalid |
| Add a whole row | success; `w:trPr/w:ins` | valid |
| Add or delete a whole table | success; `w:ins`/`w:del` under `w:body` | invalid |
| Change one cell's text only | success | valid |

The main risk is not merely poor redline readability: a caller receives a malformed DOCX while `CompareResult.stats` reports ordinary insertion/deletion ranges. The accept/reject text checks do not guarantee WML schema validity or native table semantics.

## Decisions

### 1. Fail-closed table geometry gate

For the main body, inspect the original/revised tagged tree before serialization. Match table nodes and row nodes through the existing `both` tagged alignment, not by raw row ordinal: an original-only or revised-only row is a supported whole-row edit and must not shift the coordinate comparison of later rows. Unmatched whole tables are supported as native structural insertions/deletions (decision 2). For matched tables, compare normalized direct `tblGrid` `gridCol` sequences (count and integer width attributes) unconditionally, including when no rows matched. Reject changed count and width with distinct features. For matched rows, compare direct physical-cell occupancy intervals, including `gridSpan`, `gridBefore`, and `gridAfter`, and reject cell insertion/deletion or merge/split. Use the #1040 occupancy reader where it fits. "Changed" for inventory purposes means a structural-skeleton difference: grid sequence, physical-cell count, span and offset values, `vMerge`/`hMerge`, or row/cell wrapper shape. Text-only and safe-property edits do not trigger inventory; `w:tblPrEx` is a row-level property exception, not a wrapper or skeleton change. An unchanged structural skeleton must not fail merely because it contains unsupported but identical occupancy structures (including `tblPrEx` or `sdt`-wrapped rows); if a differing skeleton cannot be inventoried, reject rather than publishing candidate XML.

Normalize `vMerge` and `hMerge` before comparing the skeleton: no element is a distinct absent state, while an element with omitted `w:val` and one with explicit `continue` mean the same continuation state. Do not reject ordinary text changes or safe row/cell property changes that leave the grid and physical intervals unchanged. Pending table-topology revision records in either input must be handled explicitly: preserve them only when the existing comparison can prove both source projections, otherwise reject. Selected header/footer stories retain SDX-CMP-STORY-05: a scaffold change that cannot be represented yields a precise `unrepresentedChanges` entry (or its existing typed diagnostic), with valid output and the story left unchanged. This change does not broaden body-only error coordinates to side stories or modify the active story-authoring contract.

Throw `UnsupportedTableTopologyComparisonError` before mutation/publication, with `partPath`, zero-based `tableIndex`, optional `rowIndex`/`cellIndex`/`columnIndex`, and a `feature` discriminant (`tblGrid`, `tblGridWidth`, `cellCount`, `gridSpan`, `gridBefore`, `gridAfter`, `vMerge`, `hMerge`, `topologyRevision`, `occupancy`, `emptyTable`, `tableContainer`, `projection`). `emptyTable` names an unmatched zero-row table, and `tableContainer` names an unmatched table or side-only block container whose wrapped rows, pre-existing row markers, nested table, or other unsupported markup prevents faithful native projection. `projection` is reserved for the final document-level footprint mismatch and uses table index -1 because no individual table is known. Matched cell-topology revision-record presence changes fail as `topologyRevision`; unchanged pending records pass through only when the existing publication projections succeed. Inputs remain untouched and no malformed DOCX buffer is returned. A final emitted-schema test guards against regression, but runtime does not rely on an external `xmllint` binary.

### 2. Whole-table revisions and structural row statistics

For an unmatched whole table in the main body only, keep the table container and grid unwrapped and mark each physical row with native `w:trPr/w:ins` or `w:trPr/w:del` plus the existing paragraph-mark/content revisions. Apply recursively to rows of nested tables; accept and reject must recreate the two source projections and emitted XML must be schema-valid. A table with zero rows (`emptyTable`), wrapped physical rows, pre-existing row revisions, or other markup that prevents faithful native projection (`tableContainer`) fails closed; never publish a direct `w:ins`/`w:del` wrapper around `w:tbl`. Selected-story whole-table additions/deletions remain on the SDX-CMP-STORY-05 unrepresented/typed-diagnostic path.

The comparator's `trackChangesAcceptorAst` currently leaves an empty `w:tbl` shell for the proposed encoding, although it is schema-valid. After resolving row markers, remove a `w:tbl` only when that same table had at least one row container before resolution and has none after, counting direct `w:tr`, `w:sdt`-wrapped rows, and `w:customXml`-wrapped rows. Preserve a table that was already empty or still contains any wrapped row. Apply this to nested and adjacent tables without deleting unrelated containers. Test both acceptors with structural projections: table-bearing top-level block order, table count, and row count, not merely text. Include controls for an unrelated pre-existing empty table and a nested table emptied inside a surviving outer row on both engines. The wrapped-row-survival control targets the comparator acceptor; its docx-core leg belongs to #1073 until that fix lands. The publication shadow gate should additionally compare a structural footprint: ordered main-body **table-bearing** top-level block kinds and, for each table depth-first, its `(nestingDepth, rowContainerCount)` with direct and wrapped row containers counted. Ordinary paragraph-mark resolution may retain an empty `w:p`, so counting all top-level paragraphs would falsely reject existing text/bookmark comparisons; non-table blocks are deliberately excluded. The narrowed footprint still detects a schema-valid empty table shell without confusing inner and outer rows. The existing docx-core `removeTableRowAndEmptyTable` direct-`w:tr` emptiness rule has a separately discovered data-loss bug for wrapped rows; do not copy that rule into the comparator.

Add `insertedTableRows` and `deletedTableRows` to `CompareStats`. Count only comparison-generated `w:trPr/w:ins` and `w:trPr/w:del` markers, using the existing private comparison-revision marker before it is stripped from final XML. Count nested-table rows and N rows in an N-row whole-table insertion/deletion, but do not count pre-existing row revisions or infer rows from paragraph insertion ranges. Aggregate the new counts across selected stories; preserve the existing `tagged-token-v1` meaning of atom/text metrics. Successful results have no unsupported column/cell topology, so no column/cell count is fabricated. A fail-closed exception carries the rejected topology type separately from stats because there is no `CompareResult` in that case.

### 3. Delivery phases

1. Pin existing whole-row insertion/deletion and whole-table insertion/deletion with their accept/reject projections; add the separate row counters.
2. Guard main-body unsupported table-grid and matched-row cell topology before serialization, with exact structured diagnostics. Verify table-width-only changes also fail closed until a native encoding is supported; preserve side-story SDX-CMP-STORY-05 behavior.
3. Later, after Word-authored column/cell revision oracles and core accept/reject support, admit only proven native forms and add separate column/cell structural counters in a new delta.

## Alternatives considered

- Return a successful `unrepresentedChanges` entry for malformed grid/cell output: misleading because the returned DOCX itself is invalid and `UnrepresentedChange` currently has section-specific coordinates.
- Treat extra/missing cells as paragraph text changes: loses table geometry and can emit schema-invalid direct `tc` nodes.
- Insert `w:tblGridChange` and `w:cellIns` from schema shapes alone: schema validity does not establish Word or accept/reject semantics.
- Compare rows by ordinal: one valid row insertion would make later rows look like cell-topology changes.
- Reject all unmatched whole tables: it would prevent a common structural edit even though the native row-revision form can represent it.

## Questions for peer review

1. Does the existing tagged alignment reliably identify matched tables/rows under all supported row edits, or is a narrower preflight matching strategy needed?
2. Does the #1040 occupancy inventory reject ordinary comparison fixtures (e.g. tables without explicit `tblGrid`), requiring a comparison-specific normalization rather than blanket use?
3. Are `insertedTableRows`/`deletedTableRows` the right public stats surface, or should they be nested to avoid bloating `CompareStats`?
4. Which pending table-topology revisions in inputs can safely remain opaque without false positives or loss of provenance?
5. Can native per-row revisions on every row of a whole table preserve accept/reject projections for nested tables and all relevant table properties, or must a narrower whole-table subset be explicitly documented?
