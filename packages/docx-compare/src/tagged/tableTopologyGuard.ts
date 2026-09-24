import { childElements, inventoryTableOccupancy, parseXml, TableOccupancyError } from '@usejunior/docx-core';
import type { TaggedNode } from './taggedTree.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export type UnsupportedTableTopologyFeature =
  | 'tblGrid' | 'tblGridWidth' | 'cellCount' | 'gridSpan' | 'gridBefore'
  | 'gridAfter' | 'vMerge' | 'hMerge' | 'topologyRevision' | 'occupancy'
  | 'emptyTable' | 'tableContainer' | 'projection';

export class UnsupportedTableTopologyComparisonError extends Error {
  readonly partPath = 'word/document.xml';
  constructor(
    readonly feature: UnsupportedTableTopologyFeature,
    readonly tableIndex: number,
    readonly rowIndex?: number,
    readonly cellIndex?: number,
    readonly columnIndex?: number,
  ) {
    super(`Unsupported table comparison topology: ${feature} at table ${tableIndex}`
      + (rowIndex === undefined ? '' : `, row ${rowIndex}`));
    this.name = 'UnsupportedTableTopologyComparisonError';
  }
}

function direct(parent: Element, name: string): Element[] {
  return childElements(parent).filter((child) => child.namespaceURI === W_NS && child.localName === name);
}

function val(element: Element | undefined, attr = 'val'): string | null {
  return element?.getAttributeNS(W_NS, attr) ?? null;
}

function grid(table: Element): Array<string | null> {
  const tblGrid = direct(table, 'tblGrid')[0];
  return tblGrid ? direct(tblGrid, 'gridCol').map((column) => val(column, 'w')) : [];
}

function cellShape(cell: Element): string {
  const tcPr = direct(cell, 'tcPr')[0];
  return JSON.stringify({
    span: val(tcPr && direct(tcPr, 'gridSpan')[0]) ?? '1',
    vMerge: cellProperty(cell, 'vMerge'),
    hMerge: cellProperty(cell, 'hMerge'),
  });
}

function cellTopologyRevisions(row: Element): string[] {
  return direct(row, 'tc').map((cell) => {
    const tcPr = direct(cell, 'tcPr')[0];
    return tcPr ? childElements(tcPr)
      .filter((child) => child.namespaceURI === W_NS
        && ['cellIns', 'cellDel', 'cellMerge'].includes(child.localName))
      .map((child) => child.localName).join(',') : '';
  });
}

function cellProperty(cell: Element | undefined, name: string): string | null {
  const tcPr = cell && direct(cell, 'tcPr')[0];
  const property = tcPr && direct(tcPr, name)[0];
  return property ? val(property) ?? 'continue' : null;
}

function rowShape(row: Element): string {
  const trPr = direct(row, 'trPr')[0];
  return JSON.stringify({
    before: val(trPr && direct(trPr, 'gridBefore')[0]) ?? '0',
    after: val(trPr && direct(trPr, 'gridAfter')[0]) ?? '0',
    children: childElements(row).filter((child) =>
      child.namespaceURI === W_NS && ['tc', 'sdt', 'customXml'].includes(child.localName))
      .map((child) => child.localName === 'tc' ? ['tc', cellShape(child)] : [child.localName]),
  });
}

function rejectChangedRow(original: Element, revised: Element, originalTable: Element,
  revisedTable: Element, tableIndex: number): never {
  const originalRows = direct(originalTable, 'tr');
  const revisedRows = direct(revisedTable, 'tr');
  const rowIndex = originalRows.indexOf(original);
  const revisedIndex = revisedRows.indexOf(revised);
  const originalCells = direct(original, 'tc');
  const revisedCells = direct(revised, 'tc');
  if (originalCells.length === revisedCells.length) {
    for (let cellIndex = 0; cellIndex < originalCells.length; cellIndex++) {
      for (const feature of ['vMerge', 'hMerge'] as const) {
        if (cellProperty(originalCells[cellIndex], feature) !== cellProperty(revisedCells[cellIndex], feature)) {
          throw new UnsupportedTableTopologyComparisonError(feature, tableIndex, rowIndex, cellIndex);
        }
      }
    }
  }
  try {
    const before = inventoryTableOccupancy(originalTable);
    const after = inventoryTableOccupancy(revisedTable);
    const a = before.rows[rowIndex];
    const b = after.rows[revisedIndex];
    if (!a || !b) throw new Error('Matched row absent from occupancy inventory');
    if (a.before !== b.before) throw new UnsupportedTableTopologyComparisonError('gridBefore', tableIndex, rowIndex);
    if (a.after !== b.after) throw new UnsupportedTableTopologyComparisonError('gridAfter', tableIndex, rowIndex);
    if (a.cells.length !== b.cells.length) throw new UnsupportedTableTopologyComparisonError('cellCount', tableIndex, rowIndex);
    for (let cellIndex = 0; cellIndex < a.cells.length; cellIndex++) {
      const left = a.cells[cellIndex]!;
      const right = b.cells[cellIndex]!;
      if (left.start !== right.start || left.end !== right.end) {
        throw new UnsupportedTableTopologyComparisonError('gridSpan', tableIndex, rowIndex, cellIndex, left.start);
      }
    }
  } catch (error) {
    if (error instanceof UnsupportedTableTopologyComparisonError) throw error;
    if (error instanceof TableOccupancyError) {
      const feature = ['vMerge', 'hMerge', 'topologyRevision'].includes(error.feature)
        ? error.feature as 'vMerge' | 'hMerge' | 'topologyRevision' : 'occupancy';
      throw new UnsupportedTableTopologyComparisonError(feature, tableIndex, rowIndex, error.cellIndex);
    }
    throw new UnsupportedTableTopologyComparisonError('occupancy', tableIndex, rowIndex);
  }
  throw new UnsupportedTableTopologyComparisonError('occupancy', tableIndex, rowIndex);
}

function guardUnmatchedTable(table: Element, tableIndex: number): void {
  const rows = Array.from(table.getElementsByTagNameNS(W_NS, 'tr'));
  if (rows.length === 0) throw new UnsupportedTableTopologyComparisonError('emptyTable', tableIndex);
  for (const current of [table, ...Array.from(table.getElementsByTagNameNS(W_NS, 'tbl'))]) {
    if (childElements(current).some((child) =>
      child.namespaceURI === W_NS && ['sdt', 'customXml'].includes(child.localName))) {
      throw new UnsupportedTableTopologyComparisonError('tableContainer', tableIndex);
    }
  }
  for (const row of rows) {
    const trPr = direct(row, 'trPr')[0];
    if (trPr && childElements(trPr).some((child) =>
      child.namespaceURI === W_NS && ['ins', 'del'].includes(child.localName))) {
      throw new UnsupportedTableTopologyComparisonError('tableContainer', tableIndex);
    }
  }
}

/**
 * Fail before serialization when native comparison cannot express body-table topology.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.37
 * @see #1043
 */
export function guardBodyTableTopology(tree: TaggedNode): void {
  let tableIndex = 0;
  const visit = (node: TaggedNode, owner?: { original: Element; revised: Element; index: number }): void => {
    const element = node.tag === 'both' ? node.original : node.node;
    let nextOwner = owner;
    if (element.namespaceURI === W_NS && element.localName === 'tbl') {
      const index = tableIndex++;
      if (node.tag === 'both') {
        const a = grid(node.original);
        const b = grid(node.revised);
        if (a.length !== b.length) throw new UnsupportedTableTopologyComparisonError('tblGrid', index,
          undefined, undefined, Math.min(a.length, b.length));
        const widthIndex = a.findIndex((width, column) => width !== b[column]);
        if (widthIndex >= 0) throw new UnsupportedTableTopologyComparisonError('tblGridWidth', index,
          undefined, undefined, widthIndex);
        nextOwner = { original: node.original, revised: node.revised, index };
      } else {
        guardUnmatchedTable(node.node, index);
        nextOwner = undefined;
      }
    } else if (element.namespaceURI === W_NS && element.localName === 'tr' && owner) {
      if (node.tag === 'both') {
        const originalRevisions = cellTopologyRevisions(node.original);
        const revisedRevisions = cellTopologyRevisions(node.revised);
        if (originalRevisions.length === revisedRevisions.length
          && JSON.stringify(originalRevisions) !== JSON.stringify(revisedRevisions)) {
          throw new UnsupportedTableTopologyComparisonError('topologyRevision', owner.index);
        }
        if (rowShape(node.original) !== rowShape(node.revised)) {
          rejectChangedRow(node.original, node.revised, owner.original, owner.revised, owner.index);
        }
      }
    } else if (element.namespaceURI === W_NS && ['sdt', 'customXml'].includes(element.localName)
      && node.tag !== 'both') {
      if (owner || element.getElementsByTagNameNS(W_NS, 'tbl').length > 0) {
        throw new UnsupportedTableTopologyComparisonError('tableContainer', owner?.index ?? tableIndex);
      }
    }
    for (const child of node.children) visit(child, nextOwner);
  };
  visit(tree);
}

/** Structural projection signature: table-bearing block order and depth-first row containers. */
export function bodyTableFootprint(xml: string): string {
  const document = parseXml(xml);
  const body = document.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) return '';
  // Paragraph-mark projection can legitimately retain an empty paragraph.
  // Its count is not a table-topology fact, so only table-bearing top-level
  // blocks participate in this guard.
  const topLevelTableBlocks = childElements(body)
    .filter((child) => child.namespaceURI === W_NS
      && (child.localName === 'tbl' || child.getElementsByTagNameNS(W_NS, 'tbl').length > 0))
    .map((child) => child.localName);
  const tables = Array.from(body.getElementsByTagNameNS(W_NS, 'tbl')).map((table) => {
    let depth = 0;
    for (let parent = table.parentNode; parent && parent !== body; parent = parent.parentNode) {
      if (parent.nodeType === 1 && (parent as Element).namespaceURI === W_NS
        && (parent as Element).localName === 'tbl') depth++;
    }
    return [depth, childElements(table).filter((child) =>
      child.namespaceURI === W_NS && ['tr', 'sdt', 'customXml'].includes(child.localName)).length];
  });
  return JSON.stringify({ topLevelTableBlocks, tables });
}
