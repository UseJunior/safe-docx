/**
 * Table emission for the DOCX → ODT converter: a contiguous run of view nodes sharing one
 * `table_context.table_id` → a complete rectangular `table:table` grid.
 *
 * Lossy by design, mirroring the HTML serializer's `renderTable`: the view model discards
 * `gridSpan`/`vMerge`, so merged cells are indistinguishable from genuinely empty grid
 * positions — gaps are filled with empty cells (recorded as `table-grid-gaps-filled`).
 * Borders and column widths come from the raw source `w:tbl` (#406 phase 3): an explicit
 * `w:tblBorders` is honored uniformly per table (including explicitly borderless tables) and
 * `w:tblGrid` widths become `table:table-column` styles. Tables without explicit borders keep
 * the 0.5pt default (most Word tables are bordered via their table style, whose `w:tblPr`
 * the styles model does not carry). Per-cell `w:tcBorders` overrides are out of scope.
 */

import { W_NS, type DocumentViewNode } from '@usejunior/docx-core';

import { ODF_NS } from '../shared/odf/namespaces.js';
import type { LossinessCollector } from './types.js';

/** The `fo:border` applied when the source declares no explicit `w:tblBorders`. */
const DEFAULT_BORDER_SPEC = '0.5pt solid #000000';

/** OOXML `ST_Border` → ODF border line style (anything unmapped degrades to solid). */
const BORDER_STYLE_MAP: Record<string, string> = {
  single: 'solid',
  double: 'double',
  dotted: 'dotted',
  dashed: 'dashed',
};

function firstChildNS(parent: Element | null, localName: string): Element | null {
  if (!parent) return null;
  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes[i]!;
    if (child.nodeType === 1 && (child as Element).localName === localName && (child as Element).namespaceURI === W_NS) {
      return child as Element;
    }
  }
  return null;
}

function wAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(W_NS, localName) || el.getAttribute(`w:${localName}`) || null;
}

/**
 * Resolve the uniform `fo:border` for a table from its explicit `w:tblBorders`, preferring
 * inside edges (what most cells show). Explicitly border-free tables return `'none'`; tables
 * without a `w:tblBorders` at all return the bordered default.
 */
export function resolveTableBorderSpec(tbl: Element | null): string {
  const tblPr = firstChildNS(tbl, 'tblPr');
  const borders = firstChildNS(tblPr, 'tblBorders');
  if (!borders) return DEFAULT_BORDER_SPEC;

  const candidates = ['insideH', 'insideV', 'top', 'bottom', 'left', 'right']
    .map((edge) => firstChildNS(borders, edge))
    .filter((el): el is Element => el !== null);
  if (candidates.length === 0) return DEFAULT_BORDER_SPEC;

  for (const edge of candidates) {
    const val = wAttr(edge, 'val') ?? 'none';
    if (val === 'none' || val === 'nil') continue;
    // w:sz is eighths of a point; absent → Word's hairline default (≈0.5pt).
    const szRaw = Number(wAttr(edge, 'sz') ?? NaN);
    const widthPt = Number.isFinite(szRaw) && szRaw > 0 ? Number((szRaw / 8).toFixed(2)) : 0.5;
    const colorRaw = wAttr(edge, 'color');
    const color = colorRaw && /^[0-9A-Fa-f]{6}$/.test(colorRaw) ? `#${colorRaw.toLowerCase()}` : '#000000';
    return `${widthPt}pt ${BORDER_STYLE_MAP[val] ?? 'solid'} ${color}`;
  }
  return 'none'; // every declared edge was explicitly none/nil
}

/** Column widths in points from `w:tblGrid/w:gridCol` (`w:w` is twips); empty when absent. */
export function readGridColWidthsPt(tbl: Element | null): number[] {
  const grid = firstChildNS(tbl, 'tblGrid');
  if (!grid) return [];
  const widths: number[] = [];
  for (let i = 0; i < grid.childNodes.length; i++) {
    const child = grid.childNodes[i]!;
    if (child.nodeType !== 1 || (child as Element).localName !== 'gridCol') continue;
    const w = Number(wAttr(child as Element, 'w') ?? NaN);
    if (!Number.isFinite(w) || w <= 0) return []; // a single unusable column invalidates the grid
    widths.push(w / 20);
  }
  return widths;
}

/**
 * Deduped automatic styles for table emission: one `table-cell` style per distinct border
 * spec and one `table-column` style per distinct width, shared across tables.
 */
export class TableStyleRegistry {
  private cellByBorder = new Map<string, string>();
  private columnByWidth = new Map<string, string>();

  constructor(
    private readonly doc: Document,
    private readonly container: Element,
  ) {}

  cellStyleFor(borderSpec: string): string {
    const existing = this.cellByBorder.get(borderSpec);
    if (existing) return existing;
    const name = `ConvCell${this.cellByBorder.size + 1}`;
    const style = this.doc.createElementNS(ODF_NS.STYLE, 'style:style');
    style.setAttributeNS(ODF_NS.STYLE, 'style:name', name);
    style.setAttributeNS(ODF_NS.STYLE, 'style:family', 'table-cell');
    const props = this.doc.createElementNS(ODF_NS.STYLE, 'style:table-cell-properties');
    props.setAttributeNS(ODF_NS.FO, 'fo:border', borderSpec);
    props.setAttributeNS(ODF_NS.FO, 'fo:padding', '0.0382in');
    style.appendChild(props);
    this.container.appendChild(style);
    this.cellByBorder.set(borderSpec, name);
    return name;
  }

  columnStyleFor(widthPt: number): string {
    const key = String(widthPt);
    const existing = this.columnByWidth.get(key);
    if (existing) return existing;
    const name = `ConvCol${this.columnByWidth.size + 1}`;
    const style = this.doc.createElementNS(ODF_NS.STYLE, 'style:style');
    style.setAttributeNS(ODF_NS.STYLE, 'style:name', name);
    style.setAttributeNS(ODF_NS.STYLE, 'style:family', 'table-column');
    const props = this.doc.createElementNS(ODF_NS.STYLE, 'style:table-column-properties');
    props.setAttributeNS(ODF_NS.STYLE, 'style:column-width', `${Number(widthPt.toFixed(2))}pt`);
    style.appendChild(props);
    this.container.appendChild(style);
    this.columnByWidth.set(key, name);
    return name;
  }
}

/**
 * Append the table built from `group` to `body`. Cell paragraph content is delegated to
 * `fillParagraph` (the orchestrator's inline emitter) and cell paragraph styles to
 * `paragraphStyleFor` so this module stays cycle-free. `sourceTbl` is the raw `w:tbl` this
 * group was derived from (null when unavailable — defaults apply).
 */
export function appendTable(
  doc: Document,
  body: Element,
  group: DocumentViewNode[],
  tableNumber: number,
  sourceTbl: Element | null,
  tableStyles: TableStyleRegistry,
  fillParagraph: (p: Element, node: DocumentViewNode) => void,
  paragraphStyleFor: (node: DocumentViewNode) => string,
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

  const cellStyleName = tableStyles.cellStyleFor(resolveTableBorderSpec(sourceTbl));

  const table = doc.createElementNS(ODF_NS.TABLE, 'table:table');
  table.setAttributeNS(ODF_NS.TABLE, 'table:name', `Table${tableNumber}`);
  // Source grid widths drive per-column styles; a grid that does not match the view's
  // column count (gridSpan merges can desync them) falls back to unstyled repeated columns.
  const gridWidths = readGridColWidthsPt(sourceTbl);
  if (gridWidths.length === totalCols) {
    for (const widthPt of gridWidths) {
      const column = doc.createElementNS(ODF_NS.TABLE, 'table:table-column');
      column.setAttributeNS(ODF_NS.TABLE, 'table:style-name', tableStyles.columnStyleFor(widthPt));
      table.appendChild(column);
    }
  } else {
    const columns = doc.createElementNS(ODF_NS.TABLE, 'table:table-column');
    columns.setAttributeNS(ODF_NS.TABLE, 'table:number-columns-repeated', String(totalCols));
    table.appendChild(columns);
  }
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
          p.setAttributeNS(ODF_NS.TEXT, 'text:style-name', paragraphStyleFor(node));
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
