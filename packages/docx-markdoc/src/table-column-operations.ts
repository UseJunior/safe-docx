import { childElements, inventoryTableOccupancy, OOXML, type DocxDocument } from '@usejunior/docx-core';
import { DocxMarkdocError } from './errors.js';
import type { EditOperation, InsertTableColumnOperation } from './types.js';

const W = OOXML.W_NS;
const isW = (element: Element, name: string): boolean => element.namespaceURI === W && element.localName === name;

function tableOf(paragraph: Element | null): Element | undefined {
  for (let node = paragraph?.parentNode; node; node = node.parentNode) {
    if (node.nodeType === 1 && isW(node as Element, 'tbl')) return node as Element;
  }
  return undefined;
}

/** Read-only planning for the initial direct-body rectangular-column surface. */
export function tableColumnTarget(document: DocxDocument, operation: InsertTableColumnOperation) {
  if (!Number.isSafeInteger(operation.widthTwips) || operation.widthTwips <= 0
    || (operation.columnIndex !== undefined && (!Number.isSafeInteger(operation.columnIndex) || operation.columnIndex < 0))
    || (operation.landscape !== undefined && typeof operation.landscape !== 'boolean')
    || !Array.isArray(operation.cells) || operation.cells.length === 0
    || operation.cells.some(cell => !Array.isArray(cell) || cell.length === 0
      || cell.some(text => typeof text !== 'string' || /[\r\n\t]/u.test(text)))) {
    throw new DocxMarkdocError('INVALID_TABLE_COLUMN', `Operation ${operation.operationId} has invalid column arguments.`);
  }
  const paragraph = document.getParagraphElementById(operation.anchorId);
  if (!paragraph) throw new DocxMarkdocError('MISSING_ANCHOR', `Column anchor ${operation.anchorId} was not found.`);
  const table = tableOf(paragraph);
  const body = table?.parentNode;
  if (!table || !body || body.nodeType !== 1 || !isW(body as Element, 'body')
    || table.getElementsByTagNameNS(W, 'tbl').length > 0) {
    throw new DocxMarkdocError('UNSUPPORTED_TABLE_COLUMN', 'Column operations require a direct-body table without nested tables.');
  }
  let occupancy;
  try { occupancy = inventoryTableOccupancy(table); }
  catch (error) {
    throw new DocxMarkdocError('UNSUPPORTED_TABLE_COLUMN', `Column ${operation.operationId}: ${(error as Error).message}`);
  }
  if (occupancy.rows.some(row => row.before !== 0 || row.after !== 0
    || row.cells.length !== occupancy.gridColumns
    || row.cells.some(cell => cell.end - cell.start !== 1 || cell.merge !== 'none' || cell.element.parentNode !== row.element))) {
    throw new DocxMarkdocError('UNSUPPORTED_TABLE_COLUMN', 'Column operations require simple rectangular rows without merges, offsets or wrapped cells.');
  }
  if (operation.cells.length !== occupancy.rows.length) {
    throw new DocxMarkdocError('COLUMN_CELL_COUNT_MISMATCH', `Column ${operation.operationId} needs ${occupancy.rows.length} cells, received ${operation.cells.length}.`);
  }
  const columnIndex = operation.columnIndex ?? occupancy.gridColumns;
  if (columnIndex > occupancy.gridColumns) {
    throw new DocxMarkdocError('INVALID_COLUMN_INDEX', `Column boundary ${columnIndex} exceeds the table's ${occupancy.gridColumns} columns.`);
  }
  let sectionIndex = 0;
  for (const block of childElements(body as Element)) {
    if (block === table) break;
    if (!isW(block, 'p')) continue;
    const properties = childElements(block).find(child => isW(child, 'pPr'));
    if (properties && childElements(properties).some(child => isW(child, 'sectPr'))) sectionIndex += 1;
  }
  return { table, columnIndex, sectionIndex };
}

export function assertTableColumnConflicts(document: DocxDocument, operations: readonly EditOperation[]): void {
  const columns = new Map<Element, InsertTableColumnOperation>();
  for (const operation of operations) {
    if (operation.kind !== 'insert-table-column') continue;
    const { table } = tableColumnTarget(document, operation);
    if (columns.has(table)) {
      throw new DocxMarkdocError('CONFLICTING_TABLE_OPERATIONS', 'Only one column operation may target a source table in one compilation.');
    }
    if (operations.some(other => other.kind === 'delete-source' && other.id === operation.anchorId)) {
      throw new DocxMarkdocError('STRUCTURAL_ANCHOR_DELETED', `Column ${operation.operationId} uses a paragraph deleted by the same build.`);
    }
    columns.set(table, operation);
  }
  for (const operation of operations) {
    if (operation.kind !== 'insert-table-rows' && operation.kind !== 'delete-table-row') continue;
    const table = tableOf(document.getParagraphElementById(operation.anchorId));
    if (table && columns.has(table)) {
      throw new DocxMarkdocError('CONFLICTING_TABLE_OPERATIONS', 'Row and column structural operations cannot target the same source table in one compilation.');
    }
  }
}

/** Apply only to the compiler's disposable clean/preflight document. */
export function applyTableColumn(document: DocxDocument, operation: InsertTableColumnOperation): Array<{ id: string; text: string }> {
  const target = tableColumnTarget(document, operation);
  if (operation.landscape) {
    const page = document.getSections()[target.sectionIndex]?.pageSize;
    if (!page?.widthTwips || !page.heightTwips) {
      throw new DocxMarkdocError('COLUMN_LANDSCAPE_PAGE_SIZE_REQUIRED', 'Landscape requires explicit source page width and height.');
    }
    document.updateSectionProperties({ sectionIndex: target.sectionIndex, pageSize: {
      widthTwips: Math.max(page.widthTwips, page.heightTwips),
      heightTwips: Math.min(page.widthTwips, page.heightTwips), orientation: 'landscape',
    } });
  }
  const inserted = document.insertTableColumn({
    anchorParagraphId: operation.anchorId, columnIndex: target.columnIndex, widthTwips: operation.widthTwips,
    rowActions: operation.cells.map(paragraphs => ({ kind: 'cell', text: paragraphs[0]! })),
  });
  const paragraphs: Array<{ id: string; text: string }> = [];
  operation.cells.forEach((texts, row) => {
    let anchorId = inserted.cellParagraphIds[row]!;
    paragraphs.push({ id: anchorId, text: texts[0]! });
    for (const text of texts.slice(1)) {
      const added = document.insertParagraph({ positionalAnchorNodeId: anchorId, relativePosition: 'AFTER', newText: text });
      anchorId = added.newParagraphId;
      paragraphs.push({ id: anchorId, text });
    }
  });
  return paragraphs;
}
