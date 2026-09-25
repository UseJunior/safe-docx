import { findParagraphByBookmarkId } from './bookmarks.js';
import { childElements, createWmlElement, getDirectChildrenByName, isW } from './dom-helpers.js';
import { SafeDocxError } from './errors.js';
import { OOXML } from './namespaces.js';
import { REVISION_ID_ELEMENT_NAME_SET } from './revision-vocabulary.js';
import { inventoryTableOccupancy, TableOccupancyError, type OccupiedCell, type OccupiedRow } from './table_occupancy.js';

export type TableEditDetail = {
  anchorId: string; tableIndex: number; rowIndex: number; columnIndex: number;
  cellIndex?: number; feature: string;
};

export function failTableEdit(code: 'INVALID_ARGUMENT' | 'UNSUPPORTED_EDIT', message: string, detail: TableEditDetail): never {
  throw new SafeDocxError(code, message, undefined, detail);
}

export function tableAncestor(node: Node | null, name: string): Element | null {
  for (let parent = node?.parentNode; parent; parent = parent.parentNode) {
    if (parent.nodeType === 1 && isW(parent as Element, name)) return parent as Element;
  }
  return null;
}

export function tableAttr(element: Element, name: string): string | null {
  return element.getAttributeNS(OOXML.W_NS, name) ?? element.getAttribute(`w:${name}`);
}

export function setTableAttr(element: Element, name: string, value: number | string): void {
  element.setAttributeNS(OOXML.W_NS, `w:${name}`, String(value));
}

export type TableEditTarget = {
  table: Element; tableIndex: number; rows: OccupiedRow[]; grid: Element; columns: Element[];
  anchorCell: OccupiedCell; anchorRow: OccupiedRow;
};

/** Resolve a body-level table and reject geometry unsupported by the clean edit phase. */
export function tableEditTarget(doc: Document, anchorId: string, columnIndex: number, operation = 'column'): TableEditTarget {
  const base = { anchorId, tableIndex: -1, rowIndex: -1, columnIndex, feature: 'anchor' };
  const paragraph = findParagraphByBookmarkId(doc, anchorId);
  if (!paragraph) failTableEdit('INVALID_ARGUMENT', `Paragraph anchor not found: ${anchorId}`, base);
  const cell = tableAncestor(paragraph, 'tc');
  const row = tableAncestor(paragraph, 'tr');
  const table = tableAncestor(paragraph, 'tbl');
  const body = tableAncestor(table, 'body');
  if (!cell || !row || !table || !body || row.parentNode !== table || table.parentNode !== body) {
    failTableEdit('UNSUPPORTED_EDIT', `${operation === 'column' ? 'Column' : 'Cell'} anchor must be in a direct row of a body-level table`, base);
  }
  const tableIndex = childElements(body).filter((part) => isW(part, 'tbl')).indexOf(table);
  const detail = { ...base, tableIndex };
  if (table.getElementsByTagNameNS(OOXML.W_NS, 'tbl').length > 0) {
    failTableEdit('UNSUPPORTED_EDIT', `Nested tables are unsupported for ${operation} edits`, { ...detail, feature: 'nestedTable' });
  }
  let occupancy;
  try { occupancy = inventoryTableOccupancy(table); }
  catch (error) {
    if (error instanceof TableOccupancyError) {
      failTableEdit('UNSUPPORTED_EDIT', error.message, { ...detail, rowIndex: error.rowIndex, cellIndex: error.cellIndex, feature: error.feature });
    }
    throw error;
  }
  const { rows } = occupancy;
  for (const occupiedRow of rows) {
    if (occupiedRow.before || occupiedRow.after) {
      failTableEdit('UNSUPPORTED_EDIT', `Offset rows are unsupported for ${operation} edits`, { ...detail, rowIndex: occupiedRow.rowIndex, feature: 'gridBefore/gridAfter' });
    }
    for (const occupiedCell of occupiedRow.cells) {
      if (occupiedCell.merge !== 'none') {
        failTableEdit('UNSUPPORTED_EDIT', `Vertical merges are unsupported for ${operation} edits`, { ...detail, rowIndex: occupiedRow.rowIndex, cellIndex: occupiedCell.cellIndex, feature: 'vMerge' });
      }
      const cellContent = childElements(occupiedCell.element).filter((element) => isW(element, 'p') || isW(element, 'tbl'));
      if (!cellContent.length || !isW(cellContent.at(-1)!, 'p')) {
        failTableEdit('UNSUPPORTED_EDIT', 'Every surviving cell must end in a direct paragraph', { ...detail, rowIndex: occupiedRow.rowIndex, cellIndex: occupiedCell.cellIndex, feature: 'trailingParagraph' });
      }
    }
  }
  const anchorRow = rows.find((candidate) => candidate.element === row);
  const anchorCell = anchorRow?.cells.find((candidate) => candidate.element === cell);
  if (!anchorRow || !anchorCell) failTableEdit('UNSUPPORTED_EDIT', 'Anchor cell is not in the table occupancy inventory', { ...detail, feature: 'occupancy' });
  const grid = getDirectChildrenByName(table, 'tblGrid')[0]!;
  return { table, tableIndex, rows, grid, columns: getDirectChildrenByName(grid, 'gridCol'), anchorRow, anchorCell };
}

export type WidthUpdate = { element: Element; next: number };

export function plannedWidthChange(element: Element | undefined, delta: number, detail: TableEditDetail): WidthUpdate | null {
  if (!element) return null;
  const type = tableAttr(element, 'type');
  const raw = tableAttr(element, 'w');
  if (!type || !['dxa', 'pct', 'auto', 'nil'].includes(type)) {
    failTableEdit('UNSUPPORTED_EDIT', 'Unresolvable width', { ...detail, feature: 'width' });
  }
  if (type !== 'dxa') return null;
  if (raw === null || !/^\d+$/.test(raw)) failTableEdit('UNSUPPORTED_EDIT', 'Non-integer dxa width', { ...detail, feature: 'width' });
  const next = Number(raw) + delta;
  if (!Number.isSafeInteger(next) || next < 0) {
    failTableEdit('UNSUPPORTED_EDIT', 'Width arithmetic exceeds supported range', { ...detail, feature: 'width' });
  }
  return { element, next };
}

export function plannedCellWidthChange(cell: Element, delta: number, detail: TableEditDetail): WidthUpdate | null {
  const tcPr = getDirectChildrenByName(cell, 'tcPr')[0];
  return plannedWidthChange(tcPr ? getDirectChildrenByName(tcPr, 'tcW')[0] : undefined, delta, detail);
}

export function plannedTableWidthChange(table: Element, delta: number, detail: TableEditDetail): WidthUpdate | null {
  const tblPr = getDirectChildrenByName(table, 'tblPr')[0];
  return plannedWidthChange(tblPr ? getDirectChildrenByName(tblPr, 'tblW')[0] : undefined, delta, detail);
}

export function applyWidthUpdates(updates: Array<WidthUpdate | null>): void {
  for (const update of updates) if (update) setTableAttr(update.element, 'w', update.next);
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

export function setCellSpan(cell: Pick<OccupiedCell, 'element'>, next: number): void {
  const tcPr = getDirectChildrenByName(cell.element, 'tcPr')[0];
  const span = tcPr ? getDirectChildrenByName(tcPr, 'gridSpan')[0] : undefined;
  if (next === 1) span?.parentNode?.removeChild(span);
  else setTableAttr(spanElement(cell.element), 'val', next);
}

const NEW_CELL_EXCLUDED_PROPERTIES = new Set([
  'tcW', 'gridSpan', 'vMerge', 'hMerge', 'cellIns', 'cellDel', 'cellMerge', 'tcPrChange',
  'cnfStyle', 'hideMark', 'headers',
]);

export function createTableCell(doc: Document, source: Element, text: string, width: number): { cell: Element; paragraph: Element } {
  const cell = createWmlElement(doc, 'tc');
  const tcPr = createWmlElement(doc, 'tcPr');
  const sourcePr = getDirectChildrenByName(source, 'tcPr')[0];
  if (sourcePr) for (const property of childElements(sourcePr)) {
    if (!NEW_CELL_EXCLUDED_PROPERTIES.has(property.localName)) tcPr.appendChild(property.cloneNode(true));
  }
  const tcW = createWmlElement(doc, 'tcW');
  setTableAttr(tcW, 'w', width);
  setTableAttr(tcW, 'type', 'dxa');
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

export function hasPendingRevision(element: Element): boolean {
  return Array.from(element.getElementsByTagNameNS(OOXML.W_NS, '*'))
    .some((descendant) => REVISION_ID_ELEMENT_NAME_SET.has(descendant.localName));
}
