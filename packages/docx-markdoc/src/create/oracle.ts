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
 * - list numbers are generated and are not part of the paragraph text;
 * - a footer page number is a PAGE field.
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

export type SourceProjection = {
  /** Body paragraphs in reading order, with the source line they came from; table cells are marked. */
  body: Array<{ text: string; line?: number; cell?: true }>;
  /** Per section: the declared footer paragraphs, or null when the section declares none. */
  footers: Array<string[] | null>;
};

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
  const push = (text: string, node: MarkdocNode, cell = false) => body.push({ text, ...(lineOf(node) === undefined ? {} : { line: lineOf(node)! }), ...(cell ? { cell: true as const } : {}) });
  const listItems = (list: MarkdocNode) => {
    for (const item of list.children) {
      for (const child of item.children) {
        if (child.type === 'list') listItems(child);
        else push(inlineText(child), item);
      }
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
        for (const group of grid?.children ?? []) {
          for (const row of group.children) for (const cell of row.children) push(inlineText(cell), cell, true);
        }
        return;
      }
      case 'section': {
        const { footer } = node.attributes;
        const pageNumbers = node.attributes['page-numbers'];
        footers.push(footer !== undefined || pageNumbers !== undefined ? footerOf(footer, pageNumbers) : null);
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
    else if (node.type === 'list') listItems(node);
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
  expectedWords: number;
  pdfWords: number;
  missing: WordSpan[];
  unexplainedExtra: WordSpan[];
  knownGenerated: { footerOccurrences: number; pageNumbers: string[]; listNumbers: string[] };
  limitations: string;
};

const LIST_NUMBER = /^(?:\d+\.|\([a-z]{1,3}\)|\([ivxlcdm]+\)|[•◦▪])$/u;
export const PDF_WORD_NORMALIZATION = 'Unicode NFKC (folds ligatures such as "fi"), then whitespace runs split words. Nothing else.';
export const PDF_WORD_LIMITATIONS =
  'The text layer is read with pdftotext -raw (content-stream order, which for LibreOffice output is document order). Footer text is recognized only at the start or end of a page, where LibreOffice places it: at most one declared footer text and, when the document declares page numbers, one digits-only page number are removed from one end of a page (the footer and its page number must be adjacent) before alignment. A footer text found anywhere else is an unexplained extra. A body paragraph that starts or ends a page with the exact text of a declared footer, on a page whose own footer is not there, is misread as that footer and reported missing (a false failure, never a false pass). Unmatched tokens shaped like list numbers ("1.", "(a)", "(iv)", bullets) count as generated, so a duplicated list number is not detected. Any other duplicated or extra word is an unexplained extra and fails.';

/**
 * Word-level alignment of the source text against the PDF text layer.
 * Generated footer text is peeled off the ends of each page first, so a
 * footer can never stand in for a missing body word. Then the source words
 * are aligned with the remaining PDF words: missing source words fail, and
 * unmatched PDF words fail unless they are list numbers.
 */
export function comparePdfWords(source: SourceProjection, pageTexts: readonly string[]): PdfWordComparison {
  const words = (text: string) => text.normalize('NFKC').split(/[\s\u00a0]+/u).filter(Boolean);
  const expected = source.body.flatMap((entry) => words(entry.text));
  const declared = source.footers.flatMap((footer) => footer ?? []);
  const hasPageNumbers = declared.includes(PAGE_NUMBER_FIELD);
  const footerSequences = [...new Set(declared.filter((line) => line !== PAGE_NUMBER_FIELD))].map(words).filter((seq) => seq.length > 0)
    .sort((a, b) => b.length - a.length);
  let footerOccurrences = 0;
  const pageNumbers: string[] = [];
  const pageWords: string[] = [];
  for (const text of pageTexts) {
    const tokens = words(text);
    const matchesAt = (from: number, seq: readonly string[], lo: number, hi: number) =>
      from >= lo && from + seq.length <= hi && seq.every((word, offset) => tokens[from + offset] === word);
    // A page has one footer: at most one footer text and one page number, adjacent, at one end of the page.
    const peel = (fromHead: boolean) => {
      let lo = 0;
      let hi = tokens.length;
      let footer = false;
      let number: string | undefined;
      for (let step = 0; step < 2; step += 1) {
        const edge = fromHead ? tokens[lo] : tokens[hi - 1];
        if (number === undefined && hasPageNumbers && lo < hi && /^\d+$/u.test(edge!)) {
          number = edge;
          if (fromHead) lo += 1;
          else hi -= 1;
          continue;
        }
        const seq = footer ? undefined : footerSequences.find((candidate) => matchesAt(fromHead ? lo : hi - candidate.length, candidate, lo, hi));
        if (!seq) break;
        footer = true;
        if (fromHead) lo += seq.length;
        else hi -= seq.length;
      }
      return { lo, hi, footer, number };
    };
    const head = peel(true);
    const tail = peel(false);
    // LibreOffice writes the footer first, so the head wins a tie; a footer text match beats a bare number.
    const chosen = head.footer || (!tail.footer && head.number !== undefined) ? head : tail;
    if (chosen.footer) footerOccurrences += 1;
    if (chosen.number !== undefined) pageNumbers.push(chosen.number);
    pageWords.push(...tokens.slice(chosen.lo, chosen.hi));
  }
  const ops = myersDiff(expected, pageWords, (x, y) => x === y);
  const missingIdx: number[] = [];
  const extraIdx: number[] = [];
  const listNumbers: string[] = [];
  if (ops) {
    for (const op of ops) {
      if (op.kind === 'delete') missingIdx.push(op.ai!);
      else if (op.kind === 'insert') {
        if (LIST_NUMBER.test(op.b!)) listNumbers.push(op.b!);
        else extraIdx.push(op.bi!);
      }
    }
  } else {
    expected.forEach((_, i) => missingIdx.push(i));
  }
  const missing = groupSpans(missingIdx, expected);
  const unexplainedExtra = groupSpans(extraIdx, pageWords);
  return {
    passed: ops !== null && missing.length === 0 && unexplainedExtra.length === 0,
    normalization: PDF_WORD_NORMALIZATION,
    alignment: ops ? 'complete' : 'over-budget',
    expectedWords: expected.length,
    pdfWords: pageWords.length,
    missing,
    unexplainedExtra,
    knownGenerated: { footerOccurrences, pageNumbers, listNumbers },
    limitations: PDF_WORD_LIMITATIONS,
  };
}
