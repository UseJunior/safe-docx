## Context

`add-structural-table-row-operations` deliberately validates every target table as unmerged and rectangular. Issue #1040 is a separate opt-in expansion, not a relaxation of the default guard. Existing anchored addressing, row-level revisions, and accept/reject machinery remain the base.

## Decisions

### 1. Read-only logical occupancy

Each direct table row is mapped to logical grid columns from `w:tblGrid`, adding `gridBefore` and `gridAfter` offsets and advancing by each direct cell's `gridSpan` (default 1). A physical cell owns a half-open column interval. A `vMerge restart` begins a vertical rectangle; a continuation (including `w:vMerge` with omitted `w:val`) must occupy exactly the same interval as the active rectangle in the preceding row. The inventory records both the physical cell and the restart owner for every occupied grid slot. It never normalizes or rewrites source XML. Offset rows are inventoried but an operation is admitted only when the inserted or surviving row inherits an identical offset shape; other offset transformations remain unsupported.

The whole target table is inventoried before any revision ID is allocated or DOM node is changed. Invalid span arithmetic, holes not explicitly represented by offsets, overlapping ownership, an orphan continuation, a changed width mid-chain, or a non-rectangular two-dimensional merge fails with a typed coordinate-level diagnostic. Unknown topology revisions remain rejected. A bounded pending cell-property revision that changes only `vMerge` between `continue` and `restart` on an otherwise identical interval is admitted only after both its accept-state and reject-state occupancy maps independently validate; this permits a second tracked operation in one table without silently interpreting an arbitrary foreign topology revision.

### 2. Explicit compatibility boundary

Add an opt-in merge-aware mode to the existing anchored insert/delete request. Omitting the mode follows the present `resolveTableShape` path and still rejects merged tables. This prevents previously rejected documents from silently receiving a new interpretation. The merge-aware path may admit nested tables as opaque content in unaffected cells, but never chooses an anchor inside one, clones one into a new row, or edits its topology.

### 3. Unambiguous insertion

The new row inherits only the adjacent anchor row's physical-cell geometry, offsets, and safe formatting shell. Its horizontal `gridSpan` intervals must exactly tile the effective grid as required by the occupancy inventory. `cellTexts` has one value per new physical cell in physical order. A continuation cell requires exactly `''`; a nonempty value is `INVALID_ARGUMENT`, not a topology failure.

The insertion boundary rules are explicit:

| Position | New cell at an affected vertical-merge interval |
| --- | --- |
| Before a restart | Independent; the existing restart is unchanged. |
| After a restart or interior continuation with a continuation below | Continuation of that same rectangle, with empty text. |
| After a terminal continuation | Independent; the completed rectangle is unchanged. |

Other boundaries, including incompatible neighboring physical-cell geometry or offset shape, fail with `mergeBoundary`. Existing row header flags, authored content, bookmarks, fields, comments, and revisions are not cloned.

### 4. Unambiguous deletion

Deleting an interior or terminal continuation shortens its vertical rectangle. If the deleted row begins a vertical rectangle and the next row continues it, that next physical cell becomes the restart, preserving its interval and content while deleting only the targeted row. The operation refuses when promotion crosses incompatible geometry or existing topology revisions. Deleting the final direct row remains forbidden. Other rows/cells are left in place; only a required restart marker changes.

### 5. Native tracked representation

Use the existing `w:trPr > w:ins|w:del` row marker and paragraph/run revisions. A restart promotion on a surviving cell appears representable by a tracked property snapshot (`w:tcPrChange`) so Reject restores `continue` and Accept retains `restart`: a scratch three-row probe passed semantic accept/reject and the vendored Transitional schema, including omitted-`w:val` continuation. Row-marker resolution SHALL remove a now-empty `w:trPr`, so a source row with an authored-empty `w:trPr` normalizes to its schema-equivalent absence; exact source projection is asserted outside this explicit boundary. The Word Track Changes oracle remains mandatory before the representation is frozen: ECMA-376 also defines `w:cellMerge` for tracked vertical merge changes. If Word requires `w:cellMerge`, pause for a revised spec and corresponding accept/reject implementation rather than emitting a merely internal reversible redline. LibreOffice does not validate row-marker semantics.

### 6. Transaction and evidence

Validation and result construction happen on a clone; errors leave serialized source and revision-ID state untouched. The occupancy validator runs on clean, tracked accept-all, and tracked reject-all projections. The serialized subtree of each unaffected physical cell SHALL match the source under the same serializer, except a cell whose merge property must change for restart promotion. Tests check those subtrees, range endpoints, unique bookmarks, and the required final direct paragraph in every cell. Tests attach ECMA-376 5th-edition Part 1 sections 17.4.48 (`tblGrid`), 17.4.17 (`gridSpan`), 17.4.84 (`vMerge`), 17.4.65 (`tc`), 17.13.5.17/12 (row markers), 17.13.5.36 (`tcPrChange`), and 17.13.5.3 (`cellMerge`) where applicable.

## Spec-delta delivery

The approval-only proposal carries one coverage-enforced, currently true delta: default merged-table row edits still fail closed. A mapped regression lands in the same PR. An initial implementation PR can add read-only inventory plus experimental horizontal-span insertion/deletion (`SDX-MERGEDROW-01/02/05/06` and inventory scenarios) with mapped tests while vertical operations stay rejected. A later PR adds `SDX-MERGEDROW-03/04` for vertical continuation and restart cases only after the Word oracle; it also completes repeated-operation and unaffected-content evidence. The initial implementation MODIFIES `SDX-TABLEROW-07/08` to preserve default rejection and define the explicit horizontal-only boundary. `add-structural-table-row-operations` must archive first so `Ambiguous table topology fails closed` exists in canonical `docx-primitives` before this change MODIFIES it; strict validation alone does not catch that archive-order conflict.

## Alternatives considered

- **Implicitly enable merged rows in the old API:** rejected because callers currently rely on fail-closed behavior.
- **Clone raw neighbor rows:** rejected because bookmark identities, fields, comments, nested tables, and revision histories would leak into inserted content.
- **Infer merge intent from column text:** rejected because that cannot disambiguate extension from a new independent cell at a boundary.
- **Treat LibreOffice rendering as a revision oracle:** rejected because it strips row-level markers on import.

## Open questions for review

1. Is adjacent-row geometry plus empty continuation values enough to make insertion at every admitted boundary unique, or must callers supply a grid-span descriptor?
2. Does Word emit and round-trip `w:tcPrChange` or `w:cellMerge` for restart promotion under a tracked row deletion?
3. Does unchanged offset shape across the insertion/deletion neighborhood suffice for all admitted `gridBefore`/`gridAfter` cases, or should the first implementation restrict offsets to inventory-only?
