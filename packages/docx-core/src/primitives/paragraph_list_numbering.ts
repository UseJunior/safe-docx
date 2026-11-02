import { OOXML, W } from './namespaces.js';
import { getAttributeSafe } from './xml-helpers.js';
import {
  advanceListLabel,
  type ListLabelSnapshot,
  type NumberingCounters,
  type NumberingModel,
} from './numbering.js';
import type { StylesModel } from './styles.js';

/**
 * Where a paragraph's effective numbering reference came from: its own
 * `w:numPr`, its paragraph style chain, or a direct `w:numPr` that names only
 * one of `w:numId` / `w:ilvl` and takes the other from the style.
 */
export type ParagraphNumberingSource = 'direct' | 'style' | 'direct+style';

export type ResolvedParagraphNumbering = {
  numId: string;
  ilvl: number;
  source: ParagraphNumberingSource;
};

type PartialNumPr = { numId: string | null; ilvl: number | null };

function wVal(el: Element): string | null {
  return getAttributeSafe(el, OOXML.W_NS, W.val, 'w');
}

function directChild(parent: Element, localName: string): Element | null {
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).namespaceURI === OOXML.W_NS && (n as Element).localName === localName) {
      return n as Element;
    }
  }
  return null;
}

/** The `w:numId` / `w:ilvl` a `w:pPr` names itself, or null without a `w:numPr`. */
function readNumPr(pPr: Element | null): PartialNumPr | null {
  const numPr = pPr ? directChild(pPr, W.numPr) : null;
  if (!numPr) return null;
  const numIdEl = directChild(numPr, W.numId);
  const ilvlEl = directChild(numPr, W.ilvl);
  const numIdVal = numIdEl ? wVal(numIdEl)?.trim() || null : null;
  const ilvlText = ilvlEl ? wVal(ilvlEl)?.trim() ?? '' : '';
  const ilvl = /^\d+$/.test(ilvlText) ? Number(ilvlText) : null;
  return { numId: numIdVal, ilvl: ilvl !== null && Number.isSafeInteger(ilvl) ? ilvl : null };
}

/**
 * The paragraph's style chain, nearest first: its `w:pStyle` and that style's
 * `w:basedOn` ancestors, or the default paragraph style when the paragraph
 * names no style or one the styles part does not define.
 */
function paragraphStyleChain(pPr: Element | null, styles: StylesModel): string[] {
  const pStyleEl = pPr ? directChild(pPr, W.pStyle) : null;
  const named = pStyleEl ? wVal(pStyleEl) : null;
  let cur = named && styles.byId.has(named) ? named : (styles.defaultParagraphStyleId ?? null);
  const chain: string[] = [];
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    const style = styles.byId.get(cur);
    if (!style) break;
    seen.add(cur);
    chain.push(cur);
    cur = style.basedOn;
  }
  return chain;
}

/** Every style id a numbering level links to through its `w:pStyle`. */
function linkedStyleIds(numbering: NumberingModel): Set<string> {
  const linked = new Set<string>();
  for (const abs of numbering.abstractNums.values()) {
    for (const level of abs.levels.values()) {
      if (level.pStyle) linked.add(level.pStyle);
    }
  }
  return linked;
}

/**
 * The numbering a paragraph's style chain gives it, or null. `w:numId` and
 * `w:ilvl` each come from the nearest style that sets them, and a missing
 * `w:ilvl` means level 0. Word honours the result only when the level it
 * names links back (through the level's `w:pStyle`) to the nearest style in
 * the chain that any level links to, or when neither side carries such a
 * link; otherwise the style's numbering shows nothing.
 */
function resolveStyleNumbering(
  chain: string[],
  styles: StylesModel,
  numbering: NumberingModel,
  linked: ReadonlySet<string>,
): PartialNumPr | null {
  let numId: string | null = null;
  let ilvl: number | null = null;
  for (const styleId of chain) {
    const own = readNumPr(styles.byId.get(styleId)?.pPr ?? null);
    if (!own) continue;
    if (numId === null && own.numId !== null) numId = own.numId;
    if (ilvl === null && own.ilvl !== null) ilvl = own.ilvl;
    if (numId !== null && ilvl !== null) break;
  }
  if (numId === null) return null;
  const level = ilvl ?? 0;
  if (numId === '0') return { numId, ilvl: level };

  const num = numbering.nums.get(numId);
  const levelStyle = num ? (numbering.abstractNums.get(num.abstractNumId)?.levels.get(level)?.pStyle ?? null) : null;
  const nearestLinked = chain.find((id) => linked.has(id)) ?? null;
  if (levelStyle !== nearestLinked) return null;
  return { numId, ilvl: level };
}

/**
 * Resolve the numbering reference a paragraph actually displays: its own
 * `w:pPr/w:numPr` (a `w:numPr` inside `w:pPrChange` is the prior state and is
 * not read), else the one inherited through its paragraph style chain
 * (`w:pStyle`, following `w:basedOn`; the default paragraph style when it
 * names none). A direct `w:numPr` that names only `w:numId` or only `w:ilvl`
 * takes the other from the style; a missing `w:ilvl` means level 0; and
 * `w:numId` 0 at the winning layer turns numbering off. Returns null for an
 * unnumbered paragraph. Read-side only: `getDirectParagraphNumbering` keeps
 * reporting just the direct reference that `format_numbering` edits.
 *
 * The style rules follow Word for Mac 16.114 (oracle evidence in
 * scripts/oracle/word/evidence/issue-1244-word-16.114.json). Word does not
 * ignore a style's `w:ilvl` in favour of the level that links to the style,
 * as § 17.3.1.19 and § 17.9.23 say: it uses the style's `w:ilvl` (0 when
 * absent) and shows no number when that level links to another style.
 *
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.3.1.19 — follows Word: a style's w:ilvl (default 0) is used, not ignored, and must agree with the level's w:pStyle link
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.23
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.4.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.27
 */
export function resolveParagraphNumbering(
  paragraph: Element,
  styles: StylesModel,
  numbering: NumberingModel,
  linked: ReadonlySet<string> = linkedStyleIds(numbering),
): ResolvedParagraphNumbering | null {
  const pPr = directChild(paragraph, W.pPr);
  const direct = readNumPr(pPr);
  const style = direct?.numId != null && direct.ilvl != null
    ? null
    : resolveStyleNumbering(paragraphStyleChain(pPr, styles), styles, numbering, linked);

  const numId = direct?.numId ?? style?.numId ?? null;
  if (numId === null || numId === '0') return null;
  const ilvl = direct?.ilvl ?? style?.ilvl ?? 0;

  let source: ParagraphNumberingSource;
  if (!direct) source = 'style';
  else if ((direct.numId === null && style) || (direct.ilvl === null && style)) source = 'direct+style';
  else source = 'direct';
  return { numId, ilvl, source };
}

export type ParagraphListLabel = ListLabelSnapshot & { source: ParagraphNumberingSource };

/**
 * Number a run of paragraphs in document order and return each numbered
 * paragraph's label and counter snapshot. Paragraphs whose numbering comes
 * from their style advance the same shared counters as directly numbered
 * ones. Pass every paragraph of the story in order — a paragraph left out
 * does not advance its list.
 */
export function computeParagraphListLabels(
  paragraphs: Iterable<Element>,
  numbering: NumberingModel,
  styles: StylesModel,
  counters: NumberingCounters = new Map(),
): Map<Element, ParagraphListLabel> {
  const linked = linkedStyleIds(numbering);
  const labels = new Map<Element, ParagraphListLabel>();
  for (const p of paragraphs) {
    const resolved = resolveParagraphNumbering(p, styles, numbering, linked);
    if (!resolved) continue;
    const snapshot = advanceListLabel(numbering, counters, resolved);
    if (snapshot) labels.set(p, { ...snapshot, source: resolved.source });
  }
  return labels;
}

export { linkedStyleIds as collectNumberingLinkedStyleIds };
