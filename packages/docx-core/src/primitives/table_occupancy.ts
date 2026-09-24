import { childElements, getDirectChildrenByName, isW } from './dom-helpers.js';
import { OOXML } from './namespaces.js';

export type MergeState = 'none' | 'restart' | 'continue';

export type OccupiedCell = {
  element: Element;
  cellIndex: number;
  start: number;
  end: number;
  merge: MergeState;
  owner: OccupiedCell;
};

export type OccupiedRow = {
  element: Element;
  rowIndex: number;
  before: number;
  after: number;
  cells: OccupiedCell[];
  slots: Array<OccupiedCell | null>;
};

export type TableOccupancy = { gridColumns: number; rows: OccupiedRow[] };

export class TableOccupancyError extends Error {
  constructor(
    readonly feature: 'occupancy' | 'gridSpan' | 'hMerge' | 'vMerge' | 'gridBefore' | 'gridAfter' | 'topologyRevision',
    readonly rowIndex: number,
    readonly cellIndex: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'TableOccupancyError';
  }
}

const RANGE_MARKERS = new Set([
  'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd',
  'permStart', 'permEnd', 'proofErr', 'moveFromRangeStart', 'moveFromRangeEnd',
  'moveToRangeStart', 'moveToRangeEnd', 'customXmlInsRangeStart',
  'customXmlInsRangeEnd', 'customXmlDelRangeStart', 'customXmlDelRangeEnd',
  'customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd',
  'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd',
]);

function oneChild(parent: Element | undefined, name: string, rowIndex: number, cellIndex?: number): Element | undefined {
  if (!parent) return undefined;
  const children = getDirectChildrenByName(parent, name);
  if (children.length > 1) {
    throw new TableOccupancyError('occupancy', rowIndex, cellIndex, `Duplicate ${name}`);
  }
  return children[0];
}

function value(element: Element): string | null {
  return element.getAttributeNS(OOXML.W_NS, 'val') ?? element.getAttribute('w:val');
}

function width(element: Element | undefined, feature: 'gridSpan' | 'gridBefore' | 'gridAfter', rowIndex: number, cellIndex?: number): number {
  if (!element) return feature === 'gridSpan' ? 1 : 0;
  const raw = value(element);
  const parsed = raw === null ? NaN : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < (feature === 'gridSpan' ? 1 : 0)) {
    throw new TableOccupancyError(feature, rowIndex, cellIndex, `Invalid ${feature} value`);
  }
  return parsed;
}

function verticalState(cell: Element, rowIndex: number, cellIndex: number): MergeState {
  const tcPr = getDirectChildrenByName(cell, 'tcPr')[0];
  const markers = tcPr ? getDirectChildrenByName(tcPr, 'vMerge') : [];
  if (markers.length > 1) throw new TableOccupancyError('vMerge', rowIndex, cellIndex, 'Duplicate vMerge');
  if (!markers.length) return 'none';
  const raw = value(markers[0]!);
  if (raw === null || raw === 'continue') return 'continue';
  if (raw === 'restart') return 'restart';
  throw new TableOccupancyError('vMerge', rowIndex, cellIndex, `Invalid vMerge value: ${raw}`);
}

/**
 * Inventory direct physical cells in logical grid coordinates without rewriting XML.
 * Each continuation points to the restart cell owning the exact same interval.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.48
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.23
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.84
 * @see #1040
 */
export function inventoryTableOccupancy(table: Element): TableOccupancy {
  const grids = getDirectChildrenByName(table, 'tblGrid');
  const gridColumns = grids.length === 1 ? getDirectChildrenByName(grids[0]!, 'gridCol').length : 0;
  if (gridColumns < 1) throw new TableOccupancyError('occupancy', -1, undefined, 'Table must have one nonempty tblGrid');
  if (grids[0]!.getElementsByTagNameNS(OOXML.W_NS, 'tblGridChange').length) {
    throw new TableOccupancyError('topologyRevision', -1, undefined, 'Tracked grid changes are unsupported');
  }

  const rows: OccupiedRow[] = [];
  let previousActive = new Map<string, OccupiedCell>();
  for (const rowElement of childElements(table)) {
    if (isW(rowElement, 'tblPr') || isW(rowElement, 'tblGrid') || RANGE_MARKERS.has(rowElement.localName)) continue;
    const rowIndex = rows.length;
    if (!isW(rowElement, 'tr')) throw new TableOccupancyError('occupancy', rowIndex, undefined, 'Unsupported row container');
    if (getDirectChildrenByName(rowElement, 'tblPrEx').length) {
      throw new TableOccupancyError('topologyRevision', rowIndex, undefined, 'Row table-property exceptions are unsupported');
    }
    const trPr = oneChild(rowElement, 'trPr', rowIndex);
    if (trPr && getDirectChildrenByName(trPr, 'trPrChange').length) {
      throw new TableOccupancyError('topologyRevision', rowIndex, undefined, 'Pending row-property changes are unsupported');
    }
    const before = width(oneChild(trPr, 'gridBefore', rowIndex), 'gridBefore', rowIndex);
    const after = width(oneChild(trPr, 'gridAfter', rowIndex), 'gridAfter', rowIndex);
    if (before + after >= gridColumns) {
      throw new TableOccupancyError('occupancy', rowIndex, undefined, 'Row offsets leave no physical cell slots');
    }
    const cells: OccupiedCell[] = [];
    const slots: Array<OccupiedCell | null> = Array(gridColumns).fill(null);
    const currentActive = new Map<string, OccupiedCell>();
    let column = before;
    for (const cellElement of childElements(rowElement)) {
      if (isW(cellElement, 'trPr') || RANGE_MARKERS.has(cellElement.localName)) continue;
      const cellIndex = cells.length;
      if (!isW(cellElement, 'tc')) {
        throw new TableOccupancyError('occupancy', rowIndex, cellIndex, 'Unsupported cell container');
      }
      const tcPr = oneChild(cellElement, 'tcPr', rowIndex, cellIndex);
      if (tcPr && getDirectChildrenByName(tcPr, 'hMerge').length) {
        throw new TableOccupancyError('hMerge', rowIndex, cellIndex, 'Legacy hMerge is unsupported');
      }
      if (tcPr && ['cellIns', 'cellDel', 'cellMerge', 'tcPrChange'].some((name) => getDirectChildrenByName(tcPr, name).length > 0)) {
        throw new TableOccupancyError('topologyRevision', rowIndex, cellIndex, 'Pending cell topology changes are unsupported');
      }
      const span = width(oneChild(tcPr, 'gridSpan', rowIndex, cellIndex), 'gridSpan', rowIndex, cellIndex);
      const end = column + span;
      if (end > gridColumns - after) {
        throw new TableOccupancyError('occupancy', rowIndex, cellIndex, 'Cell extends beyond effective grid');
      }
      const merge = verticalState(cellElement, rowIndex, cellIndex);
      const interval = `${column}:${end}`;
      const previousOwner = previousActive.get(interval);
      if (merge === 'continue' && !previousOwner) {
        throw new TableOccupancyError('vMerge', rowIndex, cellIndex, 'Orphan or changed-width continuation');
      }
      const occupied = { element: cellElement, cellIndex, start: column, end, merge, owner: null! } as OccupiedCell;
      occupied.owner = merge === 'continue' ? previousOwner! : occupied;
      cells.push(occupied);
      for (let slot = column; slot < end; slot++) slots[slot] = occupied;
      if (merge !== 'none') currentActive.set(interval, occupied.owner);
      column = end;
    }
    if (column !== gridColumns - after || cells.length === 0) {
      throw new TableOccupancyError('occupancy', rowIndex, undefined, 'Row occupancy does not match tblGrid and offsets');
    }
    rows.push({ element: rowElement, rowIndex, before, after, cells, slots });
    previousActive = currentActive;
  }
  if (!rows.length) throw new TableOccupancyError('occupancy', -1, undefined, 'Table has no direct rows');
  return { gridColumns, rows };
}
