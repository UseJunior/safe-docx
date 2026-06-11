/**
 * Property-order discipline for emitted OOXML property containers.
 *
 * Each table lists the subset of child local names the generation emitters
 * produce, in the relative order the WML schema sequence declares. Emitters
 * never appendChild properties directly — they collect them into a map and
 * call appendInOrder, which throws on any name missing from its table so
 * adding a new property forces a conscious ordering decision.
 */

import { GenerationInternalError } from './errors.js';

/**
 * Child order for w:pPr (CT_PPr). Subset actually emitted, in schema-relative
 * order; w:rPr (paragraph-mark run properties) precedes w:sectPr at the end.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.26
 */
export const PPR_ORDER = [
  'pStyle',
  'keepNext',
  'keepLines',
  'pageBreakBefore',
  'widowControl',
  'numPr',
  'pBdr',
  'shd',
  'tabs',
  'spacing',
  'ind',
  'contextualSpacing',
  'jc',
  'rPr',
  'sectPr',
] as const;

/**
 * Child order for w:rPr (CT_RPr / EG_RPrBase). Subset actually emitted.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.2.28
 */
export const RPR_ORDER = [
  'rStyle',
  'rFonts',
  'b',
  'bCs',
  'i',
  'iCs',
  'caps',
  'smallCaps',
  'strike',
  'vanish',
  'color',
  'sz',
  'szCs',
  'highlight',
  'u',
  'vertAlign',
] as const;

/** Child order for w:sectPr (CT_SectPr). Header/footer references lead. */
export const SECTPR_ORDER = [
  'headerReference',
  'footerReference',
  'type',
  'pgSz',
  'pgMar',
  'pgNumType',
  'titlePg',
  'docGrid',
] as const;

/** Child order for w:tblPr (CT_TblPr). */
export const TBLPR_ORDER = [
  'tblStyle',
  'tblW',
  'jc',
  'tblBorders',
  'tblLayout',
  'tblCellMar',
  'tblLook',
] as const;

/**
 * Child order for w:trPr (CT_TrPrBase). Subset actually emitted.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.81
 */
export const TRPR_ORDER = ['trHeight', 'tblHeader'] as const;

/** Child order for w:tcPr (CT_TcPr). */
export const TCPR_ORDER = [
  'tcW',
  'gridSpan',
  'vMerge',
  'tcBorders',
  'shd',
  'tcMar',
  'vAlign',
] as const;

export type PropMap = ReadonlyMap<string, Element | Element[]>;

/**
 * Append collected property elements to a container in the order declared by
 * the table. Repeatable properties (e.g. w:headerReference) are passed as
 * arrays and appended in collection order at their slot.
 *
 * Throws GenerationInternalError when the map contains a local name absent
 * from the order table — ordering bugs fail loudly at build time instead of
 * producing schema-invalid output.
 */
export function appendInOrder(container: Element, props: PropMap, order: readonly string[]): void {
  for (const name of props.keys()) {
    if (!order.includes(name)) {
      throw new GenerationInternalError(
        `Property '${name}' is not declared in the ordering table for <${container.tagName}>; ` +
          'add it to the table in schema order before emitting it',
      );
    }
  }
  for (const name of order) {
    const value = props.get(name);
    if (!value) continue;
    const elements = Array.isArray(value) ? value : [value];
    for (const el of elements) container.appendChild(el);
  }
}
