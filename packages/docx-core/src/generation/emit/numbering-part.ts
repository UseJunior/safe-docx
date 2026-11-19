/**
 * word/numbering.xml emitter.
 *
 * Each NumberingSpec compiles to one abstract definition plus a default
 * instance: the spec's string handle (`numId`) maps to sequential numeric ids
 * assigned in declaration order, so identical specs always produce identical
 * ids. A definition's additional `instances` become further `w:num` elements
 * after every default instance (ids N+1, N+2, … in declaration order), each
 * carrying its `w:lvlOverride`/`w:startOverride` restarts. Appending them
 * after the defaults keeps every default instance's id stable when instances
 * are added; additional instances' ids depend on the instances declared
 * before them, so numeric ids are compile-local and callers keep the string
 * handles. The returned map is what lets paragraph `w:numPr` references bind to
 * the numeric `w:numId` deterministically.
 *
 * Level children follow the CT_Lvl sequence (start, numFmt, lvlRestart,
 * pStyle, isLgl, suff, lvlText, lvlJc, pPr, rPr) through LVL_ORDER; level run
 * properties reuse the shared rPr builder so a bullet glyph's font serializes
 * exactly like body formatting would, and level tab stops reuse the shared
 * pPr builder.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.16
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.8
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.26
 */

import { createWmlElement } from '../../primitives/dom-helpers.js';
import { OOXML, W } from '../../primitives/namespaces.js';
import { parseXml, serializeXml, XML_DECL } from '../../primitives/xml.js';
import type { CompileContext } from '../context.js';
import { appendInOrder, LVL_ORDER } from '../ordering.js';
import type { DocumentSpec, NumberingInstanceSpec, NumberingLevelSpec, NumberingSpec, ThemeColorSlot } from '../types.js';
import { resolveThemeColorValues } from '../theme-colors.js';
import type { NumberingIdMap } from './emit-context.js';
import { buildParagraphPropsElement, buildRunPropsElement } from './properties.js';

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
  // Additional instances take ids after every default instance, so adding one
  // never shifts a default instance's id.
  const additional: Array<{ instance: NumberingInstanceSpec; abstractId: number; numericId: number }> = [];
  definitions.forEach((definition, index) => {
    for (const instance of definition.instances ?? []) {
      const numericId = definitions.length + additional.length + 1;
      ids.set(instance.numId, numericId);
      additional.push({ instance, abstractId: index, numericId });
    }
  });
  const themeColorValues = resolveThemeColorValues(spec.theme);
  // CT_Numbering sequence: every abstractNum precedes every num.
  definitions.forEach((definition, index) => {
    root.appendChild(buildAbstractNum(doc, definition, index, themeColorValues));
  });
  definitions.forEach((_definition, index) => {
    root.appendChild(buildNum(doc, index + 1, index));
  });
  for (const { instance, abstractId, numericId } of additional) {
    root.appendChild(buildNum(doc, numericId, abstractId, instance));
  }

  ctx.setFileContent('word/numbering.xml', XML_DECL + serializeXml(doc));
  return ids;
}

/**
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.6
 */
function buildAbstractNum(
  doc: Document,
  definition: NumberingSpec,
  abstractId: number,
  themeColorValues: ReadonlyMap<ThemeColorSlot, string>,
): Element {
  const abstractNum = createWmlElement(doc, W.abstractNum, { 'w:abstractNumId': String(abstractId) });
  abstractNum.appendChild(
    createWmlElement(doc, W.multiLevelType, {
      'w:val': definition.levels.length > 1 ? 'multilevel' : 'singleLevel',
    }),
  );
  for (const level of definition.levels) {
    abstractNum.appendChild(buildLevel(doc, level, themeColorValues));
  }
  return abstractNum;
}

/**
 * Paragraph styles linked to a numbering level through `w:pStyle`, keyed by
 * styleId. Each link names the definition's default-instance handle and the
 * level, which the styles emitter writes back as the style's `w:numPr` so a
 * paragraph that only applies the style is numbered at that level.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.23
 */
export function collectNumberingStyleLinks(spec: DocumentSpec): Map<string, { numId: string; ilvl: number }> {
  const links = new Map<string, { numId: string; ilvl: number }>();
  for (const definition of spec.numbering ?? []) {
    for (const level of definition.levels) {
      if (level.pStyle !== undefined) links.set(level.pStyle, { numId: definition.numId, ilvl: level.ilvl });
    }
  }
  return links;
}

/**
 * A numbering instance: its abstract-definition reference, then one
 * `w:lvlOverride` per overridden level (ascending `ilvl`), each holding only
 * a `w:startOverride`, per the CT_Num and CT_NumLvl sequences.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.8
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.26
 */
function buildNum(doc: Document, numericId: number, abstractId: number, instance?: NumberingInstanceSpec): Element {
  const num = createWmlElement(doc, W.num, { 'w:numId': String(numericId) });
  num.appendChild(createWmlElement(doc, W.abstractNumId, { 'w:val': String(abstractId) }));
  const overrides = [...(instance?.levelOverrides ?? [])].sort((a, b) => a.ilvl - b.ilvl);
  for (const override of overrides) {
    const lvlOverride = createWmlElement(doc, W.lvlOverride, { 'w:ilvl': String(override.ilvl) });
    lvlOverride.appendChild(createWmlElement(doc, W.startOverride, { 'w:val': String(override.startOverride) }));
    num.appendChild(lvlOverride);
  }
  return num;
}

/**
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.25
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.10
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.23
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.28
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.11
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.7
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.22
 */
function buildLevel(
  doc: Document,
  level: NumberingLevelSpec,
  themeColorValues: ReadonlyMap<ThemeColorSlot, string>,
): Element {
  const lvl = createWmlElement(doc, W.lvl, { 'w:ilvl': String(level.ilvl) });
  const children = new Map<string, Element>();
  children.set(W.start, createWmlElement(doc, W.start, { 'w:val': String(level.start ?? 1) }));
  children.set(W.numFmt, createWmlElement(doc, W.numFmt, { 'w:val': level.numFmt }));
  if (level.lvlRestart !== undefined) {
    children.set(W.lvlRestart, createWmlElement(doc, W.lvlRestart, { 'w:val': String(level.lvlRestart) }));
  }
  if (level.pStyle !== undefined) {
    children.set(W.pStyle, createWmlElement(doc, W.pStyle, { 'w:val': level.pStyle }));
  }
  // CT_OnOff: emit the bare element for true; false is the reader default.
  if (level.isLgl === true) children.set(W.isLgl, createWmlElement(doc, W.isLgl));
  if (level.suff !== undefined) {
    children.set(W.suff, createWmlElement(doc, W.suff, { 'w:val': level.suff }));
  }
  children.set(W.lvlText, createWmlElement(doc, W.lvlText, { 'w:val': level.lvlText }));
  children.set(W.lvlJc, createWmlElement(doc, W.lvlJc, { 'w:val': level.lvlJc ?? 'left' }));
  const pPr = buildLevelParagraphProps(doc, level);
  if (pPr) children.set(W.pPr, pPr);
  if (level.runProps !== undefined) {
    const rPr = buildRunPropsElement(doc, level.runProps, { themeColorValues });
    if (rPr) children.set(W.rPr, rPr);
  }
  appendInOrder(lvl, children, LVL_ORDER);
  return lvl;
}

/**
 * Level paragraph properties: tab stops through the shared pPr builder, plus
 * `w:ind` whenever `indentTwips` is declared (an empty object still emits a
 * bare `w:ind`, as before tab stops existed, so existing output is unchanged).
 */
function buildLevelParagraphProps(doc: Document, level: NumberingLevelSpec): Element | null {
  let extras: Map<string, Element> | undefined;
  if (level.indentTwips !== undefined) {
    const attrs: Record<string, string> = {};
    if (level.indentTwips.left !== undefined) attrs['w:left'] = String(level.indentTwips.left);
    if (level.indentTwips.firstLine !== undefined) attrs['w:firstLine'] = String(level.indentTwips.firstLine);
    if (level.indentTwips.hanging !== undefined) attrs['w:hanging'] = String(level.indentTwips.hanging);
    extras = new Map([[W.ind, createWmlElement(doc, W.ind, attrs)]]);
  }
  return buildParagraphPropsElement(doc, { tabs: level.tabs }, extras);
}
