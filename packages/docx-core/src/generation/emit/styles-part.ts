/**
 * word/styles.xml emitter.
 *
 * Always emitted: document defaults, the Normal paragraph style, and every
 * declared StyleSpec. Style pPr/rPr go through the same shared property
 * builders as direct formatting (emit/properties.ts), so a style definition
 * and an inline run can never disagree on how a property serializes.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.4.18
 */

import { createWmlElement } from '../../primitives/dom-helpers.js';
import { OOXML, W } from '../../primitives/namespaces.js';
import { parseXml, serializeXml, XML_DECL } from '../../primitives/xml.js';
import type { CompileContext } from '../context.js';
import type { DocumentSpec, StyleSpec } from '../types.js';
import { resolveThemeColorValues } from '../theme-colors.js';
import { buildParagraphPropsElement, buildRunPropsElement, styleParagraphProps } from './properties.js';

export const STYLES_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';
export const STYLES_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const STYLES_SKELETON = `<w:styles xmlns:w="${OOXML.W_NS}"/>`;

/** Default run properties for docDefaults: Calibri 11pt, matching Word's baseline. */
const DEFAULT_FONT = 'Calibri';
const DEFAULT_SIZE_HALF_POINTS = '22';

export function emitStylesPart(spec: DocumentSpec, ctx: CompileContext): void {
  ctx.registerPart('word/styles.xml', STYLES_CONTENT_TYPE, STYLES_REL_TYPE);

  const doc = parseXml(STYLES_SKELETON);
  const root = doc.documentElement!;

  root.appendChild(buildDocDefaults(doc));
  root.appendChild(buildNormalStyle(doc));
  for (const style of spec.styles ?? []) {
    root.appendChild(buildStyle(doc, style, spec));
  }

  ctx.setFileContent('word/styles.xml', XML_DECL + serializeXml(doc));
}

/** @conformance ECMA-376 edition 5, Part 1 § 17.7.5.1 */
function buildDocDefaults(doc: Document): Element {
  const docDefaults = createWmlElement(doc, W.docDefaults);

  const rPrDefault = createWmlElement(doc, W.rPrDefault);
  const rPr = createWmlElement(doc, W.rPr);
  rPr.appendChild(createWmlElement(doc, W.rFonts, {
    'w:ascii': DEFAULT_FONT,
    'w:hAnsi': DEFAULT_FONT,
    'w:cs': DEFAULT_FONT,
  }));
  rPr.appendChild(createWmlElement(doc, W.sz, { 'w:val': DEFAULT_SIZE_HALF_POINTS }));
  rPr.appendChild(createWmlElement(doc, W.szCs, { 'w:val': DEFAULT_SIZE_HALF_POINTS }));
  rPrDefault.appendChild(rPr);
  docDefaults.appendChild(rPrDefault);

  const pPrDefault = createWmlElement(doc, W.pPrDefault);
  docDefaults.appendChild(pPrDefault);

  return docDefaults;
}

function buildNormalStyle(doc: Document): Element {
  const style = createWmlElement(doc, W.style, { 'w:type': 'paragraph', 'w:styleId': 'Normal', 'w:default': '1' });
  style.appendChild(createWmlElement(doc, W.name, { 'w:val': 'Normal' }));
  style.appendChild(createWmlElement(doc, W.qFormat));
  return style;
}

/** @conformance ECMA-376 edition 5, Part 1 § 17.7.4.17 */
function buildStyle(doc: Document, spec: StyleSpec, documentSpec: DocumentSpec): Element {
  const style = createWmlElement(doc, W.style, { 'w:type': spec.type, 'w:styleId': spec.styleId });
  style.appendChild(createWmlElement(doc, W.name, { 'w:val': spec.name }));
  if (spec.basedOn !== undefined) {
    style.appendChild(createWmlElement(doc, W.basedOn, { 'w:val': spec.basedOn }));
  }
  if (spec.next !== undefined) {
    style.appendChild(createWmlElement(doc, W.next, { 'w:val': spec.next }));
  }
  style.appendChild(createWmlElement(doc, W.qFormat));

  // CT_Style declares pPr before rPr.
  if (spec.paragraph) {
    const pPr = buildParagraphPropsElement(doc, styleParagraphProps(spec));
    if (pPr) style.appendChild(pPr);
  }
  if (spec.run) {
    const rPr = buildRunPropsElement(doc, spec.run, { themeColorValues: resolveThemeColorValues(documentSpec.theme) });
    if (rPr) style.appendChild(rPr);
  }
  return style;
}
