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
  /** Pages whose footer region (text and page number) is not the one their section declares. */
  footerMismatches: Array<{ page: number; section: number; expected: string; found: string }>;
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
  'Every other missing or extra word fails. A page with no aligned body text is assumed to belong to the previous page\'s section, and a page whose body begins with words equal to another section\'s footer region can be misread; both cause false failures, never false passes.';

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
  type HeaderCandidate = { page: number; table: number; length: number };
  const headerCandidates: HeaderCandidate[] = [];
  pages.forEach((tokens, page) => {
    if (page === 0) return;
    for (const [table, header] of headers) {
      if (startsWith(tokens, header, regions[page]!.length)) {
        headerCandidates.push({ page, table, length: header.length });
        return;
      }
    }
  });

  const run = (accepted: readonly HeaderCandidate[]) => {
    const pdf: Array<{ word: string; page: number }> = [];
    const insertAt = new Map<HeaderCandidate, number>();
    pages.forEach((tokens, page) => {
      let from = regions[page]!.length;
      const header = accepted.find((candidate) => candidate.page === page);
      if (header) {
        insertAt.set(header, pdf.length);
        from += header.length;
      }
      for (const word of tokens.slice(from)) pdf.push({ word, page });
    });
    const ops = myersDiff(expected, pdf, (x, y) => x.word === y.word);
    return { pdf, insertAt, ops };
  };

  let accepted = headerCandidates;
  let result = run(accepted);
  // A repeated header is genuine only where the table continues across the page: the content aligned on
  // both sides of it must be body rows of that same table. Drop any that are not and align again.
  for (;;) {
    if (!result.ops) break;
    const pdfToExpected = new Map<number, number>();
    for (const op of result.ops) if (op.kind === 'equal') pdfToExpected.set(op.bi!, op.ai!);
    const inTableBody = (pdfIndex: number | undefined, table: number) => {
      const expectedIndex = pdfIndex === undefined ? undefined : pdfToExpected.get(pdfIndex);
      const entry = expectedIndex === undefined ? undefined : source.body[expected[expectedIndex]!.entry];
      return entry?.table?.id === table && entry.table.row > 0;
    };
    const invalid = accepted.filter((candidate) => {
      const at = result.insertAt.get(candidate)!;
      return !(inTableBody(at - 1, candidate.table) && inTableBody(at, candidate.table));
    });
    if (invalid.length === 0) break;
    accepted = accepted.filter((candidate) => !invalid.includes(candidate));
    result = run(accepted);
  }

  const { pdf, ops } = result;
  const missingIdx: number[] = [];
  const extraIdx: number[] = [];
  const footerMismatches: PdfWordComparison['footerMismatches'] = [];
  if (ops) {
    const pageSection = new Map<number, number>();
    for (const op of ops) {
      if (op.kind === 'delete') missingIdx.push(op.ai!);
      else if (op.kind === 'insert') extraIdx.push(op.bi!);
      else {
        const page = pdf[op.bi!]!.page;
        if (!pageSection.has(page)) pageSection.set(page, source.body[expected[op.ai!]!.entry]!.section ?? 0);
      }
    }
    let section = 0;
    pages.forEach((_, page) => {
      section = pageSection.get(page) ?? section;
      const want = regionFor(section, page).join(' ');
      const found = regions[page]!.join(' ');
      if (want !== found) footerMismatches.push({ page: page + 1, section, expected: want, found });
    });
  } else {
    expected.forEach((_, i) => missingIdx.push(i));
  }
  const missing = groupSpans(missingIdx, expected.map((token) => token.word));
  const unexplainedExtra = groupSpans(extraIdx, pdf.map((token) => token.word));
  return {
    passed: ops !== null && missing.length === 0 && unexplainedExtra.length === 0 && footerMismatches.length === 0,
    normalization: PDF_WORD_NORMALIZATION,
    alignment: ops ? 'complete' : 'over-budget',
    expectedWords: expected.length,
    pdfWords: pdf.length,
    missing,
    unexplainedExtra,
    footerMismatches,
    knownGenerated: {
      footerRegions: regions.map((region) => region.join(' ')),
      listMarkers,
      repeatedTableHeaders: accepted.map(({ page, table }) => ({ page: page + 1, table })),
    },
    limitations: PDF_WORD_LIMITATIONS,
  };
}
