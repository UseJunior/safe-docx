import JSZip from 'jszip';
import { OOXML, parseXml } from '@usejunior/docx-core';
import { DocxMarkdocError } from '../errors.js';
import { CREATION_STYLE } from './profile.js';
import { paragraphReadbackText } from './readback.js';

const W = OOXML.W_NS;
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * One body, header, footer or footnote paragraph as `pull` reads it: the
 * read-back text `create` verifies (fields as their tokens, a REF field as its
 * cached result), and beside it what the text alone does not show.
 */
export type PullParagraph = {
  text: string;
  inTableCell: boolean;
  /** Per character of `text`: the run formatting it carries, as a signature ('' for none). */
  formats: string[];
  /** The paragraph properties `pull` compares, as a signature. */
  properties: string;
  /** `w:pStyle`, when set. */
  style?: string;
  /** `w:jc`, normalized to left, center, right or both. */
  alignment?: string;
  /** True when the paragraph has its own `w:numPr`. */
  numbered: boolean;
  /**
   * The list label the paragraph shows, computed from `word/numbering.xml`
   * (start values, overrides, formats, level text and restarts), with the
   * level's justification, suffix and indentation; '' when unnumbered.
   * Filled in by `readPullDocx` for body paragraphs.
   */
  label: string;
  /** REF fields (cross-references), in order: offset and cached result. */
  crossReferences: Array<{ offset: number; text: string }>;
  /** Offsets of the footnote references in `text`. */
  footnoteReferences: number[];
  /** Names of the other fields (PAGE, DATE, …), in order. */
  fields: string[];
};

/** A header or footer part's paragraphs, or null for a slot without a reference. */
export type PullStory = PullParagraph[] | null;

export type PullDocx = {
  paragraphs: PullParagraph[];
  /** Per section, the default header and footer. */
  headers: PullStory[];
  footers: PullStory[];
  /** Per section: null without `w:titlePg`, else its first-page header and footer. */
  firstPage: Array<{ header: PullStory; footer: PullStory } | null>;
  /** Per section: its page setup as a signature. */
  pageSetup: string[];
  /** Tracked-change elements in any story: element name and count. */
  trackedChanges: Record<string, number>;
  /** Comment anchors in the body and comments in word/comments.xml. */
  comments: number;
  /** Content `create` never writes and `pull` cannot carry, by element name, across the body and the running text. */
  unsupported: Record<string, number>;
  /** Each note's paragraph texts, in reference order. */
  footnotes: string[][];
  /** The style definitions creation uses and the document defaults, as signatures by style id. */
  styles: Record<string, string>;
  /** Each paragraph style's alignment, through its basedOn chain, when it sets one. */
  styleAlignments: Record<string, string | undefined>;
  /** Each body table's structure (rows, cells, grid, spans and merges), as a signature, in reading order. */
  tables: string[];
  /** Even-page header and footer references across the sections. */
  evenPageStories: number;
  /** `w:evenAndOddHeaders` in word/settings.xml. */
  evenAndOddHeaders: boolean;
};

const elementChildren = (node: Node): Element[] => Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
const isW = (node: Node, localName: string): node is Element =>
  node.nodeType === 1 && (node as Element).namespaceURI === W && (node as Element).localName === localName;
const attr = (element: Element, name: string): string | null => (element.hasAttributeNS(W, name) ? element.getAttributeNS(W, name) : element.getAttribute(`w:${name}`));
const child = (element: Element | undefined, localName: string): Element | undefined =>
  element ? elementChildren(element).find((node) => isW(node, localName)) : undefined;

/** Elements that record a tracked change. `pull` refuses a document holding any of them. */
export const TRACKED_CHANGE_ELEMENTS = [
  'ins', 'del', 'moveFrom', 'moveTo', 'moveFromRangeStart', 'moveToRangeStart', 'rPrChange', 'pPrChange', 'sectPrChange',
  'tblPrChange', 'tblGridChange', 'trPrChange', 'tcPrChange', 'numberingChange', 'cellIns', 'cellDel', 'cellMerge',
  'customXmlInsRangeStart', 'customXmlDelRangeStart', 'customXmlMoveFromRangeStart', 'customXmlMoveToRangeStart',
] as const;

/**
 * Content `create` never writes, and whose loss a rebuild would not show in
 * the read-back text: drawings and objects, hyperlinks, content controls,
 * symbols and special characters the read-back skips, text boxes and endnotes.
 */
export const UNSUPPORTED_ELEMENTS = [
  'drawing', 'pict', 'object', 'hyperlink', 'sdt', 'sym', 'noBreakHyphen', 'softHyphen', 'ptab', 'cr', 'txbxContent', 'endnoteReference', 'altChunk', 'smartTag', 'customXml',
] as const;

/** An on/off property: present and not turned off with w:val. */
function on(element: Element | undefined): boolean {
  if (!element) return false;
  const value = attr(element, 'val');
  return !['0', 'false', 'off', 'none'].includes(value ?? '');
}

/**
 * The run formatting `pull` compares, read from a run's direct `w:rPr`:
 * character style, bold, italic, underline, strike, caps, hidden text,
 * vertical alignment, highlight, colour, size, ASCII font and shading. The
 * complex-script variants are left out: Word adds them beside their Latin
 * twins, and they do not change Latin text.
 */
export function runFormatSignature(run: Element | null): string {
  const rPr = run ? child(run, 'rPr') : undefined;
  if (!rPr) return '';
  const parts: string[] = [];
  const style = child(rPr, 'rStyle');
  if (style) parts.push(`style=${attr(style, 'val') ?? ''}`);
  for (const name of ['b', 'i', 'strike', 'dstrike', 'caps', 'smallCaps', 'vanish', 'emboss', 'imprint', 'outline', 'shadow']) {
    if (on(child(rPr, name))) parts.push(name);
  }
  const underline = child(rPr, 'u');
  if (underline && (attr(underline, 'val') ?? 'single') !== 'none') parts.push(`u=${attr(underline, 'val') ?? 'single'}`);
  for (const name of ['vertAlign', 'highlight', 'sz']) {
    const value = child(rPr, name);
    if (value && attr(value, 'val') && attr(value, 'val') !== 'none' && attr(value, 'val') !== 'baseline') parts.push(`${name}=${attr(value, 'val')}`);
  }
  const color = child(rPr, 'color');
  if (color && attr(color, 'val') && attr(color, 'val') !== 'auto') parts.push(`color=${attr(color, 'val')!.toUpperCase()}`);
  const fonts = child(rPr, 'rFonts');
  if (fonts && attr(fonts, 'ascii')) parts.push(`font=${attr(fonts, 'ascii')}`);
  const shading = child(rPr, 'shd');
  if (shading && attr(shading, 'fill') && attr(shading, 'fill') !== 'auto') parts.push(`shd=${attr(shading, 'fill')}`);
  return parts.join(',');
}

/** An element's attributes, sorted, without revision ids. */
function attributeSignature(element: Element | undefined): string {
  if (!element) return '';
  return Array.from(element.attributes)
    .filter((attribute) => !/^rsid/u.test(attribute.localName) && attribute.prefix !== 'xmlns' && attribute.name !== 'xmlns')
    .map((attribute) => `${attribute.localName}=${attribute.value}`)
    .sort()
    .join(' ');
}

/** `w:jc` as left, center, right or both (Word's start and end are left and right). */
function alignmentOf(pPr: Element | undefined): string | undefined {
  const jc = child(pPr, 'jc');
  const value = jc ? attr(jc, 'val') ?? undefined : undefined;
  if (value === 'start') return 'left';
  if (value === 'end') return 'right';
  if (value === 'justify' || value === 'distribute') return 'both';
  return value;
}

/**
 * The paragraph properties `pull` compares: style, alignment, numbering,
 * indentation, spacing, keep and page-break options, tab stops, outline level
 * and borders or shading. The paragraph mark's own run formatting and any
 * `w:sectPr` are left out.
 */
function paragraphPropertySignature(pPr: Element | undefined): string {
  if (!pPr) return '';
  const parts: string[] = [];
  const style = child(pPr, 'pStyle');
  if (style) parts.push(`style=${attr(style, 'val')}`);
  const alignment = alignmentOf(pPr);
  if (alignment) parts.push(`jc=${alignment}`);
  const numPr = child(pPr, 'numPr');
  if (numPr) parts.push(`num=${attr(child(numPr, 'numId')!, 'val') ?? ''}/${child(numPr, 'ilvl') ? attr(child(numPr, 'ilvl')!, 'val') : '0'}`);
  for (const name of ['ind', 'spacing', 'tabs', 'pBdr', 'shd', 'outlineLvl', 'framePr', 'textDirection']) {
    const element = child(pPr, name);
    if (!element) continue;
    const nested = name === 'tabs' || name === 'pBdr'
      ? elementChildren(element).map((tab) => `${tab.localName}(${attributeSignature(tab)})`).join(' ')
      : attributeSignature(element);
    parts.push(`${name}(${nested})`);
  }
  for (const name of ['keepNext', 'keepLines', 'pageBreakBefore', 'widowControl', 'contextualSpacing', 'suppressAutoHyphens', 'bidi']) {
    const element = child(pPr, name);
    if (element) parts.push(`${name}=${on(element)}`);
  }
  return parts.join(';');
}

/** Read one paragraph: its read-back text, the formatting of each character and its properties. */
function readParagraph(paragraph: Element, inTableCell: boolean): PullParagraph {
  const formats: string[] = [];
  const crossReferences: PullParagraph['crossReferences'] = [];
  const footnoteReferences: number[] = [];
  const text = paragraphReadbackText(
    paragraph,
    (offset) => footnoteReferences.push(offset),
    (offset, result) => crossReferences.push({ offset, text: result }),
    undefined,
    undefined,
    (start, end, run) => {
      const signature = runFormatSignature(run);
      for (let index = start; index < end; index += 1) formats[index] = signature;
    },
  );
  const fields: string[] = [];
  for (const field of Array.from(paragraph.getElementsByTagNameNS(W, 'instrText'))) {
    const name = (field.textContent ?? '').trim().split(/\s+/u)[0] ?? '';
    if (name && name !== 'REF') fields.push(name);
  }
  for (const field of Array.from(paragraph.getElementsByTagNameNS(W, 'fldSimple'))) {
    const name = (attr(field, 'instr') ?? '').trim().split(/\s+/u)[0] ?? '';
    if (name && name !== 'REF') fields.push(name);
  }
  const pPr = child(paragraph, 'pPr');
  const style = child(pPr, 'pStyle');
  const alignment = alignmentOf(pPr);
  return {
    text,
    inTableCell,
    formats: Array.from({ length: text.length }, (_, index) => formats[index] ?? ''),
    properties: paragraphPropertySignature(pPr),
    ...(style && attr(style, 'val') ? { style: attr(style, 'val')! } : {}),
    ...(alignment ? { alignment } : {}),
    numbered: child(pPr, 'numPr') !== undefined,
    label: '',
    crossReferences,
    footnoteReferences,
    fields,
  };
}

/**
 * Block content in reading order: paragraphs, table cells row by row (as
 * `create`'s read-back takes them), and the paragraphs inside block-level
 * content controls and custom XML, which Word writes around page-number
 * footers and which `create` never writes.
 */
function readBlocks(container: Element, out: PullParagraph[], inTableCell = false, elements: Element[] = [], tables: string[] = []): PullParagraph[] {
  for (const node of elementChildren(container)) {
    if (isW(node, 'p')) {
      out.push(readParagraph(node, inTableCell));
      elements.push(node);
    }
    else if (isW(node, 'tbl')) {
      if (!inTableCell) tables.push(tableSignature(node));
      for (const row of elementChildren(node)) {
        const wrapped = row.namespaceURI === W && (row.localName === 'sdt' || row.localName === 'customXml');
        const rows: Element[] = isW(row, 'tr') ? [row] : wrapped ? Array.from((row as Element).getElementsByTagNameNS(W, 'tr')) : [];
        for (const tr of rows) {
          for (const cell of elementChildren(tr).filter((candidate) => isW(candidate, 'tc'))) readBlocks(cell, out, true, elements, tables);
        }
      }
    } else if (isW(node, 'sdt')) {
      const content = child(node, 'sdtContent');
      if (content) readBlocks(content, out, inTableCell, elements, tables);
    } else if (isW(node, 'customXml')) {
      readBlocks(node, out, inTableCell, elements, tables);
    }
  }
  return out;
}

/** Counts of each named element under `root`, kept when non-zero. */
/** A table's structure: its grid and, per row, each cell's span and merge, nested tables included. */
function tableSignature(table: Element): string {
  const grid = child(table, 'tblGrid');
  const columns = grid ? elementChildren(grid).filter((node) => isW(node, 'gridCol')).length : 0;
  const rows: string[] = [];
  const rowsOf = (container: Element): Element[] => elementChildren(container).flatMap((node: Element): Element[] => {
    if (node.namespaceURI !== W) return [];
    if (node.localName === 'tr') return [node];
    return node.localName === 'sdt' || node.localName === 'customXml' ? Array.from(node.getElementsByTagNameNS(W, 'tr')) : [];
  });
  for (const row of rowsOf(table)) {
    const cells = elementChildren(row).filter((node) => isW(node, 'tc')).map((cell) => {
      const tcPr = child(cell, 'tcPr');
      const span = child(tcPr, 'gridSpan');
      const vMerge = child(tcPr, 'vMerge');
      const hMerge = child(tcPr, 'hMerge');
      const nested = elementChildren(cell).filter((node) => isW(node, 'tbl')).map(tableSignature);
      return `${span ? attr(span, 'val') : '1'}${vMerge ? `v${attr(vMerge, 'val') ?? 'continue'}` : ''}${hMerge ? `h${attr(hMerge, 'val') ?? 'continue'}` : ''}${nested.length ? `[${nested.join(',')}]` : ''}`;
    });
    const header = child(child(row, 'trPr'), 'tblHeader');
    rows.push(`${header && on(header) ? 'H' : ''}${cells.join(' ')}`);
  }
  return `${columns}:${rows.join('/')}`;
}

type NumberingLevel = { start: number; format: string; text: string; restart?: number; legal: boolean; shape: string };

/** The levels of each `w:num`, with its overrides applied, and the abstract definition it counts with. */
function readNumbering(xml: string | null): Map<string, { abstract: string; levels: Map<number, NumberingLevel>; starts: Map<number, number> }> {
  const out = new Map<string, { abstract: string; levels: Map<number, NumberingLevel>; starts: Map<number, number> }>();
  if (xml === null) return out;
  const root = parseXml(xml).documentElement!;
  const level = (lvl: Element): NumberingLevel => {
    const value = (name: string) => { const element = child(lvl, name); return element ? attr(element, 'val') : null; };
    const restart = value('lvlRestart');
    const pPr = child(lvl, 'pPr');
    const ind = child(pPr, 'ind');
    return {
      start: Number(value('start') ?? '0'),
      format: value('numFmt') ?? 'decimal',
      text: value('lvlText') ?? '',
      ...(restart !== null ? { restart: Number(restart) } : {}),
      legal: on(child(lvl, 'isLgl')),
      shape: `${value('lvlJc') ?? ''}|${value('suff') ?? 'tab'}|${ind ? attributeSignature(ind) : ''}`,
    };
  };
  const abstracts = new Map<string, Map<number, NumberingLevel>>();
  for (const abstract of elementChildren(root).filter((node) => isW(node, 'abstractNum'))) {
    const levels = new Map<number, NumberingLevel>();
    for (const lvl of elementChildren(abstract).filter((node) => isW(node, 'lvl'))) levels.set(Number(attr(lvl, 'ilvl') ?? '0'), level(lvl));
    abstracts.set(attr(abstract, 'abstractNumId') ?? '', levels);
  }
  for (const num of elementChildren(root).filter((node) => isW(node, 'num'))) {
    const abstractRef = child(num, 'abstractNumId');
    const abstract = abstractRef ? attr(abstractRef, 'val') ?? '' : '';
    const levels = new Map(abstracts.get(abstract) ?? []);
    const starts = new Map<number, number>();
    for (const override of elementChildren(num).filter((node) => isW(node, 'lvlOverride'))) {
      const ilvl = Number(attr(override, 'ilvl') ?? '0');
      const replaced = child(override, 'lvl');
      if (replaced) levels.set(ilvl, level(replaced));
      const startOverride = child(override, 'startOverride');
      if (startOverride) starts.set(ilvl, Number(attr(startOverride, 'val') ?? '0'));
    }
    out.set(attr(num, 'numId') ?? '', { abstract, levels, starts });
  }
  return out;
}

function formatNumber(value: number, format: string): string {
  const letters = (n: number) => { let out = ''; for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) out = String.fromCharCode(97 + ((k - 1) % 26)) + out; return out; };
  const roman = (n: number) => {
    const table: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let out = '';
    let rest = n;
    for (const [size, glyph] of table) while (rest >= size) { out += glyph; rest -= size; }
    return out;
  };
  switch (format) {
    case 'decimal': return String(value);
    case 'decimalZero': return value < 10 ? `0${value}` : String(value);
    case 'lowerLetter': return letters(value);
    case 'upperLetter': return letters(value).toUpperCase();
    case 'lowerRoman': return roman(value);
    case 'upperRoman': return roman(value).toUpperCase();
    case 'bullet': case 'none': return '';
    default: return `${format}:${value}`;
  }
}

/**
 * Each numbered paragraph's label, counting as Word does: one counter set per
 * abstract definition, a `w:startOverride` restarting it where its `w:num` is
 * first used, and a level restarting after a higher one. A model, not Word
 * itself, but it reads every input that shapes a label, so two documents
 * with the same labels have the same numbering inputs where they show.
 */
function labelParagraphs(paragraphs: readonly Element[], read: PullParagraph[], numbering: ReturnType<typeof readNumbering>): void {
  const counters = new Map<string, number[]>();
  const started = new Set<string>();
  for (const [index, paragraph] of paragraphs.entries()) {
    const numPr = child(child(paragraph, 'pPr'), 'numPr');
    if (!numPr) continue;
    const numId = child(numPr, 'numId') ? attr(child(numPr, 'numId')!, 'val') ?? '' : '';
    const ilvl = Number(child(numPr, 'ilvl') ? attr(child(numPr, 'ilvl')!, 'val') ?? '0' : '0');
    const num = numbering.get(numId);
    if (numId === '0' || !num) {
      read[index]!.label = numId === '0' ? '' : `?num${numId}`;
      continue;
    }
    const levels = num.levels;
    const counter = counters.get(num.abstract) ?? Array.from({ length: 9 }, (_, k) => (levels.get(k)?.start ?? 1) - 1);
    counters.set(num.abstract, counter);
    if (!started.has(numId)) {
      started.add(numId);
      for (const [k, start] of num.starts) counter[k] = start - 1;
    }
    counter[ilvl] = (counter[ilvl] ?? 0) + 1;
    // A deeper level restarts after any higher one by default; w:lvlRestart N restarts it only after levels 1..N, 0 never.
    for (let deeper = ilvl + 1; deeper < counter.length; deeper += 1) {
      const restart = levels.get(deeper)?.restart;
      if (restart === undefined || (restart > 0 && ilvl < restart)) counter[deeper] = (num.starts.get(deeper) ?? levels.get(deeper)?.start ?? 1) - 1;
    }
    const level = levels.get(ilvl);
    if (!level) {
      read[index]!.label = `?lvl${ilvl}`;
      continue;
    }
    const text = level.text.replace(/%([1-9])/gu, (_, n: string) => formatNumber(counter[Number(n) - 1] ?? 0, level.legal ? 'decimal' : levels.get(Number(n) - 1)?.format ?? 'decimal'));
    read[index]!.label = `${level.format === 'bullet' ? `bullet(${level.text})` : text}|${level.shape}`;
  }
}

function countElements(roots: readonly Element[], names: readonly string[], into: Record<string, number>): void {
  for (const root of roots) {
    for (const name of names) {
      const count = root.getElementsByTagNameNS(W, name).length;
      if (count > 0) into[name] = (into[name] ?? 0) + count;
    }
  }
}

/** The page setup of a section: size, orientation, margins, columns, vertical alignment, page numbering and line numbers. */
function pageSetupSignature(sectPr: Element): string {
  const parts: string[] = [];
  const size = child(sectPr, 'pgSz');
  parts.push(`size(${attributeSignature(size).replace(/\s*code=\S+/u, '')})`);
  parts.push(`margins(${attributeSignature(child(sectPr, 'pgMar'))})`);
  const cols = child(sectPr, 'cols');
  parts.push(`columns=${cols ? attr(cols, 'num') ?? '1' : '1'}`);
  const vAlign = child(sectPr, 'vAlign');
  parts.push(`vAlign=${vAlign ? attr(vAlign, 'val') ?? 'top' : 'top'}`);
  const numbering = child(sectPr, 'pgNumType');
  if (numbering && attributeSignature(numbering)) parts.push(`pageNumbers(${attributeSignature(numbering)})`);
  if (child(sectPr, 'lnNumType')) parts.push('lineNumbers');
  const type = child(sectPr, 'type');
  parts.push(`break=${type ? attr(type, 'val') ?? 'nextPage' : 'nextPage'}`);
  for (const name of ['bidi', 'rtlGutter', 'textDirection', 'pgBorders']) if (child(sectPr, name)) parts.push(name);
  return parts.join(';');
}

/** The run and paragraph properties of one style or the document defaults, as compared. */
function styleSignature(rPr: Element | undefined, pPr: Element | undefined, basedOn?: string | null): string {
  // runFormatSignature reads a run's rPr; wrap the style's rPr the same way.
  const runParts = rPr ? runFormatSignature(wrapRunProperties(rPr)) : '';
  return [`basedOn=${basedOn ?? ''}`, `run(${runParts})`, `paragraph(${paragraphPropertySignature(pPr)})`].join(';');
}

/** A detached run holding `rPr`, so a style's run properties read like a run's. */
function wrapRunProperties(rPr: Element): Element {
  const run = rPr.ownerDocument!.createElementNS(W, 'w:r');
  run.appendChild(rPr.cloneNode(true));
  return run;
}

/** The creation styles and the document defaults, as signatures, and every paragraph style's alignment. */
function readStyles(xml: string | null): { styles: Record<string, string>; styleAlignments: Record<string, string | undefined> } {
  if (!xml) return { styles: {}, styleAlignments: {} };
  const document = parseXml(xml);
  const out: Record<string, string> = {};
  const own = new Map<string, { alignment?: string; basedOn?: string }>();
  for (const style of Array.from(document.getElementsByTagNameNS(W, 'style'))) {
    if (attr(style, 'type') !== 'paragraph') continue;
    const basedOn = child(style, 'basedOn');
    const alignment = alignmentOf(child(style, 'pPr'));
    own.set(attr(style, 'styleId') ?? '', { ...(alignment ? { alignment } : {}), ...(basedOn && attr(basedOn, 'val') ? { basedOn: attr(basedOn, 'val')! } : {}) });
  }
  const styleAlignments: Record<string, string | undefined> = {};
  for (const id of own.keys()) {
    let at: string | undefined = id;
    const visited = new Set<string>();
    while (at !== undefined && !visited.has(at)) {
      visited.add(at);
      const entry = own.get(at);
      if (entry?.alignment) {
        styleAlignments[id] = entry.alignment;
        break;
      }
      at = entry?.basedOn;
    }
  }
  const defaults = document.getElementsByTagNameNS(W, 'docDefaults').item(0) ?? undefined;
  if (defaults) {
    out['(document defaults)'] = styleSignature(
      child(child(defaults, 'rPrDefault'), 'rPr'),
      child(child(defaults, 'pPrDefault'), 'pPr'),
    );
  }
  const wanted = new Set<string>(Object.values(CREATION_STYLE));
  for (const style of Array.from(document.getElementsByTagNameNS(W, 'style'))) {
    const id = attr(style, 'styleId') ?? '';
    if (!wanted.has(id)) continue;
    const basedOn = child(style, 'basedOn');
    out[id] = styleSignature(child(style, 'rPr'), child(style, 'pPr'), basedOn ? attr(basedOn, 'val') : null);
  }
  return { styles: out, styleAlignments };
}

/**
 * Read a DOCX the way `pull` compares it with the build it came from: body
 * paragraphs with their formatting, each section's headers, footers and
 * first-page slots, page setup, footnotes, styles, and the content `create`
 * cannot express (tracked changes, comments, drawings and the like).
 */
export async function readPullDocx(buffer: Buffer): Promise<PullDocx> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    throw new DocxMarkdocError('PULL_UNREADABLE_DOCX', `The DOCX cannot be opened: ${error instanceof Error ? error.message : String(error)}.`);
  }
  const readOptional = async (part: string): Promise<string | null> => (zip.file(part) ? zip.file(part)!.async('string') : null);
  const read = async (part: string): Promise<string> => {
    const xml = await readOptional(part);
    if (xml === null) throw new DocxMarkdocError('PULL_UNREADABLE_DOCX', `The DOCX has no ${part}.`);
    return xml;
  };
  const document = parseXml(await read('word/document.xml'));
  const body = document.getElementsByTagNameNS(W, 'body').item(0);
  if (!body) throw new DocxMarkdocError('PULL_UNREADABLE_DOCX', 'The DOCX has no w:body.');
  const bodyElements: Element[] = [];
  const tables: string[] = [];
  const paragraphs = readBlocks(body, [], false, bodyElements, tables);
  const numberingXml = await readOptional('word/numbering.xml');
  labelParagraphs(bodyElements, paragraphs, readNumbering(numberingXml));

  const relsXml = await readOptional('word/_rels/document.xml.rels');
  const targets = new Map(relsXml === null ? [] : Array.from(parseXml(relsXml).getElementsByTagName('Relationship'))
    .map((rel) => [rel.getAttribute('Id') ?? '', rel.getAttribute('Target') ?? '']));
  const partPath = (target: string) => `word/${target.replace(/^\//u, '').replace(/^word\//u, '')}`;
  const storyRoots: Element[] = [];
  const storyCache = new Map<string, PullParagraph[]>();
  const story = async (sectPr: Element, kind: 'header' | 'footer', type: 'default' | 'first'): Promise<PullStory> => {
    const reference = elementChildren(sectPr).find((node) => isW(node, `${kind}Reference`) && attr(node, 'type') === type);
    if (!reference) return null;
    const target = targets.get(reference.getAttributeNS(R, 'id') || reference.getAttribute('r:id') || '');
    if (!target) throw new DocxMarkdocError('PULL_UNREADABLE_DOCX', `A ${kind} reference does not resolve.`);
    const cached = storyCache.get(target);
    if (cached) return cached;
    const root = parseXml(await read(partPath(target))).documentElement!;
    storyRoots.push(root);
    const lines = readBlocks(root, []);
    storyCache.set(target, lines);
    return lines;
  };
  const headers: PullStory[] = [];
  const footers: PullStory[] = [];
  const firstPage: PullDocx['firstPage'] = [];
  const pageSetup: string[] = [];
  let evenPageStories = 0;
  for (const sectPr of Array.from(document.getElementsByTagNameNS(W, 'sectPr'))) {
    // A sectPr inside w:sectPrChange is a tracked change, refused separately.
    if (sectPr.parentNode && isW(sectPr.parentNode, 'sectPrChange')) continue;
    evenPageStories += elementChildren(sectPr).filter((node) => (isW(node, 'headerReference') || isW(node, 'footerReference')) && attr(node, 'type') === 'even').length;
    headers.push(await story(sectPr, 'header', 'default'));
    footers.push(await story(sectPr, 'footer', 'default'));
    firstPage.push(on(child(sectPr, 'titlePg')) ? { header: await story(sectPr, 'header', 'first'), footer: await story(sectPr, 'footer', 'first') } : null);
    pageSetup.push(pageSetupSignature(sectPr));
  }

  const footnotesXml = await readOptional('word/footnotes.xml');
  const notes = new Map<string, Element>();
  if (footnotesXml) {
    const root = parseXml(footnotesXml).documentElement!;
    storyRoots.push(root);
    for (const note of Array.from(root.getElementsByTagNameNS(W, 'footnote'))) notes.set(attr(note, 'id') ?? '', note);
  }
  const footnotes = Array.from(body.getElementsByTagNameNS(W, 'footnoteReference')).map((reference) => {
    const note = notes.get(attr(reference, 'id') ?? '');
    return note ? readBlocks(note, []).map((paragraph) => paragraph.text) : [];
  });

  // Tracked changes are refused wherever they are: every header, footer and note part the document relates,
  // read or not (an even-page header is not), and the numbering definitions.
  const scanned = new Set<string>();
  const trackedRoots: Element[] = [body];
  const relatedParts = relsXml === null ? [] : Array.from(parseXml(relsXml).getElementsByTagName('Relationship'))
    .filter((rel) => /\/(header|footer|footnotes|endnotes|comments|numbering)$/u.test(rel.getAttribute('Type') ?? '') && rel.getAttribute('TargetMode') !== 'External')
    .map((rel) => partPath(rel.getAttribute('Target') ?? ''));
  for (const part of relatedParts) {
    if (scanned.has(part)) continue;
    scanned.add(part);
    const xml = await readOptional(part);
    if (xml !== null) trackedRoots.push(parseXml(xml).documentElement!);
  }
  const trackedChanges: Record<string, number> = {};
  countElements(trackedRoots, TRACKED_CHANGE_ELEMENTS, trackedChanges);
  const settingsXml = await readOptional('word/settings.xml');
  const evenAndOddHeaders = settingsXml !== null && on(child(parseXml(settingsXml).documentElement!, 'evenAndOddHeaders'));
  const unsupported: Record<string, number> = {};
  // A content control in a header or footer is how Word wraps an inserted page number: its text is read, and the
  // wrapper carries nothing create expresses, so only the body's count.
  countElements([body], UNSUPPORTED_ELEMENTS, unsupported);
  countElements(storyRoots, UNSUPPORTED_ELEMENTS.filter((name) => name !== 'sdt' && name !== 'customXml'), unsupported);
  const commentsXml = await readOptional('word/comments.xml');
  const comments = body.getElementsByTagNameNS(W, 'commentRangeStart').length
    + body.getElementsByTagNameNS(W, 'commentReference').length
    + (commentsXml ? parseXml(commentsXml).getElementsByTagNameNS(W, 'comment').length : 0);

  return {
    paragraphs,
    headers,
    footers,
    firstPage,
    pageSetup,
    trackedChanges,
    comments,
    unsupported,
    footnotes,
    ...readStyles(await readOptional('word/styles.xml')),
    tables,
    evenPageStories,
    evenAndOddHeaders,
  };
}
