/**
 * Section-properties emitter.
 *
 * Shipped: page size/margins, page numbering, section break type, title-page
 * switch, and header/footer references. The reference rIds come from the
 * header/footer part allocation pass (emit/header-footer-part.ts), which runs
 * before the document part so the sectPr can bind them.
 */

import { createWmlElement } from '../../primitives/dom-helpers.js';
import { OOXML, W } from '../../primitives/namespaces.js';
import { appendInOrder, SECTPR_ORDER } from '../ordering.js';
import type { SectionSpec } from '../types.js';

/** US Letter, in twentieths of a point. */
const DEFAULT_PAGE = { w: 12240, h: 15840 } as const;

/** One-inch page margins, half-inch header/footer offsets, no gutter. */
const DEFAULT_MARGINS = {
  top: 1440,
  right: 1440,
  bottom: 1440,
  left: 1440,
  header: 720,
  footer: 720,
  gutter: 0,
} as const;

/** Header/footer part references for one section, allocated by the parts pass. */
export type SectionHeaderFooterRefs = {
  headers: Partial<Record<'default' | 'first' | 'even', string>>;
  footers: Partial<Record<'default' | 'first' | 'even', string>>;
};

/**
 * Build the w:sectPr element for a section.
 *
 * Width/height are always emitted explicitly (never reader defaults); a
 * landscape request swaps the dimensions and sets w:orient. Header/footer
 * references lead the child sequence; w:titlePg is implied whenever a
 * first-page header or footer is present.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.13
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.6
 */
export function buildSectPr(doc: Document, section: SectionSpec, refs?: SectionHeaderFooterRefs): Element {
  const sectPr = createWmlElement(doc, W.sectPr);
  const props = new Map<string, Element | Element[]>();

  if (refs) {
    const headerRefs = buildReferences(doc, W.headerReference, refs.headers);
    const footerRefs = buildReferences(doc, W.footerReference, refs.footers);
    if (headerRefs.length > 0) props.set(W.headerReference, headerRefs);
    if (footerRefs.length > 0) props.set(W.footerReference, footerRefs);
  }

  if (section.breakType !== undefined) {
    props.set(W.type, createWmlElement(doc, W.type, { 'w:val': section.breakType }));
  }
  props.set(W.pgSz, buildPgSz(doc, section));
  props.set(W.pgMar, buildPgMar(doc, section));
  if (section.pageNumbering) {
    const attrs: Record<string, string> = {};
    if (section.pageNumbering.start !== undefined) attrs['w:start'] = String(section.pageNumbering.start);
    if (section.pageNumbering.format !== undefined) attrs['w:fmt'] = section.pageNumbering.format;
    props.set(W.pgNumType, createWmlElement(doc, W.pgNumType, attrs));
  }
  if (titlePgImplied(section)) {
    props.set(W.titlePg, createWmlElement(doc, W.titlePg));
  }

  appendInOrder(sectPr, props, SECTPR_ORDER);
  return sectPr;
}

export function titlePgImplied(section: SectionSpec): boolean {
  return Boolean(section.titlePg || section.headers?.first || section.footers?.first);
}

/**
 * One reference element per declared header/footer slot, in a fixed
 * first/default/even emission order so output is deterministic.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 */
function buildReferences(
  doc: Document,
  localName: string,
  slots: Partial<Record<'default' | 'first' | 'even', string>>,
): Element[] {
  const out: Element[] = [];
  for (const type of ['first', 'default', 'even'] as const) {
    const rId = slots[type];
    if (!rId) continue;
    const el = createWmlElement(doc, localName, { 'w:type': type });
    el.setAttributeNS(OOXML.R_NS, 'r:id', rId);
    out.push(el);
  }
  return out;
}

function buildPgSz(doc: Document, section: SectionSpec): Element {
  const requested = section.page?.sizeTwips ?? DEFAULT_PAGE;
  const landscape = section.page?.orientation === 'landscape';
  const w = landscape ? Math.max(requested.w, requested.h) : requested.w;
  const h = landscape ? Math.min(requested.w, requested.h) : requested.h;
  const attrs: Record<string, string> = { 'w:w': String(w), 'w:h': String(h) };
  if (landscape) attrs['w:orient'] = 'landscape';
  return createWmlElement(doc, W.pgSz, attrs);
}

/**
 * The full attribute set (top/right/bottom/left/header/footer/gutter) is
 * always emitted because readers diverge in their defaults when attributes
 * are omitted.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.11
 */
function buildPgMar(doc: Document, section: SectionSpec): Element {
  const margins = { ...DEFAULT_MARGINS, ...section.page?.marginsTwips };
  return createWmlElement(doc, W.pgMar, {
    'w:top': String(margins.top),
    'w:right': String(margins.right),
    'w:bottom': String(margins.bottom),
    'w:left': String(margins.left),
    'w:header': String(margins.header),
    'w:footer': String(margins.footer),
    'w:gutter': String(margins.gutter),
  });
}
