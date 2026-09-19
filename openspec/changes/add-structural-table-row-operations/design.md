# Design: Structural Table Row Operations

## Addressing and transaction boundary

The public operation resolves a paragraph bookmark to its nearest physical
`w:tc`, then requires the cell's row to be a direct `w:tr` child of a `w:tbl`
that is itself a direct child of `w:body`. A nested-table paragraph, a row inside
`w:sdt`/`w:customXml`/revision wrappers, and a table wrapped by a block content
control fail explicitly rather than selecting an outer row.

Validation describes the complete target table before allocating revision IDs
or mutating the DOM. Failures throw `SafeDocxError`: `UNSUPPORTED_EDIT` for
unsupported topology and `INVALID_ARGUMENT` for a bad anchor, wrong cell count,
duplicate deletion, or final-row deletion. `detail` has shape:

```ts
type TableRowEditDetail = {
  anchorId: string;
  tableIndex: number;
  rowIndex: number;
  cellIndex?: number;
  feature:
    | 'gridSpan' | 'vMerge' | 'gridBefore' | 'gridAfter'
    | 'nestedTable' | 'rowContainer' | 'cellContainer' | 'tblPrEx'
    | 'occupancy' | 'trailingParagraph' | 'topologyRevision'
    | 'lastRow' | 'nestedAnchor' | 'alreadyInserted' | 'alreadyDeleted';
};
```

For a failed tracked operation, `ctx.idState.nextId` is unchanged.

## Admitted table shape

Phase one admits only a rectangular table:

- `w:tblGrid` has at least one direct `w:gridCol`;
- every direct `w:tr` has exactly that many direct `w:tc` children;
- no direct row uses `w:gridBefore`, `w:gridAfter`, or `w:tblPrEx`;
- no direct cell uses `w:gridSpan` or `w:vMerge`;
- no direct cell contains a descendant `w:tbl`;
- no row/cell wrapper (`w:sdt`, `w:customXml`, `w:ins`, `w:del`, `w:moveFrom`,
  or `w:moveTo`) occurs where a direct row or cell is expected;
- no topology revision (`w:cellIns`, `w:cellDel`, `w:cellMerge`,
  `w:tblGridChange`, `w:tblPrExChange`, or a property snapshot that changes
  `gridSpan`, `vMerge`, `gridBefore`, or `gridAfter`) occurs; and
- every direct cell ends with a direct `w:p`.

Schema-permitted range markers may appear between direct rows and do not count
as rows. Other non-row element children fail with their table child index. These
restrictions are table-wide: inserting within a vertical-merge chain changes
cells above and below even when the anchor row has no marker.

Ordinary content revisions and row markers remain admissible. Insertion may be
anchored before/after an inserted or deleted row. Tracked deletion of a row that
already carries `w:trPr > w:ins` or `w:trPr > w:del` fails with
`alreadyInserted` or `alreadyDeleted` in phase one. This permits repeated
insertions around returned anchors without requiring intermediate accept/reject.

## Inserted-row construction

The anchor row supplies only a formatting shell. The constructor:

- copies `w:trPr` except `cnfStyle`, `tblHeader`, `hidden`, `divId`, `ins`, `del`,
  and `trPrChange`;
- creates the same number of direct cells and copies each `w:tcPr` except
  `cnfStyle`, `hideMark`, `cellIns`, `cellDel`, `cellMerge`, and `tcPrChange`;
- creates exactly one direct paragraph per cell, copying the first direct
  paragraph's `w:pPr` except `numPr`, `sectPr`, and `pPrChange`, and copying its
  paragraph-mark `w:rPr` except `ins`, `del`, and `rPrChange` as the new run's
  character formatting; and
- populates plain text from the caller's cell array.

It does not clone authored blocks, so fields, comments, drawings, content
controls, nested tables, bookmarks, and revision histories cannot leak into the
new row. Each new paragraph receives a fresh deterministic bookmark and the
operation returns `{ rowIndex, cellParagraphIds: string[] }`, allowing the next
insertion to anchor on the new row. Every new cell ends in its new direct `w:p`.

Insert-before row zero is allowed. `w:tblHeader` and cached `cnfStyle` flags are
not copied, so the new row does not silently become repeating header content;
document-view row indexes and derived column headers intentionally shift.

## Tracked topology and content

Tracked insertion attaches `w:ins` to the new row's `w:trPr`, marks each new
paragraph mark with `w:pPr > w:rPr > w:ins`, and wraps populated runs in
`w:ins`. Tracked deletion attaches `w:del` to the existing row's `w:trPr`, marks
its paragraph marks with `w:del`, and wraps existing run content in `w:del`
while converting `w:t` to `w:delText`. Row and content markers share author and
date; each receives its own ID from the caller's `RevisionIdState`.

`CT_TrPr` ordering places `w:ins`, then `w:del`, after the final base property
and before `w:trPrChange`. A row carries at most one marker from this primitive.

Accept/reject resolve row markers wherever their engine runs, including side
stories and nested tables:

| Marker | Accept | Reject |
| --- | --- | --- |
| `w:trPr > w:ins` | keep row; remove marker | remove row |
| `w:trPr > w:del` | remove row | keep row; remove marker |

Row removal occurs before generic content-wrapper sweeps. A selected row marker
removes the whole row, including unselected inner content revisions; those inner
markers are not separately counted. Selective filters leave foreign row markers
and rows untouched, including through `w:trPrChange` restoration.
`unresolvedRowRevisions` remains for compatibility and is zero for supported row
markers.

Projection assertions account for pre-existing revisions: reject-all of tracked
output equals reject-all of the source, and accept-all of tracked output equals
accept-all of the corresponding clean result.

## Deletion and range integrity

Clean and accepted deletion refuse to remove the table's final direct row. When
a bookmark or supported range-marker pair has exactly one endpoint inside a row
being removed, the surviving endpoint is also removed, matching the engines'
existing cross-paragraph cleanup. Every anchor in the removed row becomes
unresolvable; unrelated ranges remain unchanged.

## Conformance basis

- ECMA-376 5th edition, Part 1 §17.4.48 (`w:tblGrid`).
- ECMA-376 5th edition, Part 1 §17.4.65 (`w:tc` and trailing paragraph).
- ECMA-376 5th edition, Part 1 §17.4.84 (`w:vMerge`).
- ECMA-376 5th edition, Part 1 §17.13.5.17 (`w:ins`, inserted table row).
- ECMA-376 5th edition, Part 1 §17.13.5.12 (`w:del`, deleted table row).
- ECMA-376 5th edition, Part 1 §§17.13.5.18 and 17.13.5.14 (inserted and
  deleted run content).

LibreOffice strips row-level markers on import, so it is not the semantic oracle
for row topology. Vendored schema validation, the cross-implementation suite,
and accept/reject projection tests are the release gates. LibreOffice verifies
only that clean accepted/rejected results open and render.
