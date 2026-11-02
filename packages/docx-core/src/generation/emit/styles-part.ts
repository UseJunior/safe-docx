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
import { GenerationInternalError } from '../errors.js';
import type { DocumentSpec, StyleSpec, ThemeColorSlot } from '../types.js';
import { resolveThemeColorValues } from '../theme-colors.js';
import type { NumberingIdMap } from './emit-context.js';
import { collectNumberingStyleLinks } from './numbering-part.js';
import { buildParagraphPropsElement, buildRunPropsElement, styleParagraphProps } from './properties.js';

export const STYLES_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';
export const STYLES_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const STYLES_SKELETON = `<w:styles xmlns:w="${OOXML.W_NS}"/>`;

/** Default run properties for docDefaults: Calibri 11pt, matching Word's baseline. */
const DEFAULT_FONT = 'Calibri';
const DEFAULT_SIZE_PT = 11;

/** The typeface w:rPrDefault declares: the spec's default font, else Calibri. */
export function documentDefaultFont(spec: DocumentSpec): string {
  return spec.defaults?.run?.font ?? DEFAULT_FONT;
}

/**
 * Emit word/styles.xml. `numberingIds` (from the numbering emitter) resolves
 * the numeric instance id a numbering-linked style's `w:numPr` names.
 */
export function emitStylesPart(spec: DocumentSpec, ctx: CompileContext, numberingIds?: NumberingIdMap): void {
  ctx.registerPart('word/styles.xml', STYLES_CONTENT_TYPE, STYLES_REL_TYPE);

  const doc = parseXml(STYLES_SKELETON);
  const root = doc.documentElement!;

  const themeColorValues = resolveThemeColorValues(spec.theme);
  root.appendChild(buildDocDefaults(doc, spec, themeColorValues));
  root.appendChild(buildNormalStyle(doc));
  const numberingLinks = resolveNumberingStyleLinks(spec, numberingIds);
  for (const style of spec.styles ?? []) {
    root.appendChild(buildStyle(doc, style, themeColorValues, numberingLinks.get(style.styleId)));
  }

  ctx.setFileContent('word/styles.xml', XML_DECL + serializeXml(doc));
}

/**
 * Document defaults: the declared run defaults merge over the Calibri 11pt
 * baseline, and declared paragraph defaults fill `w:pPrDefault`. Both go
 * through the shared property builders, so a default serializes exactly like
 * the same property on a style or a run.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.5.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.2.26
 */
function buildDocDefaults(
  doc: Document,
  spec: DocumentSpec,
  themeColorValues: ReadonlyMap<ThemeColorSlot, string>,
): Element {
  const docDefaults = createWmlElement(doc, W.docDefaults);

  const rPrDefault = createWmlElement(doc, W.rPrDefault);
  // Nullish fallbacks (not a spread) so an explicit `undefined` cannot erase
  // the baseline and leave font and size to reader-specific fallbacks.
  const rPr = buildRunPropsElement(doc, {
    ...spec.defaults?.run,
    font: documentDefaultFont(spec),
    sizePt: spec.defaults?.run?.sizePt ?? DEFAULT_SIZE_PT,
  }, { themeColorValues });
  if (rPr) rPrDefault.appendChild(rPr);
  docDefaults.appendChild(rPrDefault);

  const pPrDefault = createWmlElement(doc, W.pPrDefault);
  const pPr = spec.defaults?.paragraph ? buildParagraphPropsElement(doc, spec.defaults.paragraph) : null;
  if (pPr) pPrDefault.appendChild(pPr);
  docDefaults.appendChild(pPrDefault);

  return docDefaults;
}

function buildNormalStyle(doc: Document): Element {
  const style = createWmlElement(doc, W.style, { 'w:type': 'paragraph', 'w:styleId': 'Normal', 'w:default': '1' });
  style.appendChild(createWmlElement(doc, W.name, { 'w:val': 'Normal' }));
  style.appendChild(createWmlElement(doc, W.qFormat));
  return style;
}

type StyleNumberingLink = { numericId: number; ilvl: number };

/**
 * Bind each numbering-linked style to the numeric id of its definition's
 * default instance. Validation guarantees the definition exists, so a missing
 * id here is an internal ordering bug.
 */
function resolveNumberingStyleLinks(
  spec: DocumentSpec,
  numberingIds: NumberingIdMap | undefined,
): Map<string, StyleNumberingLink> {
  const resolved = new Map<string, StyleNumberingLink>();
  for (const [styleId, link] of collectNumberingStyleLinks(spec)) {
    const numericId = numberingIds?.get(link.numId);
    if (numericId === undefined) {
      throw new GenerationInternalError(
        `Style '${styleId}' is linked to numbering handle '${link.numId}' with no allocated numeric id`,
      );
    }
    resolved.set(styleId, { numericId, ilvl: link.ilvl });
  }
  return resolved;
}

/**
 * A style linked to a numbering level carries the reverse link as `w:numPr`
 * in its `w:pPr`: the level's own `w:pStyle` decides the level in Word, and
 * the explicit `w:ilvl` keeps readers that read only the style in step.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.4.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.23
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.19
 */
function buildStyle(
  doc: Document,
  spec: StyleSpec,
  themeColorValues: ReadonlyMap<ThemeColorSlot, string>,
  numberingLink?: StyleNumberingLink,
): Element {
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
  if (spec.paragraph || numberingLink) {
    let extras: Map<string, Element> | undefined;
    if (numberingLink) {
      const numPr = createWmlElement(doc, W.numPr);
      numPr.appendChild(createWmlElement(doc, W.ilvl, { 'w:val': String(numberingLink.ilvl) }));
      numPr.appendChild(createWmlElement(doc, W.numId, { 'w:val': String(numberingLink.numericId) }));
      extras = new Map([[W.numPr, numPr]]);
    }
    const pPr = buildParagraphPropsElement(doc, styleParagraphProps(spec), extras);
    if (pPr) style.appendChild(pPr);
  }
  if (spec.run) {
    const rPr = buildRunPropsElement(doc, spec.run, { themeColorValues });
    if (rPr) style.appendChild(rPr);
  }
  return style;
}
