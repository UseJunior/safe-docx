import { findParagraphByBookmarkId, insertSingleParagraphBookmark, type BookmarkReservation } from './bookmarks.js';
import { childElements, createWmlElement, getDirectChildrenByName, isW } from './dom-helpers.js';
import { SafeDocxError } from './errors.js';
import { OOXML } from './namespaces.js';
import { REVISION_ID_ELEMENT_NAME_SET } from './revision-vocabulary.js';
import { inventoryTableOccupancy, TableOccupancyError, type OccupiedCell, type OccupiedRow } from './table_occupancy.js';
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
export type TableColumnEditDetail = {
  anchorId: string; tableIndex: number; rowIndex: number; columnIndex: number;
  cellIndex?: number; feature: string;
};

function fail(code: 'INVALID_ARGUMENT' | 'UNSUPPORTED_EDIT', message: string, detail: TableColumnEditDetail): never {
  throw new SafeDocxError(code, message, undefined, detail);
}

function ancestor(node: Node | null, name: string): Element | null {
  for (let parent = node?.parentNode; parent; parent = parent.parentNode) {
    if (parent.nodeType === 1 && isW(parent as Element, name)) return parent as Element;
  }
  return null;
}

function attr(element: Element, name: string): string | null {
  return element.getAttributeNS(OOXML.W_NS, name) ?? element.getAttribute(`w:${name}`);
}

function setAttr(element: Element, name: string, value: number | string): void {
  element.setAttributeNS(OOXML.W_NS, `w:${name}`, String(value));
}

type Target = { table: Element; tableIndex: number; rows: OccupiedRow[]; grid: Element; columns: Element[] };

/** Resolve one body-level table and reject geometry that the clean phase cannot transform. */
function target(doc: Document, anchorId: string, columnIndex: number): Target {
  const base = { anchorId, tableIndex: -1, rowIndex: -1, columnIndex, feature: 'anchor' };
  const paragraph = findParagraphByBookmarkId(doc, anchorId);
  if (!paragraph) fail('INVALID_ARGUMENT', `Paragraph anchor not found: ${anchorId}`, base);
  const cell = ancestor(paragraph, 'tc');
  const row = ancestor(paragraph, 'tr');
  const table = ancestor(paragraph, 'tbl');
  const body = ancestor(table, 'body');
  if (!cell || !row || !table || !body || row.parentNode !== table || table.parentNode !== body) {
    fail('UNSUPPORTED_EDIT', 'Column anchor must be in a direct row of a body-level table', base);
  }
  const tableIndex = childElements(body).filter((part) => isW(part, 'tbl')).indexOf(table);
  const detail = { ...base, tableIndex };
  if (table.getElementsByTagNameNS(OOXML.W_NS, 'tbl').length > 0) {
    fail('UNSUPPORTED_EDIT', 'Nested tables are unsupported for column edits', { ...detail, feature: 'nestedTable' });
  }
  let occupancy;
  try { occupancy = inventoryTableOccupancy(table); }
  catch (error) {
    if (error instanceof TableOccupancyError) {
      fail('UNSUPPORTED_EDIT', error.message, { ...detail, rowIndex: error.rowIndex, cellIndex: error.cellIndex, feature: error.feature });
    }
    throw error;
  }
  const { rows } = occupancy;
  for (const occupiedRow of rows) {
    if (occupiedRow.before || occupiedRow.after) {
      fail('UNSUPPORTED_EDIT', 'Offset rows are unsupported for column edits', { ...detail, rowIndex: occupiedRow.rowIndex, feature: 'gridBefore/gridAfter' });
    }
    for (const occupiedCell of occupiedRow.cells) {
      if (occupiedCell.merge !== 'none') {
        fail('UNSUPPORTED_EDIT', 'Vertical merges are unsupported for column edits', { ...detail, rowIndex: occupiedRow.rowIndex, cellIndex: occupiedCell.cellIndex, feature: 'vMerge' });
      }
      const cellContent = childElements(occupiedCell.element).filter((element) => isW(element, 'p') || isW(element, 'tbl'));
      if (!cellContent.length || !isW(cellContent.at(-1)!, 'p')) {
        fail('UNSUPPORTED_EDIT', 'Every surviving cell must end in a direct paragraph', { ...detail, rowIndex: occupiedRow.rowIndex, cellIndex: occupiedCell.cellIndex, feature: 'trailingParagraph' });
      }
    }
  }
  const grid = getDirectChildrenByName(table, 'tblGrid')[0]!;
  return { table, tableIndex, rows, grid, columns: getDirectChildrenByName(grid, 'gridCol') };
}

type WidthUpdate = { element: Element; next: number };

function plannedWidthChange(element: Element | undefined, delta: number, detail: TableColumnEditDetail): WidthUpdate | null {
  if (!element) return null;
  const type = attr(element, 'type');
  const raw = attr(element, 'w');
  if (!type || !['dxa', 'pct', 'auto', 'nil'].includes(type)) {
    fail('UNSUPPORTED_EDIT', 'Unresolvable width', { ...detail, feature: 'width' });
  }
  if (type !== 'dxa') return null;
  if (raw === null || !/^\d+$/.test(raw)) fail('UNSUPPORTED_EDIT', 'Non-integer dxa width', { ...detail, feature: 'width' });
  const next = Number(raw) + delta;
  if (!Number.isSafeInteger(next) || next < 0) {
    fail('UNSUPPORTED_EDIT', 'Width arithmetic exceeds supported range', { ...detail, feature: 'width' });
  }
  return { element, next };
}

function plannedCellWidthChange(cell: Element, delta: number, detail: TableColumnEditDetail): WidthUpdate | null {
  const tcPr = getDirectChildrenByName(cell, 'tcPr')[0];
  return plannedWidthChange(tcPr ? getDirectChildrenByName(tcPr, 'tcW')[0] : undefined, delta, detail);
}

function plannedTableWidthChange(table: Element, delta: number, detail: TableColumnEditDetail): WidthUpdate | null {
  const tblPr = getDirectChildrenByName(table, 'tblPr')[0];
  return plannedWidthChange(tblPr ? getDirectChildrenByName(tblPr, 'tblW')[0] : undefined, delta, detail);
}

function applyWidthUpdates(updates: Array<WidthUpdate | null>): void {
  for (const update of updates) if (update) setAttr(update.element, 'w', update.next);
}

function spanElement(cell: Element): Element {
  let tcPr = getDirectChildrenByName(cell, 'tcPr')[0];
  if (!tcPr) {
    tcPr = createWmlElement(cell.ownerDocument!, 'tcPr');
    cell.insertBefore(tcPr, cell.firstChild);
  }
  let span = getDirectChildrenByName(tcPr, 'gridSpan')[0];
  if (!span) {
    span = createWmlElement(cell.ownerDocument!, 'gridSpan');
    const tcW = getDirectChildrenByName(tcPr, 'tcW')[0];
    const cnfStyle = getDirectChildrenByName(tcPr, 'cnfStyle')[0];
    const preceding = tcW ?? cnfStyle;
    tcPr.insertBefore(span, preceding ? preceding.nextSibling : tcPr.firstChild);
  }
  return span;
}

function setSpan(cell: OccupiedCell, next: number): void {
  const tcPr = getDirectChildrenByName(cell.element, 'tcPr')[0];
  const span = tcPr ? getDirectChildrenByName(tcPr, 'gridSpan')[0] : undefined;
  if (next === 1) span?.parentNode?.removeChild(span);
  else setAttr(spanElement(cell.element), 'val', next);
}

function newCell(doc: Document, source: Element, text: string, width: number): { cell: Element; paragraph: Element } {
  const cell = createWmlElement(doc, 'tc');
  const tcPr = createWmlElement(doc, 'tcPr');
  const sourcePr = getDirectChildrenByName(source, 'tcPr')[0];
  if (sourcePr) for (const property of childElements(sourcePr)) {
    if (!['tcW', 'gridSpan', 'vMerge', 'hMerge', 'cellIns', 'cellDel', 'cellMerge', 'tcPrChange', 'cnfStyle', 'hideMark', 'headers'].includes(property.localName)) {
      tcPr.appendChild(property.cloneNode(true));
    }
  }
  const tcW = createWmlElement(doc, 'tcW');
  setAttr(tcW, 'w', width);
  setAttr(tcW, 'type', 'dxa');
  tcPr.insertBefore(tcW, tcPr.firstChild);
  cell.appendChild(tcPr);
  const paragraph = createWmlElement(doc, 'p');
  if (text) {
    const run = createWmlElement(doc, 'r');
    const leaf = createWmlElement(doc, 't');
    if (/^\s|\s$/.test(text)) leaf.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    leaf.appendChild(doc.createTextNode(text));
    run.appendChild(leaf);
    paragraph.appendChild(run);
  }
  cell.appendChild(paragraph);
  return { cell, paragraph };
}

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
      setSpan(plan.owner, plan.owner.end - plan.owner.start + 1);
    } else {
      const created = newCell(doc, plan.source, plan.text, width);
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
      if (Array.from(owner.element.getElementsByTagNameNS(OOXML.W_NS, '*')).some((element) => REVISION_ID_ELEMENT_NAME_SET.has(element.localName))) {
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
      setSpan(plan.owner, plan.nextSpan);
    }
  }
  applyWidthUpdates([tableWidthUpdate]);
  shape.grid.removeChild(shape.columns[columnIndex]!);
  inventoryTableOccupancy(shape.table);
  return { gridColumns: shape.columns.length - 1, deleted: true };
}
