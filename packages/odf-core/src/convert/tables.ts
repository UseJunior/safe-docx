/**
 * Table emission for the DOCX → ODT converter: a contiguous run of view nodes sharing one
 * `table_context.table_id` → a complete rectangular `table:table` grid.
 *
 * Lossy by design, mirroring the HTML serializer's `renderTable`: the view model discards
 * `gridSpan`/`vMerge`, so merged cells are indistinguishable from genuinely empty grid
 * positions — gaps are filled with empty cells (recorded as `table-grid-gaps-filled`), and
 * every cell shares one thin-bordered automatic style (the view model carries no border
 * info; most Word tables are bordered).
 */

import type { DocumentViewNode } from '@usejunior/docx-core';

import { ODF_NS } from '../shared/odf/namespaces.js';
import type { LossinessCollector } from './types.js';

const CELL_STYLE_NAME = 'ConvCell';

/** Register the shared bordered table-cell automatic style (call once per document). */
export function registerCellStyle(doc: Document, automaticStyles: Element): string {
  const style = doc.createElementNS(ODF_NS.STYLE, 'style:style');
  style.setAttributeNS(ODF_NS.STYLE, 'style:name', CELL_STYLE_NAME);
  style.setAttributeNS(ODF_NS.STYLE, 'style:family', 'table-cell');
  const props = doc.createElementNS(ODF_NS.STYLE, 'style:table-cell-properties');
  props.setAttributeNS(ODF_NS.FO, 'fo:border', '0.5pt solid #000000');
  props.setAttributeNS(ODF_NS.FO, 'fo:padding', '0.0382in');
  style.appendChild(props);
  automaticStyles.appendChild(style);
  return CELL_STYLE_NAME;
}

/**
 * Append the table built from `group` to `body`. Cell paragraph content is delegated to
 * `fillParagraph` (the orchestrator's inline emitter) so this module stays cycle-free.
 */
export function appendTable(
  doc: Document,
  body: Element,
  group: DocumentViewNode[],
  tableNumber: number,
  cellStyleName: string,
  fillParagraph: (p: Element, node: DocumentViewNode) => void,
  lossiness: LossinessCollector,
): void {
  let totalCols = 0;
  for (const n of group) {
    const tc = n.table_context;
    if (!tc) continue;
    totalCols = Math.max(totalCols, tc.total_cols, tc.col_index + 1);
  }
  if (totalCols <= 0) return;

  const rows = new Map<number, Map<number, DocumentViewNode[]>>();
  const rowOrder: number[] = [];
  const headerRows = new Set<number>();
  for (const n of group) {
    const tc = n.table_context;
    if (!tc) continue;
    if (!rows.has(tc.row_index)) {
      rows.set(tc.row_index, new Map());
      rowOrder.push(tc.row_index);
    }
    const cellMap = rows.get(tc.row_index)!;
    const cellNodes = cellMap.get(tc.col_index) ?? [];
    cellNodes.push(n);
    cellMap.set(tc.col_index, cellNodes);
    if (tc.is_header_row) headerRows.add(tc.row_index);
  }
  rowOrder.sort((a, b) => a - b);
  if (rowOrder.length === 0) return;

  const table = doc.createElementNS(ODF_NS.TABLE, 'table:table');
  table.setAttributeNS(ODF_NS.TABLE, 'table:name', `Table${tableNumber}`);
  const columns = doc.createElementNS(ODF_NS.TABLE, 'table:table-column');
  columns.setAttributeNS(ODF_NS.TABLE, 'table:number-columns-repeated', String(totalCols));
  table.appendChild(columns);
  body.appendChild(table);

  const buildRow = (rowIndex: number): Element => {
    const row = doc.createElementNS(ODF_NS.TABLE, 'table:table-row');
    const cellMap = rows.get(rowIndex) ?? new Map<number, DocumentViewNode[]>();
    for (let c = 0; c < totalCols; c++) {
      const cell = doc.createElementNS(ODF_NS.TABLE, 'table:table-cell');
      cell.setAttributeNS(ODF_NS.OFFICE, 'office:value-type', 'string');
      cell.setAttributeNS(ODF_NS.TABLE, 'table:style-name', cellStyleName);
      const cellNodes = cellMap.get(c);
      if (cellNodes && cellNodes.length > 0) {
        for (const node of cellNodes) {
          const p = doc.createElementNS(ODF_NS.TEXT, 'text:p');
          p.setAttributeNS(ODF_NS.TEXT, 'text:style-name', 'Standard');
          cell.appendChild(p);
          fillParagraph(p, node);
        }
      } else {
        lossiness.add('table-grid-gaps-filled', `Table${tableNumber} r${rowIndex}c${c}`);
        cell.appendChild(doc.createElementNS(ODF_NS.TEXT, 'text:p'));
      }
      row.appendChild(cell);
    }
    return row;
  };

  // The LEADING run of header-flagged rows goes into `table:table-header-rows` (the ODF
  // analogue of the HTML serializer's `<thead>`). The view model flags `is_header_row` for
  // row 0 of every table — a heuristic, not Word's `w:tblHeader` — so in practice this is
  // the first row.
  let headerEnd = 0;
  while (headerEnd < rowOrder.length && headerRows.has(rowOrder[headerEnd]!)) headerEnd += 1;
  if (headerEnd > 0) {
    const headerContainer = doc.createElementNS(ODF_NS.TABLE, 'table:table-header-rows');
    for (let r = 0; r < headerEnd; r++) headerContainer.appendChild(buildRow(rowOrder[r]!));
    table.appendChild(headerContainer);
  }
  for (let r = headerEnd; r < rowOrder.length; r++) table.appendChild(buildRow(rowOrder[r]!));
}
