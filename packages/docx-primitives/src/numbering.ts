import { OOXML, W } from './namespaces.js';

function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, localName) ?? el.getAttribute(`w:${localName}`) ?? el.getAttribute(localName);
}

export type NumberingLevel = {
  ilvl: number;
  start: number; // default 1
  numFmt: string; // decimal, lowerLetter, upperLetter, lowerRoman, upperRoman, bullet, none...
  lvlText: string; // e.g. "%1.%2."
  suff: string; // tab, space, nothing
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

      const startVal = startEl ? Number.parseInt(getWAttr(startEl, 'val') ?? '1', 10) : 1;
      const numFmt = numFmtEl ? (getWAttr(numFmtEl, 'val') ?? 'decimal') : 'decimal';
      const lvlText = lvlTextEl ? (getWAttr(lvlTextEl, 'val') ?? `%${ilvl + 1}.`) : `%${ilvl + 1}.`;
      const suff = suffEl ? (getWAttr(suffEl, 'val') ?? 'tab') : 'tab';

      levels.set(ilvl, { ilvl, start: startVal, numFmt, lvlText, suff });
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

export type NumberingCounters = Map<string, number[]>; // numId -> per-level counters

function getStartForLevel(model: NumberingModel, numId: string, ilvl: number): number {
  const num = model.nums.get(numId);
  if (!num) return 1;
  const ov = num.startOverrideByLevel.get(ilvl);
  if (ov !== undefined) return ov;
  const abs = model.abstractNums.get(num.abstractNumId);
  const lvl = abs?.levels.get(ilvl);
  return lvl?.start ?? 1;
}

function getLevel(model: NumberingModel, numId: string, ilvl: number): NumberingLevel | null {
  const num = model.nums.get(numId);
  if (!num) return null;
  const abs = model.abstractNums.get(num.abstractNumId);
  return abs?.levels.get(ilvl) ?? null;
}

export function computeListLabelForParagraph(
  model: NumberingModel,
  counters: NumberingCounters,
  params: { numId: string; ilvl: number },
): string {
  const { numId, ilvl } = params;
  const level = getLevel(model, numId, ilvl);
  if (!level) return '';

  let arr = counters.get(numId);
  if (!arr) {
    // Initialize with "start-1" for each level we might see.
    arr = [];
    counters.set(numId, arr);
  }

  // Ensure array has at least ilvl+1 entries.
  while (arr.length <= ilvl) arr.push(0);

  // Initialize this level to start-1 if it hasn't been set yet.
  const startThis = getStartForLevel(model, numId, ilvl);
  if (arr[ilvl] === 0) arr[ilvl] = startThis - 1;

  // Increment this level.
  arr[ilvl] = arr[ilvl] + 1;
  if (arr[ilvl] < startThis) arr[ilvl] = startThis;

  // Reset deeper levels.
  for (let d = ilvl + 1; d < arr.length; d++) {
    const startD = getStartForLevel(model, numId, d);
    arr[d] = startD - 1;
  }

  // Render lvlText by substituting counters.
  const lvlText = level.lvlText || `%${ilvl + 1}.`;
  const rendered = lvlText.replace(/%(\d+)/g, (_m, nStr) => {
    const levelNum = Number.parseInt(String(nStr), 10) - 1;
    if (Number.isNaN(levelNum) || levelNum < 0) return '';
    const v = arr[levelNum] ?? 0;
    const lvlDef = getLevel(model, numId, levelNum);
    const fmt = lvlDef?.numFmt ?? 'decimal';
    return formatCounter(fmt, v);
  });

  // For TOON we treat suffix as a display concern; keep label column trimmed.
  return rendered.trim();
}
