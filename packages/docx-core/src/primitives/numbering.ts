import { OOXML, W } from './namespaces.js';
import { getFirstChild } from './xml-helpers.js';

function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, localName) ?? el.getAttribute(`w:${localName}`) ?? el.getAttribute(localName);
}

export type NumberingLevel = {
  ilvl: number;
  start: number; // default 1
  numFmt: string; // decimal, lowerLetter, upperLetter, lowerRoman, upperRoman, bullet, none...
  lvlText: string; // e.g. "%1.%2."
  suff: string; // tab, space, nothing
  pStyle: string | null;
  /** w:isLgl: placeholders in lvlText render as Arabic numerals. */
  isLgl: boolean;
  /**
   * w:lvlRestart: one-based restart threshold (0 = never restart); null when
   * absent, meaning the level restarts after the previous level.
   */
  lvlRestart: number | null;
};

export type AbstractNum = {
  abstractNumId: string;
  levels: Map<number, NumberingLevel>;
};

export type NumInstance = {
  numId: string;
  abstractNumId: string;
  startOverrideByLevel: Map<number, number>;
};

export type NumberingModel = {
  abstractNums: Map<string, AbstractNum>;
  nums: Map<string, NumInstance>;
};

export function parseNumberingXml(numberingDoc: Document | null): NumberingModel {
  const model: NumberingModel = { abstractNums: new Map(), nums: new Map() };
  if (!numberingDoc) return model;

  const abs = Array.from(numberingDoc.getElementsByTagNameNS(OOXML.W_NS, W.abstractNum));
  for (const a of abs) {
    const id = getWAttr(a, 'abstractNumId');
    if (!id) continue;
    const levels = new Map<number, NumberingLevel>();
    const lvls = Array.from(a.getElementsByTagNameNS(OOXML.W_NS, W.lvl));
    for (const lvl of lvls) {
      const ilvlStr = getWAttr(lvl, 'ilvl');
      const ilvl = ilvlStr ? Number.parseInt(ilvlStr, 10) : NaN;
      if (Number.isNaN(ilvl)) continue;
      const startEl = lvl.getElementsByTagNameNS(OOXML.W_NS, W.start).item(0);
      const numFmtEl = lvl.getElementsByTagNameNS(OOXML.W_NS, W.numFmt).item(0);
      const lvlTextEl = lvl.getElementsByTagNameNS(OOXML.W_NS, W.lvlText).item(0);
      const suffEl = lvl.getElementsByTagNameNS(OOXML.W_NS, W.suff).item(0);
      const pStyleEl = getFirstChild(lvl, OOXML.W_NS, W.pStyle);
      const isLglEl = getFirstChild(lvl, OOXML.W_NS, W.isLgl);
      const lvlRestartEl = getFirstChild(lvl, OOXML.W_NS, W.lvlRestart);

      const startVal = startEl ? Number.parseInt(getWAttr(startEl, 'val') ?? '1', 10) : 1;
      const numFmt = numFmtEl ? (getWAttr(numFmtEl, 'val') ?? 'decimal') : 'decimal';
      const lvlText = lvlTextEl ? (getWAttr(lvlTextEl, 'val') ?? `%${ilvl + 1}.`) : `%${ilvl + 1}.`;
      const suff = suffEl ? (getWAttr(suffEl, 'val') ?? 'tab') : 'tab';
      const pStyle = pStyleEl ? (getWAttr(pStyleEl, 'val') ?? null) : null;
      const isLgl = isLglEl ? isOnOffTrue(getWAttr(isLglEl, 'val')) : false;
      const lvlRestartVal = lvlRestartEl ? Number.parseInt(getWAttr(lvlRestartEl, 'val') ?? '', 10) : NaN;
      const lvlRestart = Number.isNaN(lvlRestartVal) ? null : lvlRestartVal;

      levels.set(ilvl, { ilvl, start: startVal, numFmt, lvlText, suff, pStyle, isLgl, lvlRestart });
    }
    model.abstractNums.set(id, { abstractNumId: id, levels });
  }

  const nums = Array.from(numberingDoc.getElementsByTagNameNS(OOXML.W_NS, W.num));
  for (const n of nums) {
    const numId = getWAttr(n, 'numId');
    if (!numId) continue;
    const absIdEl = n.getElementsByTagNameNS(OOXML.W_NS, W.abstractNumId).item(0);
    const abstractNumId = absIdEl ? (getWAttr(absIdEl, 'val') ?? '') : '';
    if (!abstractNumId) continue;

    const startOverrideByLevel = new Map<number, number>();
    const overrides = Array.from(n.getElementsByTagNameNS(OOXML.W_NS, W.lvlOverride));
    for (const ov of overrides) {
      const ilvlStr = getWAttr(ov, 'ilvl');
      const ilvl = ilvlStr ? Number.parseInt(ilvlStr, 10) : NaN;
      if (Number.isNaN(ilvl)) continue;
      const startOv = ov.getElementsByTagNameNS(OOXML.W_NS, W.startOverride).item(0);
      if (!startOv) continue;
      const v = Number.parseInt(getWAttr(startOv, 'val') ?? '', 10);
      if (!Number.isNaN(v)) startOverrideByLevel.set(ilvl, v);
    }

    model.nums.set(numId, { numId, abstractNumId, startOverrideByLevel });
  }

  return model;
}

/** CT_OnOff: a bare element (no val) is true; '0'/'false'/'off' are false. */
function isOnOffTrue(val: string | null): boolean {
  return val === null || !['0', 'false', 'off'].includes(val);
}

function toRoman(n: number, upper: boolean): string {
  // Simple roman numeral conversion for 1..3999.
  if (n <= 0) return '';
  const pairs: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let x = n;
  let out = '';
  for (const [val, sym] of pairs) {
    while (x >= val) {
      out += sym;
      x -= val;
    }
  }
  return upper ? out : out.toLowerCase();
}

function toLetters(n: number, upper: boolean): string {
  // 1 -> a, 2 -> b, ..., 26 -> z, 27 -> aa
  if (n <= 0) return '';
  let x = n;
  let out = '';
  while (x > 0) {
    x -= 1;
    out = String.fromCharCode(97 + (x % 26)) + out;
    x = Math.floor(x / 26);
  }
  return upper ? out.toUpperCase() : out;
}

function formatCounter(numFmt: string, n: number): string {
  switch (numFmt) {
    case 'decimal':
      return String(n);
    case 'decimalZero':
      // A leading zero only for one through nine (§ 17.18.59): 0 stays "0".
      return n >= 1 && n <= 9 ? `0${n}` : String(n);
    case 'lowerLetter':
      return toLetters(n, false);
    case 'upperLetter':
      return toLetters(n, true);
    case 'lowerRoman':
      return toRoman(n, false);
    case 'upperRoman':
      return toRoman(n, true);
    case 'bullet':
      return '•';
    case 'none':
      return '';
    default:
      // Many formats exist; default to decimal for now.
      return String(n);
  }
}

/**
 * Running list counters for one document pass, keyed by `abstractNumId`.
 * Every `w:num` instance of one abstract definition shares a single running
 * sequence, as Word and LibreOffice display it; create one `new Map()` per
 * document pass and feed paragraphs to it in document order.
 *
 * The functions here also keep per-pass state beside the map (which
 * instance levels have restarted, and the start value a level not yet used
 * will begin at). That state is tied to the map object: `new Map(counters)`
 * does not copy it and `counters.clear()` does not reset it, so start each
 * pass with a fresh map rather than copying or clearing one.
 */
export type NumberingCounters = Map<string, number[]>; // abstractNumId -> per-level counters

type ListPassState = {
  /**
   * The (instance, level) pairs already numbered, so a `w:startOverride`
   * restarts the shared sequence only at its instance's first paragraph on
   * that level.
   */
  usedInstanceLevels: Map<string, Set<number>>;
  /**
   * Per abstract definition, the start value a level the list has never used
   * will begin at, recorded when a paragraph's restart reaches that level
   * (the restarting paragraph's instance start, as Word applies it). Kept
   * apart from the counters so a never-used level still reads NaN.
   */
  pendingStarts: Map<string, Map<number, number>>;
};

/** Kept beside the map rather than in it, so `NumberingCounters` stays a plain map. */
const passStates = new WeakMap<NumberingCounters, ListPassState>();

function passState(counters: NumberingCounters): ListPassState {
  let state = passStates.get(counters);
  if (!state) {
    state = { usedInstanceLevels: new Map(), pendingStarts: new Map() };
    passStates.set(counters, state);
  }
  return state;
}

function instanceLevelsUsed(state: ListPassState, numId: string): Set<number> {
  let used = state.usedInstanceLevels.get(numId);
  if (!used) {
    used = new Set();
    state.usedInstanceLevels.set(numId, used);
  }
  return used;
}

function pendingStartsFor(state: ListPassState, abstractNumId: string): Map<number, number> {
  let pending = state.pendingStarts.get(abstractNumId);
  if (!pending) {
    pending = new Map();
    state.pendingStarts.set(abstractNumId, pending);
  }
  return pending;
}

/** The level's start value for an instance: its `startOverride`, else the abstract `w:start`. */
function getStartForLevel(model: NumberingModel, numId: string, ilvl: number): number {
  const num = model.nums.get(numId);
  if (!num) return 1;
  const ov = num.startOverrideByLevel.get(ilvl);
  if (ov !== undefined) return ov;
  const abs = model.abstractNums.get(num.abstractNumId);
  const lvl = abs?.levels.get(ilvl);
  return lvl?.start ?? 1;
}

/**
 * Resolve the exact numbering-level definition active for a paragraph without
 * advancing or otherwise mutating list counters.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.6
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.23
 */
export function getNumberingLevel(
  model: NumberingModel,
  numId: string,
  ilvl: number,
): Readonly<NumberingLevel> | null {
  const num = model.nums.get(numId);
  if (!num) return null;
  const abs = model.abstractNums.get(num.abstractNumId);
  return abs?.levels.get(ilvl) ?? null;
}

/**
 * One numbered paragraph's place in its list, captured when its counters
 * advance: the rendered label plus the counter value of every level from 0
 * through `ilvl`, so a caller can render any ancestor level's text (for
 * example a full-context number such as "2.06(b)") with
 * {@link renderListLevelText} without re-walking the document.
 */
export type ListLabelSnapshot = {
  numId: string;
  abstractNumId: string;
  ilvl: number;
  /** The paragraph's own level text, rendered and trimmed, e.g. "(b)". */
  label: string;
  /**
   * Counter values for levels 0..ilvl at this paragraph. A level the list has
   * never used is NaN; a level restarted since its last use holds its
   * restart start value minus one.
   */
  levelValues: readonly number[];
};

/**
 * Advance the paragraph's list counters and render its label. Counters are
 * shared by every `w:num` instance of one `w:abstractNum`; an instance's
 * `w:startOverride` restarts the shared level at its override value the
 * first time a paragraph uses that instance on that level, and never again.
 * Deeper levels restart per their `w:lvlRestart` threshold, at the start
 * value of the instance whose paragraph caused the restart. A `w:isLgl`
 * level renders every placeholder as an Arabic numeral, except that
 * `decimalZero` levels keep their padding and `none` levels stay empty, as
 * Word displays them; `decimalZero` pads one through nine. Returns null, and
 * leaves the counters untouched, when the instance or level is undefined.
 *
 * The sharing and restart rules follow Word for Mac 16.114 (oracle evidence
 * in scripts/oracle/word/evidence/issue-1243-word-16.114.json).
 *
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.9.4 — follows Word: decimalZero padding and none/bullet levels survive isLgl
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.10
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.11
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.26
 */
export function advanceListLabel(
  model: NumberingModel,
  counters: NumberingCounters,
  params: { numId: string; ilvl: number },
): ListLabelSnapshot | null {
  const { numId, ilvl } = params;
  const level = getNumberingLevel(model, numId, ilvl);
  if (!level) return null;
  const abstractNumId = model.nums.get(numId)!.abstractNumId;

  let arr = counters.get(abstractNumId);
  if (!arr) {
    arr = [];
    counters.set(abstractNumId, arr);
  }

  // Ensure array has at least ilvl+1 entries. NaN marks a level not yet
  // used, so a level whose legitimate value is 0 (start or startOverride 0,
  // or a negative start counting up through 0) is not re-initialized.
  while (arr.length <= ilvl) arr.push(Number.NaN);

  // The instance's first paragraph on an overridden level restarts the
  // shared sequence at the override value; later paragraphs of the same
  // instance continue it like any other instance.
  const state = passState(counters);
  const pending = pendingStartsFor(state, abstractNumId);
  const used = instanceLevelsUsed(state, numId);
  const override = model.nums.get(numId)!.startOverrideByLevel.get(ilvl);
  if (override !== undefined && !used.has(ilvl)) arr[ilvl] = override - 1;
  used.add(ilvl);

  // A level the list has never used begins at the start a restart recorded
  // for it, else at this instance's start; then advance.
  if (Number.isNaN(arr[ilvl]!)) arr[ilvl] = (pending.get(ilvl) ?? getStartForLevel(model, numId, ilvl)) - 1;
  pending.delete(ilvl);
  arr[ilvl] = arr[ilvl]! + 1;

  // Reset deeper levels whose restart threshold this level meets. By default
  // a level restarts whenever any earlier level is used; w:lvlRestart="r"
  // restarts it only when one of the first r levels (one-based) is used, and
  // r = 0 never restarts it (§ 17.9.10). The restart value is this
  // paragraph's instance's start for that level, as Word applies it. A level
  // the list has never used keeps reading NaN; its restart value is recorded
  // so that an override instance's restart still reaches a level another
  // instance uses first (Word's r4 case).
  const levels = model.abstractNums.get(abstractNumId)!.levels;
  for (const d of levels.keys()) {
    if (d <= ilvl) continue;
    const restart = levels.get(d)!.lvlRestart;
    if (restart !== null && ilvl >= restart) continue;
    const start = getStartForLevel(model, numId, d);
    if (d < arr.length && !Number.isNaN(arr[d]!)) arr[d] = start - 1;
    else pending.set(d, start);
  }

  const levelValues = arr.slice(0, ilvl + 1);
  return {
    numId,
    abstractNumId,
    ilvl,
    label: renderListLevelText(model, numId, ilvl, levelValues),
    levelValues,
  };
}

/**
 * Render one level's `w:lvlText` from the given per-level counter values
 * without touching any counters, e.g. an ancestor level of a
 * {@link ListLabelSnapshot}: `renderListLevelText(model, s.numId, 1,
 * s.levelValues)` gives the "Section 2.06" above a "(b)" clause. Returns ''
 * when the level is undefined.
 *
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.9.4 — follows Word: decimalZero padding and none/bullet levels survive isLgl
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.11
 */
export function renderListLevelText(
  model: NumberingModel,
  numId: string,
  ilvl: number,
  levelValues: readonly number[],
): string {
  const level = getNumberingLevel(model, numId, ilvl);
  if (!level) return '';
  const lvlText = level.lvlText || `%${ilvl + 1}.`;
  const rendered = lvlText.replace(/%(\d+)/g, (_m, nStr) => {
    const levelNum = Number.parseInt(String(nStr), 10) - 1;
    if (Number.isNaN(levelNum) || levelNum < 0) return '';
    const counter = levelValues[levelNum];
    // A level never used renders as 0, as before the NaN sentinel existed.
    const v = counter === undefined || Number.isNaN(counter) ? 0 : counter;
    const lvlDef = getNumberingLevel(model, numId, levelNum);
    const fmt = lvlDef?.numFmt ?? 'decimal';
    // Legal numbering (w:isLgl) shows every placeholder as an Arabic numeral.
    // Following Word rather than the letter of § 17.9.4: zero-padded decimal
    // levels keep their padding ("Section 2.01", observed in Word and
    // LibreOffice), and a `none` level stays empty ([MS-OE376]); bullet glyphs
    // are not numbers, so they stay glyphs.
    if (level.isLgl && fmt !== 'decimalZero' && fmt !== 'bullet' && fmt !== 'none') {
      return formatCounter('decimal', v);
    }
    return formatCounter(fmt, v);
  });

  // For TOON we treat suffix as a display concern; keep label column trimmed.
  return rendered.trim();
}

/**
 * Advance the paragraph's list counters and return its rendered label, or ''
 * when the instance or level is undefined. See {@link advanceListLabel} for
 * the counting rules.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.26
 */
export function computeListLabelForParagraph(
  model: NumberingModel,
  counters: NumberingCounters,
  params: { numId: string; ilvl: number },
): string {
  return advanceListLabel(model, counters, params)?.label ?? '';
}
