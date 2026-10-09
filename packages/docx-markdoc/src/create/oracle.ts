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
  unverifiedTableHeaders: Array<{ page: number; words: string }>;
  knownGenerated: {
    /** The footer region removed from the head of each page, as found. */
    footerRegions: string[];
    listMarkers: number;
    repeatedTableHeaders: Array<{ page: number; table: number }>;
  };
  limitations: string;
};

export const PDF_WORD_NORMALIZATION = 'Unicode NFKC (folds ligatures such as "fi"), then whitespace runs split words. Nothing else.';
export const PDF_WORD_LIMITATIONS =
  'The text layer is read with pdftotext -raw (content-stream order; LibreOffice writes each page\'s footer first, then the body in document order). ' +
  'Generated text is modelled, not guessed: the expected words include each list label the grammar generates; each page must begin with exactly its section\'s footer region (footer text, then the page number, counting pages from 1), checked against the section of the content aligned on that page; and a table\'s header row is accepted again only at the top of a page whose surrounding content belongs to that same table. ' +
  'A page with no aligned body text takes every section a consistent page order allows (sections run in order, each starting a new page); its footer must be the region of every one of them. Header-shaped text at a page head that is neither a validated repetition nor its table\'s own header row is reported as unverified. ' +
  'Every other missing or extra word fails. Ambiguity (a wordless page that could belong to differently footered sections, or body text at a page head equal to another section\'s footer region) causes a false failure, never a false pass.';

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
  // Footer region at each page head: the longest candidate region that matches; validated after alignment.
  const candidates = (page: number) => [...new Set(effective.map((_, section) => regionFor(section, page).join('\u0001')))].map((key) => (key ? key.split('\u0001') : []))
    .sort((a, b) => b.length - a.length);
  const startsWith = (tokens: readonly string[], seq: readonly string[], at = 0) => seq.length > 0 && at + seq.length <= tokens.length && seq.every((word, offset) => tokens[at + offset] === word);
  const regions = pages.map((tokens, page) => candidates(page).find((region) => region.length === 0 || startsWith(tokens, region)) ?? []);

  // Repeated header candidates: right after the footer region on a later page.
  // Every table whose header row matches right after the footer region. Headers of different lengths (one a
  // prefix of another) are separate options, tried longest first; identical headers share an option.
  type HeaderOption = { tables: number[]; length: number };
  type HeaderCandidate = { page: number; options: HeaderOption[] };
  const headerCandidates: HeaderCandidate[] = [];
  pages.forEach((tokens, page) => {
    if (page === 0) return;
    const byLength = new Map<number, number[]>();
    for (const [table, header] of headers) {
      if (startsWith(tokens, header, regions[page]!.length)) byLength.set(header.length, [...(byLength.get(header.length) ?? []), table]);
    }
    if (byLength.size > 0) headerCandidates.push({ page, options: [...byLength].sort((a, b) => b[0] - a[0]).map(([length, tables]) => ({ length, tables })) });
  });

  /** The option each candidate currently removes; a candidate with none left is aligned as ordinary text. */
  const chosen = new Map<HeaderCandidate, number>(headerCandidates.map((candidate) => [candidate, 0]));
  const optionOf = (candidate: HeaderCandidate) => candidate.options[chosen.get(candidate) ?? candidate.options.length];
  const run = () => {
    const pdf: Array<{ word: string; page: number }> = [];
    /** Where each candidate sits in `pdf`: the insertion point if removed, or its first token if kept. */
    const at = new Map<HeaderCandidate, number>();
    pages.forEach((tokens, page) => {
      let from = regions[page]!.length;
      const candidate = headerCandidates.find((entry) => entry.page === page);
      if (candidate) at.set(candidate, pdf.length);
      const option = candidate ? optionOf(candidate) : undefined;
      if (option) from += option.length;
      for (const word of tokens.slice(from)) pdf.push({ word, page });
    });
    const ops = myersDiff(expected, pdf, (x, y) => x.word === y.word);
    const pdfToExpected = new Map<number, number>();
    for (const op of ops ?? []) if (op.kind === 'equal') pdfToExpected.set(op.bi!, op.ai!);
    const entryAt = (pdfIndex: number) => {
      const expectedIndex = pdfToExpected.get(pdfIndex);
      return expectedIndex === undefined ? undefined : source.body[expected[expectedIndex]!.entry];
    };
    return { pdf, at, ops, entryAt };
  };

  // A repeated header is genuine only where a table continues across the page: the content aligned on
  // both sides of it must be body rows of one table whose header it matches. A removed option that fails
  // moves to the candidate's next (shorter) option, or to none, and the texts are aligned again; options
  // only advance, so this ends.
  const repeatedTableHeaders: PdfWordComparison['knownGenerated']['repeatedTableHeaders'] = [];
  let result = run();
  for (;;) {
    if (!result.ops) break;
    const { at, entryAt } = result;
    const continuing = (candidate: HeaderCandidate) => optionOf(candidate)?.tables.find((table) => {
      const isBody = (entry: SourceBodyEntry | undefined) => entry?.table?.id === table && entry.table.row > 0;
      return isBody(entryAt(at.get(candidate)! - 1)) && isBody(entryAt(at.get(candidate)!));
    });
    const invalid = headerCandidates.filter((candidate) => optionOf(candidate) && continuing(candidate) === undefined);
    if (invalid.length === 0) {
      for (const candidate of headerCandidates) {
        if (optionOf(candidate)) repeatedTableHeaders.push({ page: candidate.page + 1, table: continuing(candidate)! });
      }
      break;
    }
    for (const candidate of invalid) chosen.set(candidate, chosen.get(candidate)! + 1);
    result = run();
  }

  const { pdf, ops, at, entryAt } = result;
  const missingIdx: number[] = [];
  const extraIdx: number[] = [];
  const footerMismatches: PdfWordComparison['footerMismatches'] = [];
  const unverifiedTableHeaders: PdfWordComparison['unverifiedTableHeaders'] = [];
  if (ops) {
    for (const op of ops) {
      if (op.kind === 'delete') missingIdx.push(op.ai!);
      else if (op.kind === 'insert') extraIdx.push(op.bi!);
    }
    // A header-shaped run at a page head that is not a repetition must be the original header row of one of
    // its tables (a table starting on that page). Otherwise it may be generated text standing in for lost
    // source words, so it cannot be certified either way.
    for (const candidate of headerCandidates) {
      if (optionOf(candidate)) continue;
      const start = at.get(candidate)!;
      const original = candidate.options.some((option) => Array.from({ length: option.length }, (_, offset) => entryAt(start + offset))
        .every((entry) => entry?.table !== undefined && entry.table.row === 0 && option.tables.includes(entry.table.id)));
      if (!original) unverifiedTableHeaders.push({ page: candidate.page + 1, words: pdf.slice(start, start + candidate.options[0]!.length).map((token) => token.word).join(' ') });
    }
    footerMismatches.push(...checkPageFooters(pages.length, effective.length, pdf, entryAt, (page) => regions[page]!.join(' '), (section, page) => regionFor(section, page).join(' ')));
  } else {
    expected.forEach((_, i) => missingIdx.push(i));
  }
  const missing = groupSpans(missingIdx, expected.map((token) => token.word));
  const unexplainedExtra = groupSpans(extraIdx, pdf.map((token) => token.word));
  return {
    passed: ops !== null && missing.length === 0 && unexplainedExtra.length === 0 && footerMismatches.length === 0 && unverifiedTableHeaders.length === 0,
    normalization: PDF_WORD_NORMALIZATION,
    alignment: ops ? 'complete' : 'over-budget',
    expectedWords: expected.length,
    pdfWords: pdf.length,
    missing,
    unexplainedExtra,
    footerMismatches,
    unverifiedTableHeaders,
    knownGenerated: {
      footerRegions: regions.map((region) => region.join(' ')),
      listMarkers,
      repeatedTableHeaders,
    },
    limitations: PDF_WORD_LIMITATIONS,
  };
}

/**
 * Check each page's footer region against its section. Sections start on a new page and run in order, so
 * page sections are non-decreasing and every section has at least one page. A page with aligned body text
 * takes that text's section (all of it must be one section). A page without any takes every section a
 * consistent assignment allows; its footer must then be the region of every one of them, so a guess is
 * never certified.
 */
function checkPageFooters(
  pageCount: number,
  sectionCount: number,
  pdf: ReadonlyArray<{ page: number }>,
  entryAt: (pdfIndex: number) => SourceBodyEntry | undefined,
  found: (page: number) => string,
  region: (section: number, page: number) => string,
): PdfWordComparison['footerMismatches'] {
  const mismatches: PdfWordComparison['footerMismatches'] = [];
  if (pageCount === 0 && sectionCount > 0) return [{ page: 0, section: null, expected: '', found: '', reason: 'the PDF has no pages' }];
  const sectionsOn = Array.from({ length: pageCount }, () => new Set<number>());
  pdf.forEach((token, index) => {
    const entry = entryAt(index);
    if (entry) sectionsOn[token.page]!.add(entry.section ?? 0);
  });
  const fixed: Array<number | undefined> = sectionsOn.map((set) => (set.size === 1 ? [...set][0] : undefined));
  sectionsOn.forEach((set, page) => {
    if (set.size > 1) mismatches.push({ page: page + 1, section: null, expected: '', found: found(page), reason: `page holds text from sections ${[...set].join(', ')}` });
  });
  // Unaligned pages between two fixed pages (or the document ends) take any section a consistent assignment allows.
  let page = 0;
  let previous = -1; // section of the last fixed page; -1 before the first
  while (page < pageCount) {
    if (fixed[page] !== undefined) {
      const section = fixed[page]!;
      if (section < previous) mismatches.push({ page: page + 1, section, expected: region(section, page), found: found(page), reason: 'sections out of order' });
      else if (section > previous + 1 && (page === 0 || fixed[page - 1] !== undefined)) {
        mismatches.push({ page: page + 1, section, expected: region(section, page), found: found(page), reason: `no page for section ${previous + 1}` });
      }
      if (region(section, page) !== found(page)) mismatches.push({ page: page + 1, section, expected: region(section, page), found: found(page) });
      previous = Math.max(previous, section);
      page += 1;
      continue;
    }
    let end = page;
    while (end < pageCount && fixed[end] === undefined) end += 1;
    // Sections strictly between `previous` and `after` must each get a gap page; past the end, `after` is virtual.
    const after = end < pageCount ? fixed[end]! : sectionCount;
    const gap = end - page;
    const low = Math.max(previous, 0);
    const high = Math.min(after, sectionCount - 1);
    const mustCover = after - previous - 1;
    if (mustCover > gap) {
      mismatches.push({ page: page + 1, section: null, expected: '', found: found(page), reason: `${mustCover - gap} section(s) have no page` });
    }
    for (let i = 1; i <= gap; i += 1) {
      const p = page + i - 1;
      const possible: number[] = [];
      for (let s = low; s <= high; s += 1) {
        const coverBefore = s > previous ? s - previous - 1 : 0; // sections strictly between previous and s
        const coverAfter = s < after ? after - s - 1 : 0; // sections strictly between s and after
        if (coverBefore <= i - 1 && coverAfter <= gap - i) possible.push(s);
      }
      if (possible.length === 0) continue; // already reported: too few pages for the sections
      const regions = [...new Set(possible.map((s) => region(s, p)))];
      if (regions.length !== 1 || regions[0] !== found(p)) {
        mismatches.push({
          page: p + 1,
          section: possible.length === 1 ? possible[0]! : null,
          expected: regions.join(' | '),
          found: found(p),
          ...(possible.length === 1 ? {} : { reason: `page has no aligned text and could belong to section ${possible.join(' or ')}` }),
        });
      }
    }
    previous = Math.max(previous, high);
    page = end;
  }
  if (pageCount > 0 && fixed[pageCount - 1] !== undefined && previous < sectionCount - 1) {
    mismatches.push({ page: pageCount, section: previous, expected: '', found: found(pageCount - 1), reason: `no page for section ${previous + 1}` });
  }
  return mismatches;
}
