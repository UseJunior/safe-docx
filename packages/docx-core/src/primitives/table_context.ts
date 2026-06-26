import { OOXML, W } from './namespaces.js';
import { isW, getDirectChildrenByName } from './dom-helpers.js';
import { getParagraphText } from './text.js';
import type { TableContext } from './document_view-types.js';

// ── Table context derivation for the document view ───────────────────
//
// Extracted from document.ts so BOTH `DocxDocument.buildDocumentView()` and the
// free `buildDocumentView()` can derive identical table context without a
// circular import (document.ts already imports from document_view.ts).

export type TableMeta = {
  tableIndex: number;
  tableId: string;
  rows: Element[];
  headers: string[];
  totalCols: number;
};

/**
 * Collect all w:tr descendants of a table element, descending through
 * w:ins/w:del/w:sdt wrappers but not into nested w:tbl elements.
 */
function collectTableRows(tbl: Element): Element[] {
  const rows: Element[] = [];
  function walk(parent: Element) {
    for (let i = 0; i < parent.childNodes.length; i++) {
      const child = parent.childNodes[i]!;
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (isW(el, W.tr)) {
        rows.push(el);
      } else if (!isW(el, W.tbl)) {
        walk(el);
      }
    }
  }
  walk(tbl);
  return rows;
}

/**
 * Collect all w:tc descendants of a row element, descending through
 * w:ins/w:del/w:sdt wrappers but not into nested w:tr or w:tbl elements.
 */
function collectRowCells(tr: Element): Element[] {
  const cells: Element[] = [];
  function walk(parent: Element) {
    for (let i = 0; i < parent.childNodes.length; i++) {
      const child = parent.childNodes[i]!;
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (isW(el, W.tc)) {
        cells.push(el);
      } else if (!isW(el, W.tr) && !isW(el, W.tbl)) {
        walk(el);
      }
    }
  }
  walk(tr);
  return cells;
}

/** Get the gridSpan value for a table cell (default 1). */
function getCellGridSpan(tc: Element): number {
  const tcPrList = getDirectChildrenByName(tc, W.tcPr);
  if (tcPrList.length === 0) return 1;
  const gridSpanEls = getDirectChildrenByName(tcPrList[0]!, 'gridSpan');
  if (gridSpanEls.length === 0) return 1;
  const val =
    gridSpanEls[0]!.getAttributeNS(OOXML.W_NS, W.val) ??
    gridSpanEls[0]!.getAttribute('w:val') ??
    gridSpanEls[0]!.getAttribute(W.val);
  if (!val) return 1;
  const n = parseInt(val, 10);
  return n > 0 ? n : 1;
}

/** Get visible text from a cell's direct paragraphs (excludes nested tables). */
function getCellHeaderText(tc: Element): string {
  const parts: string[] = [];
  for (let i = 0; i < tc.childNodes.length; i++) {
    const child = tc.childNodes[i]!;
    if (child.nodeType === 1 && isW(child as Element, W.p)) {
      parts.push(getParagraphText(child as Element).trim());
    }
  }
  return parts.join(' ').trim();
}

/**
 * Build metadata map for body-level tables.
 * Only indexes direct w:tbl children of w:body (consistent with extractTables).
 */
export function buildTableMetaMap(body: Element): Map<Element, TableMeta> {
  const map = new Map<Element, TableMeta>();
  const tables = getDirectChildrenByName(body, W.tbl);

  for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
    const tbl = tables[tableIndex]!;
    const rows = collectTableRows(tbl);
    if (rows.length === 0) continue;

    // Compute max grid columns across all rows
    let maxGridCols = 0;
    for (const row of rows) {
      const cells = collectRowCells(row);
      let gridCols = 0;
      for (const cell of cells) {
        gridCols += getCellGridSpan(cell);
      }
      if (gridCols > maxGridCols) maxGridCols = gridCols;
    }

    // Extract headers from row 0
    const headerRow = rows[0]!;
    const headerCells = collectRowCells(headerRow);
    const headers: string[] = [];
    for (const cell of headerCells) {
      const span = getCellGridSpan(cell);
      const text = getCellHeaderText(cell);
      headers.push(text);
      for (let s = 1; s < span; s++) headers.push('');
    }
    while (headers.length < maxGridCols) headers.push('');
    if (headers.length > maxGridCols) headers.length = maxGridCols;

    map.set(tbl, {
      tableIndex,
      tableId: `_tbl_${tableIndex}`,
      rows,
      headers,
      totalCols: maxGridCols,
    });
  }

  return map;
}

/**
 * Derive table context for a paragraph by walking up the DOM.
 * Returns undefined if the paragraph is not inside a body-level table.
 */
export function deriveTableContext(p: Element, tableMetaMap: Map<Element, TableMeta>): TableContext | undefined {
  let tc: Element | null = null;
  let tr: Element | null = null;
  let tbl: Element | null = null;

  let current: Node | null = p.parentNode;
  while (current && current.nodeType === 1) {
    const el = current as Element;
    if (isW(el, W.body)) break;

    if (isW(el, W.tc)) tc = el;
    if (isW(el, W.tr)) tr = el;
    if (isW(el, W.tbl)) {
      if (tableMetaMap.has(el)) {
        tbl = el;
        break;
      }
      // Nested table: reset tc/tr, keep walking to find body-level table
      tc = null;
      tr = null;
    }

    current = el.parentNode;
  }

  if (!tbl || !tr || !tc) return undefined;

  const meta = tableMetaMap.get(tbl)!;

  // Compute row_index
  const rowIndex = meta.rows.indexOf(tr);
  if (rowIndex < 0) return undefined;

  // Compute grid-aware col_index by summing gridSpan for preceding cells
  const rowCells = collectRowCells(tr);
  let gridCol = 0;
  let cellFound = false;
  for (const cell of rowCells) {
    if (cell === tc) {
      cellFound = true;
      break;
    }
    gridCol += getCellGridSpan(cell);
  }
  if (!cellFound) return undefined;

  // Compute para_in_cell and cell_para_count
  const allCellPs = Array.from(tc.getElementsByTagNameNS(OOXML.W_NS, W.p));
  const paraInCell = allCellPs.indexOf(p);

  return {
    table_id: meta.tableId,
    table_index: meta.tableIndex,
    row_index: rowIndex,
    col_index: gridCol,
    col_header: meta.headers[gridCol] ?? '',
    total_rows: meta.rows.length,
    total_cols: meta.totalCols,
    is_header_row: rowIndex === 0,
    para_in_cell: paraInCell >= 0 ? paraInCell : 0,
    cell_para_count: allCellPs.length,
  };
}
