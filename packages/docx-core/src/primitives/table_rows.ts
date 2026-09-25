import {
  insertSingleParagraphBookmark,
  findParagraphByBookmarkId,
  type BookmarkReservation,
} from './bookmarks.js';
import { childElements, createWmlElement, getDirectChildrenByName, isW } from './dom-helpers.js';
import { SafeDocxError } from './errors.js';
import { OOXML } from './namespaces.js';
import { inventoryTableOccupancy, TableOccupancyError } from './table_occupancy.js';
import { allocateRevisionId, createRevisionContainer, type RevisionContext } from './track-changes-emitter.js';

export type TableRowEditFeature =
  | 'gridSpan' | 'hMerge' | 'vMerge' | 'gridBefore' | 'gridAfter'
  | 'nestedTable' | 'rowContainer' | 'cellContainer' | 'tblPrEx'
  | 'occupancy' | 'trailingParagraph' | 'topologyRevision'
  | 'lastRow' | 'nestedAnchor' | 'alreadyInserted' | 'alreadyDeleted';

export type TableRowEditDetail = {
  anchorId: string;
  tableIndex: number;
  rowIndex: number;
  cellIndex?: number;
  childIndex?: number;
  feature: TableRowEditFeature;
};

export type InsertTableRowParams = {
  positionalAnchorNodeId: string;
  relativePosition: 'BEFORE' | 'AFTER';
  cellTexts: string[];
  /** @experimental Opt into validated horizontal spans; vertical merges still fail closed. */
  mergeAware?: boolean;
};

export type InsertTableRowResult = { rowIndex: number; cellParagraphIds: string[] };
export type DeleteTableRowParams = {
  targetParagraphId: string;
  /** @experimental Opt into validated horizontal spans; vertical merges still fail closed. */
  mergeAware?: boolean;
};
export type DeleteTableRowResult = { rowIndex: number; deleted: true };

type TableShape = {
  table: Element;
  rows: Element[];
  anchorRow: Element;
  rowIndex: number;
  tableIndex: number;
  cells: Element[][];
};

const ALLOWED_TABLE_RANGE_MARKERS = new Set([
  'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd',
  'permStart', 'permEnd', 'proofErr', 'moveFromRangeStart', 'moveFromRangeEnd',
  'moveToRangeStart', 'moveToRangeEnd', 'customXmlInsRangeStart',
  'customXmlInsRangeEnd', 'customXmlDelRangeStart', 'customXmlDelRangeEnd',
  'customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd',
  'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd',
]);
const TRPR_EXCLUDED = new Set(['cnfStyle', 'tblHeader', 'hidden', 'divId', 'ins', 'del', 'trPrChange']);
const TCPR_EXCLUDED = new Set(['cnfStyle', 'hideMark', 'cellIns', 'cellDel', 'cellMerge', 'tcPrChange']);
const PPR_EXCLUDED = new Set(['numPr', 'sectPr', 'pPrChange']);
const RPR_EXCLUDED = new Set(['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange']);
const RANGE_PAIRS = [
  ['bookmarkStart', 'bookmarkEnd'], ['commentRangeStart', 'commentRangeEnd'],
  ['permStart', 'permEnd'], ['moveFromRangeStart', 'moveFromRangeEnd'],
  ['moveToRangeStart', 'moveToRangeEnd'],
  ['customXmlInsRangeStart', 'customXmlInsRangeEnd'],
  ['customXmlDelRangeStart', 'customXmlDelRangeEnd'],
  ['customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd'],
  ['customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd'],
] as const;

function markerId(marker: Element): string | null {
  return marker.getAttributeNS(OOXML.W_NS, 'id') ?? marker.getAttribute('w:id');
}

/** Remove the surviving half of any supported range cut by subtree removal. */
export function removeOrphanedRangeEndpointsForSubtree(root: Element, subtree: Element): void {
  for (const [startName, endName] of RANGE_PAIRS) {
    const starts = Array.from(root.getElementsByTagNameNS(OOXML.W_NS, startName));
    const ends = Array.from(root.getElementsByTagNameNS(OOXML.W_NS, endName));
    for (const start of starts) {
      const id = markerId(start);
      if (!id) continue;
      const end = ends.find((candidate) => markerId(candidate) === id);
      if (!end) continue;
      const startInside = subtree === start || subtree.contains(start);
      const endInside = subtree === end || subtree.contains(end);
      if (startInside !== endInside) {
        const survivor = startInside ? end : start;
        survivor.parentNode?.removeChild(survivor);
      }
    }
  }
}

/**
 * Resolve a deleted or rejected row without discarding surviving row containers.
 * A table-level sdt/customXml child can hold rows even when no direct tr remains.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @see #1073
 */
export function removeTableRowAndEmptyTable(root: Element, row: Element): void {
  const wrappers: Element[] = [];
  let parent = row.parentNode;
  while (parent?.nodeType === 1 && !isW(parent as Element, 'tbl')) {
    if (isW(parent as Element, 'sdtContent') && parent.parentNode?.nodeType === 1
      && isW(parent.parentNode as Element, 'sdt')) {
      wrappers.push(parent.parentNode as Element);
      parent = parent.parentNode.parentNode;
    } else if (isW(parent as Element, 'customXml')) {
      wrappers.push(parent as Element);
      parent = parent.parentNode;
    } else {
      return;
    }
  }
  if (!parent || parent.nodeType !== 1 || !isW(parent as Element, 'tbl')) return;
  const table = parent as Element;
  removeOrphanedRangeEndpointsForSubtree(root, row);
  row.parentNode?.removeChild(row);
  for (const wrapper of wrappers) {
    if (wrapper.getElementsByTagNameNS(OOXML.W_NS, 'tr').length === 0) {
      removeOrphanedRangeEndpointsForSubtree(root, wrapper);
      wrapper.parentNode?.removeChild(wrapper);
    }
  }
  if (!childElements(table).some((child) =>
    isW(child, 'tr') || isW(child, 'sdt') || isW(child, 'customXml'))) {
    table.parentNode?.removeChild(table);
  }
}

/**
 * Remove a resolved row marker and its now-empty property container.
 * An authored empty trPr is normalized to absence after row resolution.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @see #1040
 */
export function removeResolvedRowMarker(marker: Element): void {
  const trPr = marker.parentNode;
  trPr?.removeChild(marker);
  if (trPr?.nodeType === 1 && isW(trPr as Element, 'trPr')
    && childElements(trPr as Element).length === 0 && (trPr as Element).attributes.length === 0) {
    trPr.parentNode?.removeChild(trPr);
  }
}

function nearestWAncestor(node: Node | null, localName: string): Element | null {
  let current = node?.parentNode ?? null;
  while (current) {
    if (current.nodeType === 1 && isW(current as Element, localName)) return current as Element;
    current = current.parentNode;
  }
  return null;
}

function detail(anchorId: string, tableIndex: number, rowIndex: number, feature: TableRowEditFeature, extra?: Partial<TableRowEditDetail>): TableRowEditDetail {
  return { anchorId, tableIndex, rowIndex, feature, ...extra };
}

function fail(code: 'UNSUPPORTED_EDIT' | 'INVALID_ARGUMENT', message: string, info: TableRowEditDetail): never {
  throw new SafeDocxError(code, message, undefined, info);
}

function directBodyTables(body: Element): Element[] {
  return childElements(body).filter((element) => isW(element, 'tbl'));
}

/**
 * Validate a phase-one table-row target without mutating the DOM.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.48
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.65
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.23
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.84
 * @see #764
 */
function resolveTableShape(doc: Document, anchorId: string, mergeAware = false): TableShape {
  const paragraph = findParagraphByBookmarkId(doc, anchorId);
  if (!paragraph) {
    fail('INVALID_ARGUMENT', `Paragraph anchor not found: ${anchorId}`, detail(anchorId, -1, -1, 'nestedAnchor'));
  }
  const cell = nearestWAncestor(paragraph, 'tc');
  const row = nearestWAncestor(paragraph, 'tr');
  const table = nearestWAncestor(paragraph, 'tbl');
  const body = nearestWAncestor(table, 'body');
  if (!cell || !row || !table || !body || row.parentNode !== table || table.parentNode !== body) {
    fail('UNSUPPORTED_EDIT', 'Table row anchor must resolve to a direct row in a body-level table', detail(anchorId, -1, -1, 'nestedAnchor'));
  }
  const tableIndex = directBodyTables(body).indexOf(table);
  const grid = getDirectChildrenByName(table, 'tblGrid')[0];
  const gridColumns = grid ? getDirectChildrenByName(grid, 'gridCol').length : 0;
  if (gridColumns < 1) fail('UNSUPPORTED_EDIT', 'Table has no direct grid columns', detail(anchorId, tableIndex, -1, 'occupancy'));
  if (grid && grid.getElementsByTagNameNS(OOXML.W_NS, 'tblGridChange').length > 0) {
    fail('UNSUPPORTED_EDIT', 'Table grid has tracked topology', detail(anchorId, tableIndex, -1, 'topologyRevision'));
  }

  const rows: Element[] = [];
  for (const [childIndex, child] of childElements(table).entries()) {
    if (isW(child, 'tblPr') || isW(child, 'tblGrid') || ALLOWED_TABLE_RANGE_MARKERS.has(child.localName)) continue;
    if (!isW(child, 'tr')) {
      fail('UNSUPPORTED_EDIT', 'Table contains an unsupported row container', detail(anchorId, tableIndex, rows.length, 'rowContainer', { childIndex }));
    }
    rows.push(child);
  }
  const rowIndex = rows.indexOf(row);
  if (rowIndex < 0) fail('UNSUPPORTED_EDIT', 'Anchor row is not a direct table row', detail(anchorId, tableIndex, -1, 'nestedAnchor'));

  const cells: Element[][] = [];
  for (const [currentRowIndex, currentRow] of rows.entries()) {
    const tblPrEx = getDirectChildrenByName(currentRow, 'tblPrEx')[0];
    if (tblPrEx?.getElementsByTagNameNS(OOXML.W_NS, 'tblPrExChange').length) {
      fail('UNSUPPORTED_EDIT', 'Row contains a topology revision', detail(anchorId, tableIndex, currentRowIndex, 'topologyRevision'));
    }
    if (tblPrEx) {
      fail('UNSUPPORTED_EDIT', 'Row carries table-property exceptions', detail(anchorId, tableIndex, currentRowIndex, 'tblPrEx'));
    }
    const trPr = getDirectChildrenByName(currentRow, 'trPr')[0];
    for (const feature of ['gridBefore', 'gridAfter'] as const) {
      if (trPr && getDirectChildrenByName(trPr, feature).length > 0) {
        fail('UNSUPPORTED_EDIT', `Row uses ${feature}`, detail(anchorId, tableIndex, currentRowIndex, feature));
      }
    }
    if (trPr?.getElementsByTagNameNS(OOXML.W_NS, 'trPrChange').length) {
      const snapshot = trPr.getElementsByTagNameNS(OOXML.W_NS, 'trPrChange').item(0)!;
      if (snapshot.getElementsByTagNameNS(OOXML.W_NS, 'gridBefore').length || snapshot.getElementsByTagNameNS(OOXML.W_NS, 'gridAfter').length) {
        fail('UNSUPPORTED_EDIT', 'Row property change affects topology', detail(anchorId, tableIndex, currentRowIndex, 'topologyRevision'));
      }
    }
    const rowCells: Element[] = [];
    for (const [childIndex, child] of childElements(currentRow).entries()) {
      if (isW(child, 'trPr') || isW(child, 'tblPrEx') || ALLOWED_TABLE_RANGE_MARKERS.has(child.localName)) continue;
      if (!isW(child, 'tc')) {
        fail('UNSUPPORTED_EDIT', 'Row contains an unsupported cell container', detail(anchorId, tableIndex, currentRowIndex, 'cellContainer', { childIndex }));
      }
      rowCells.push(child);
    }
    if (!mergeAware && rowCells.length !== gridColumns) {
      fail('UNSUPPORTED_EDIT', 'Row occupancy does not match tblGrid', detail(anchorId, tableIndex, currentRowIndex, 'occupancy'));
    }
    for (const [cellIndex, currentCell] of rowCells.entries()) {
      const tcPr = getDirectChildrenByName(currentCell, 'tcPr')[0];
      for (const feature of (mergeAware ? ['hMerge', 'vMerge'] : ['gridSpan', 'hMerge', 'vMerge']) as Array<'gridSpan' | 'hMerge' | 'vMerge'>) {
        if (tcPr && getDirectChildrenByName(tcPr, feature).length > 0) {
          fail('UNSUPPORTED_EDIT', `Cell uses ${feature}`, detail(anchorId, tableIndex, currentRowIndex, feature, { cellIndex }));
        }
      }
      const tcPrChange = tcPr ? getDirectChildrenByName(tcPr, 'tcPrChange')[0] : undefined;
      if (tcPrChange && (tcPrChange.getElementsByTagNameNS(OOXML.W_NS, 'gridSpan').length
        || tcPrChange.getElementsByTagNameNS(OOXML.W_NS, 'vMerge').length)) {
        fail('UNSUPPORTED_EDIT', 'Cell property change affects topology', detail(anchorId, tableIndex, currentRowIndex, 'topologyRevision', { cellIndex }));
      }
      if (currentCell.getElementsByTagNameNS(OOXML.W_NS, 'tbl').length > 0) {
        fail('UNSUPPORTED_EDIT', 'Cell contains a nested table', detail(anchorId, tableIndex, currentRowIndex, 'nestedTable', { cellIndex }));
      }
      for (const revision of ['cellIns', 'cellDel', 'cellMerge', 'tblPrExChange']) {
        if (currentCell.getElementsByTagNameNS(OOXML.W_NS, revision).length > 0) {
          fail('UNSUPPORTED_EDIT', 'Cell contains a topology revision', detail(anchorId, tableIndex, currentRowIndex, 'topologyRevision', { cellIndex }));
        }
      }
      const blocks = childElements(currentCell).filter((child) =>
        !isW(child, 'tcPr') && !ALLOWED_TABLE_RANGE_MARKERS.has(child.localName));
      if (!blocks.length || !isW(blocks[blocks.length - 1]!, 'p')) {
        fail('UNSUPPORTED_EDIT', 'Cell does not end in a direct paragraph', detail(anchorId, tableIndex, currentRowIndex, 'trailingParagraph', { cellIndex }));
      }
    }
    cells.push(rowCells);
  }
  if (mergeAware) {
    try {
      inventoryTableOccupancy(table);
    } catch (error) {
      if (!(error instanceof TableOccupancyError)) throw error;
      fail('UNSUPPORTED_EDIT', error.message, detail(anchorId, tableIndex, error.rowIndex, error.feature, { cellIndex: error.cellIndex }));
    }
  }
  return { table, rows, anchorRow: row, rowIndex, tableIndex, cells };
}

function cloneFilteredProperties(source: Element | undefined, localName: string, excluded: Set<string>): Element | null {
  if (!source) return null;
  const doc = source.ownerDocument!;
  const clone = createWmlElement(doc, localName);
  for (let i = 0; i < source.attributes.length; i++) {
    const attribute = source.attributes.item(i)!;
    clone.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
  }
  for (const child of childElements(source)) {
    if (!excluded.has(child.localName)) clone.appendChild(child.cloneNode(true));
  }
  return clone;
}

function appendRevisionMarker(parent: Element, kind: 'ins' | 'del', ctx: RevisionContext): void {
  const marker = createWmlElement(parent.ownerDocument!, kind, {
    'w:id': String(allocateRevisionId(ctx.idState)), 'w:author': ctx.author, 'w:date': ctx.date,
  });
  const change = getDirectChildrenByName(parent, 'trPrChange')[0];
  parent.insertBefore(marker, change ?? null);
}

function ensureParagraphMarker(paragraph: Element, kind: 'ins' | 'del', ctx: RevisionContext): void {
  let pPr = getDirectChildrenByName(paragraph, 'pPr')[0];
  if (!pPr) { pPr = createWmlElement(paragraph.ownerDocument!, 'pPr'); paragraph.insertBefore(pPr, paragraph.firstChild); }
  let rPr = getDirectChildrenByName(pPr, 'rPr')[0];
  if (!rPr) {
    rPr = createWmlElement(paragraph.ownerDocument!, 'rPr');
    const before = getDirectChildrenByName(pPr, 'sectPr')[0]
      ?? getDirectChildrenByName(pPr, 'pPrChange')[0]
      ?? null;
    pPr.insertBefore(rPr, before);
  }
  const marker = createWmlElement(paragraph.ownerDocument!, kind, {
    'w:id': String(allocateRevisionId(ctx.idState)), 'w:author': ctx.author, 'w:date': ctx.date,
  });
  rPr.insertBefore(marker, rPr.firstChild);
}

function appendText(run: Element, text: string): void {
  const t = createWmlElement(run.ownerDocument!, 't');
  if (text.startsWith(' ') || text.endsWith(' ')) t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  t.appendChild(run.ownerDocument!.createTextNode(text));
  run.appendChild(t);
}

/** Insert a rectangular unmerged row using an anchored row's safe formatting shell. */
export function insertTableRow(
  doc: Document,
  params: InsertTableRowParams,
  ctx?: RevisionContext,
  bookmarkReservation?: BookmarkReservation,
): InsertTableRowResult {
  const shape = resolveTableShape(doc, params.positionalAnchorNodeId, params.mergeAware);
  const anchorCells = shape.cells[shape.rowIndex]!;
  if (params.cellTexts.length !== anchorCells.length) {
    fail('INVALID_ARGUMENT', 'cellTexts must match the table grid column count', detail(params.positionalAnchorNodeId, shape.tableIndex, shape.rowIndex, 'occupancy'));
  }
  const newRow = createWmlElement(doc, 'tr');
  const trPr = cloneFilteredProperties(getDirectChildrenByName(shape.anchorRow, 'trPr')[0], 'trPr', TRPR_EXCLUDED) ?? createWmlElement(doc, 'trPr');
  if (ctx) appendRevisionMarker(trPr, 'ins', ctx);
  if (trPr.childNodes.length > 0) newRow.appendChild(trPr);

  const newParagraphs: Element[] = [];
  for (const [cellIndex, text] of params.cellTexts.entries()) {
    const sourceCell = anchorCells[cellIndex]!;
    const newCell = createWmlElement(doc, 'tc');
    const tcPr = cloneFilteredProperties(getDirectChildrenByName(sourceCell, 'tcPr')[0], 'tcPr', TCPR_EXCLUDED);
    if (tcPr) newCell.appendChild(tcPr);
    const sourceParagraph = getDirectChildrenByName(sourceCell, 'p')[0];
    const paragraph = createWmlElement(doc, 'p');
    const pPr = cloneFilteredProperties(sourceParagraph ? getDirectChildrenByName(sourceParagraph, 'pPr')[0] : undefined, 'pPr', PPR_EXCLUDED);
    if (pPr) {
      const markRPr = getDirectChildrenByName(pPr, 'rPr')[0];
      if (markRPr) for (const child of childElements(markRPr)) if (RPR_EXCLUDED.has(child.localName)) markRPr.removeChild(child);
      paragraph.appendChild(pPr);
    }
    const run = createWmlElement(doc, 'r');
    const sourceMarkRPr = pPr ? getDirectChildrenByName(pPr, 'rPr')[0] : undefined;
    const runRPr = cloneFilteredProperties(sourceMarkRPr, 'rPr', RPR_EXCLUDED);
    if (runRPr) run.appendChild(runRPr);
    appendText(run, text);
    if (ctx) {
      ensureParagraphMarker(paragraph, 'ins', ctx);
      const wrapper = createRevisionContainer(doc, 'ins', ctx);
      wrapper.appendChild(run);
      paragraph.appendChild(wrapper);
    } else paragraph.appendChild(run);
    newCell.appendChild(paragraph);
    newRow.appendChild(newCell);
    newParagraphs.push(paragraph);
  }

  const ref = params.relativePosition === 'BEFORE' ? shape.anchorRow : shape.anchorRow.nextSibling;
  shape.table.insertBefore(newRow, ref);
  const cellParagraphIds = newParagraphs.map((paragraph) =>
    insertSingleParagraphBookmark(doc, paragraph, bookmarkReservation));
  return { rowIndex: shape.rowIndex + (params.relativePosition === 'AFTER' ? 1 : 0), cellParagraphIds };
}

/** Delete or deletion-mark a rectangular unmerged row. */
export function deleteTableRow(doc: Document, params: DeleteTableRowParams, ctx?: RevisionContext): DeleteTableRowResult {
  const shape = resolveTableShape(doc, params.targetParagraphId, params.mergeAware);
  if (shape.rows.length === 1) fail('INVALID_ARGUMENT', 'Cannot delete the final table row', detail(params.targetParagraphId, shape.tableIndex, shape.rowIndex, 'lastRow'));
  if (!ctx) {
    removeOrphanedRangeEndpointsForSubtree(doc.documentElement, shape.anchorRow);
    shape.table.removeChild(shape.anchorRow);
    return { rowIndex: shape.rowIndex, deleted: true };
  }
  let trPr = getDirectChildrenByName(shape.anchorRow, 'trPr')[0];
  if (!trPr) { trPr = createWmlElement(doc, 'trPr'); shape.anchorRow.insertBefore(trPr, shape.anchorRow.firstChild); }
  if (getDirectChildrenByName(trPr, 'ins').length) fail('INVALID_ARGUMENT', 'Cannot deletion-mark an already inserted row', detail(params.targetParagraphId, shape.tableIndex, shape.rowIndex, 'alreadyInserted'));
  if (getDirectChildrenByName(trPr, 'del').length) fail('INVALID_ARGUMENT', 'Row is already deletion-marked', detail(params.targetParagraphId, shape.tableIndex, shape.rowIndex, 'alreadyDeleted'));
  appendRevisionMarker(trPr, 'del', ctx);
  for (const cell of shape.cells[shape.rowIndex]!) {
    const paragraphs = getDirectChildrenByName(cell, 'p');
    for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
      if (paragraphIndex < paragraphs.length - 1) ensureParagraphMarker(paragraph, 'del', ctx);
      for (const run of Array.from(paragraph.getElementsByTagNameNS(OOXML.W_NS, 'r'))) {
        const parent = run.parentNode;
        const parentElement = parent?.nodeType === 1 ? parent as Element : null;
        if (!parentElement || isW(parentElement, 'ins') || isW(parentElement, 'del') || isW(parentElement, 'moveFrom') || isW(parentElement, 'moveTo')) continue;
        const wrapper = createRevisionContainer(doc, 'del', ctx);
        const cloned = run.cloneNode(true) as Element;
        for (const text of Array.from(cloned.getElementsByTagNameNS(OOXML.W_NS, 't'))) {
          const renamed = createWmlElement(doc, 'delText');
          for (let i = 0; i < text.attributes.length; i++) { const a = text.attributes.item(i)!; renamed.setAttributeNS(a.namespaceURI, a.name, a.value); }
          while (text.firstChild) renamed.appendChild(text.firstChild);
          text.parentNode?.replaceChild(renamed, text);
        }
        wrapper.appendChild(cloned);
        parentElement.replaceChild(wrapper, run);
      }
    }
  }
  return { rowIndex: shape.rowIndex, deleted: true };
}
