/**
 * Section-properties emitter.
 *
 * PR 1 scope: page size and margins for the document-final section. Header /
 * footer references, break types, page numbering, and title-page switches land
 * with the multi-section phase.
 */

import { createWmlElement } from '../../primitives/dom-helpers.js';
import { W } from '../../primitives/namespaces.js';
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

/**
 * Build the w:sectPr element for a section.
 *
 * Width/height are always emitted explicitly (never reader defaults); a
 * landscape request swaps the dimensions and sets w:orient.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.13
 */
export function buildSectPr(doc: Document, section: SectionSpec): Element {
  const sectPr = createWmlElement(doc, W.sectPr);
  const props = new Map<string, Element | Element[]>();
  props.set(W.pgSz, buildPgSz(doc, section));
  props.set(W.pgMar, buildPgMar(doc, section));
  appendInOrder(sectPr, props, SECTPR_ORDER);
  return sectPr;
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
