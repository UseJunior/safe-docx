import { insertSingleParagraphBookmark, type BookmarkReservation } from './bookmarks.js';
import { getDirectChildrenByName } from './dom-helpers.js';
import {
  applyWidthUpdates, createTableCell, failTableEdit, hasPendingRevision,
  plannedCellWidthChange, plannedWidthChange, setCellSpan, setTableAttr,
  tableAttr, tableEditTarget, type TableEditDetail,
} from './table_edit_common.js';
import { inventoryTableOccupancy, type OccupiedCell, type OccupiedRow } from './table_occupancy.js';
import { removeOrphanedRangeEndpointsForSubtree } from './table_rows.js';
import type { RevisionContext } from './track-changes-emitter.js';

export type SplitTableCellParams = {
  anchorParagraphId: string;
  /** Boundary before this zero-based logical grid column. */
  splitColumnIndex: number;
  existingSide: 'left' | 'right';
  newCellText: string;
};
export type AbsorbTableCellParams = {
  anchorParagraphId: string;
  /** Existing adjacent physical cell that retains its content and absorbs the target. */
  absorbSide: 'left' | 'right';
};
export type TableCellInterval = { start: number; end: number };
export type SplitTableCellResult = {
  tableIndex: number; rowIndex: number;
  retained: TableCellInterval; created: TableCellInterval;
  newParagraphId: string;
};
export type AbsorbTableCellResult = {
  tableIndex: number; rowIndex: number; absorbedInto: TableCellInterval;
};

function detail(anchorId: string, tableIndex: number, row: OccupiedRow, cell: OccupiedCell, columnIndex: number): TableEditDetail {
  return { anchorId, tableIndex, rowIndex: row.rowIndex, cellIndex: cell.cellIndex, columnIndex, feature: 'argument' };
}

function rejectPendingRow(row: OccupiedRow, info: TableEditDetail): void {
  const trPr = getDirectChildrenByName(row.element, 'trPr')[0];
  if (trPr && (getDirectChildrenByName(trPr, 'ins').length || getDirectChildrenByName(trPr, 'del').length)) {
    failTableEdit('UNSUPPORTED_EDIT', 'Pending row insertion or deletion is unsupported for cell edits', { ...info, feature: 'topologyRevision' });
  }
}

function gridWidth(columns: Element[], start: number, end: number, info: TableEditDetail): number {
  let width = 0;
  for (let index = start; index < end; index++) {
    const raw = columns[index] ? tableAttr(columns[index]!, 'w') : null;
    if (raw === null || !/^\d+$/.test(raw)) {
      failTableEdit('UNSUPPORTED_EDIT', 'Affected grid columns need integer twip widths', { ...info, feature: 'width' });
    }
    const next = Number(raw);
    if (!Number.isSafeInteger(next) || next <= 0 || !Number.isSafeInteger(width + next)) {
      failTableEdit('UNSUPPORTED_EDIT', 'Affected grid width is outside the supported range', { ...info, feature: 'width' });
    }
    width += next;
  }
  return width;
}

function cellPreferredWidth(cell: Element, info: TableEditDetail): Element | undefined {
  const tcPr = getDirectChildrenByName(cell, 'tcPr')[0];
  const widths = tcPr ? getDirectChildrenByName(tcPr, 'tcW') : [];
  if (widths.length > 1) {
    failTableEdit('UNSUPPORTED_EDIT', 'Duplicate cell preferred widths are unsupported', { ...info, feature: 'width' });
  }
  return widths[0];
}

function checkedSplitWidth(cell: OccupiedCell, expected: number, info: TableEditDetail): Element | undefined {
  const preferred = cellPreferredWidth(cell.element, info);
  if (!preferred) return undefined;
  const type = tableAttr(preferred, 'type');
  if (type === 'pct') failTableEdit('UNSUPPORTED_EDIT', 'Percentage cell width cannot be split without an allocation rule', { ...info, feature: 'width' });
  const update = plannedWidthChange(preferred, 0, info);
  if (update && update.next !== expected) {
    failTableEdit('UNSUPPORTED_EDIT', 'Preferred cell width does not match its grid interval', { ...info, feature: 'width' });
  }
  return update?.element;
}

/**
 * Split a horizontal cell at an interior grid boundary without changing the table grid.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.48
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.71
 * @see #1042
 */
export function splitTableCell(doc: Document, params: SplitTableCellParams, ctx?: RevisionContext, reservation?: BookmarkReservation): SplitTableCellResult {
  const { anchorParagraphId: anchorId, splitColumnIndex: boundary, existingSide, newCellText } = params;
  const initial = { anchorId, tableIndex: -1, rowIndex: -1, columnIndex: boundary, feature: 'argument' };
  if (ctx) failTableEdit('UNSUPPORTED_EDIT', 'Tracked cell edits are not supported', { ...initial, feature: 'revisionContext' });
  const shape = tableEditTarget(doc, anchorId, boundary, 'cell');
  const { anchorRow: row, anchorCell: cell } = shape;
  const info = detail(anchorId, shape.tableIndex, row, cell, boundary);
  rejectPendingRow(row, info);
  if (!Number.isSafeInteger(boundary) || boundary <= cell.start || boundary >= cell.end) {
    failTableEdit('INVALID_ARGUMENT', 'Split boundary must be strictly inside the target cell interval', { ...info, feature: 'splitColumnIndex' });
  }
  if (existingSide !== 'left' && existingSide !== 'right') {
    failTableEdit('INVALID_ARGUMENT', 'existingSide must be left or right', { ...info, feature: 'existingSide' });
  }
  if (typeof newCellText !== 'string') {
    failTableEdit('INVALID_ARGUMENT', 'newCellText must be a string', { ...info, feature: 'newCellText' });
  }
  if (/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(newCellText)) {
    failTableEdit('INVALID_ARGUMENT', 'newCellText contains a character forbidden by XML 1.0', { ...info, feature: 'newCellText' });
  }
  const leftWidth = gridWidth(shape.columns, cell.start, boundary, info);
  const rightWidth = gridWidth(shape.columns, boundary, cell.end, info);
  const originalWidth = checkedSplitWidth(cell, leftWidth + rightWidth, info);
  const retained = existingSide === 'left'
    ? { start: cell.start, end: boundary } : { start: boundary, end: cell.end };
  const created = existingSide === 'left'
    ? { start: boundary, end: cell.end } : { start: cell.start, end: boundary };
  const retainedWidth = existingSide === 'left' ? leftWidth : rightWidth;
  const createdWidth = existingSide === 'left' ? rightWidth : leftWidth;
  const newCell = createTableCell(doc, cell.element, newCellText, createdWidth);
  if (existingSide === 'left') row.element.insertBefore(newCell.cell, cell.element.nextSibling);
  else row.element.insertBefore(newCell.cell, cell.element);
  setCellSpan(cell, retained.end - retained.start);
  setCellSpan({ element: newCell.cell }, created.end - created.start);
  if (originalWidth) setTableAttr(originalWidth, 'w', retainedWidth);
  inventoryTableOccupancy(shape.table);
  const newParagraphId = insertSingleParagraphBookmark(doc, newCell.paragraph, reservation);
  return { tableIndex: shape.tableIndex, rowIndex: row.rowIndex, retained, created, newParagraphId };
}

/**
 * Absorb and discard a physical cell into an adjacent same-row sibling. The target content is lost.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.48
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.71
 * @see #1042
 */
export function absorbTableCell(doc: Document, params: AbsorbTableCellParams, ctx?: RevisionContext): AbsorbTableCellResult {
  const { anchorParagraphId: anchorId, absorbSide } = params;
  const initial = { anchorId, tableIndex: -1, rowIndex: -1, columnIndex: -1, feature: 'argument' };
  if (ctx) failTableEdit('UNSUPPORTED_EDIT', 'Tracked cell edits are not supported', { ...initial, feature: 'revisionContext' });
  const shape = tableEditTarget(doc, anchorId, -1, 'cell');
  const { anchorRow: row, anchorCell: cell } = shape;
  const info = detail(anchorId, shape.tableIndex, row, cell, cell.start);
  rejectPendingRow(row, info);
  if (absorbSide !== 'left' && absorbSide !== 'right') {
    failTableEdit('INVALID_ARGUMENT', 'absorbSide must be left or right', { ...info, feature: 'absorbSide' });
  }
  if (row.cells.length === 1) failTableEdit('INVALID_ARGUMENT', 'Cannot remove the final physical cell', { ...info, feature: 'lastCell' });
  const sibling = row.cells[cell.cellIndex + (absorbSide === 'left' ? -1 : 1)];
  if (!sibling || (absorbSide === 'left' ? sibling.end !== cell.start : sibling.start !== cell.end)) {
    failTableEdit('INVALID_ARGUMENT', 'No adjacent physical cell on the requested side', { ...info, feature: 'absorbSide' });
  }
  if (hasPendingRevision(cell.element)) {
    failTableEdit('UNSUPPORTED_EDIT', 'Cannot discard pending revisions inside the removed cell', { ...info, feature: 'contentRevision' });
  }
  const removedWidth = gridWidth(shape.columns, cell.start, cell.end, info);
  gridWidth(shape.columns, sibling.start, sibling.end, info);
  const removedPreferred = cellPreferredWidth(cell.element, info);
  if (removedPreferred) plannedWidthChange(removedPreferred, 0, info);
  const siblingPreferred = cellPreferredWidth(sibling.element, info);
  if (siblingPreferred && tableAttr(siblingPreferred, 'type') === 'pct') {
    failTableEdit('UNSUPPORTED_EDIT', 'Percentage width on the absorbing cell is ambiguous', { ...info, feature: 'width' });
  }
  const widthUpdate = plannedCellWidthChange(sibling.element, removedWidth, info);
  const absorbedInto = { start: Math.min(cell.start, sibling.start), end: Math.max(cell.end, sibling.end) };
  removeOrphanedRangeEndpointsForSubtree(doc.documentElement, cell.element);
  row.element.removeChild(cell.element);
  applyWidthUpdates([widthUpdate]);
  setCellSpan(sibling, absorbedInto.end - absorbedInto.start);
  inventoryTableOccupancy(shape.table);
  return { tableIndex: shape.tableIndex, rowIndex: row.rowIndex, absorbedInto };
}
