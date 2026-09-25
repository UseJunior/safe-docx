import { insertSingleParagraphBookmark, type BookmarkReservation } from './bookmarks.js';
import { createWmlElement } from './dom-helpers.js';
import { inventoryTableOccupancy, type OccupiedCell, type OccupiedRow } from './table_occupancy.js';
import {
  applyWidthUpdates,
  createTableCell,
  failTableEdit as fail,
  hasPendingRevision,
  plannedCellWidthChange,
  plannedTableWidthChange,
  setCellSpan,
  setTableAttr as setAttr,
  tableAttr as attr,
  tableEditTarget as target,
  type TableEditDetail,
  type WidthUpdate,
} from './table_edit_common.js';
import { removeOrphanedRangeEndpointsForSubtree } from './table_rows.js';
import type { RevisionContext } from './track-changes-emitter.js';

export type ColumnInsertRowAction = { kind: 'cell'; text: string } | { kind: 'growCell'; side: 'left' | 'right' };
export type InsertTableColumnParams = {
  anchorParagraphId: string;
  columnIndex: number;
  widthTwips: number;
  rowActions: ColumnInsertRowAction[];
};
export type DeleteTableColumnParams = { anchorParagraphId: string; columnIndex: number };
export type InsertTableColumnResult = { gridColumns: number; cellParagraphIds: string[] };
export type DeleteTableColumnResult = { gridColumns: number; deleted: true };
export type TableColumnEditDetail = TableEditDetail;

/**
 * Insert a clean logical table-grid column, leaving source XML untouched on failure.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.48
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.16
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.71
 * @see #1041
 */
export function insertTableColumn(doc: Document, params: InsertTableColumnParams, ctx?: RevisionContext, reservation?: BookmarkReservation): InsertTableColumnResult {
  const { anchorParagraphId: anchorId, columnIndex, widthTwips: width, rowActions } = params;
  const initial = { anchorId, tableIndex: -1, rowIndex: -1, columnIndex, feature: 'argument' };
  if (ctx) fail('UNSUPPORTED_EDIT', 'Tracked column edits are not supported', { ...initial, feature: 'revisionContext' });
  const shape = target(doc, anchorId, columnIndex);
  if (!Number.isSafeInteger(columnIndex) || columnIndex < 0 || columnIndex > shape.columns.length) {
    fail('INVALID_ARGUMENT', 'Column boundary is outside the table grid', initial);
  }
  if (!Number.isSafeInteger(width) || width <= 0) fail('INVALID_ARGUMENT', 'widthTwips must be a positive integer', { ...initial, feature: 'width' });
  if (!Array.isArray(rowActions) || rowActions.length !== shape.rows.length) {
    fail('INVALID_ARGUMENT', 'One row action is required per physical row', { ...initial, feature: 'rowActions' });
  }
  const plans: Array<
    { kind: 'growCell'; owner: OccupiedCell; widthUpdate: WidthUpdate | null }
    | { kind: 'cell'; row: OccupiedRow; next: OccupiedCell | undefined; source: Element; text: string }
  > = [];
  for (const row of shape.rows) {
    const action = rowActions[row.rowIndex];
    const info = { ...initial, tableIndex: shape.tableIndex, rowIndex: row.rowIndex, feature: 'rowAction' };
    if (!action || !['cell', 'growCell'].includes(action.kind)) fail('INVALID_ARGUMENT', 'Unsupported row action', info);
    if (action.kind === 'growCell') {
      if (!['left', 'right'].includes(action.side)) fail('INVALID_ARGUMENT', 'Invalid growCell side', info);
      const owner = action.side === 'left'
        ? row.cells.find((cell) => cell.start < columnIndex && cell.end >= columnIndex)
        : row.cells.find((cell) => cell.start <= columnIndex && cell.end > columnIndex);
      if (!owner) fail('INVALID_ARGUMENT', 'No cell on requested side of column boundary', info);
      const widthUpdate = plannedCellWidthChange(owner.element, width, { ...info, cellIndex: owner.cellIndex });
      plans.push({ kind: 'growCell', owner, widthUpdate });
    } else {
      if (typeof action.text !== 'string') fail('INVALID_ARGUMENT', 'Cell text must be a string', info);
      const next = row.cells.find((cell) => cell.start === columnIndex);
      if (!next && columnIndex !== shape.columns.length) fail('INVALID_ARGUMENT', 'Cannot insert a cell inside a horizontal span', info);
      const source = next?.element ?? row.cells.at(-1)!.element;
      plans.push({ kind: 'cell', row, next, source, text: action.text });
    }
  }
  const tableWidthUpdate = plannedTableWidthChange(shape.table, width, { ...initial, tableIndex: shape.tableIndex });
  const newParagraphs: Element[] = [];
  for (const plan of plans) {
    if (plan.kind === 'growCell') {
      applyWidthUpdates([plan.widthUpdate]);
      setCellSpan(plan.owner, plan.owner.end - plan.owner.start + 1);
    } else {
      const created = createTableCell(doc, plan.source, plan.text, width);
      plan.row.element.insertBefore(created.cell, plan.next?.element ?? null);
      newParagraphs.push(created.paragraph);
    }
  }
  applyWidthUpdates([tableWidthUpdate]);
  const gridCol = createWmlElement(doc, 'gridCol');
  setAttr(gridCol, 'w', width);
  shape.grid.insertBefore(gridCol, shape.columns[columnIndex] ?? null);
  inventoryTableOccupancy(shape.table);
  const cellParagraphIds = newParagraphs.map((paragraph) => insertSingleParagraphBookmark(doc, paragraph, reservation));
  return { gridColumns: shape.columns.length + 1, cellParagraphIds };
}

/**
 * Delete a clean logical table-grid column, removing width-one physical cells.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.48
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.16
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.71
 * @see #1041
 */
export function deleteTableColumn(doc: Document, params: DeleteTableColumnParams, ctx?: RevisionContext): DeleteTableColumnResult {
  const { anchorParagraphId: anchorId, columnIndex } = params;
  const initial = { anchorId, tableIndex: -1, rowIndex: -1, columnIndex, feature: 'argument' };
  if (ctx) fail('UNSUPPORTED_EDIT', 'Tracked column edits are not supported', { ...initial, feature: 'revisionContext' });
  const shape = target(doc, anchorId, columnIndex);
  if (!Number.isSafeInteger(columnIndex) || columnIndex < 0 || columnIndex >= shape.columns.length) {
    fail('INVALID_ARGUMENT', 'Column is outside the table grid', initial);
  }
  if (shape.columns.length === 1) fail('INVALID_ARGUMENT', 'Cannot remove the final table column', { ...initial, feature: 'lastColumn' });
  const rawWidth = attr(shape.columns[columnIndex]!, 'w');
  if (rawWidth === null || !/^\d+$/.test(rawWidth) || !Number.isSafeInteger(Number(rawWidth))) {
    fail('UNSUPPORTED_EDIT', 'Deleted grid column needs an integer twip width', { ...initial, feature: 'width' });
  }
  const width = Number(rawWidth);
  const plans: Array<
    { kind: 'remove'; row: OccupiedRow; owner: OccupiedCell }
    | { kind: 'shrink'; owner: OccupiedCell; nextSpan: number; widthUpdate: WidthUpdate | null }
  > = [];
  for (const row of shape.rows) {
    const owner = row.slots[columnIndex];
    if (!owner) fail('UNSUPPORTED_EDIT', 'Missing physical cell at column', { ...initial, rowIndex: row.rowIndex, feature: 'occupancy' });
    const info = { ...initial, tableIndex: shape.tableIndex, rowIndex: row.rowIndex, cellIndex: owner.cellIndex };
    const span = owner.end - owner.start;
    if (span === 1) {
      if (row.cells.length === 1) fail('INVALID_ARGUMENT', 'Deleting this column would leave a row empty', { ...info, feature: 'lastCell' });
      if (hasPendingRevision(owner.element)) {
        fail('UNSUPPORTED_EDIT', 'Cannot discard pending revisions inside a removed cell', { ...info, feature: 'contentRevision' });
      }
      plans.push({ kind: 'remove', row, owner });
    } else {
      const widthUpdate = plannedCellWidthChange(owner.element, -width, { ...info, feature: 'width' });
      plans.push({ kind: 'shrink', owner, nextSpan: span - 1, widthUpdate });
    }
  }
  const tableWidthUpdate = plannedTableWidthChange(shape.table, -width, { ...initial, tableIndex: shape.tableIndex });
  for (const plan of plans) {
    if (plan.kind === 'remove') {
      removeOrphanedRangeEndpointsForSubtree(doc.documentElement, plan.owner.element);
      plan.row.element.removeChild(plan.owner.element);
    } else {
      applyWidthUpdates([plan.widthUpdate]);
      setCellSpan(plan.owner, plan.nextSpan);
    }
  }
  applyWidthUpdates([tableWidthUpdate]);
  shape.grid.removeChild(shape.columns[columnIndex]!);
  inventoryTableOccupancy(shape.table);
  return { gridColumns: shape.columns.length - 1, deleted: true };
}
