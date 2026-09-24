## Context

`w:tblGrid` defines logical columns, while each direct `w:tr` can tile that grid with different `w:tc` widths (`w:gridSpan`) and explicit leading/trailing gaps (`w:gridBefore`/`w:gridAfter`). `w:vMerge` makes the same horizontal interval one rectangle across rows. The #1040 occupancy inventory is the prerequisite; a physical-cell index is not a stable column address.

## Decisions

### 1. Request and addressing

`insertTableColumn` takes a bookmark anchored inside a direct body table, a zero-based logical boundary `columnIndex` in `[0, gridColumns]`, a positive `widthTwips`, and one explicit `rowActions` entry per direct row:

```ts
type ColumnInsertRowAction =
  | { kind: 'cell'; text: string }
  | { kind: 'growCell'; side: 'left' | 'right' }
  | { kind: 'growOffset'; side: 'before' | 'after' };
```

The action identifies the transformation, not merely whether text is present. `deleteTableColumn` takes an anchor and a zero-based logical column in `[0, gridColumns-1]`. Delete does not infer replacement text.

The API reports the new grid width and anchors of newly created physical cells. It does not accept raw `w:tc` indexes or silently redistribute widths. A one-column table cannot have its final column removed.

### 2. Deterministic row transform

For insertion, `growCell` names the physical cell immediately to the requested side of a boundary; when a boundary lies strictly inside a span, both sides name that same cell and `side` is ignored because the output is identical. This permits a full-width title cell to grow when a column is prepended or appended, and permits widening a neighboring cell at any shared edge. `cell` creates a new physical cell at a cell or offset edge from a safe adjacent formatting shell. `growOffset` extends the named leading/trailing offset only at that offset's edge. At a shared cell/offset edge, `cell` and `growOffset` are both valid but are disambiguated by the explicit action. A geometry/action mismatch is `INVALID_ARGUMENT` with row/column/cell coordinates. Malformed or revised ownership is `UNSUPPORTED_EDIT` before mutation.

For deletion, a column inside a span wider than one shrinks that cell's span. A width-one cell covering the column is removed together with its authored content; a deleted offset slot decrements `gridBefore` or `gridAfter`. The method name makes removal of authored content explicit, so no second loss-of-content flag is needed; however, the clean first phase rejects removal of a cell containing pending revision records rather than silently discarding unresolved history. Cross-cell bookmark and comment range endpoints use the existing row-deletion cleanup policy: both halves of a broken pair are removed. No row may be left without a physical cell, and every surviving cell must end in a direct paragraph. A vertical rectangle is transformed atomically across its restart and all continuations or rejected; partial removal, orphan continuations, and non-rectangular survivors are not admitted. The first clean phase rejects any nested table in the target table, aligning with the existing row primitive; a later phase may treat nested content in unaffected cells as opaque only when both sibling APIs share that contract.

Width bookkeeping is explicit. A new cell receives `w:tcW w:type="dxa"` equal to the inserted grid-column `widthTwips`; this may coexist with `pct`/`auto` siblings and makes no pixel-layout promise. A grown or shrunk cell with dxa `tcW` adds or subtracts that width from its existing value. A fixed dxa `w:tblW` likewise grows or shrinks by the column width. Existing `pct`, `auto`, and `nil` widths remain unchanged even when they omit `w`, and an absent `tcW` remains absent. No other grid-column width is redistributed. Width arithmetic applies only when the affected dxa `w` is an integer twips value. Deletion subtracts the deleted `w:gridCol/@w`; if that attribute is omitted or non-integer, the operation fails. If an affected cell or table width has an omitted `type`, or an affected dxa width that would change has an omitted `w`, a non-integer or universal-measure `w`, or a negative result, the operation fails before mutation with `UNSUPPORTED_EDIT` (`feature: 'width'`). These numeric updates are tested independently from reader layout, which is not a pixel-equivalence claim.

### 3. Tracked representation and resolution gate

The candidate encoding is a `w:tblGridChange` snapshot of the original grid plus `w:cellIns`/`w:cellDel` on newly inserted/deleted physical cells and `w:tcPrChange`/`w:trPrChange` for span/offset mutations. These are *candidate* records, not a promise that arbitrary mixtures are Word-interoperable. The vendored schema makes `tblGridChange` a `CT_Markup` record with `w:id` but no `w:author` or `w:date`; `cellIns`/`cellDel`/`cellMerge` are a one-of group inside `tcPr` before `tcPrChange`. A Word Track Changes oracle must cover at least: insertion at a simple boundary, insertion inside a horizontal span, deletion of a width-one cell, deletion inside a span, and a vertical rectangle. Compare Word's package parts with the candidate shape and adjust the spec before implementation if they differ.

The current accept/reject engine silently retains `tblGridChange` and `cellIns`/`cellDel` without reporting them as unresolved, even when paragraph content revisions resolve. A separate prerequisite change, `report-unresolved-table-cell-revisions`, must add an explicit result field and MCP response contract for foreign/unresolvable grid/cell records before tracked column output ships; `unresolvedRowRevisions` cannot be reused because its canonical contract requires zero. Subsequent tracked-column implementation must resolve emitted records semantically or report the whole unit unresolved.

Correlation is table-scoped, not by a nonexistent OOXML operation ID: a table's single `tblGridChange` together with every `cellIns`, `cellDel`, span-affecting `tcPrChange`, and offset-affecting `trPrChange` in that table forms one candidate unit. Accept or reject resolves that unit atomically only when the filter selects every member. If the table holds more than one grid snapshot or the filter selects a strict subset, resolution is refused and every record remains intact with a nonzero unresolved count. Intermediate non-rectangular states are not observable.

Reject-all must reproduce the normalized source topology and accept-all the clean edited topology. Selective filters must leave foreign revision records intact. A pre-existing pending grid/cell/topology revision is rejected unless both accept and reject occupancy states are independently valid and the operation has the same unique interpretation in each. In the first clean-only phase, any supplied `RevisionContext` is rejected with `UNSUPPORTED_EDIT` before mutation.

### 4. Validation and evidence

Build the entire transformation plan read-only against the existing DOM before allocating IDs or mutating it. Apply only after all row actions, widths, and content-loss guards pass; preserving existing element references is part of the core API contract. Validate the occupancy map before editing and on clean, accept-all, and reject-all outputs when tracked support exists. Test exact grid-column count/widths, physical-cell intervals, vertical owners, range/bookmark identities, trailing cell paragraphs, unchanged cell subtrees, and schema validity. Use real public merged-table documents for reader smoke; LibreOffice rendering is not a tracked-cell semantic oracle.

### 5. Delivery phases

1. Clean-only insertion/deletion for simple cells and horizontal `gridSpan`, with explicit `rowActions`; reject offsets, `vMerge`, legacy `hMerge`, nested tables, pending topology revisions, and tracked requests. The initial OpenSpec delta contains only scenarios this phase implements and maps to tests.
2. Clean offset and vertical-rectangle transformations, admitting only consistent whole-rectangle plans in a follow-up delta.
3. Independently ship unresolved grid/cell revision reporting; then add tracked output in another delta only after the Word oracle and atomic grid/cell revision resolution are implemented.

## Alternatives considered

- Treat every row as one cell per column: corrupts `gridSpan` and offsets.
- Split a span implicitly on insertion: changes authored cell content/formatting and has no unique placement for a new cell.
- Rewrite the table cleanly and compare it afterward: loses native cell/grid revision intent and may alter unrelated XML.
- Emit only `w:tblGridChange`: does not describe per-row cell existence or span changes.

## Open questions for peer review

1. Does Word's tracked column edit actually use the proposed `tblGridChange` + cell/property records in all cases? The encoding remains a candidate until the oracle.
2. Can operation IDs pair an authorless grid snapshot with all cell/property records without collision or ambiguous selective filtering? If not, tracked selective column edits must remain unsupported.
