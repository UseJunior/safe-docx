/**
 * word/numbering.xml emitter.
 *
 * Each NumberingSpec compiles to one abstract definition plus one instance:
 * the spec's string handle (`numId`) maps to sequential numeric ids assigned
 * in declaration order, so identical specs always produce identical ids. The
 * returned map is what lets paragraph `w:numPr` references bind to the
 * numeric `w:numId` deterministically.
 *
 * Level children follow the CT_Lvl sequence (start, numFmt, suff, lvlText,
 * lvlJc, pPr, rPr); level run properties reuse the shared rPr builder so a
 * bullet glyph's font serializes exactly like body formatting would.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.16
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.2
 */

import { createWmlElement } from '../../primitives/dom-helpers.js';
import { OOXML, W } from '../../primitives/namespaces.js';
import { parseXml, serializeXml, XML_DECL } from '../../primitives/xml.js';
import type { CompileContext } from '../context.js';
import type { DocumentSpec, NumberingSpec } from '../types.js';
import type { NumberingIdMap } from './emit-context.js';
import { buildRunPropsElement } from './properties.js';

export const NUMBERING_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
export const NUMBERING_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

const NUMBERING_SKELETON = `<w:numbering xmlns:w="${OOXML.W_NS}"/>`;

/**
 * Emit word/numbering.xml when the spec declares numbering definitions.
 * Returns the handle → numeric id map (empty when no part is emitted).
 */
export function emitNumberingPartIfNeeded(spec: DocumentSpec, ctx: CompileContext): NumberingIdMap {
  const ids = new Map<string, number>();
  const definitions = spec.numbering ?? [];
  if (definitions.length === 0) return ids;

  ctx.registerPart('word/numbering.xml', NUMBERING_CONTENT_TYPE, NUMBERING_REL_TYPE);

  const doc = parseXml(NUMBERING_SKELETON);
  const root = doc.documentElement!;

  definitions.forEach((definition, index) => {
    ids.set(definition.numId, index + 1);
  });
  // CT_Numbering sequence: every abstractNum precedes every num.
  definitions.forEach((definition, index) => {
    root.appendChild(buildAbstractNum(doc, definition, index));
  });
  definitions.forEach((_definition, index) => {
    const num = createWmlElement(doc, W.num, { 'w:numId': String(index + 1) });
    num.appendChild(createWmlElement(doc, W.abstractNumId, { 'w:val': String(index) }));
    root.appendChild(num);
  });

  ctx.setFileContent('word/numbering.xml', XML_DECL + serializeXml(doc));
  return ids;
}

/**
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.6
 */
function buildAbstractNum(doc: Document, definition: NumberingSpec, abstractId: number): Element {
  const abstractNum = createWmlElement(doc, W.abstractNum, { 'w:abstractNumId': String(abstractId) });
  abstractNum.appendChild(
    createWmlElement(doc, W.multiLevelType, {
      'w:val': definition.levels.length > 1 ? 'multilevel' : 'singleLevel',
    }),
  );
  for (const level of definition.levels) {
    abstractNum.appendChild(buildLevel(doc, level));
  }
  return abstractNum;
}

/**
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.25
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.28
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.11
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.7
 */
function buildLevel(doc: Document, level: NumberingSpec['levels'][number]): Element {
  const lvl = createWmlElement(doc, W.lvl, { 'w:ilvl': String(level.ilvl) });
  lvl.appendChild(createWmlElement(doc, W.start, { 'w:val': String(level.start ?? 1) }));
  lvl.appendChild(createWmlElement(doc, W.numFmt, { 'w:val': level.numFmt }));
  if (level.suff !== undefined) {
    lvl.appendChild(createWmlElement(doc, W.suff, { 'w:val': level.suff }));
  }
  lvl.appendChild(createWmlElement(doc, W.lvlText, { 'w:val': level.lvlText }));
  lvl.appendChild(createWmlElement(doc, W.lvlJc, { 'w:val': 'left' }));
  if (level.indentTwips !== undefined) {
    const pPr = createWmlElement(doc, W.pPr);
    const attrs: Record<string, string> = {};
    if (level.indentTwips.left !== undefined) attrs['w:left'] = String(level.indentTwips.left);
    if (level.indentTwips.hanging !== undefined) attrs['w:hanging'] = String(level.indentTwips.hanging);
    pPr.appendChild(createWmlElement(doc, W.ind, attrs));
    lvl.appendChild(pPr);
  }
  if (level.runProps !== undefined) {
    const rPr = buildRunPropsElement(doc, level.runProps);
    if (rPr) lvl.appendChild(rPr);
  }
  return lvl;
}
