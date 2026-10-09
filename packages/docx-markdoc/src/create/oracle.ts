import Markdoc, { type Node as MarkdocNode } from '@markdoc/markdoc';
import { parseCreationFrontmatter } from './validate.js';

/**
 * Independent round-trip oracle for `docx-markdoc create` (#1185).
 *
 * The expected text comes ONLY from the original Markdoc source, read here
 * with its own small walker. It never touches the lowering, the markdocx
 * engine, the creation theme or the DocumentSpec, so a lowering that drops a
 * word, paragraph, table cell or footer cannot also drop it from the
 * expectation. The actual text comes from re-importing the created DOCX
 * through `docx-markdoc import`.
 *
 * The oracle encodes only the documented layout contract of the grammar:
 * - a signer is a 30-underscore signature line, a line break, the name, then
 *   a tab and the date;
 * - a `{% fill %}` renders its text inside brackets;
 * - list numbers are generated and are not part of the paragraph text; an
 *   ordered list numbers `1.`, then `(a)`, then `(i)` by depth (top-level
 *   lists start at their first marker, nested lists at 1), and bullets are
 *   `•`, `◦`, `▪`;
 * - a table's first row is its header and repeats on continuation pages;
 * - a footer page number is a PAGE field, and pages number continuously from 1.
 */

/** The only normalization applied before comparing; anything wider could hide an omission. */
export const ORACLE_NORMALIZATION =
  'Unicode NFC; every run of whitespace (space, tab, line break, no-break space) becomes one space; leading and trailing whitespace is trimmed. Nothing else: no case folding, no punctuation removal, no deduplication. Empty paragraphs are dropped on both sides.';

export function normalizeOracleText(text: string): string {
  return text.normalize('NFC').replace(/[\s ]+/gu, ' ').trim();
}

/** Contract constant, duplicated on purpose: a renderer change to the signature line must show up here. */
const SIGNATURE_LINE = '_'.repeat(30);
/** Marker for a footer PAGE field in the expected projection; any decimal page number satisfies it. */
export const PAGE_NUMBER_FIELD = '\u0000PAGE';

export type SourceBodyEntry = {
  text: string;
  /** 1-based source line. */
  line?: number;
  cell?: true;
  /** Section index (0-based); a `{% section %}` tag starts the next one. */
  section?: number;
  /** The generated list label shown before this paragraph (`1.`, `(a)`, `(i)`, `•`, …). */
  marker?: string;
  /** Table membership: which table (0-based, in order) and which row (0 = the repeating header row). */
  table?: { id: number; row: number };
};

export type SourceProjection = {
  /** Body paragraphs in reading order, with the source line they came from; table cells are marked. */
  body: SourceBodyEntry[];
  /** Per section: the declared footer paragraphs, or null when the section declares none (it then inherits). */
  footers: Array<string[] | null>;
};

const BULLETS = ['•', '◦', '▪'] as const;

function letters(n: number): string {
  // Word's lowerLetter: a…z, then aa…zz, then aaa…
  const letter = String.fromCharCode(97 + ((n - 1) % 26));
  return letter.repeat(Math.floor((n - 1) / 26) + 1);
}

function roman(n: number): string {
  const table: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [value, symbol] of table) {
    while (n >= value) { out += symbol; n -= value; }
  }
  return out;
}

/** The label the grammar's numbering definition produces for item `n` at `depth`. */
export function listMarker(ordered: boolean, depth: number, n: number): string {
  if (!ordered) return BULLETS[Math.min(depth, 2)]!;
  if (depth === 0) return `${n}.`;
  return depth === 1 ? `(${letters(n)})` : `(${roman(n)})`;
}

function lineOf(node: MarkdocNode): number | undefined {
  const start = node.lines?.[0];
  return start === undefined ? undefined : start + 1;
}

function inlineText(node: MarkdocNode): string {
  switch (node.type) {
    case 'text': return String(node.attributes.content ?? '');
    case 'softbreak': return ' ';
    case 'hardbreak': return '\n';
    case 'tag':
      if (node.tag === 'fill') return `[${node.children.map(inlineText).join('')}]`;
      return node.children.map(inlineText).join('');
    default: return node.children.map(inlineText).join('');
  }
}

/** The one tag a paragraph stands for when that tag is its only content. */
function soleTag(paragraph: MarkdocNode): MarkdocNode | undefined {
  if (paragraph.type !== 'paragraph') return undefined;
  const inline = paragraph.children.length === 1 && paragraph.children[0]!.type === 'inline' ? paragraph.children[0]! : undefined;
  const meaningful = inline?.children.filter((child) => !(child.type === 'text' && !String(child.attributes.content ?? '').trim())) ?? [];
  const only = meaningful.length === 1 ? meaningful[0]! : undefined;
  return only?.type === 'tag' && only.tag !== 'fill' && only.tag !== 'literal' ? only : undefined;
}

function paragraphsOfTag(node: MarkdocNode): MarkdocNode[] {
  const paragraphs = node.children.filter((child) => child.type === 'paragraph');
  return paragraphs.length > 0 ? paragraphs : [node];
}

/** Read the expected plain text straight from the Markdoc source. */
export function projectSourceText(source: string): SourceProjection {
  const ast = Markdoc.parse(source);
  const frontmatter = parseCreationFrontmatter(ast.attributes.frontmatter as string | undefined);
  const footerOf = (text: unknown, pageNumbers: unknown): string[] =>
    [...(typeof text === 'string' && text ? [text] : []), ...(pageNumbers === true ? [PAGE_NUMBER_FIELD] : [])];
  const body: SourceProjection['body'] = [];
  const footers: SourceProjection['footers'] = [
    frontmatter.footer || frontmatter.pageNumbers ? footerOf(frontmatter.footer, frontmatter.pageNumbers) : null,
  ];
  let section = 0;
  let tables = 0;
  const push = (text: string, node: MarkdocNode, extra: Partial<SourceBodyEntry> = {}) =>
    body.push({ text, ...(lineOf(node) === undefined ? {} : { line: lineOf(node)! }), section, ...extra });
  const listItems = (list: MarkdocNode, depth: number) => {
    const ordered = list.attributes.ordered === true;
    let n = depth === 0 && ordered && Number.isInteger(list.attributes.start) ? Number(list.attributes.start) : 1;
    for (const item of list.children) {
      for (const child of item.children) {
        if (child.type === 'list') listItems(child, depth + 1);
        else push(inlineText(child), item, { marker: listMarker(ordered, depth, n) });
      }
      n += 1;
    }
  };
  const tag = (node: MarkdocNode) => {
    switch (node.tag) {
      case 'center':
      case 'legend':
        for (const paragraph of paragraphsOfTag(node)) push(paragraph === node ? node.children.map(inlineText).join('') : inlineText(paragraph), paragraph);
        return;
      case 'signer': {
        const name = node.attributes.name !== undefined ? String(node.attributes.name) : paragraphsOfTag(node).map((paragraph) => (paragraph === node ? node.children.map(inlineText).join('') : inlineText(paragraph))).join('');
        const date = node.attributes.date === undefined ? '' : `\t${String(node.attributes.date)}`;
        push(`${SIGNATURE_LINE}\n${name}${date}`, node);
        return;
      }
      case 'table': {
        const grid = node.children.find((child) => child.type === 'table');
        const id = tables++;
        let row = 0;
        for (const group of grid?.children ?? []) {
          for (const tr of group.children) {
            for (const cell of tr.children) push(inlineText(cell), cell, { cell: true, table: { id, row } });
            row += 1;
          }
        }
        return;
      }
      case 'section': {
        const { footer } = node.attributes;
        const pageNumbers = node.attributes['page-numbers'];
        footers.push(footer !== undefined || pageNumbers !== undefined ? footerOf(footer, pageNumbers) : null);
        section += 1;
        return;
      }
      default:
        return; // page-break: layout only
    }
  };
  for (const node of ast.children) {
    const sole = node.type === 'paragraph' ? soleTag(node) : undefined;
    if (sole) tag(sole);
    else if (node.type === 'tag') tag(node);
    else if (node.type === 'list') listItems(node, 0);
    else if (node.type === 'blockquote') for (const child of node.children) push(inlineText(child), child);
    else push(inlineText(node), node);
  }
  return { body, footers };
}

// ---------------------------------------------------------------- diffing

type Op<A, B> = { kind: 'equal' | 'delete' | 'insert'; a?: A; b?: B; ai?: number; bi?: number };

/**
 * Myers O(ND) diff. `delete` = only in `a` (expected), `insert` = only in `b`
 * (actual). Returns null when the sequences need more than `maxEdits` edits; callers
 * then fail rather than guess. Memory is O(D × (N+M)) for D edits, so the
 * budget is bounded.
 */
export function myersDiff<A, B>(a: readonly A[], b: readonly B[], equal: (x: A, y: B) => boolean, maxEdits = 2000): Op<A, B>[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && equal(a[x]!, b[y]!)) { x += 1; y += 1; }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        const ops: Op<A, B>[] = [];
        let cx = n;
        let cy = m;
        for (let dd = d; dd > 0; dd -= 1) {
          const pv = trace[dd]!;
          const kk = cx - cy;
          const prevK = kk === -dd || (kk !== dd && pv[offset + kk - 1]! < pv[offset + kk + 1]!) ? kk + 1 : kk - 1;
          const prevX = pv[offset + prevK]!;
          const prevY = prevX - prevK;
          while (cx > prevX && cy > prevY) { cx -= 1; cy -= 1; ops.push({ kind: 'equal', a: a[cx], b: b[cy], ai: cx, bi: cy }); }
          if (cx === prevX) { cy -= 1; ops.push({ kind: 'insert', b: b[cy], bi: cy }); } else { cx -= 1; ops.push({ kind: 'delete', a: a[cx], ai: cx }); }
        }
        while (cx > 0 && cy > 0) { cx -= 1; cy -= 1; ops.push({ kind: 'equal', a: a[cx], b: b[cy], ai: cx, bi: cy }); }
        return ops.reverse();
      }
    }
  }
  return null;
}

export type WordSpan = { words: string; before: string; after: string };

const CONTEXT_WORDS = 4;

/** Group word indices into consecutive spans, each with a few words of context. */
function groupSpans(indices: readonly number[], words: readonly string[]): WordSpan[] {
  const spans: WordSpan[] = [];
  let run: number[] = [];
  const flush = () => {
    if (!run.length) return;
    const first = run[0]!;
    const last = run.at(-1)!;
    spans.push({ words: run.map((i) => words[i]).join(' '), before: words.slice(Math.max(0, first - CONTEXT_WORDS), first).join(' '), after: words.slice(last + 1, last + 1 + CONTEXT_WORDS).join(' ') });
    run = [];
  };
  for (const index of indices) {
    if (run.length && index !== run.at(-1)! + 1) flush();
    run.push(index);
  }
  flush();
  return spans;
}

/** Word-level spans of `expected` missing from `actual`, and of `actual` not in `expected`. */
export function wordSpans(expected: string, actual: string): { missing: WordSpan[]; extra: WordSpan[] } {
  const a = expected ? expected.split(' ') : [];
  const b = actual ? actual.split(' ') : [];
  const ops = myersDiff(a, b, (x, y) => x === y);
  if (!ops) return { missing: groupSpans(a.map((_, i) => i), a), extra: groupSpans(b.map((_, i) => i), b) };
  return {
    missing: groupSpans(ops.filter((op) => op.kind === 'delete').map((op) => op.ai!), a),
    extra: groupSpans(ops.filter((op) => op.kind === 'insert').map((op) => op.bi!), b),
  };
}

export type ParagraphMismatch = {
  kind: 'missing' | 'extra' | 'changed';
  expected?: string;
  actual?: string;
  expectedIndex?: number;
  actualIndex?: number;
  line?: number;
  missingWords?: WordSpan[];
  extraWords?: WordSpan[];
};

export type SequenceComparison = { passed: boolean; expected: number; actual: number; mismatches: ParagraphMismatch[]; knownGenerated: string[] };

/**
 * Compare paragraph sequences. Exact (normalized) paragraphs align first;
 * unaligned paragraphs left between two aligned ones pair up as `changed`
 * (with word spans), and any leftovers are `missing` or `extra`.
 */
export function compareParagraphs(expected: Array<{ text: string; line?: number }>, actual: string[]): SequenceComparison {
  const knownGenerated: string[] = [];
  const exp = expected.map((entry) => ({ ...entry, text: entry.text === PAGE_NUMBER_FIELD ? entry.text : normalizeOracleText(entry.text) })).filter((entry) => entry.text);
  const act = actual.map(normalizeOracleText).filter(Boolean);
  const matches = (e: { text: string }, a: string) => e.text === a || (e.text === PAGE_NUMBER_FIELD && /^\d+$/u.test(a));
  const ops = myersDiff(exp, act, matches) ?? null;
  const mismatches: ParagraphMismatch[] = [];
  if (!ops) {
    mismatches.push({ kind: 'changed', expected: `${exp.length} paragraphs`, actual: `${act.length} paragraphs (too different to align)` });
    return { passed: false, expected: exp.length, actual: act.length, mismatches, knownGenerated };
  }
  let pendingDeletes: Array<{ e: (typeof exp)[number]; i: number }> = [];
  let pendingInserts: Array<{ a: string; i: number }> = [];
  const flush = () => {
    const pairs = Math.min(pendingDeletes.length, pendingInserts.length);
    for (let p = 0; p < pairs; p += 1) {
      const { e, i } = pendingDeletes[p]!;
      const { a, i: j } = pendingInserts[p]!;
      const { missing, extra } = wordSpans(e.text === PAGE_NUMBER_FIELD ? '' : e.text, a);
      mismatches.push({ kind: 'changed', expected: e.text, actual: a, expectedIndex: i, actualIndex: j, ...(e.line === undefined ? {} : { line: e.line }), missingWords: missing, extraWords: extra });
    }
    for (const { e, i } of pendingDeletes.slice(pairs)) mismatches.push({ kind: 'missing', expected: e.text, expectedIndex: i, ...(e.line === undefined ? {} : { line: e.line }) });
    for (const { a, i } of pendingInserts.slice(pairs)) mismatches.push({ kind: 'extra', actual: a, actualIndex: i });
    pendingDeletes = [];
    pendingInserts = [];
  };
  for (const op of ops) {
    if (op.kind === 'equal') {
      flush();
      if (op.a!.text === PAGE_NUMBER_FIELD) knownGenerated.push(`page number field rendered as "${op.b}"`);
    } else if (op.kind === 'delete') pendingDeletes.push({ e: op.a!, i: op.ai! });
    else pendingInserts.push({ a: op.b!, i: op.bi! });
  }
  flush();
  return { passed: mismatches.length === 0, expected: exp.length, actual: act.length, mismatches, knownGenerated };
}

// ------------------------------------------------------------ PDF words

export type PdfWordComparison = {
  passed: boolean;
  normalization: string;
  /** `over-budget` when the texts were too different to align; every source word is then reported missing. */
  alignment: 'complete' | 'over-budget';
  /** Source words plus the list labels the grammar generates. */
  expectedWords: number;
  /** PDF words left after removing each page's footer region and repeated table headers. */
  pdfWords: number;
  missing: WordSpan[];
  unexplainedExtra: WordSpan[];
  /**
   * Pages whose footer region (text and page number) is not the one their section declares. When the page
   * could belong to more than one section, `expected` lists every possible region and `reason` says why.
   */
  footerMismatches: Array<{ page: number; section: number | null; expected: string; found: string; reason?: string }>;
  /** Header-shaped text at a page head that is neither a repetition of a continuing table nor that table's own header row. */
  unverifiedTableHeaders: Array<{ page: number; words: string; reason: string }>;
  knownGenerated: {
    /** The footer region removed from the head of each page, as found. */
    footerRegions: string[];
    listMarkers: number;
    repeatedTableHeaders: Array<{ page: number; table: number }>;
    /** Table rows found split across pages (cell fragments page by page) and read back in cell order. */
    splitRows: Array<{ table: number; row: number; pages: number[] }>;
  };
  limitations: string;
};

export const PDF_WORD_NORMALIZATION = 'Unicode NFKC (folds ligatures such as "fi"), then whitespace runs split words. Nothing else.';
export const PDF_WORD_LIMITATIONS =
  'The text layer is read with pdftotext -raw (content-stream order; LibreOffice writes each page\'s footer first, then the body in document order, except that a table row split across pages comes out as each cell\'s fragment on each page; such a row is read back in cell order only when its words partition exactly into those fragments, every cell starting on the first page, and the pages after the first stay pinned to that row and its section). ' +
  'List labels are expected words. Every page break is explained from the source: the checker searches for where each page can start between the source words around it (including inside wordless content such as empty table rows), and a start fixes what the page must show first, namely its section\'s footer and page number, the table header LibreOffice repeats when a table continues across the break, and the source words at the top of the page. Sections start on new pages. ' +
  'Two observed LibreOffice behaviours are assumed: a header row is never left alone at a page bottom (it stays with the first body row), and a table\'s last row can spill its empty remainder onto the next page, repeating the header there. ' +
  'The check passes only when every start that fits explains the same source words; if none fits, or starts that fit disagree (for example, a table with empty trailing rows followed by a table with the same header, or two such tables back to back at a page start), it fails. The text alone cannot always show layout, so such cases fail even when the PDF is right (a false failure); an ambiguity is never settled by a guess.';

type ExpectedToken = { word: string; entry: number };

/**
 * Word-level alignment of the source text against the PDF text layer, with
 * every piece of generated text modelled from the source: list labels, each
 * page's footer region, and repeated table header rows.
 */
export function comparePdfWords(source: SourceProjection, pageTexts: readonly string[]): PdfWordComparison {
  const words = (text: string) => text.normalize('NFKC').split(/[\s\u00a0]+/u).filter(Boolean);
  const expected: ExpectedToken[] = [];
  let listMarkers = 0;
  source.body.forEach((entry, index) => {
    if (entry.marker) {
      expected.push({ word: entry.marker.normalize('NFKC'), entry: index });
      listMarkers += 1;
    }
    for (const word of words(entry.text)) expected.push({ word, entry: index });
  });

  // Effective footer per section: a section that declares none inherits the previous one.
  const effective: Array<{ text: string[]; pageNumbers: boolean }> = [];
  source.footers.forEach((declared, section) => {
    const own = declared === null ? undefined : { text: declared.filter((line) => line !== PAGE_NUMBER_FIELD).flatMap(words), pageNumbers: declared.includes(PAGE_NUMBER_FIELD) };
    effective.push(own ?? effective[section - 1] ?? { text: [], pageNumbers: false });
  });
  const regionFor = (section: number, page: number): string[] => {
    const footer = effective[Math.min(section, effective.length - 1)] ?? { text: [], pageNumbers: false };
    return [...footer.text, ...(footer.pageNumbers ? [String(page + 1)] : [])];
  };
  const headers = new Map<number, string[]>();
  source.body.forEach((entry) => {
    if (entry.table?.row === 0) headers.set(entry.table.id, [...(headers.get(entry.table.id) ?? []), ...words(entry.text)]);
  });

  const pages = pageTexts.map(words);
  // Footer region at each page head: the longest candidate region that matches; checked by the break model.
  const candidates = (page: number) => [...new Set(effective.map((_, section) => regionFor(section, page).join('\u0001')))].map((key) => (key ? key.split('\u0001') : []))
    .sort((a, b) => b.length - a.length);
  const startsWith = (tokens: readonly string[], seq: readonly string[], at = 0) => seq.length > 0 && at + seq.length <= tokens.length && seq.every((word, offset) => tokens[at + offset] === word);
  const regions = pages.map((tokens, page) => candidates(page).find((region) => region.length === 0 || startsWith(tokens, region)) ?? []);
  // Head run: every table-header copy at the top of a later page (longest header first). These words are set
  // aside and must be explained by the page-break model, as a repeated header or as source words.
  const headerSeqs = [...new Set([...headers.values()].map((seq) => seq.join('\u0001')))].map((key) => key.split('\u0001')).sort((a, b) => b.length - a.length);
  const headRuns = pages.map((tokens, page) => {
    if (page === 0) return [] as string[];
    let at = regions[page]!.length;
    for (let seq = headerSeqs.find((h) => startsWith(tokens, h, at)); seq; seq = headerSeqs.find((h) => startsWith(tokens, h, at))) at += seq.length;
    return tokens.slice(regions[page]!.length, at);
  });

  const bodies = pages.map((tokens, page) => tokens.slice(regions[page]!.length + headRuns[page]!.length));
  const split = joinSplitRows(source, words, bodies);
  const pdf: Array<{ word: string; page: number }> = [];
  bodies.forEach((tokens, page) => {
    for (const word of tokens) pdf.push({ word, page });
  });
  const ops = myersDiff(expected, pdf, (x, y) => x.word === y.word);

  const missing = new Set<number>();
  const extraIdx: number[] = [];
  const footerMismatches: PdfWordComparison['footerMismatches'] = [];
  const unverifiedTableHeaders: PdfWordComparison['unverifiedTableHeaders'] = [];
  const repeatedTableHeaders: PdfWordComparison['knownGenerated']['repeatedTableHeaders'] = [];
  if (ops) {
    const firstOnPage: Array<number | undefined> = pages.map(() => undefined);
    const lastOnPage: Array<number | undefined> = pages.map(() => undefined);
    const aligned: Array<{ index: number; page: number }> = [];
    for (const op of ops) {
      if (op.kind === 'delete') missing.add(op.ai!);
      else if (op.kind === 'insert') extraIdx.push(op.bi!);
      else {
        const page = pdf[op.bi!]!.page;
        firstOnPage[page] ??= op.ai!;
        lastOnPage[page] = op.ai!;
        aligned.push({ index: op.ai!, page });
      }
    }
    // Pages that hold the continuation of a split row belong to that row: its section, and its place in the source.
    const pinned = new Map<number, SplitRow>();
    for (const row of split.rows) for (const page of row.pages.slice(1)) pinned.set(page, row);
    if (split.exhausted) unverifiedTableHeaders.push({ page: 0, words: '', reason: 'table rows split across pages have too many possible readings to check' });
    const model = explainPageBreaks({
      source, expected, headers, pages: pages.length, firstOnPage, lastOnPage, aligned, headRuns, pinned,
      found: (page) => regions[page]!.join(' '),
      region: (section, page) => regionFor(section, page).join(' '),
      sectionCount: effective.length,
    });
    for (const index of model.explained) missing.delete(index);
    footerMismatches.push(...model.footerMismatches);
    unverifiedTableHeaders.push(...model.unverified);
    repeatedTableHeaders.push(...model.repeated);
  } else {
    expected.forEach((_, i) => missing.add(i));
  }
  const missingSpans = groupSpans([...missing].sort((a, b) => a - b), expected.map((token) => token.word));
  const unexplainedExtra = groupSpans(extraIdx, pdf.map((token) => token.word));
  return {
    passed: ops !== null && missingSpans.length === 0 && unexplainedExtra.length === 0 && footerMismatches.length === 0 && unverifiedTableHeaders.length === 0,
    normalization: PDF_WORD_NORMALIZATION,
    alignment: ops ? 'complete' : 'over-budget',
    expectedWords: expected.length,
    pdfWords: pdf.length,
    missing: missingSpans,
    unexplainedExtra,
    footerMismatches,
    unverifiedTableHeaders,
    knownGenerated: {
      footerRegions: regions.map((region) => region.join(' ')),
      listMarkers,
      repeatedTableHeaders,
      splitRows: split.rows.map(({ table, row, pages: spanned }) => ({ table, row, pages: spanned.map((page) => page + 1) })),
    },
    limitations: PDF_WORD_LIMITATIONS,
  };
}

/** A table row found split over `pages` (0-based, first to last). */
type SplitRow = { table: number; row: number; section: number; pages: number[] };

/**
 * A table row that breaks across pages comes out of `pdftotext -raw` page by page: on each page, a fragment
 * of every cell in cell order (left part, right part; then the rest of each on the next page). Find rows
 * whose words fill the end of one page and the start of the next (and any whole pages between) exactly in
 * that shape, and put those words back in cell order on the first page. Words are only reordered, never
 * added or removed, and only when every word of the row is accounted for exactly once; a row with a lost or
 * extra word has no such split and is left for the alignment to report.
 */
function joinSplitRows(source: SourceProjection, words: (text: string) => string[], bodies: string[][]): { rows: SplitRow[]; exhausted: boolean } {
  const rows = new Map<string, { table: number; row: number; section: number; cells: string[][] }>();
  for (const entry of source.body) {
    if (!entry.table) continue;
    const key = `${entry.table.id}:${entry.table.row}`;
    const row = rows.get(key) ?? { table: entry.table.id, row: entry.table.row, section: entry.section ?? 0, cells: [] };
    row.cells.push(words(entry.text));
    rows.set(key, row);
  }
  const candidates = [...rows.values()].filter((row) => row.cells.filter((cell) => cell.length > 0).length >= 2);
  const counts = (tokens: readonly string[]) => {
    const map = new Map<string, number>();
    for (const token of tokens) map.set(token, (map.get(token) ?? 0) + 1);
    return map;
  };
  const sameWords = (a: Map<string, number>, parts: readonly string[][]) => {
    const b = counts(parts.flat());
    return a.size === b.size && [...a].every(([word, count]) => b.get(word) === count);
  };
  const found: SplitRow[] = [];
  // One work budget for every attempt; running out is reported, so it can only fail, never pass.
  let budget = 2_000_000;
  /** Can `parts` be read as fragments of `cells`, every part listing one fragment per cell in cell order? */
  const partition = (cells: string[][], parts: string[][]): boolean => {
    const offsets = cells.map(() => 0);
    const failed = new Set<string>();
    const visit = (part: number, cell: number, pos: number): boolean => {
      if (budget <= 0) return false;
      budget -= 1;
      if (part === parts.length) return offsets.every((offset, index) => offset === cells[index]!.length);
      if (cell === cells.length) return pos === parts[part]!.length && visit(part + 1, 0, 0);
      const key = `${part}|${cell}|${offsets.join(',')}`;
      if (failed.has(key)) return false;
      const cellWords = cells[cell]!;
      const start = offsets[cell]!;
      // The row starts on the first page in every cell, so on that page each later cell with words keeps at least one.
      const reserve = part === 0 ? cells.slice(cell + 1).filter((later) => later.length > 0).length : 0;
      // On the last page every cell ends, so this cell's fragment is exactly what is left of it.
      const room = parts[part]!.length - pos - reserve;
      let max = 0;
      while (start + max < cellWords.length && max < room && parts[part]![pos + max] === cellWords[start + max]) max += 1;
      const least = part === parts.length - 1 ? cellWords.length - start : part === 0 && cellWords.length > 0 ? 1 : 0;
      for (let length = max; length >= least; length -= 1) {
        offsets[cell] = start + length;
        if (visit(part, cell + 1, pos + length)) return true;
      }
      offsets[cell] = start;
      failed.add(key);
      return false;
    };
    return visit(0, 0, 0);
  };
  for (let page = 0; page + 1 < bodies.length; page += 1) {
    for (const row of candidates) {
      const first = row.cells.find((cell) => cell.length > 0)![0]!;
      const rowCounts = counts(row.cells.flat());
      const total = row.cells.reduce((sum, cell) => sum + cell.length, 0);
      let joined = false;
      // The row may continue over whole pages before it ends on page `last`.
      for (let last = page + 1; last < bodies.length && !joined; last += 1) {
        const middle = bodies.slice(page + 1, last);
        const middleLength = middle.reduce((sum, body) => sum + body.length, 0);
        if (middleLength >= total) break;
        for (let tail = 1; tail < total - middleLength && !joined; tail += 1) {
          const head = total - middleLength - tail;
          if (tail > bodies[page]!.length || head > bodies[last]!.length) continue;
          // The first cell with words starts the row on the first page.
          if (bodies[page]![bodies[page]!.length - tail] !== first) continue;
          const parts = [bodies[page]!.slice(-tail), ...middle, bodies[last]!.slice(0, head)];
          // Cheap necessary condition first: exactly the row's words. Only then search for the fragment layout.
          if (!sameWords(rowCounts, parts) || !partition(row.cells, parts)) continue;
          bodies[page] = [...bodies[page]!.slice(0, -tail), ...row.cells.flat()];
          for (let middlePage = page + 1; middlePage < last; middlePage += 1) bodies[middlePage] = [];
          bodies[last] = bodies[last]!.slice(head);
          found.push({ table: row.table, row: row.row, section: row.section, pages: Array.from({ length: last - page + 1 }, (_, index) => page + index) });
          joined = true;
        }
      }
    }
  }
  return { rows: found, exhausted: budget <= 0 };
}

type BreakModelInput = {
  source: SourceProjection;
  expected: readonly ExpectedToken[];
  headers: ReadonlyMap<number, string[]>;
  pages: number;
  firstOnPage: ReadonlyArray<number | undefined>;
  lastOnPage: ReadonlyArray<number | undefined>;
  aligned: ReadonlyArray<{ index: number; page: number }>;
  headRuns: ReadonlyArray<readonly string[]>;
  /** Pages holding the continuation of a split table row. */
  pinned: ReadonlyMap<number, SplitRow>;
  found: (page: number) => string;
  region: (section: number, page: number) => string;
  sectionCount: number;
};

type BreakModelResult = {
  explained: Set<number>;
  footerMismatches: PdfWordComparison['footerMismatches'];
  unverified: PdfWordComparison['unverifiedTableHeaders'];
  repeated: PdfWordComparison['knownGenerated']['repeatedTableHeaders'];
};

/**
 * Explain every page break from the source alone. Between two consecutive aligned source words, the pages
 * that start there must each start at some point in the source between them (possibly inside wordless
 * content such as empty table rows). A placement fixes everything the page head must show: the footer of
 * the section starting there, the header LibreOffice repeats when a table continues across the break, and
 * the source words at the top of the page (missing from the alignment because the head run was set aside).
 * Sections start on a new page, so every section change must be a break. The check accepts only when every
 * consistent placement explains the same source words; anything else fails, and an ambiguity is never
 * settled by a guess.
 */
function explainPageBreaks(input: BreakModelInput): BreakModelResult {
  const { source, expected, headers, pages, firstOnPage, lastOnPage, aligned, headRuns, pinned, found, region } = input;
  const result: BreakModelResult = { explained: new Set(), footerMismatches: [], unverified: [], repeated: [] };
  const sectionOf = (entry: number) => source.body[entry]?.section ?? 0;
  const tokensOf = new Map<number, number[]>();
  expected.forEach((token, index) => tokensOf.set(token.entry, [...(tokensOf.get(token.entry) ?? []), index]));

  // Text of two sections on one page, between consecutive aligned words with no page break between them.
  for (let k = 1; k < aligned.length; k += 1) {
    const [a, b] = [aligned[k - 1]!, aligned[k]!];
    if (a.page === b.page && sectionOf(expected[a.index]!.entry) !== sectionOf(expected[b.index]!.entry)) {
      result.footerMismatches.push({ page: b.page + 1, section: null, expected: '', found: found(b.page), reason: `page holds text from sections ${sectionOf(expected[a.index]!.entry)} and ${sectionOf(expected[b.index]!.entry)}` });
    }
  }
  // A page continuing a split row belongs to that row's section: any other text aligned on it is another
  // section's, which must have started on a page of its own.
  for (const { index, page } of aligned) {
    const pin = pinned.get(page);
    if (pin && sectionOf(expected[index]!.entry) !== pin.section) {
      result.footerMismatches.push({ page: page + 1, section: pin.section, expected: '', found: found(page), reason: `page continues a table row of section ${pin.section} but also holds text from section ${sectionOf(expected[index]!.entry)}` });
      break;
    }
  }
  const lastEntrySection = source.body.length > 0 ? sectionOf(source.body.length - 1) : 0;
  if (pages === 0) {
    if (input.sectionCount > 0) result.footerMismatches.push({ page: 0, section: null, expected: '', found: '', reason: 'the PDF has no pages' });
    return result;
  }
  if (lastEntrySection < input.sectionCount - 1) {
    result.footerMismatches.push({ page: pages, section: null, expected: '', found: found(pages - 1), reason: `section ${lastEntrySection + 1} has no content to place on a page` });
  }

  // Group the pages by the aligned words around their start: the last aligned word before, the first at or after.
  type Group = { before: number; after: number; pages: number[] };
  const groups: Group[] = [];
  for (let page = 0; page < pages; page += 1) {
    let before = -1;
    for (let p = 0; p < page; p += 1) before = Math.max(before, lastOnPage[p] ?? -1);
    let after = expected.length;
    for (let p = pages - 1; p >= page; p -= 1) after = firstOnPage[p] ?? after;
    const last = groups.at(-1);
    if (last && last.before === before && last.after === after) last.pages.push(page);
    else groups.push({ before, after, pages: [page] });
  }
  // The source after the last aligned word, past the last page start, is on the last page: no section change there.
  const tail = aligned.at(-1);
  if (tail && groups.at(-1)!.after !== expected.length) {
    const fromEntry = expected[tail.index]!.entry;
    if (sectionOf(fromEntry) !== lastEntrySection) {
      result.footerMismatches.push({ page: pages, section: null, expected: '', found: found(pages - 1), reason: `section ${lastEntrySection} has no page of its own` });
    }
  }

  for (const group of groups) explainGroup(group);
  return result;

  function explainGroup(group: Group) {
    const firstEntry = group.before >= 0 ? expected[group.before]!.entry : -1;
    const lastEntry = group.after < expected.length ? expected[group.after]!.entry : source.body.length;
    // Items between the two aligned words: unaligned source words, and wordless entries (empty cells).
    type Item = { entry: number; token?: number };
    const items: Item[] = [];
    for (let entry = Math.max(firstEntry, 0); entry <= Math.min(lastEntry, source.body.length - 1); entry += 1) {
      const tokens = tokensOf.get(entry) ?? [];
      if (tokens.length === 0) {
        if (entry > firstEntry && entry < lastEntry) items.push({ entry });
      } else {
        for (const token of tokens) if (token > group.before && token < group.after) items.push({ entry, token });
      }
    }
    const beforeEntry = (pos: number) => (pos === 0 ? (firstEntry >= 0 ? firstEntry : undefined) : items[pos - 1]!.entry);
    const afterEntry = (pos: number) => (pos === items.length ? (lastEntry < source.body.length ? lastEntry : undefined) : items[pos]!.entry);
    /**
     * Which repeated header a break at `pos` shows. Between rows of one table, its header always repeats.
     * Right after a table's body cell with nothing of that table following, either no header (a clean break
     * after the table) or the header (LibreOffice spills the empty remainder of that last row, as it does
     * when the row ends exactly at the page bottom). `undefined` means no header.
     */
    const headersAt = (pos: number): Array<{ table?: number; spill: boolean }> => {
      const [b, a] = [beforeEntry(pos), afterEntry(pos)];
      const [tb, ta] = [b === undefined ? undefined : source.body[b]!.table, a === undefined ? undefined : source.body[a]!.table];
      // LibreOffice keeps a table's header row with its first body row (observed: a table that starts near the
      // page bottom moves whole), so no page breaks between the header row and the first body row.
      if (tb && ta && tb.id === ta.id && tb.row === 0 && ta.row === 1) return [];
      if (tb && ta && tb.id === ta.id && ta.row > 0) return [{ table: ta.id, spill: false }];
      if (tb && tb.row > 0) return [{ spill: false }, { table: tb.id, spill: true }];
      return [{ spill: false }];
    };
    const sectionAt = (pos: number) => {
      const a = afterEntry(pos) ?? beforeEntry(pos);
      return a === undefined ? 0 : sectionOf(a);
    };
    const changeAt = (pos: number) => {
      const [b, a] = [beforeEntry(pos), afterEntry(pos)];
      return b !== undefined && a !== undefined && sectionOf(b) !== sectionOf(a);
    };
    const changes = Array.from({ length: items.length + 1 }, (_, pos) => pos).filter(changeAt);
    const tokenItemsFrom = (pos: number) => items.map((item, index) => ({ item, index })).filter(({ item, index }) => index >= pos && item.token !== undefined);

    /** A spill page holds the rest of the row before `pos`, so it belongs to that row's section and starts no new one. */
    type Placement = { pos: number; explained: number[]; end: number; table?: number; section: number; spill: boolean; pinned?: true };
    // How page `page` can start at `pos` with repeated header `table`: its head run is that header, then source words.
    const place = (page: number, pos: number, table: number | undefined, spill: boolean): Placement | undefined => {
      if (page === 0 && table !== undefined) return undefined;
      const generated = table === undefined ? [] : headers.get(table) ?? [];
      const head = headRuns[page]!;
      if (generated.some((word, offset) => head[offset] !== word) || head.length < generated.length) return undefined;
      const rest = head.slice(generated.length);
      const next = tokenItemsFrom(pos).slice(0, rest.length);
      if (next.length < rest.length || next.some(({ item }, offset) => expected[item.token!]!.word !== rest[offset])) return undefined;
      const end = next.length > 0 ? next.at(-1)!.index + 1 : pos;
      const section = spill ? sectionOf(beforeEntry(pos)!) : sectionAt(pos);
      return { pos, explained: next.map(({ item }) => item.token!), end, ...(table === undefined ? {} : { table }), section, spill };
    };

    const signature = (solution: Placement[]) => solution.flatMap((placement) => placement.explained).sort((a, b) => a - b).join(',');
    let solutions: Placement[][] = [];
    let signatures = new Set<string>();
    // The search stops once two placements disagree (that is already a failure) or after a fixed budget of
    // steps; running out of budget counts as ambiguous, so it can only fail, never pass.
    let budget = 200_000;
    // Every page holds something: source content between its start and the next page's (wordless rows count),
    // a spilled row remainder, or, for the last page, the aligned text after the group. No empty page can be
    // invented to move a section start (and with it a footer) onto a page that belongs to the section before.
    const hasContent = (placement: Placement, next: number | undefined) =>
      placement.spill || placement.pinned === true || (next === undefined ? placement.pos < items.length || group.after < expected.length : placement.pos < next);
    const search = (k: number, from: number, chosen: Placement[], footers: boolean) => {
      if (signatures.size > 1 || budget <= 0) return;
      budget -= 1;
      if (k === group.pages.length) {
        if (chosen.length > 0 && !hasContent(chosen.at(-1)!, undefined)) return;
        // Every section change must be a page start, and none may lie after the last start.
        if (changes.every((pos) => chosen.some((placement) => placement.pos === pos && !placement.spill && !placement.pinned))) {
          solutions.push([...chosen]);
          signatures.add(signature(chosen));
        }
        return;
      }
      const page = group.pages[k]!;
      // A page cannot start past a section change it skips; page 0 starts at the very beginning.
      const firstChange = changes.find((pos) => pos >= from && !chosen.some((placement) => placement.pos === pos && !placement.spill && !placement.pinned));
      const hi = page === 0 && group.before < 0 ? 0 : Math.min(firstChange ?? items.length, items.length);
      const seen = new Set<string>();
      const pin = pinned.get(page);
      for (let pos = from; pos <= hi; pos += 1) {
        // A page continuing a split row starts inside that row (its words were read back onto the row's first
        // page), shows the repeated header unless the split row is the header itself, and has the row's section.
        const before = beforeEntry(pos);
        const inRow = pin && before !== undefined && source.body[before]!.table?.id === pin.table && source.body[before]!.table?.row === pin.row;
        if (pin && !inRow) continue;
        const options = pin ? [{ table: pin.row === 0 ? undefined : pin.table, spill: false }] : headersAt(pos);
        for (const { table, spill } of options) {
          const placed = place(page, pos, table, spill);
          const placement = placed && pin ? { ...placed, section: pin.section, pinned: true as const } : placed;
          if (!placement) continue;
          if (footers && region(placement.section, page) !== found(page)) continue;
          // Equivalent starts (same repeated header, same explained words, same section) lead to the same outcomes.
          if (chosen.length > 0 && !hasContent(chosen.at(-1)!, pos)) continue;
          const key = `${placement.table}|${placement.spill}|${placement.pinned}|${placement.explained.join(',')}|${placement.section}|${changes.includes(pos)}|${pos === from}`;
          if (seen.has(key)) continue;
          seen.add(key);
          search(k + 1, Math.max(pos, placement.end), [...chosen, placement], footers);
        }
      }
    };
    search(0, 0, [], true);
    if (budget <= 0) {
      for (const page of group.pages) result.unverified.push({ page: page + 1, words: headRuns[page]!.join(' '), reason: 'the page breaks here have too many possible placements to check' });
      return;
    }
    if (solutions.length > 0) {
      if (signatures.size === 1) {
        for (const placement of solutions[0]!) {
          for (const index of placement.explained) result.explained.add(index);
        }
        solutions[0]!.forEach((placement, k) => {
          if (placement.table !== undefined) result.repeated.push({ page: group.pages[k]! + 1, table: placement.table });
        });
      } else {
        for (const page of group.pages) {
          if (headRuns[page]!.length > 0) result.unverified.push({ page: page + 1, words: headRuns[page]!.join(' '), reason: 'the text fits more than one page break, and they disagree about which source words are present' });
        }
      }
      return;
    }
    // No placement fits. Report a footer problem if one exists without footers, otherwise the head of the pages.
    solutions = [];
    signatures = new Set();
    budget = 200_000;
    search(0, 0, [], false);
    if (budget <= 0) {
      for (const page of group.pages) result.unverified.push({ page: page + 1, words: headRuns[page]!.join(' '), reason: 'the page breaks here have too many possible placements to check' });
      return;
    }
    if (solutions.length > 0) {
      const relaxed = solutions[0]!;
      relaxed.forEach((placement, k) => {
        const page = group.pages[k]!;
        const want = region(placement.section, page);
        if (want !== found(page)) result.footerMismatches.push({ page: page + 1, section: placement.section, expected: want, found: found(page) });
      });
      if (signatures.size === 1) for (const placement of relaxed) for (const index of placement.explained) result.explained.add(index);
      return;
    }
    const skipped = changes.length - group.pages.length;
    if (skipped > 0) {
      result.footerMismatches.push({ page: group.pages[0]! + 1, section: null, expected: '', found: found(group.pages[0]!), reason: `${skipped} section(s) have no page` });
      return;
    }
    for (const page of group.pages) {
      result.unverified.push({ page: page + 1, words: headRuns[page]!.join(' '), reason: 'no page break fits: a repeated table header or the source words at the top of the page are missing or out of place' });
    }
  }
}
