import { createWmlElement } from '../../primitives/dom-helpers.js';
import { W } from '../../primitives/namespaces.js';
import type { BorderSpec, ParagraphBorders, TableBorders } from '../types.js';

type BorderEdge = readonly [string, BorderSpec | undefined];

/**
 * Build a border collection with explicit size, spacing, and color attributes.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.26
 */
export function buildParagraphBordersElement(doc: Document, borders: ParagraphBorders): Element {
  return buildBordersElement(doc, W.pBdr, [
    [W.top, borders.top],
    [W.left, borders.left],
    [W.bottom, borders.bottom],
    [W.right, borders.right],
    [W.between, borders.between],
  ]);
}

/**
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.66
 */
export function buildTableBordersElement(
  doc: Document,
  localName: typeof W.tblBorders | typeof W.tcBorders,
  borders: TableBorders,
): Element {
  return buildBordersElement(doc, localName, [
    [W.top, borders.top],
    [W.left, borders.left],
    [W.bottom, borders.bottom],
    [W.right, borders.right],
    [W.insideH, borders.insideH],
    [W.insideV, borders.insideV],
  ]);
}

function buildBordersElement(doc: Document, localName: string, edges: BorderEdge[]): Element {
  const container = createWmlElement(doc, localName);
  for (const [edge, spec] of edges) {
    if (!spec) continue;
    container.appendChild(
      createWmlElement(doc, edge, {
        'w:val': spec.style,
        'w:sz': String(spec.style === 'none' ? 0 : (spec.sizeEighthPt ?? 4)),
        'w:space': '0',
        'w:color': spec.colorHex ?? 'auto',
      }),
    );
  }
  return container;
}
