import { childElements, inventoryTableOccupancy, parseXml, TableOccupancyError } from '@usejunior/docx-core';
import type { TaggedNode } from './taggedTree.js';
import { isBlockContainer } from './blockContainer.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export type UnsupportedTableTopologyFeature =
  | 'tblGrid' | 'tblGridWidth' | 'cellCount' | 'gridSpan' | 'gridBefore'
  | 'gridAfter' | 'vMerge' | 'hMerge' | 'topologyRevision' | 'occupancy'
  | 'emptyTable' | 'tableContainer' | 'projection';

/** Which projection of the comparison output disagreed with its source. */
export interface TableProjectionMismatch {
  readonly projection: 'accept' | 'reject';
  readonly mismatch: TableFootprintMismatch;
}

export class UnsupportedTableTopologyComparisonError extends Error {
  readonly partPath = 'word/document.xml';
  constructor(
    readonly feature: UnsupportedTableTopologyFeature,
    readonly tableIndex: number,
    readonly rowIndex?: number,
    readonly cellIndex?: number,
    readonly columnIndex?: number,
    /** Set when `feature` is `projection`: the side and first footprint difference. */
    readonly projectionMismatch?: TableProjectionMismatch,
  ) {
    super(`Unsupported table comparison topology: ${feature} at table ${tableIndex}`
      + (rowIndex === undefined ? '' : `, row ${rowIndex}`)
      + (projectionMismatch ? ` (${projectionMismatch.projection} projection ${projectionMismatch.mismatch.feature})` : ''));
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

/**
 * Structural skeleton of one row: its grid offsets and, per cell-bearing
 * child, the cell's span and merge states. Matched rows whose skeletons
 * differ are replaced by a deleted and an inserted row before
 * {@link guardBodyTableTopology}, which refuses the rest (#1396); comparison
 * alignment pairs rows across positions only when their skeletons agree.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.17
 */
export function rowShape(row: Element): string {
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

function outermostTables(root: Element): Element[] {
  return Array.from(root.getElementsByTagNameNS(W_NS, 'tbl')).filter((table) => {
    for (let parent = table.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (parent.namespaceURI === W_NS && parent.localName === 'tbl') return false;
    }
    return true;
  });
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
      if (isBlockContainer(element)) {
        // A whole block container is tracked through its content (#1386); its
        // tables are unmatched tables and face the same limits as any other.
        for (const table of outermostTables(element)) guardUnmatchedTable(table, tableIndex++);
      } else if (owner || element.getElementsByTagNameNS(W_NS, 'tbl').length > 0) {
        throw new UnsupportedTableTopologyComparisonError('tableContainer', owner?.index ?? tableIndex);
      }
    }
    for (const child of node.children) visit(child, nextOwner);
  };
  visit(tree);
}

export type FootprintMergeState = 'none' | 'restart' | 'continue';

/** One physical cell in logical grid coordinates: columns `[start, end)`. */
export interface TableCellFootprint {
  readonly start: number;
  readonly end: number;
  readonly vMerge: FootprintMergeState;
  readonly hMerge: FootprintMergeState;
}

/** One `w:tr`, including rows reached through row-level `w:sdt`/`w:customXml`. */
export interface TableRowFootprint {
  readonly gridBefore: number;
  readonly gridAfter: number;
  readonly cells: readonly TableCellFootprint[];
}

export interface TableFootprint {
  /** Number of `w:tbl` ancestors inside the body. */
  readonly depth: number;
  /** Direct `w:tr`/`w:sdt`/`w:customXml` children of the table. */
  readonly rowContainers: number;
  /** `w:gridCol/@w:w` in grid order; its length is the grid column count. */
  readonly gridColumnWidths: readonly (string | null)[];
  readonly rows: readonly TableRowFootprint[];
}

/** Structural projection of every body table, in document order. */
export interface BodyTableFootprint {
  /** Local names of the top-level body blocks that are or contain a table. */
  readonly topLevelTableBlocks: readonly string[];
  readonly tables: readonly TableFootprint[];
}

export type TableFootprintMismatchFeature =
  | 'tableBlocks' | 'tableCount' | 'nesting' | 'rowContainers' | 'rowCount'
  | 'gridColumns' | 'gridColumnWidth' | 'gridBefore' | 'gridAfter' | 'cellCount'
  | 'cellInterval' | 'vMerge' | 'hMerge';

/** The first structural difference between two footprints, located for reporting. */
export interface TableFootprintMismatch {
  readonly feature: TableFootprintMismatchFeature;
  /** Document-order table index; -1 for a body-level block difference. */
  readonly tableIndex: number;
  readonly rowIndex?: number;
  readonly cellIndex?: number;
  readonly columnIndex?: number;
  readonly expected: unknown;
  readonly actual: unknown;
}

const ROW_CONTAINERS = new Set(['tr', 'sdt', 'customXml']);
const CONTENT_WRAPPERS = new Set(['sdt', 'sdtContent', 'customXml']);

function gridNumber(element: Element | undefined, fallback: number, minimum: number): number {
  const raw = val(element);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

function mergeState(cell: Element, name: 'vMerge' | 'hMerge'): FootprintMergeState {
  const state = cellProperty(cell, name);
  if (state === null) return 'none';
  return state === 'restart' ? 'restart' : 'continue';
}

/** Children named `names`, looking through `w:sdt`/`w:customXml` content wrappers. */
function wrappedChildren(parent: Element, names: ReadonlySet<string>): Element[] {
  const found: Element[] = [];
  for (const child of childElements(parent)) {
    if (child.namespaceURI !== W_NS) continue;
    if (names.has(child.localName)) found.push(child);
    else if (CONTENT_WRAPPERS.has(child.localName)) found.push(...wrappedChildren(child, names));
  }
  return found;
}

function rowFootprint(row: Element): TableRowFootprint {
  const trPr = direct(row, 'trPr')[0];
  const gridBefore = gridNumber(trPr && direct(trPr, 'gridBefore')[0], 0, 0);
  const gridAfter = gridNumber(trPr && direct(trPr, 'gridAfter')[0], 0, 0);
  let column = gridBefore;
  const cells = wrappedChildren(row, new Set(['tc'])).map((cell): TableCellFootprint => {
    const tcPr = direct(cell, 'tcPr')[0];
    const start = column;
    column += gridNumber(tcPr && direct(tcPr, 'gridSpan')[0], 1, 1);
    return { start, end: column, vMerge: mergeState(cell, 'vMerge'), hMerge: mergeState(cell, 'hMerge') };
  });
  return { gridBefore, gridAfter, cells };
}

/**
 * Structural projection signature of the body's tables: table-bearing block
 * order, nesting depth, row containers, the grid (column count and widths),
 * each row's offsets, and each cell's grid interval and merge states.
 *
 * Intervals are derived from the markup without validating occupancy, so a
 * malformed source table still yields a footprint that compares equal to an
 * identical projection rather than throwing.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.48
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.84
 * @see https://github.com/UseJunior/safe-docx/issues/1395
 */
export function bodyTableFootprint(xml: string): BodyTableFootprint {
  const document = parseXml(xml);
  const body = document.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) return { topLevelTableBlocks: [], tables: [] };
  // Paragraph-mark projection can legitimately retain an empty paragraph.
  // Its count is not a table-topology fact, so only table-bearing top-level
  // blocks participate in this guard.
  const topLevelTableBlocks = childElements(body)
    .filter((child) => child.namespaceURI === W_NS
      && (child.localName === 'tbl' || child.getElementsByTagNameNS(W_NS, 'tbl').length > 0))
    .map((child) => child.localName);
  const tables = Array.from(body.getElementsByTagNameNS(W_NS, 'tbl')).map((table): TableFootprint => {
    let depth = 0;
    for (let parent = table.parentNode; parent && parent !== body; parent = parent.parentNode) {
      if (parent.nodeType === 1 && (parent as Element).namespaceURI === W_NS
        && (parent as Element).localName === 'tbl') depth++;
    }
    return {
      depth,
      rowContainers: childElements(table).filter((child) =>
        child.namespaceURI === W_NS && ROW_CONTAINERS.has(child.localName)).length,
      gridColumnWidths: grid(table),
      rows: wrappedChildren(table, new Set(['tr'])).map(rowFootprint),
    };
  });
  return { topLevelTableBlocks, tables };
}

/**
 * Locate the first structural difference between an expected projection
 * footprint and the comparison output's, or return null when they agree.
 */
export function findTableFootprintMismatch(
  expected: BodyTableFootprint,
  actual: BodyTableFootprint,
): TableFootprintMismatch | null {
  const blocks = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length && left.every((name, index) => name === right[index]);
  if (!blocks(expected.topLevelTableBlocks, actual.topLevelTableBlocks)) {
    return { feature: 'tableBlocks', tableIndex: -1,
      expected: expected.topLevelTableBlocks, actual: actual.topLevelTableBlocks };
  }
  if (expected.tables.length !== actual.tables.length) {
    return { feature: 'tableCount', tableIndex: Math.min(expected.tables.length, actual.tables.length),
      expected: expected.tables.length, actual: actual.tables.length };
  }
  for (let tableIndex = 0; tableIndex < expected.tables.length; tableIndex++) {
    const left = expected.tables[tableIndex]!;
    const right = actual.tables[tableIndex]!;
    const at = { tableIndex };
    if (left.depth !== right.depth) return { feature: 'nesting', ...at, expected: left.depth, actual: right.depth };
    if (left.rowContainers !== right.rowContainers) {
      return { feature: 'rowContainers', ...at, expected: left.rowContainers, actual: right.rowContainers };
    }
    if (left.gridColumnWidths.length !== right.gridColumnWidths.length) {
      return { feature: 'gridColumns', ...at,
        columnIndex: Math.min(left.gridColumnWidths.length, right.gridColumnWidths.length),
        expected: left.gridColumnWidths.length, actual: right.gridColumnWidths.length };
    }
    const widthIndex = left.gridColumnWidths.findIndex((width, column) => width !== right.gridColumnWidths[column]);
    if (widthIndex >= 0) {
      return { feature: 'gridColumnWidth', ...at, columnIndex: widthIndex,
        expected: left.gridColumnWidths[widthIndex], actual: right.gridColumnWidths[widthIndex] };
    }
    if (left.rows.length !== right.rows.length) {
      return { feature: 'rowCount', ...at, rowIndex: Math.min(left.rows.length, right.rows.length),
        expected: left.rows.length, actual: right.rows.length };
    }
    for (let rowIndex = 0; rowIndex < left.rows.length; rowIndex++) {
      const a = left.rows[rowIndex]!;
      const b = right.rows[rowIndex]!;
      const row = { ...at, rowIndex };
      if (a.gridBefore !== b.gridBefore) return { feature: 'gridBefore', ...row, expected: a.gridBefore, actual: b.gridBefore };
      if (a.gridAfter !== b.gridAfter) return { feature: 'gridAfter', ...row, expected: a.gridAfter, actual: b.gridAfter };
      if (a.cells.length !== b.cells.length) {
        return { feature: 'cellCount', ...row, cellIndex: Math.min(a.cells.length, b.cells.length),
          expected: a.cells.length, actual: b.cells.length };
      }
      for (let cellIndex = 0; cellIndex < a.cells.length; cellIndex++) {
        const x = a.cells[cellIndex]!;
        const y = b.cells[cellIndex]!;
        const cell = { ...row, cellIndex, columnIndex: x.start };
        if (x.start !== y.start || x.end !== y.end) {
          return { feature: 'cellInterval', ...cell, expected: [x.start, x.end], actual: [y.start, y.end] };
        }
        if (x.vMerge !== y.vMerge) return { feature: 'vMerge', ...cell, expected: x.vMerge, actual: y.vMerge };
        if (x.hMerge !== y.hMerge) return { feature: 'hMerge', ...cell, expected: x.hMerge, actual: y.hMerge };
      }
    }
  }
  return null;
}
