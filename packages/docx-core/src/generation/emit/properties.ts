/**
 * Shared property builders: RunProps → w:rPr and paragraph formatting → w:pPr
 * child maps, used by both the body emitters (run.ts / paragraph.ts) and the
 * styles-part emitter so direct formatting and style definitions can never
 * drift apart. All children are routed through the ordering tables.
 */

import { createWmlElement } from '../../primitives/dom-helpers.js';
import { W } from '../../primitives/namespaces.js';
import { appendInOrder, PPR_ORDER, RPR_ORDER } from '../ordering.js';
import type { ParagraphSpec, RunProps, StyleSpec } from '../types.js';

/** Paragraph-formatting subset shared by ParagraphSpec and StyleSpec.paragraph. */
export type ParagraphProps = Pick<
  ParagraphSpec,
  'alignment' | 'spacing' | 'indent' | 'tabs' | 'pageBreakBefore' | 'keepNext'
> & { styleId?: string };

const ALIGNMENT_TO_JC: Record<NonNullable<ParagraphProps['alignment']>, string> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'both',
};

/**
 * Build the ordered rPr children for a RunProps value. Returns null when no
 * property is set so callers can omit the rPr container entirely.
 *
 * Complex-script twins (bCs/iCs/szCs) and the full rFonts script coverage
 * (ascii + hAnsi + cs) are always emitted alongside their base properties so
 * all script ranges agree.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.2.28
 */
export function buildRunPropsElement(doc: Document, props: RunProps): Element | null {
  const children = new Map<string, Element | Element[]>();

  if (props.font !== undefined) {
    children.set(W.rFonts, createWmlElement(doc, W.rFonts, {
      'w:ascii': props.font,
      'w:hAnsi': props.font,
      'w:cs': props.font,
    }));
  }
  if (props.bold !== undefined) {
    children.set(W.b, createWmlElement(doc, W.b, props.bold ? undefined : { 'w:val': '0' }));
    children.set(W.bCs, createWmlElement(doc, W.bCs, props.bold ? undefined : { 'w:val': '0' }));
  }
  if (props.italic !== undefined) {
    children.set(W.i, createWmlElement(doc, W.i, props.italic ? undefined : { 'w:val': '0' }));
    children.set(W.iCs, createWmlElement(doc, W.iCs, props.italic ? undefined : { 'w:val': '0' }));
  }
  if (props.caps !== undefined) {
    children.set(W.caps, createWmlElement(doc, W.caps, props.caps ? undefined : { 'w:val': '0' }));
  }
  if (props.smallCaps !== undefined) {
    children.set(W.smallCaps, createWmlElement(doc, W.smallCaps, props.smallCaps ? undefined : { 'w:val': '0' }));
  }
  if (props.colorHex !== undefined) {
    children.set(W.color, createWmlElement(doc, W.color, { 'w:val': props.colorHex }));
  }
  if (props.sizePt !== undefined) {
    const halfPoints = String(Math.round(props.sizePt * 2));
    children.set(W.sz, createWmlElement(doc, W.sz, { 'w:val': halfPoints }));
    children.set(W.szCs, createWmlElement(doc, W.szCs, { 'w:val': halfPoints }));
  }
  if (props.underline !== undefined) {
    children.set(W.u, createWmlElement(doc, W.u, { 'w:val': props.underline }));
  }

  if (children.size === 0) return null;
  const rPr = createWmlElement(doc, W.rPr);
  appendInOrder(rPr, children, RPR_ORDER);
  return rPr;
}

/**
 * Build the ordered pPr children for a paragraph-formatting subset. Returns
 * null when nothing is set. The optional extras hook lets phase-specific
 * callers add already-built children (e.g. a section break sectPr) that
 * still go through the same ordering discipline.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.26
 */
export function buildParagraphPropsElement(
  doc: Document,
  props: ParagraphProps,
  extras?: ReadonlyMap<string, Element | Element[]>,
): Element | null {
  const children = new Map<string, Element | Element[]>();

  if (props.styleId !== undefined) {
    children.set(W.pStyle, createWmlElement(doc, W.pStyle, { 'w:val': props.styleId }));
  }
  if (props.keepNext) {
    children.set(W.keepNext, createWmlElement(doc, W.keepNext));
  }
  if (props.pageBreakBefore) {
    children.set(W.pageBreakBefore, createWmlElement(doc, W.pageBreakBefore));
  }
  if (props.tabs && props.tabs.length > 0) {
    const tabs = createWmlElement(doc, W.tabs);
    for (const stop of props.tabs) {
      const attrs: Record<string, string> = { 'w:val': stop.align, 'w:pos': String(stop.posTwips) };
      if (stop.leader && stop.leader !== 'none') attrs['w:leader'] = stop.leader;
      tabs.appendChild(createWmlElement(doc, W.tab, attrs));
    }
    children.set(W.tabs, tabs);
  }
  if (props.spacing) {
    const attrs: Record<string, string> = {};
    if (props.spacing.beforeTwips !== undefined) attrs['w:before'] = String(props.spacing.beforeTwips);
    if (props.spacing.afterTwips !== undefined) attrs['w:after'] = String(props.spacing.afterTwips);
    if (props.spacing.lineTwips !== undefined) {
      attrs['w:line'] = String(props.spacing.lineTwips);
      attrs['w:lineRule'] = props.spacing.lineRule ?? 'auto';
    }
    if (Object.keys(attrs).length > 0) children.set(W.spacing, createWmlElement(doc, W.spacing, attrs));
  }
  if (props.indent) {
    const attrs: Record<string, string> = {};
    if (props.indent.leftTwips !== undefined) attrs['w:left'] = String(props.indent.leftTwips);
    if (props.indent.rightTwips !== undefined) attrs['w:right'] = String(props.indent.rightTwips);
    if (props.indent.firstLineTwips !== undefined) attrs['w:firstLine'] = String(props.indent.firstLineTwips);
    if (props.indent.hangingTwips !== undefined) attrs['w:hanging'] = String(props.indent.hangingTwips);
    if (Object.keys(attrs).length > 0) children.set(W.ind, createWmlElement(doc, W.ind, attrs));
  }
  if (props.alignment !== undefined) {
    children.set(W.jc, createWmlElement(doc, W.jc, { 'w:val': ALIGNMENT_TO_JC[props.alignment] }));
  }
  if (extras) {
    for (const [name, value] of extras) children.set(name, value);
  }

  if (children.size === 0) return null;
  const pPr = createWmlElement(doc, W.pPr);
  appendInOrder(pPr, children, PPR_ORDER);
  return pPr;
}

/** Paragraph-formatting subset of a StyleSpec, normalized for the builder. */
export function styleParagraphProps(style: StyleSpec): ParagraphProps {
  return { ...style.paragraph };
}
