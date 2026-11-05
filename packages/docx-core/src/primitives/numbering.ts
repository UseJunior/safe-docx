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

/**
 * Alphabetic list numbers: a…z, then the letter repeated, aa, bb, …, zz, then
 * aaa, bbb, … (§ 17.18.59 lowerLetter/upperLetter; Word 16.114 shows 27 as
 * "aa", 28 as "bb" and 53 as "aaa", recorded in
 * scripts/oracle/word/evidence/issue-1236-word-16.114.json).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.18.59
 */
function toLetters(n: number, upper: boolean): string {
  if (n <= 0) return '';
  const out = String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);
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
   * Per abstract definition, the start value a level with no paragraph since
   * it was last restarted (or ever) will begin at, recorded when a
   * paragraph's restart reaches that level (the restarting paragraph's
   * instance start, as Word applies it). Kept apart from the counters so
   * such a level still reads NaN.
   */
  pendingStarts: Map<string, Map<number, number>>;
  /**
   * Per abstract definition, the ancestor levels shown at a start value
   * because a deeper paragraph needed them before any paragraph of their
   * own (since they last restarted), mapped to the value shown. The counter
   * of such a level holds the start of the instance that first showed it,
   * which its own next paragraph continues from.
   */
  levelsShownAtStart: Map<string, Map<number, number>>;
};

/** Kept beside the map rather than in it, so `NumberingCounters` stays a plain map. */
const passStates = new WeakMap<NumberingCounters, ListPassState>();

function passState(counters: NumberingCounters): ListPassState {
  let state = passStates.get(counters);
  if (!state) {
    state = { usedInstanceLevels: new Map(), pendingStarts: new Map(), levelsShownAtStart: new Map() };
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

function perAbstract(map: Map<string, Map<number, number>>, abstractNumId: string): Map<number, number> {
  let levels = map.get(abstractNumId);
  if (!levels) {
    levels = new Map();
    map.set(abstractNumId, levels);
  }
  return levels;
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

/** The level's `w:start` in the abstract definition, ignoring any instance `startOverride`. */
function getAbstractStartForLevel(model: NumberingModel, numId: string, ilvl: number): number {
  return getNumberingLevel(model, numId, ilvl)?.start ?? 1;
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
   * The value each level 0..ilvl shows at this paragraph. An ancestor level
   * with no paragraph of its own since it last restarted shows a start value
   * (see {@link ListLabelSnapshot.levelsAtStartValue}); every value is a
   * number.
   */
  levelValues: readonly number[];
  /**
   * The ancestor levels (ascending) that no paragraph has numbered since
   * they last restarted, so that this paragraph shows them at a start value.
   * A full-context reference number passes over such a level when a level
   * above it has a paragraph. Absent means none.
   */
  levelsAtStartValue?: readonly number[];
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
 * An ancestor level with no paragraph of its own since it last restarted (or
 * ever) shows a start value: the value a restart recorded for it, else the
 * abstract `w:start` (an instance's `w:startOverride` is not shown). Its
 * counter then holds the start of the instance whose paragraph first showed
 * it, so the level's next paragraph continues from there ("1." "1(a)(i)"
 * "1(b)", and "1(a)" "1(b)" "2." when the list opens at level 1), unless
 * that paragraph is its instance's first on an overridden level.
 *
 * A level whose own level text names a deeper level is silent: its
 * paragraphs get an empty label (their counters still advance), and a
 * placeholder naming it renders as empty text.
 *
 * The sharing, restart, start-value and silent-level rules follow Word for
 * Mac 16.114 (oracle evidence in
 * scripts/oracle/word/evidence/issue-1243-word-16.114.json and
 * issue-1254-word-16.114.json).
 *
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.9.4 — follows Word: decimalZero padding and none/bullet levels survive isLgl
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.9.11 — follows Word: a level text naming a deeper level shows no label, and a placeholder naming such a level shows nothing
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.10
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
  const pending = perAbstract(state.pendingStarts, abstractNumId);
  const shownAtStart = perAbstract(state.levelsShownAtStart, abstractNumId);
  const used = instanceLevelsUsed(state, numId);
  const override = model.nums.get(numId)!.startOverrideByLevel.get(ilvl);
  if (override !== undefined && !used.has(ilvl)) arr[ilvl] = override - 1;
  used.add(ilvl);

  // A level the list has never used begins at the start a restart recorded
  // for it, else at this instance's start; then advance.
  if (Number.isNaN(arr[ilvl]!)) arr[ilvl] = (pending.get(ilvl) ?? getStartForLevel(model, numId, ilvl)) - 1;
  pending.delete(ilvl);
  shownAtStart.delete(ilvl);
  arr[ilvl] = arr[ilvl]! + 1;

  // Reset deeper levels whose restart threshold this level meets. By default
  // a level restarts whenever any earlier level is used; w:lvlRestart="r"
  // restarts it only when one of the first r levels (one-based) is used, and
  // r = 0 never restarts it (§ 17.9.10). The restart value is this
  // paragraph's instance's start for that level, as Word applies it. A
  // restarted level reads NaN until it is next used or shown, and its
  // restart value is recorded, so an override instance's restart also
  // reaches a level another instance uses first (Word's r4 case).
  const levels = model.abstractNums.get(abstractNumId)!.levels;
  for (const d of levels.keys()) {
    if (d <= ilvl) continue;
    const restart = levels.get(d)!.lvlRestart;
    if (restart !== null && ilvl >= restart) continue;
    if (d < arr.length) arr[d] = Number.NaN;
    pending.set(d, getStartForLevel(model, numId, d));
    shownAtStart.delete(d);
  }

  // An ancestor with no paragraph since it last restarted is shown at the
  // value its restart recorded, else the abstract start, and counts as used
  // from this instance's start (Word's r2/r5 and override probes).
  for (let k = 0; k < ilvl; k++) {
    if (!Number.isNaN(arr[k]!)) continue;
    shownAtStart.set(k, pending.get(k) ?? getAbstractStartForLevel(model, numId, k));
    pending.delete(k);
    arr[k] = getStartForLevel(model, numId, k);
  }

  const levelValues = arr.slice(0, ilvl + 1).map((value, k) => shownAtStart.get(k) ?? value);
  const levelsAtStartValue = [...shownAtStart.keys()].filter((k) => k < ilvl).sort((a, b) => a - b);
  return {
    numId,
    abstractNumId,
    ilvl,
    label: renderListLevelText(model, numId, ilvl, levelValues),
    levelValues,
    ...(levelsAtStartValue.length > 0 ? { levelsAtStartValue } : {}),
  };
}

/**
 * Render one level's `w:lvlText` from the given per-level counter values
 * without touching any counters, e.g. an ancestor level of a
 * {@link ListLabelSnapshot}: `renderListLevelText(model, s.numId, 1,
 * s.levelValues)` gives the "Section 2.06" above a "(b)" clause. Returns ''
 * when the level is undefined, and when its level text names a deeper level
 * (Word shows no label for such a level); a placeholder naming such a level
 * renders as empty text ("%1." over a silent level 0 reads ".").
 *
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.9.4 — follows Word: decimalZero padding and none/bullet levels survive isLgl
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.9.11 — follows Word: a level text naming a deeper level shows no label, and a placeholder naming such a level shows nothing
 */
export function renderListLevelText(
  model: NumberingModel,
  numId: string,
  ilvl: number,
  levelValues: readonly number[],
): string {
  // For TOON we treat suffix as a display concern; keep label column trimmed.
  const part = substituteLevelText(model, numId, ilvl, levelValues);
  return part && !part.namesDeeperLevel ? part.text.trim() : '';
}

/** The deepest level a list can define (`w:ilvl` 0 through 8). */
const DEEPEST_LIST_LEVEL = 8;

/**
 * Whether a placeholder's level is deeper than `ilvl` but still a level a
 * list can define. A placeholder past level 8 (such as `%10`) names no level
 * and keeps rendering as 0.
 */
function isDeeperListLevel(levelNum: number, ilvl: number): boolean {
  return levelNum > ilvl && levelNum <= DEEPEST_LIST_LEVEL;
}

/** Whether a level text names a level deeper than its own (Word then shows nothing for the level). */
function levelTextNamesDeeperLevel(lvlText: string, ilvl: number): boolean {
  for (const match of lvlText.matchAll(/%(\d+)/g)) {
    if (isDeeperListLevel(Number.parseInt(match[1]!, 10) - 1, ilvl)) return true;
  }
  return false;
}

/** The level's `w:lvlText`, or the `%N.` Word assumes when it is absent. */
function effectiveLevelText(level: Readonly<NumberingLevel>, ilvl: number): string {
  return level.lvlText || `%${ilvl + 1}.`;
}

/**
 * The level's `w:lvlText` with every placeholder replaced, untrimmed, and
 * whether a placeholder named a level without a counter value (rendered 0)
 * or a level deeper than its own. A placeholder naming a shallower level
 * whose own text names a deeper level renders as empty text, as Word shows
 * it. Null when the level is undefined.
 */
function substituteLevelText(
  model: NumberingModel,
  numId: string,
  ilvl: number,
  levelValues: readonly number[],
): { text: string; lvlText: string; usesUnusedLevel: boolean; namesDeeperLevel: boolean } | null {
  const level = getNumberingLevel(model, numId, ilvl);
  if (!level) return null;
  const lvlText = effectiveLevelText(level, ilvl);
  let usesUnusedLevel = false;
  let namesDeeperLevel = false;
  const text = lvlText.replace(/%(\d+)/g, (_m, nStr) => {
    const levelNum = Number.parseInt(String(nStr), 10) - 1;
    if (Number.isNaN(levelNum) || levelNum < 0) return '';
    if (isDeeperListLevel(levelNum, ilvl)) namesDeeperLevel = true;
    const lvlDef = getNumberingLevel(model, numId, levelNum);
    // A silent shallower level (its own text names a deeper level) shows nothing here either.
    if (levelNum < ilvl && lvlDef && levelTextNamesDeeperLevel(effectiveLevelText(lvlDef, levelNum), levelNum)) return '';
    const counter = levelValues[levelNum];
    // A level without a counter value (a deeper level, a placeholder past
    // level 8, or a caller's snapshot) renders as 0.
    const unused = counter === undefined || Number.isNaN(counter);
    if (unused) usesUnusedLevel = true;
    const v = unused ? 0 : counter;
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
  return { text, lvlText, usesUnusedLevel, namesDeeperLevel };
}

/** The lowest level a level text's placeholders name, or `ilvl` when it names none. */
function lowestReferencedLevel(lvlText: string, ilvl: number): number {
  let lowest = ilvl;
  for (const match of lvlText.matchAll(/%(\d+)/g)) {
    const levelNum = Number.parseInt(match[1]!, 10) - 1;
    if (levelNum >= 0 && levelNum < lowest) lowest = levelNum;
  }
  return lowest;
}

/** Remove one trailing period, the only character Word strips from a referenced number. */
function withoutTrailingPeriod(text: string): string {
  return text.endsWith('.') ? text.slice(0, -1) : text;
}

/**
 * Which paragraph number a `REF` field's number switch asks for: `\w` (the
 * number in full context), `\n` (the paragraph's own level text) or `\r`
 * (the number in relative context, which depends on where the field sits;
 * see {@link resolveReferenceNumber}).
 */
export type ReferenceNumberForm = 'fullContext' | 'paragraph' | 'relative';

/**
 * Where a `\r` (relative) reference sits, as its number depends on it: the
 * snapshot of the last paragraph of the target's own list (its `w:numId`)
 * at or before the paragraph holding the field, or null when no paragraph
 * of that list comes before the field (the field then shows the full
 * number). The paragraph holding the field need not be numbered or be in
 * that list: Word numbers it relative to the target list's position there
 * (an unnumbered paragraph after "2.03(c)" shows "(b)" for "2.03(b)").
 */
export type RelativeReferenceContext = Pick<ListLabelSnapshot, 'numId' | 'ilvl' | 'levelValues' | 'levelsAtStartValue'> | null;

/** Why no reference number is offered for a numbered paragraph. */
export type ReferenceNumberRefusal =
  /**
   * The number depends on a level without a counter value: a placeholder
   * past `%9`, which names no list level, or a level a caller-built snapshot
   * leaves out. Snapshots from {@link advanceListLabel} carry a value for
   * every level through their own (an ancestor no paragraph has numbered
   * shows its start value, as Word does).
   */
  | 'unusedLevel'
  /** The paragraph's own level text names a deeper level: Word then shows no number at all (a REF field shows 0). */
  | 'deeperLevel'
  /** The level or numbering instance is not defined. */
  | 'undefinedLevel'
  /**
   * A relative (`\r`) number whose target or position shows a level at its
   * start value ({@link ListLabelSnapshot.levelsAtStartValue}): what Word
   * shows for it is not measured.
   */
  | 'relativeStartValue';

/**
 * The number a `REF` field shows for a numbered paragraph, as Word for Mac
 * 16.114 computes it after updating fields, or why none is offered. A number
 * Word would show differently from what safe-docx can compute is refused
 * rather than guessed.
 *
 * - `paragraph` (`\n`): the paragraph's level text, untrimmed, less one
 *   trailing period ("2." → "2", "Article I." → "Article I", "1.." → "1.").
 * - `fullContext` (`\w`): the level text, preceded by the level text of the
 *   level above the lowest one it names, and so on until level 0 is named:
 *   "(b)" under "Section %1.%2" reads "Section 2.06(b)", because that level
 *   already names level 0; "(b)" under "%1." reads "2(b)". One trailing
 *   period is dropped from the last part, and from a part followed by a part
 *   starting with "(" ("2." + "(b)" → "2(b)", but "2." + "b." → "2.b",
 *   "1." + "[a]" → "1.[a]").
 * - `relative` (`\r`): the full-context number less the leading levels the
 *   target shares with where the field sits. `context` is that position
 *   ({@link RelativeReferenceContext}): the levels, from level 0, whose
 *   values the context and the target share are dropped, but never the
 *   target's own level. From inside "Section 2.03(a)", "2.03(b)(ii)" reads
 *   "(b)(ii)"; from "2.03(b)(i)", "(ii)"; from its own paragraph, "(ii)";
 *   from "Section 2.04(a)", "Section 2.03(b)(ii)" (the Section part names
 *   level 0, so it is kept whole); and from another Article in full. A
 *   reference to "Section 2.03" from inside it reads "Section 2.03". With no
 *   context, the number is the full-context one, as in a footnote.
 *
 * On the way up (in both context forms), two kinds of level are passed
 * over, and the walk continues with the level directly above them:
 *
 * - a silent level, whose own level text names a deeper level (Word shows
 *   no label for it): "(a)" under a silent "%1.%2.%3" under "%1." reads
 *   "1(a)";
 * - a level shown at its start value because no paragraph has numbered it
 *   since it last restarted ({@link ListLabelSnapshot.levelsAtStartValue}),
 *   when a level above it has a paragraph: "(i)" right after "ARTICLE II"
 *   reads "ARTICLE II(i)". When no level above has one either, the level is
 *   kept at its start value: a list that opens with a "(a)" clause reads
 *   "Section 1.01(a)".
 *
 * § 17.16.5.51 defines the switches: `\n` gives the number "without trailing
 * periods", `\w` the number "in full context", and `\r` "the entire
 * paragraph number of the bookmarked paragraph in relative context—or
 * relative to its position in the numbering scheme—without trailing
 * periods". How Word assembles the context, which periods it drops between
 * parts, and what a relative number is relative to are measured, not
 * specified; the evidence is in
 * scripts/oracle/word/evidence/issue-1236-word-16.114.json and
 * issue-1254-word-16.114.json; for `\r`, issue-1258-word-16.114.json, whose
 * probes show the position is the target list's (`w:numId`) last paragraph
 * before the field, not the field's own paragraph, and that a field in a
 * footnote shows the full number. § 17.9.11 says a placeholder naming a deeper
 * level is ignored, but Word 16.114 shows no number for such a level (its REF
 * fields show 0), so a reference to it is refused. LibreOffice 26.2
 * recalculates these fields on load and keeps the period before "(" ("2.(b)").
 *
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.16.5.51 — follows Word: one trailing period is removed, a period before "(" inside a full-context number, and silent or unnumbered ancestor levels are passed over; a relative number is measured against the target list's last paragraph before the field
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.9.11 — follows Word: a level text naming a deeper level shows no number, so no reference number to it is offered
 */
export function resolveReferenceNumber(
  model: NumberingModel,
  snapshot: Pick<ListLabelSnapshot, 'numId' | 'ilvl' | 'levelValues' | 'levelsAtStartValue'>,
  form: ReferenceNumberForm,
  context: RelativeReferenceContext = null,
): { text: string } | { refused: ReferenceNumberRefusal } {
  const own = substituteLevelText(model, snapshot.numId, snapshot.ilvl, snapshot.levelValues);
  if (!own) return { refused: 'undefinedLevel' };
  if (own.namesDeeperLevel) return { refused: 'deeperLevel' };
  if (own.usesUnusedLevel) return { refused: 'unusedLevel' };
  if (form === 'paragraph') return { text: withoutTrailingPeriod(own.text) };

  // A relative number keeps the levels from the first one the position does
  // not share with the target, and always the target's own level.
  let keepFrom = 0;
  if (form === 'relative' && context !== null && context.numId === snapshot.numId) {
    if ((snapshot.levelsAtStartValue?.length ?? 0) > 0 || (context.levelsAtStartValue?.length ?? 0) > 0) {
      return { refused: 'relativeStartValue' };
    }
    const shared = Math.min(context.ilvl, snapshot.ilvl) + 1;
    while (keepFrom < shared && context.levelValues[keepFrom] === snapshot.levelValues[keepFrom]) keepFrom += 1;
    keepFrom = Math.min(keepFrom, snapshot.ilvl);
  }

  const atStartValue = new Set(snapshot.levelsAtStartValue ?? []);
  // Whether some level above `ilvl` has a paragraph since it last restarted.
  const numberedAbove = (ilvl: number): boolean => {
    for (let k = 0; k < ilvl; k++) if (!atStartValue.has(k)) return true;
    return false;
  };
  const parts = [own.text];
  let ilvl = lowestReferencedLevel(own.lvlText, snapshot.ilvl) - 1;
  while (ilvl >= keepFrom) {
    const part = substituteLevelText(model, snapshot.numId, ilvl, snapshot.levelValues);
    if (!part) return { refused: 'undefinedLevel' };
    if (part.namesDeeperLevel || (atStartValue.has(ilvl) && numberedAbove(ilvl))) {
      ilvl -= 1;
      continue;
    }
    if (part.usesUnusedLevel) return { refused: 'unusedLevel' };
    parts.unshift(part.text);
    ilvl = Math.min(lowestReferencedLevel(part.lvlText, ilvl), ilvl) - 1;
  }
  return {
    text: parts
      .map((part, index) => {
        const next = parts[index + 1];
        return next === undefined || next.startsWith('(') ? withoutTrailingPeriod(part) : part;
      })
      .join(''),
  };
}

/** {@link resolveReferenceNumber}'s text, or null when no number is offered. */
export function renderReferenceNumber(
  model: NumberingModel,
  snapshot: Pick<ListLabelSnapshot, 'numId' | 'ilvl' | 'levelValues' | 'levelsAtStartValue'>,
  form: ReferenceNumberForm,
  context: RelativeReferenceContext = null,
): string | null {
  const result = resolveReferenceNumber(model, snapshot, form, context);
  return 'text' in result ? result.text : null;
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
