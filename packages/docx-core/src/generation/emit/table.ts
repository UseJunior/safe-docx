/**
 * Table emitter.
 *
 * Compiles TableSpec nodes into w:tbl structures: table-level properties and
 * the column grid, then rows and cells. Cell content reuses the paragraph
 * emitter, and nested tables recurse through buildTable. Two invariants are
 * enforced by construction rather than checked after the fact:
 *
 *  - every cell ends with a w:p (readers treat a cell whose last block is a
 *    table as corrupt), and
 *  - cell widths always come from somewhere deterministic — an explicit
 *    widthTwips, or the sum of the grid columns the cell spans.
 */

import { createWmlElement } from '../../primitives/dom-helpers.js';
import { W } from '../../primitives/namespaces.js';
import { appendInOrder, TBLPR_ORDER, TCPR_ORDER, TRPR_ORDER } from '../ordering.js';
import type { BlockSpec, TableCellSpec, TableRowSpec, TableSpec } from '../types.js';
import type { BlockEmitContext } from './emit-context.js';
import { buildTableBordersElement } from './borders.js';
import { buildParagraph } from './paragraph.js';

/**
 * Build the w:tbl element for a table block.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.37
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.59
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.48
 */
export function buildTable(doc: Document, table: TableSpec, ctx?: BlockEmitContext): Element {
  const tbl = createWmlElement(doc, W.tbl);
  tbl.appendChild(buildTblPr(doc, table));
  tbl.appendChild(buildTblGrid(doc, table));
  for (const row of table.rows) {
    tbl.appendChild(buildRow(doc, table, row, ctx));
  }
  return tbl;
}

/**
 * Table-level properties. w:tblW always carries the dxa sum of the declared
 * grid so the preferred width and the grid agree, and w:tblLayout is always
 * emitted explicitly (fixed by default) because autofit is the reader-side
 * default and silently reflows fixed designs.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.63
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.52
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.38
 */
function buildTblPr(doc: Document, table: TableSpec): Element {
  const tblPr = createWmlElement(doc, W.tblPr);
  const props = new Map<string, Element | Element[]>();
  const widthSum = table.columnWidthsTwips.reduce((sum, w) => sum + w, 0);
  props.set(W.tblW, createWmlElement(doc, W.tblW, { 'w:w': String(widthSum), 'w:type': 'dxa' }));
  if (table.borders) {
    props.set(W.tblBorders, buildTableBordersElement(doc, W.tblBorders, table.borders));
  }
  props.set(W.tblLayout, createWmlElement(doc, W.tblLayout, { 'w:type': table.layout ?? 'fixed' }));
  appendInOrder(tblPr, props, TBLPR_ORDER);
  return tblPr;
}

/**
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.16
 */
function buildTblGrid(doc: Document, table: TableSpec): Element {
  const tblGrid = createWmlElement(doc, W.tblGrid);
  for (const width of table.columnWidthsTwips) {
    tblGrid.appendChild(createWmlElement(doc, W.gridCol, { 'w:w': String(width) }));
  }
  return tblGrid;
}

/**
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.78
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.80
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.49
 */
function buildRow(doc: Document, table: TableSpec, row: TableRowSpec, ctx?: BlockEmitContext): Element {
  const tr = createWmlElement(doc, W.tr);

  const props = new Map<string, Element | Element[]>();
  if (row.heightTwips !== undefined) {
    props.set(
      W.trHeight,
      createWmlElement(doc, W.trHeight, {
        'w:val': String(row.heightTwips),
        'w:hRule': row.heightRule ?? 'atLeast',
      }),
    );
  }
  if (row.header) {
    props.set(W.tblHeader, createWmlElement(doc, W.tblHeader));
  }
  if (props.size > 0) {
    const trPr = createWmlElement(doc, W.trPr);
    appendInOrder(trPr, props, TRPR_ORDER);
    tr.appendChild(trPr);
  }

  let gridOffset = 0;
  for (const cell of row.cells) {
    const span = cell.gridSpan ?? 1;
    tr.appendChild(buildCell(doc, table, cell, gridOffset, ctx));
    gridOffset += span;
  }
  return tr;
}

/**
 * Cell properties in TCPR_ORDER, then cell content. An unspecified width
 * falls back to the sum of the spanned grid columns; a vertical-merge
 * continuation is the bare element form Word itself writes.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.65
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.69
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.71
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.84
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.32
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.83
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.68
 */
function buildCell(doc: Document, table: TableSpec, cell: TableCellSpec, gridOffset: number, ctx?: BlockEmitContext): Element {
  const tc = createWmlElement(doc, W.tc);
  const tcPr = createWmlElement(doc, W.tcPr);
  const props = new Map<string, Element | Element[]>();

  const span = cell.gridSpan ?? 1;
  const width =
    cell.widthTwips ?? table.columnWidthsTwips.slice(gridOffset, gridOffset + span).reduce((sum, w) => sum + w, 0);
  props.set(W.tcW, createWmlElement(doc, W.tcW, { 'w:w': String(width), 'w:type': 'dxa' }));
  if (cell.gridSpan !== undefined && cell.gridSpan > 1) {
    props.set(W.gridSpan, createWmlElement(doc, W.gridSpan, { 'w:val': String(cell.gridSpan) }));
  }
  if (cell.vMerge !== undefined) {
    props.set(
      W.vMerge,
      cell.vMerge === 'restart' ? createWmlElement(doc, W.vMerge, { 'w:val': 'restart' }) : createWmlElement(doc, W.vMerge),
    );
  }
  if (cell.borders) {
    props.set(W.tcBorders, buildTableBordersElement(doc, W.tcBorders, cell.borders));
  }
  if (cell.shadingHex !== undefined || cell.themeFill !== undefined) {
    const attrs: Record<string, string> = { 'w:val': 'clear', 'w:color': 'auto' };
    if (cell.shadingHex !== undefined) attrs['w:fill'] = cell.shadingHex;
    if (cell.themeFill !== undefined) {
      attrs['w:themeFill'] = cell.themeFill;
      const fallback = ctx?.themeColorValues?.get(cell.themeFill);
      if (fallback !== undefined && attrs['w:fill'] === undefined) attrs['w:fill'] = fallback;
    }
    if (cell.themeFillTint !== undefined) attrs['w:themeFillTint'] = cell.themeFillTint;
    if (cell.themeFillShade !== undefined) attrs['w:themeFillShade'] = cell.themeFillShade;
    props.set(W.shd, createWmlElement(doc, W.shd, attrs));
  }
  if (cell.marginsTwips) {
    props.set(W.tcMar, buildCellMargins(doc, cell.marginsTwips));
  }
  if (cell.vAlign !== undefined) {
    props.set(W.vAlign, createWmlElement(doc, W.vAlign, { 'w:val': cell.vAlign }));
  }
  appendInOrder(tcPr, props, TCPR_ORDER);
  tc.appendChild(tcPr);

  for (const block of cell.blocks) {
    tc.appendChild(buildBlock(doc, block, ctx));
  }
  // A cell must end with a paragraph: readers reject a cell that is empty or
  // whose last block is a table.
  const last = cell.blocks[cell.blocks.length - 1];
  if (!last || last.kind === 'table') {
    tc.appendChild(createWmlElement(doc, W.p));
  }
  return tc;
}

/** Dispatch a block-level spec node to its emitter (cells hold both kinds). */
export function buildBlock(doc: Document, block: BlockSpec, ctx?: BlockEmitContext): Element {
  return block.kind === 'table' ? buildTable(doc, block, ctx) : buildParagraph(doc, block, ctx);
}

function buildCellMargins(
  doc: Document,
  margins: NonNullable<TableCellSpec['marginsTwips']>,
): Element {
  const tcMar = createWmlElement(doc, W.tcMar);
  const edges: Array<[string, number | undefined]> = [
    [W.top, margins.top],
    [W.left, margins.left],
    [W.bottom, margins.bottom],
    [W.right, margins.right],
  ];
  for (const [edge, value] of edges) {
    if (value === undefined) continue;
    tcMar.appendChild(createWmlElement(doc, edge, { 'w:w': String(value), 'w:type': 'dxa' }));
  }
  return tcMar;
}
