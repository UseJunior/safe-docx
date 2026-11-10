import Markdoc, { type Node as MarkdocNode } from '@markdoc/markdoc';
import { DocxMarkdocError } from '../errors.js';
import { createDocumentFromMarkdoc, type CreatedDocument } from './create.js';
import { lowerCreationMarkdoc, NUMPAGES_FIELD_TOKEN, PAGE_FIELD_TOKEN, type CreationProjection } from './lower.js';
import { CREATION_STYLE } from './profile.js';
import { readPullDocx, type PullDocx, type PullParagraph, type PullStory } from './pull-docx.js';
import { buildSourceMap, lineStartsOf, type SourceHolder, type SourceMap, type SourceParagraph, type SourcePiece } from './pull-source.js';
import { RUNNING_TEXT_KEYS } from './validate.js';

/**
 * Something in the edited DOCX that `pull` reports but does not write into
 * the creation source: it cannot be expressed in the creation grammar, or it
 * could not be mapped onto the source safely. `line` is a line of the
 * original `.mdoc`.
 */
export type PullDiagnostic = { code: string; message: string; line?: number; paragraph?: number; section?: number };

/** One word-level edit in a changed paragraph: the text replaced and its replacement, at a source line. */
export type PullEdit = { line: number; deleted: string; inserted: string };

/**
 * A change between the build and the edited DOCX. `paragraph` numbers count
 * the build's read-back paragraphs from 1; `line` is a line of the original
 * `.mdoc`. `applied` says whether `pull --apply` writes the change.
 */
export type PullChange =
  | { kind: 'changed'; paragraph: number; line: number; before: string; after: string; edits: PullEdit[]; applied: boolean }
  | { kind: 'deleted'; paragraph: number; line: number; endLine: number; text: string; applied: boolean }
  | { kind: 'added'; afterParagraph: number; afterLine: number; paragraphs: string[]; applied: boolean }
  | { kind: 'running-text'; section: number; slot: RunningSlot; line: number; before: string[]; after: string[]; applied: boolean };

export type RunningSlot = 'header' | 'footer' | 'first-page header' | 'first-page footer';

export type PullResult = {
  changes: PullChange[];
  diagnostics: PullDiagnostic[];
  /** The source with every applied change; absent when no change applies. */
  pulledSource?: string;
  /**
   * True when every change applied, no diagnostic was raised, and the
   * pulled source builds (every `create` check passing) to a DOCX whose body
   * paragraphs, their run formatting, and each section's visible header and
   * footer equal the edited DOCX's.
   */
  complete: boolean;
};

export type PullInput = {
  /** The creation source the build came from. */
  source: string;
  /** The style profile the build used (the certificate's), when any. */
  profile?: unknown;
  /** The build, regenerated from `source`. */
  base: CreatedDocument;
  /** The edited DOCX. */
  edited: Buffer;
};

type Splice = { start: number; end: number; text: string };

/** The paragraphs a pulled source must read back as: each build paragraph (or null once deleted) with what was added after it. */
type Slots = { before: string[]; items: Array<{ text: string | null; after: string[] }> };

type Plan = {
  changes: PullChange[];
  splices: Splice[];
  apply: (slots: Slots) => void;
  /** Body edits inside a paragraph must leave the markup skeleton as it was. */
  keepsSkeleton: boolean;
  /** What to report when the planned change fails verification. */
  where: { line: number; paragraph?: number };
};

// ---------------------------------------------------------------------------
// Diffing

/** Words, runs of whitespace and single other characters. */
function tokens(text: string): string[] {
  return text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? [];
}

type Op = { kind: 'equal' | 'delete' | 'insert'; a: number; b: number; count: number };

/** Longest-common-subsequence alignment of two sequences, after trimming their common prefix and suffix. */
function align<T>(a: readonly T[], b: readonly T[], equal: (x: T, y: T) => boolean): Op[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && equal(a[prefix]!, b[prefix]!)) prefix += 1;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && equal(a[a.length - 1 - suffix]!, b[b.length - 1 - suffix]!)) suffix += 1;
  const n = a.length - prefix - suffix;
  const m = b.length - prefix - suffix;
  const ops: Op[] = [];
  const push = (kind: Op['kind'], ai: number, bi: number) => {
    const last = ops.at(-1);
    if (last && last.kind === kind && last.a + (kind === 'insert' ? 0 : last.count) === ai && last.b + (kind === 'delete' ? 0 : last.count) === bi) last.count += 1;
    else ops.push({ kind, a: ai, b: bi, count: 1 });
  };
  for (let index = 0; index < prefix; index += 1) push('equal', index, index);
  if (n * m > 4_000_000) {
    // Too large to align exactly: one replacement of the differing middle.
    for (let index = 0; index < n; index += 1) push('delete', prefix + index, prefix);
    for (let index = 0; index < m; index += 1) push('insert', prefix + n, prefix + index);
  } else {
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        table[i * width + j] = equal(a[prefix + i]!, b[prefix + j]!) ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && equal(a[prefix + i]!, b[prefix + j]!)) {
        push('equal', prefix + i, prefix + j);
        i += 1;
        j += 1;
      } else if (j < m && (i === n || table[i * width + j + 1]! >= table[(i + 1) * width + j]!)) {
        push('insert', prefix + i, prefix + j);
        j += 1;
      } else {
        push('delete', prefix + i, prefix + j);
        i += 1;
      }
    }
  }
  for (let index = 0; index < suffix; index += 1) push('equal', a.length - suffix + index, b.length - suffix + index);
  return ops;
}

/** A replaced range of a paragraph: characters [oStart, oEnd) of the build became [eStart, eEnd) of the edited text. */
type Hunk = { oStart: number; oEnd: number; eStart: number; eEnd: number };

/** Word-level hunks between two paragraph texts, and the aligned equal character ranges. */
function wordDiff(before: string, after: string): { hunks: Hunk[]; equal: Array<{ o: number; e: number; length: number }> } {
  const a = tokens(before);
  const b = tokens(after);
  const offsets = (list: string[]) => list.reduce<number[]>((out, token) => [...out, out.at(-1)! + token.length], [0]);
  const ao = offsets(a);
  const bo = offsets(b);
  const hunks: Hunk[] = [];
  const equal: Array<{ o: number; e: number; length: number }> = [];
  let open: Hunk | undefined;
  for (const op of align(a, b, (x, y) => x === y)) {
    if (op.kind === 'equal') {
      if (open) hunks.push(open);
      open = undefined;
      equal.push({ o: ao[op.a]!, e: bo[op.b]!, length: ao[op.a + op.count]! - ao[op.a]! });
      continue;
    }
    open ??= { oStart: ao[op.a]!, oEnd: ao[op.a]!, eStart: bo[op.b]!, eEnd: bo[op.b]! };
    if (op.kind === 'delete') open.oEnd = ao[op.a + op.count]!;
    else open.eEnd = bo[op.b + op.count]!;
  }
  if (open) hunks.push(open);
  return { hunks, equal };
}

/**
 * The hunk without the characters its two sides share at either end, with the
 * same formatting, or undefined when nothing is shared. A character retyped
 * with other formatting ("**bar**" to plain "baz") is changed, not kept.
 */
function trimHunk(before: PullParagraph, after: PullParagraph, hunk: Hunk): Hunk | undefined {
  let { oStart, oEnd, eStart, eEnd } = hunk;
  const same = (o: number, e: number) => before.text[o] === after.text[e] && before.formats[o] === after.formats[e];
  while (oStart < oEnd && eStart < eEnd && same(oStart, eStart)) {
    oStart += 1;
    eStart += 1;
  }
  while (oStart < oEnd && eStart < eEnd && same(oEnd - 1, eEnd - 1)) {
    oEnd -= 1;
    eEnd -= 1;
  }
  if (oStart === hunk.oStart && oEnd === hunk.oEnd) return undefined;
  return { oStart, oEnd, eStart, eEnd };
}

/** Dice similarity of two paragraphs' words. */
function similarity(a: string, b: string): number {
  const words = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const left = words(a);
  const right = words(b);
  if (left.length === 0 && right.length === 0) return a.trim() === b.trim() ? 1 : 0;
  const counts = new Map<string, number>();
  for (const word of left) counts.set(word, (counts.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of right) {
    const count = counts.get(word) ?? 0;
    if (count > 0) {
      shared += 1;
      counts.set(word, count - 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}

type ParagraphPairing = Array<{ o?: number; e?: number }>;

/**
 * Pair the build's paragraphs with the edited ones: equal texts first, then,
 * between two equal pairs, the edited paragraph most like each build
 * paragraph, in order. An unpaired build paragraph was deleted; an unpaired
 * edited one was added.
 */
function pairParagraphs(before: readonly string[], after: readonly string[]): ParagraphPairing {
  const out: ParagraphPairing = [];
  const pending: { o: number[]; e: number[] } = { o: [], e: [] };
  const flush = () => {
    const { o, e } = pending;
    const threshold = o.length === 1 && e.length === 1 ? 0.3 : 0.5;
    // Order-preserving pairing that maximizes total similarity above the threshold.
    const n = o.length;
    const m = e.length;
    const score: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        const s = similarity(before[o[i]!]!, after[e[j]!]!);
        score[i]![j] = Math.max(score[i + 1]![j]!, score[i]![j + 1]!, s >= threshold ? score[i + 1]![j + 1]! + s : -Infinity);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m) {
        const s = similarity(before[o[i]!]!, after[e[j]!]!);
        if (s >= threshold && score[i]![j] === score[i + 1]![j + 1]! + s) {
          out.push({ o: o[i]!, e: e[j]! });
          i += 1;
          j += 1;
          continue;
        }
        if (score[i]![j] === score[i + 1]![j]) {
          out.push({ o: o[i]! });
          i += 1;
        } else {
          out.push({ e: e[j]! });
          j += 1;
        }
      } else if (i < n) {
        out.push({ o: o[i]! });
        i += 1;
      } else {
        out.push({ e: e[j]! });
        j += 1;
      }
    }
    pending.o = [];
    pending.e = [];
  };
  for (const op of align(before, after, (x, y) => x === y)) {
    for (let k = 0; k < op.count; k += 1) {
      if (op.kind === 'equal') {
        flush();
        out.push({ o: op.a + k, e: op.b + k });
      } else if (op.kind === 'delete') pending.o.push(op.a + k);
      else pending.e.push(op.b + k);
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Escaping

const INLINE_SPECIAL = /[\\`*_[\]{}<>~|&]/gu;

/** Text as creation Markdoc inline content: Markdown and Markdoc punctuation escaped; a line break as a hard break. */
export function escapeInline(text: string, atLineStart: boolean): string {
  const lines = text.split('\n').map((line, index) => {
    let escaped = line.replace(INLINE_SPECIAL, (char) => `\\${char}`);
    if (index > 0 || atLineStart) {
      escaped = escaped.replace(/^([ \t]*)(\d+)([.)])/u, '$1$2\\$3').replace(/^([ \t]*)([#>+\-=])/u, '$1\\$2');
    }
    return escaped;
  });
  return lines.join('\\\n');
}

/** Text as a Markdoc attribute string's content. */
function escapeAttribute(text: string): string {
  return text.replace(/[\\"]/gu, (char) => `\\${char}`);
}

/** True when `offset` starts a line of the source, after indentation and block markers only. */
function atLineStart(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  return /^[ \t]*(?:>[ \t]?)*[ \t]*(?:(?:[-*+]|\d+[.)]|#{1,6})[ \t]+)?$/u.test(source.slice(lineStart, offset));
}

// ---------------------------------------------------------------------------
// Formatting

/** A run-formatting signature as words. */
function describeFormat(signature: string): string {
  if (!signature) return 'plain';
  // A field whose runs disagree, or whose result holds a tab or break: each format, with what it covers.
  if (signature.includes('#')) return `a field laid out as ${signature.split('&').map((segment) => { const [format = '', parts = ''] = segment.split('#'); return `${describeFormat(format)} [${parts}]`; }).join(' then ')}`;
  const names: Record<string, string> = { b: 'bold', i: 'italic', strike: 'struck through', caps: 'caps', smallCaps: 'small caps', vanish: 'hidden', u: 'underlined', vertAlign: 'raised or lowered', highlight: 'highlighted', color: 'coloured' };
  return signature.split(',').map((part) => (part.endsWith('=off') ? `explicitly not ${names[part.slice(0, -4)] ?? part.slice(0, -4)}` : names[part] ?? part)).join(', ');
}

/** The run formatting `pull` can write as markup: bold, italic and single underline. */
function markupFor(signature: string): { open: string; close: string } | undefined {
  const parts = signature ? signature.split(',') : [];
  if (parts.some((part) => part !== 'b' && part !== 'i' && part !== 'u=single')) return undefined;
  let open = '';
  let close = '';
  if (parts.includes('u=single')) {
    open += '{% u %}';
    close = `{% /u %}${close}`;
  }
  if (parts.includes('b')) {
    open += '**';
    close = `**${close}`;
  }
  if (parts.includes('i')) {
    open += '*';
    close = `*${close}`;
  }
  return { open, close };
}

/** The formatting of a container's own text in the build, or undefined when it has none. */
function holderFormat(paragraph: SourceParagraph, built: PullParagraph, holder: number): string | undefined {
  const piece = paragraph.pieces!.find((candidate) => candidate.holder === holder && candidate.kind === 'text' && candidate.end > candidate.start);
  return piece ? built.formats[piece.start] : undefined;
}

/** The formatting of the first non-space character of a range, or of its first character. */
function leadingFormat(formats: readonly string[], text: string): string {
  const index = text.search(/\S/u);
  return formats[index === -1 ? 0 : index] ?? '';
}

/** Ranges of equal text whose run formatting differs, merged. */
function formattingChanges(
  before: PullParagraph,
  after: PullParagraph,
  equal: ReadonlyArray<{ o: number; e: number; length: number }>,
): Array<{ text: string; from: string; to: string }> {
  const out: Array<{ text: string; from: string; to: string; end: number }> = [];
  for (const range of equal) {
    for (let k = 0; k < range.length; k += 1) {
      const from = before.formats[range.o + k] ?? '';
      const to = after.formats[range.e + k] ?? '';
      if (from === to) continue;
      const char = before.text[range.o + k]!;
      const last = out.at(-1);
      if (last && last.end === range.o + k && last.from === from && last.to === to) {
        last.text += char;
        last.end += 1;
      } else out.push({ text: char, from, to, end: range.o + k + 1 });
    }
  }
  return out.filter((change) => change.text.trim()).map(({ text, from, to }) => ({ text, from, to }));
}

// ---------------------------------------------------------------------------
// Running text

/** Each section's visible header and footer: its own or inherited part, first page apart. */
type VisibleStories = Array<Record<RunningSlot, string[]>>;

type StoryLines = Array<{ text: string; signature: string }>;

/** A story's non-empty lines, with a signature of their alignment and the formatting of their own text. */
function storyLines(story: PullStory, doc: Pick<PullDocx, 'styleAlignments'>, defaultStyle: string): StoryLines | null {
  if (story === null) return null;
  return story.filter((paragraph) => paragraph.text.trim()).map((paragraph) => {
    const alignment = paragraph.alignment ?? doc.styleAlignments[paragraph.style ?? defaultStyle] ?? 'left';
    const literal = new Set<string>();
    const fieldless = paragraph.text.replaceAll(PAGE_FIELD_TOKEN, '\u0001'.repeat(PAGE_FIELD_TOKEN.length)).replaceAll(NUMPAGES_FIELD_TOKEN, '\u0001'.repeat(NUMPAGES_FIELD_TOKEN.length));
    const field = new Set<string>();
    for (let index = 0; index < fieldless.length; index += 1) {
      if (fieldless[index] === '\u0001') field.add(paragraph.formats[index] ?? '');
      else if (/\S/u.test(fieldless[index]!)) literal.add(paragraph.formats[index] ?? '');
    }
    // Alignment, the formats of its literal text, its other paragraph properties (indentation, spacing, tabs, …) and the
    // formats of its page-number fields (the field's own runs; the cached number is not read).
    const others = paragraph.properties.split(';').filter((part) => part && !part.startsWith('jc=')).join(';');
    // Last, the fields' instructions: a page number given a format switch reads the same.
    return { text: paragraph.text, signature: `${alignment}|${[...literal].sort().join('+')}|${others}|${[...field].sort().join('+')}|${paragraph.fieldInstructions.join('+')}` };
  });
}

function visibleFrom<T>(
  headers: ReadonlyArray<T | null>,
  footers: ReadonlyArray<T | null>,
  firstPage: ReadonlyArray<{ header: T | null; footer: T | null } | null>,
): Array<Record<RunningSlot, T | []>> {
  const out: Array<Record<RunningSlot, T | []>> = [];
  let header: T | null = null;
  let footer: T | null = null;
  for (let section = 0; section < Math.max(headers.length, footers.length); section += 1) {
    header = headers[section] ?? header;
    footer = footers[section] ?? footer;
    const first = firstPage[section];
    out.push({
      header: header ?? [],
      footer: footer ?? [],
      'first-page header': first ? first.header ?? [] : header ?? [],
      'first-page footer': first ? first.footer ?? [] : footer ?? [],
    });
  }
  return out;
}

/** The visible running text of a lowering's projection, as non-empty lines. */
function projectedStories(projection: Pick<CreationProjection, 'headers' | 'footers' | 'firstPage'>): VisibleStories {
  const lines = (story: string[] | null) => (story === null ? null : story.filter((line) => line.trim()));
  return visibleFrom(projection.headers.map(lines), projection.footers.map(lines), projection.firstPage.map((entry) => (entry ? { header: lines(entry.header), footer: lines(entry.footer) } : null)))
    .map((section) => Object.fromEntries(Object.entries(section).map(([slot, value]) => [slot, [...value]])) as Record<RunningSlot, string[]>);
}

function docStories(doc: PullDocx): Array<Record<RunningSlot, StoryLines>> {
  const header = (story: PullStory) => storyLines(story, doc, CREATION_STYLE.header);
  const footer = (story: PullStory) => storyLines(story, doc, CREATION_STYLE.footer);
  return visibleFrom(doc.headers.map(header), doc.footers.map(footer), doc.firstPage.map((entry) => (entry ? { header: header(entry.header), footer: footer(entry.footer) } : null)))
    .map((section) => Object.fromEntries(Object.entries(section).map(([slot, value]) => [slot, [...value]])) as Record<RunningSlot, StoryLines>);
}

const SLOTS: readonly RunningSlot[] = ['header', 'footer', 'first-page header', 'first-page footer'];
const textsOf = (lines: StoryLines) => lines.map((line) => line.text);
const sameStory = (a: StoryLines, b: StoryLines) => JSON.stringify(a) === JSON.stringify(b);

/** A page number line in one of the creation formats, or undefined. */
function pageNumberFormat(text: string): 'plain' | 'dashed' | 'page-of-total' | undefined {
  const trimmed = text.trim();
  if (trimmed === PAGE_FIELD_TOKEN) return 'plain';
  if (trimmed === `- ${PAGE_FIELD_TOKEN} -`) return 'dashed';
  if (trimmed === `Page ${PAGE_FIELD_TOKEN} of ${NUMPAGES_FIELD_TOKEN}`) return 'page-of-total';
  return undefined;
}

type RunningKeys = Partial<Record<(typeof RUNNING_TEXT_KEYS)[number], string | boolean>>;

/**
 * The running-text keys that reproduce a section's own header and footer in
 * the edited DOCX, or the reason they cannot. `inherit` is true for a slot
 * the section takes from the one before.
 */
function inferRunningKeys(doc: PullDocx, section: number): { keys: RunningKeys; problems: string[] } {
  const keys: RunningKeys = {};
  const problems: string[] = [];
  const plainText = (line: { text: string }) => !/[\t\n]/u.test(line.text) && !line.text.includes(PAGE_FIELD_TOKEN) && !line.text.includes(NUMPAGES_FIELD_TOKEN) && !/<[A-Z]+>/u.test(line.text);
  const alignmentOf = (line: { signature: string }) => line.signature.split('|')[0]!;
  const formatsOf = (line: { signature: string }) => line.signature.split('|')[1]!.split('+').filter(Boolean);
  const fieldFormatsOf = (line: { signature: string }) => (line.signature.split('|')[3] ?? '').split('+').filter(Boolean);
  for (const [slot, story] of [['header', doc.headers[section]], ['footer', doc.footers[section]]] as const) {
    for (const line of storyLines(story ?? null, doc, slot === 'header' ? CREATION_STYLE.header : CREATION_STYLE.footer) ?? []) {
      if (fieldFormatsOf(line).length > 0) problems.push(`its ${slot}'s page number is formatted (${fieldFormatsOf(line).map(describeFormat).join('; ')}), which create does not express`);
      // create writes PAGE and NUMPAGES bare; a switch (`\\* roman`) or another field is not a key.
      const switched = (line.signature.split('|')[4] ?? '').split('+').filter((instruction) => instruction && instruction !== 'PAGE' && instruction !== 'NUMPAGES');
      if (switched.length > 0) problems.push(`its ${slot} holds the field ${switched.map((instruction) => quote(instruction)).join(', ')}, which create does not write`);
    }
  }
  const header = storyLines(doc.headers[section] ?? null, doc, CREATION_STYLE.header);
  if (header !== null) {
    if (header.length === 0) {
      if (section > 0) keys.header = false;
    } else if (header.length === 1 && plainText(header[0]!)) {
      keys.header = header[0]!.text.trim();
      const alignment = alignmentOf(header[0]!);
      if (alignment === 'left' || alignment === 'right') keys['header-align'] = alignment;
      else if (alignment !== 'center') problems.push(`its header is aligned '${alignment}', which header-align cannot express`);
      if (formatsOf(header[0]!).length > 0) problems.push(`its header text is formatted (${formatsOf(header[0]!).map(describeFormat).join('; ')}), which create does not express`);
    } else {
      problems.push(`its header is ${header.length} lines or holds fields or tabs; a created header is one line of text`);
    }
  }
  type Footer = { text?: string; italic?: boolean; align?: string; number?: { format: string; align: string }; oneLine?: boolean };
  const readFooter = (lines: StoryLines): Footer | string => {
    const footer: Footer = {};
    const textLine = (line: StoryLines[number]) => {
      footer.text = line.text.trim();
      footer.align = alignmentOf(line);
      const formats = formatsOf(line);
      if (formats.length > 1 || (formats.length === 1 && formats[0] !== 'i')) return `its footer text is formatted (${formats.map(describeFormat).join('; ')}), which create does not express`;
      footer.italic = formats[0] === 'i';
      return undefined;
    };
    if (lines.length === 1 && lines[0]!.text.includes('\t')) {
      const [left, right, ...rest] = lines[0]!.text.split('\t');
      const format = right === undefined ? undefined : pageNumberFormat(right);
      if (rest.length > 0 || !format || !left!.trim() || /<[A-Z]+>/u.test(left!)) return 'its footer line holds tabs create cannot lay out';
      const problem = textLine({ ...lines[0]!, text: left! });
      if (problem) return problem;
      footer.oneLine = true;
      footer.number = { format, align: 'right' };
      return footer;
    }
    for (const line of lines) {
      const format = pageNumberFormat(line.text);
      if (format && !footer.number) footer.number = { format, align: alignmentOf(line) };
      else if (!format && plainText(line) && footer.text === undefined && !footer.number) {
        const problem = textLine(line);
        if (problem) return problem;
      } else return 'its footer is not footer text over a page number';
    }
    return footer;
  };
  const footerLines = storyLines(doc.footers[section] ?? null, doc, CREATION_STYLE.footer);
  let footer: Footer | undefined;
  if (footerLines !== null) {
    const read = readFooter(footerLines);
    if (typeof read === 'string') problems.push(read);
    else {
      footer = read;
      if (read.text === undefined && !read.number) {
        if (section > 0) keys['page-numbers'] = false;
      }
      if (read.text !== undefined) {
        keys.footer = read.text;
        if (read.italic === false) keys['footer-italic'] = false;
        if (!read.oneLine && read.align !== 'center') {
          if (read.align === 'left' || read.align === 'right') keys['footer-align'] = read.align;
          else problems.push(`its footer text is aligned '${read.align}', which footer-align cannot express`);
        }
      }
      if (read.number) {
        keys['page-numbers'] = true;
        if (read.number.format !== 'plain') keys['page-number-format'] = read.number.format;
        if (read.oneLine) keys['footer-layout'] = 'one-line';
        else if (read.number.align !== 'center') {
          if (read.number.align === 'left' || read.number.align === 'right') keys['page-number-align'] = read.number.align;
          else problems.push(`its page number is aligned '${read.number.align}', which page-number-align cannot express`);
        }
      }
    }
  }
  const first = doc.firstPage[section];
  if (first) {
    const firstHeader = storyLines(first.header, doc, CREATION_STYLE.header) ?? [];
    const ownHeader = header ?? [];
    if (!sameStory(firstHeader, ownHeader)) {
      if (firstHeader.length === 0) keys['header-first'] = 'none';
      else if (firstHeader.length === 1 && plainText(firstHeader[0]!) && (ownHeader.length === 0 || alignmentOf(firstHeader[0]!) === alignmentOf(ownHeader[0]!))) keys['header-first'] = firstHeader[0]!.text.trim();
      else problems.push('its first-page header differs from its header in more than its text');
    }
    const firstFooter = storyLines(first.footer, doc, CREATION_STYLE.footer) ?? [];
    const ownFooter = footerLines ?? [];
    if (!sameStory(firstFooter, ownFooter)) {
      const read = readFooter(firstFooter);
      if (firstFooter.length === 0) keys['footer-first'] = 'none';
      else if (typeof read !== 'string' && read.text !== undefined && footer
        && JSON.stringify(read.number) === JSON.stringify(footer.number) && read.oneLine === footer.oneLine && read.italic === footer.italic && (footer.oneLine || read.align === footer.align)) keys['footer-first'] = read.text;
      else problems.push('its first-page footer differs from its footer in more than its text');
    }
  }
  return { keys, problems };
}

/** A running-text key as a frontmatter line or a section attribute. */
function frontmatterLine(key: string, value: string | boolean): string {
  return `${key}: ${String(value)}`;
}

function sectionAttribute(key: string, value: string | boolean): string {
  return typeof value === 'boolean' ? `${key}=${value}` : `${key}="${escapeAttribute(value)}"`;
}

/** Frontmatter extent: [start, end) of the lines between the fences, or undefined without frontmatter. */
function frontmatterRange(source: string): { open: number; bodyStart: number; bodyEnd: number; close: number } | undefined {
  const match = /^---[ \t]*\n([\s\S]*?\n)?---[ \t]*(?:\n|$)/u.exec(source);
  if (!match) return undefined;
  const bodyStart = source.indexOf('\n') + 1;
  const bodyEnd = bodyStart + (match[1]?.length ?? 0);
  return { open: 0, bodyStart, bodyEnd, close: match[0].length };
}

/** The splice that sets section 0's running-text keys in the frontmatter, keeping every other line. */
function frontmatterSplice(source: string, keys: RunningKeys): Splice {
  const running = new Set<string>(RUNNING_TEXT_KEYS);
  const range = frontmatterRange(source);
  const added = Object.entries(keys).map(([key, value]) => frontmatterLine(key, value!));
  if (!range) {
    return { start: 0, end: 0, text: added.length ? `---\n${added.join('\n')}\n---\n\n` : '' };
  }
  const lines = source.slice(range.bodyStart, range.bodyEnd).split('\n').slice(0, -1);
  const out: string[] = [];
  let placed = false;
  for (const line of lines) {
    const key = /^([a-z-]+):/u.exec(line.trim())?.[1];
    if (key && running.has(key)) {
      if (!placed) out.push(...added);
      placed = true;
      continue;
    }
    out.push(line);
  }
  if (!placed) out.push(...added);
  return { start: range.bodyStart, end: range.bodyEnd, text: out.length ? `${out.join('\n')}\n` : '' };
}

// ---------------------------------------------------------------------------
// Planning

/** Report what a plan failed on: unmapped edits and their reasons. */
class PlanProblem {
  constructor(readonly code: string, readonly reason: string) {}
}

/**
 * The source splices for one hunk of a changed paragraph, or the reason it
 * cannot be written without moving markup. See the README's `pull` section
 * for the rules: an edit inside one container rewrites that span; an edit
 * across containers deletes from each and puts the new text into the
 * container whose formatting it has; a container (a fill-in, bold text) the
 * edit covers entirely is replaced with it; a cross-reference may only go
 * when its field went too.
 */
function planHunk(
  source: string,
  paragraph: SourceParagraph,
  built: PullParagraph,
  edited: PullParagraph,
  hunk: Hunk,
  notes: PullDiagnostic[],
): { splices: Splice[]; crossReferences: number; removesMarkup?: true } | PlanProblem {
  const pieces = paragraph.pieces!;
  const holders = paragraph.holders!;
  const { oStart: a, oEnd: b } = hunk;
  const inserted = edited.text.slice(hunk.eStart, hunk.eEnd);
  const insertedFormats = edited.formats.slice(hunk.eStart, hunk.eEnd);
  const wanted = inserted ? leadingFormat(insertedFormats, inserted) : undefined;
  if (inserted.includes('\t')) return new PlanProblem('PULL_UNEXPRESSIBLE_TEXT', 'the new text holds a tab, which creation Markdoc cannot write');
  const mixed = () => {
    if (new Set(insertedFormats.filter((_, index) => inserted[index]!.trim())).size > 1) {
      notes.push({ code: 'PULL_DIRECT_FORMATTING', message: `the new text "${inserted}" mixes formatting (${[...new Set(insertedFormats)].map(describeFormat).join('; ')}); it is written with the formatting of the text around it` });
    }
  };
  const holderById = new Map(holders.map((holder) => [holder.id, holder]));
  const chain = (id: number): SourceHolder[] => {
    const out: SourceHolder[] = [];
    for (let at: SourceHolder | undefined = holderById.get(id); at; at = at.parent === null ? undefined : holderById.get(at.parent)) out.push(at);
    return out;
  };
  const depth = (id: number) => chain(id).length;
  const escape = (holder: number, at: number, text: string) => (holderById.get(holder)?.kind === 'attribute' ? escapeAttribute(text) : escapeInline(text, atLineStart(source, at)));
  const notFormatted = (holder: number) => {
    const format = holderFormat(paragraph, built, holder);
    if (wanted !== undefined && format !== undefined && format !== wanted) {
      notes.push({ code: 'PULL_DIRECT_FORMATTING', message: `the new text "${inserted.trim()}" is ${describeFormat(wanted)} in the edited DOCX but goes into ${describeFormat(format)} text` });
    }
  };

  if (a === b) {
    // A pure insertion: inside a piece of text, or at the boundary of two.
    const inside = pieces.find((piece) => piece.start < a && a < piece.end);
    if (inside) {
      if (inside.kind === 'fixed') return new PlanProblem(inside.what === 'cross-reference' ? 'PULL_EDIT_IN_CROSS_REFERENCE' : 'PULL_EDIT_IN_GENERATED_TEXT', `the insertion lands inside ${inside.what === 'cross-reference' ? 'a cross-reference' : 'generated text'} ("${inside.text}")`);
      const at = inside.raw![a - inside.start]!;
      mixed();
      notFormatted(inside.holder);
      return { splices: [{ start: at, end: at, text: escape(inside.holder, at, inserted) }], crossReferences: 0 };
    }
    const left = [...pieces].reverse().find((piece) => piece.end === a && piece.end > piece.start && piece.kind !== 'fixed');
    const right = pieces.find((piece) => piece.start === a && piece.end > piece.start && piece.kind !== 'fixed');
    const candidates = [left, right].filter((piece): piece is SourcePiece => piece !== undefined);
    if (candidates.length === 0) return new PlanProblem('PULL_EDIT_CROSSES_MARKUP', 'the insertion lands between generated text and markup');
    const mark = pieces.some((piece) => piece.what === 'footnote-reference' && piece.start === a);
    const afterMark = mark && edited.footnoteReferences.includes(hunk.eStart);
    const ranked = [...candidates].sort((x, y) => {
      const match = (piece: SourcePiece) => (holderFormat(paragraph, built, piece.holder) === wanted ? 0 : 1);
      if (match(x) !== match(y)) return match(x) - match(y);
      if (mark) return (x === right) === afterMark ? -1 : 1;
      if (depth(x.holder) !== depth(y.holder)) return depth(x.holder) - depth(y.holder);
      return x === left ? -1 : 1;
    });
    // New text whose formatting changes once, matching the text on each side ("and **very** bold"), is split between them.
    if (left && right && insertedFormats.length > 1) {
      const leftFormat = holderFormat(paragraph, built, left.holder);
      const rightFormat = holderFormat(paragraph, built, right.holder);
      const cut = insertedFormats.findIndex((format) => format !== insertedFormats[0]);
      if (leftFormat !== rightFormat && cut > 0 && insertedFormats[0] === leftFormat && insertedFormats.slice(cut).every((format) => format === rightFormat)) {
        const leftAt = left.raw!.at(-1)!;
        const rightAt = right.raw![0]!;
        return {
          splices: [
            { start: leftAt, end: leftAt, text: escape(left.holder, leftAt, inserted.slice(0, cut)) },
            { start: rightAt, end: rightAt, text: escape(right.holder, rightAt, inserted.slice(cut)) },
          ],
          crossReferences: 0,
        };
      }
    }
    mixed();
    const target = ranked[0]!;
    const at = target === left ? target.raw!.at(-1)! : target.raw![0]!;
    notFormatted(target.holder);
    return { splices: [{ start: at, end: at, text: escape(target.holder, at, inserted) }], crossReferences: 0 };
  }

  mixed();
  // A deletion or replacement: the pieces it touches, each lifted to the outermost container it covers entirely.
  const touched = pieces.filter((piece) => (piece.end > piece.start && piece.start < b && piece.end > a) || (piece.start === piece.end && a < piece.start && piece.start < b));
  type Unit = { parent: number; rawStart: number; rawEnd: number; start: number; end: number; holder?: SourceHolder; crossReference?: boolean };
  const units: Unit[] = [];
  const seen = new Set<number>();
  // The characters that really changed: markup is removed only around text inside them, never around text the edit keeps.
  const tight = trimHunk(built, edited, hunk) ?? hunk;
  for (const [index, piece] of touched.entries()) {
    const covered = chain(piece.holder).filter((holder) => holder.kind !== 'root' && holder.kind !== 'attribute' && a <= holder.start && holder.end <= b).at(-1);
    if (covered) {
      if (!(tight.oStart <= covered.start && covered.end <= tight.oEnd)) {
        return new PlanProblem('PULL_EDIT_CROSSES_MARKUP', `the edit would remove the ${covered.kind === 'fill' ? 'fill-in' : `${covered.kind} markup`} around text it keeps ("${built.text.slice(covered.start, covered.end)}")`);
      }
      if (seen.has(covered.id)) continue;
      seen.add(covered.id);
      units.push({ parent: covered.parent!, rawStart: covered.rawStart!, rawEnd: covered.rawEnd!, start: covered.start, end: covered.end, holder: covered });
      continue;
    }
    if (piece.kind === 'fixed') {
      if (piece.what === 'generated' && touched[index + 1]?.what === 'cross-reference' && piece.text === 'Section ') continue;
      if (piece.what === 'cross-reference' && a <= piece.start && piece.end <= b) {
        const prefix = touched[index - 1];
        const start = prefix?.what === 'generated' && prefix.text === 'Section ' && prefix.end === piece.start ? prefix.start : piece.start;
        if (start < a) return new PlanProblem('PULL_EDIT_IN_CROSS_REFERENCE', `the edit changes part of a cross-reference ("${built.text.slice(start, piece.end)}")`);
        units.push({ parent: piece.holder, rawStart: piece.rawStart!, rawEnd: piece.rawEnd!, start, end: piece.end, crossReference: true });
        continue;
      }
      if (piece.what === 'cross-reference') return new PlanProblem('PULL_EDIT_IN_CROSS_REFERENCE', `the edit changes part of a cross-reference ("${piece.text}")`);
      if (piece.what === 'footnote-reference') return new PlanProblem('PULL_EDIT_CROSSES_MARKUP', 'the edit spans a footnote reference');
      if (piece.what === 'fill-bracket') return new PlanProblem('PULL_EDIT_CROSSES_MARKUP', 'the edit changes the brackets of a fill-in without the whole fill-in');
      if (piece.what === 'line-break') return new PlanProblem('PULL_EDIT_CROSSES_MARKUP', 'the edit spans a line break');
      return new PlanProblem('PULL_EDIT_IN_GENERATED_TEXT', `the edit changes text the markup generates ("${piece.text}")`);
    }
    const from = Math.max(a, piece.start) - piece.start;
    const to = Math.min(b, piece.end) - piece.start;
    units.push({ parent: piece.holder, rawStart: piece.raw![from]!, rawEnd: piece.raw![to]!, start: Math.max(a, piece.start), end: Math.min(b, piece.end) });
  }
  // Consecutive units in one container whose source is contiguous form one splice.
  const groups: Unit[][] = [];
  for (const unit of units) {
    const last = groups.at(-1)?.at(-1);
    if (last && last.parent === unit.parent && last.rawEnd === unit.rawStart) groups.at(-1)!.push(unit);
    else groups.push([unit]);
  }
  let target: Unit[] | undefined;
  if (inserted) {
    target = groups.find((group) => holderFormat(paragraph, built, group[0]!.parent) === wanted)
      ?? [...groups].sort((x, y) => depth(x[0]!.parent) - depth(y[0]!.parent))[0];
    notFormatted(target![0]!.parent);
  }
  // A container the edit empties (other than the paragraph itself) would leave empty markup.
  const remaining = (holder: SourceHolder) => pieces
    .filter((piece) => piece.kind !== 'fixed' && chain(piece.holder).some((candidate) => candidate.id === holder.id))
    .reduce((count, piece) => count + [...piece.text].filter((char, k) => (piece.start + k < a || piece.start + k >= b) && char.trim()).length, 0);
  for (const holder of holders) {
    if (holder.kind === 'root' || (a <= holder.start && holder.end <= b)) continue;
    if (holder.end <= a || holder.start >= b) continue;
    const gains = target !== undefined && chain(target[0]!.parent).some((candidate) => candidate.id === holder.id) && inserted.trim() !== '';
    if (remaining(holder) === 0 && !gains) return new PlanProblem('PULL_EDIT_CROSSES_MARKUP', `the edit would empty a ${holder.kind === 'fill' ? 'fill-in' : holder.kind === 'attribute' ? 'signer attribute' : `${holder.kind} span`}`);
  }
  const splices = groups.map((group) => {
    const start = group[0]!.rawStart;
    const end = group.at(-1)!.rawEnd;
    return { start, end, text: group === target ? escape(group[0]!.parent, start, inserted) : '' };
  });
  // Replacing a whole container or cross-reference removes its markup on purpose; the skeleton check then does not apply.
  const removesMarkup = units.some((unit) => unit.holder !== undefined || unit.crossReference);
  return { splices, crossReferences: units.filter((unit) => unit.crossReference).length, ...(removesMarkup ? { removesMarkup: true as const } : {}) };
}

/** Inline creation markup for an added paragraph, from its runs: bold, italic and underline as markup, other formatting reported. */
function addedInline(paragraph: PullParagraph, notes: PullDiagnostic[], where: string): string {
  let out = '';
  let index = 0;
  const text = paragraph.text;
  while (index < text.length) {
    const format = paragraph.formats[index] ?? '';
    let end = index + 1;
    while (end < text.length && (paragraph.formats[end] ?? '') === format) end += 1;
    const segment = text.slice(index, end);
    let markup = markupFor(format);
    if (!markup) {
      notes.push({ code: 'PULL_DIRECT_FORMATTING', message: `${where}: "${segment.trim()}" is ${describeFormat(format)}, which create does not express; it is written as plain text` });
      markup = { open: '', close: '' };
    }
    const leading = /^\s*/u.exec(segment)![0];
    const trailing = /\s*$/u.exec(segment.slice(leading.length))![0];
    const core = segment.slice(leading.length, segment.length - trailing.length);
    const lineStart = out === '' || out.endsWith('\n');
    out += escapeInline(leading, lineStart);
    out += core ? `${markup.open}${escapeInline(core, out === '' || out.endsWith('\n'))}${markup.close}` : '';
    out += escapeInline(trailing, false);
    index = end;
  }
  return out;
}

type AddedBlock = { kind: 'plain' | 'list' | 'quote'; markdown: string };

/** The creation markup for one added paragraph, by its paragraph style. */
function addedBlock(paragraph: PullParagraph, notes: PullDiagnostic[], where: string): AddedBlock | PlanProblem {
  if (!paragraph.text.trim()) return new PlanProblem('PULL_UNMAPPED_INSERTION', 'an empty paragraph cannot be written in creation Markdoc');
  if (paragraph.text.includes('\t')) return new PlanProblem('PULL_UNEXPRESSIBLE_TEXT', 'the paragraph holds a tab, which creation Markdoc cannot write');
  if (paragraph.text !== paragraph.text.trim()) return new PlanProblem('PULL_UNEXPRESSIBLE_TEXT', 'the paragraph starts or ends with spaces, which creation Markdoc cannot write');
  if (paragraph.fields.length > 0 || paragraph.crossReferences.length > 0) return new PlanProblem('PULL_FIELD_CHANGED', `the paragraph holds fields (${[...paragraph.fields, ...paragraph.crossReferences.map(() => 'REF')].join(', ')}), which pull does not write`);
  if (paragraph.footnoteReferences.length > 0) return new PlanProblem('PULL_FOOTNOTES_CHANGED', 'the paragraph holds a footnote reference, which pull does not write');
  const inline = addedInline(paragraph, notes, where);
  const style = paragraph.style;
  if (paragraph.numbered || style === CREATION_STYLE.list) return { kind: 'list', markdown: inline };
  switch (style) {
    case CREATION_STYLE.title:
      return paragraph.text.includes('\n') ? new PlanProblem('PULL_UNEXPRESSIBLE_TEXT', 'a heading cannot hold a line break') : { kind: 'plain', markdown: `# ${inline}` };
    case CREATION_STYLE.heading1:
      return paragraph.text.includes('\n') ? new PlanProblem('PULL_UNEXPRESSIBLE_TEXT', 'a heading cannot hold a line break') : { kind: 'plain', markdown: `## ${inline}` };
    case CREATION_STYLE.heading2:
      return paragraph.text.includes('\n') ? new PlanProblem('PULL_UNEXPRESSIBLE_TEXT', 'a heading cannot hold a line break') : { kind: 'plain', markdown: `### ${inline}` };
    case CREATION_STYLE.quote:
      return { kind: 'quote', markdown: inline };
    case CREATION_STYLE.centered:
      return { kind: 'plain', markdown: `{% center %}${inline}{% /center %}` };
    case CREATION_STYLE.legend:
      return { kind: 'plain', markdown: `{% legend %}${inline}{% /legend %}` };
    case undefined:
    case CREATION_STYLE.body:
      return { kind: 'plain', markdown: inline };
    default:
      notes.push({ code: 'PULL_ADDED_PARAGRAPH_STYLE', message: `${where} has paragraph style '${style}', which create does not express; it is written as a body paragraph` });
      return { kind: 'plain', markdown: inline };
  }
}

/** The 0-based end line of a source paragraph's top-level block. */
function entryEnd(map: SourceMap, entry: number): number | undefined {
  return map.entryLines[entry]?.[1];
}

/** Offset where a new block goes before 0-based line `line`, with the separation it needs. */
function blockInsertion(source: string, starts: readonly number[], line: number, markdown: string): Splice {
  const lineCount = starts.length - 1;
  if (line >= lineCount || starts[line]! >= source.length) {
    const prefix = source.endsWith('\n') ? '' : '\n';
    return { start: source.length, end: source.length, text: `${prefix}\n${markdown}\n` };
  }
  const next = source.slice(starts[line]!, starts[line + 1]!);
  return { start: starts[line]!, end: starts[line]!, text: `\n${markdown}\n${next.trim() ? '\n' : ''}` };
}

/** Lines [start, end) as a deletion splice; the blank line after them goes too when one precedes them. */
function lineDeletion(source: string, starts: readonly number[], [first, end]: [number, number]): Splice {
  const lineCount = starts.length - 1;
  const blank = (line: number) => line >= 0 && line < lineCount && source.slice(starts[line]!, starts[line + 1]!).trim() === '';
  const stop = blank(end) && (first === 0 || blank(first - 1)) ? end + 1 : end;
  return { start: starts[first]!, end: starts[Math.min(stop, lineCount)]!, text: '' };
}

/** Markup skeleton of a source: every node's type, tag and attributes, with adjacent text merged. */
function skeleton(source: string): string {
  const walk = (node: MarkdocNode): string => {
    if (node.type === 'text' || node.type === 'softbreak') return 'T';
    // A signer's name and date are text pull edits in place; their values are not markup.
    const attributes = Object.entries(node.attributes)
      .filter(([key]) => key !== 'content')
      .map(([key, value]) => [key, node.tag === 'signer' && (key === 'name' || key === 'date') && typeof value === 'string' ? '' : value] as const)
      .sort(([x], [y]) => x.localeCompare(y));
    const children = node.children.map(walk).join(',').replace(/T(,T)+/gu, 'T');
    return `${node.type}${node.tag ? `:${node.tag}` : ''}${attributes.length ? JSON.stringify(attributes) : ''}(${children})`;
  };
  const ast = Markdoc.parse(source);
  return `${String(ast.attributes.frontmatter ?? '')}\n${walk(ast)}`;
}

function applySplices(source: string, splices: readonly Splice[]): string {
  let out = source;
  for (const splice of [...splices].sort((x, y) => y.start - x.start || y.end - x.end)) out = out.slice(0, splice.start) + splice.text + out.slice(splice.end);
  return out;
}

function expectedParagraphs(slots: Slots): string[] {
  return [...slots.before, ...slots.items.flatMap((item) => [...(item.text === null ? [] : [item.text]), ...item.after])];
}

function cloneSlots(slots: Slots): Slots {
  return { before: [...slots.before], items: slots.items.map((item) => ({ text: item.text, after: [...item.after] })) };
}

const quote = (text: string, limit = 80) => JSON.stringify(text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

/**
 * Compare an edited `create` output with the build it came from and plan
 * each change against the creation source. Every planned change is applied
 * to the source one at a time and kept only when the source still lowers
 * and reads back as the paragraphs and running text expected so far, with
 * its markup skeleton unchanged by edits inside a paragraph; a change that
 * fails is reported as a diagnostic and left out. The pulled source is then
 * built in full with `create`'s checks and read back against the edited
 * DOCX.
 *
 * Tracked changes are refused: `pull` reads neither the accepted nor the
 * rejected view, since either would write a choice the reviewer has not
 * made. Accept or reject them in Word first.
 */
export async function pullCreationEdits(input: PullInput): Promise<PullResult> {
  const { source, profile } = input;
  const built = await readPullDocx(input.base.docx);
  const edited = await readPullDocx(input.edited);
  const tracked = Object.entries(edited.trackedChanges);
  if (tracked.length > 0) {
    throw new DocxMarkdocError(
      'PULL_TRACKED_CHANGES',
      `The edited DOCX holds tracked changes (${tracked.map(([name, count]) => `${count} w:${name}`).join(', ')}). Accept or reject them in Word, save, and pull again; pull does not choose between the two views.`,
    );
  }
  if (JSON.stringify(built.paragraphs.map((paragraph) => paragraph.text)) !== JSON.stringify(input.base.readback.paragraphs)) {
    throw new Error('pull read the build differently from create\'s read-back');
  }
  const map = buildSourceMap(source, input.base.lowering.paragraphEntries, built.paragraphs);
  const starts = lineStartsOf(source);
  const diagnostics: PullDiagnostic[] = [];
  const changes: PullChange[] = [];
  const plans: Plan[] = [];
  const O = built.paragraphs;
  const E = edited.paragraphs;
  const pairing = pairParagraphs(O.map((paragraph) => paragraph.text), E.map((paragraph) => paragraph.text));
  const lineOfOffset = (offset: number) => starts.findIndex((start, index) => offset < (starts[index + 1] ?? Infinity) && offset >= start) + 1;

  // Changed paragraphs and formatting changes.
  for (const pair of pairing) {
    if (pair.o === undefined || pair.e === undefined) continue;
    const before = O[pair.o]!;
    const after = E[pair.e]!;
    const sp = map.paragraphs[pair.o]!;
    const where = `paragraph ${pair.o + 1}`;
    const notes: PullDiagnostic[] = [];
    if (before.properties !== after.properties) {
      const parts = (signature: string) => new Set(signature.split(';').filter(Boolean));
      const was = parts(before.properties);
      const now = parts(after.properties);
      const changed = [...new Set([...was, ...now])].filter((part) => !(was.has(part) && now.has(part))).map((part) => part.split(/[=(]/u)[0]);
      diagnostics.push({ code: 'PULL_PARAGRAPH_FORMATTING', message: `${where}: its paragraph formatting changed (${[...new Set(changed)].join(', ')}), which create does not express`, line: sp.line, paragraph: pair.o + 1 });
    }
    const { hunks, equal } = wordDiff(before.text, after.text);
    for (const change of formattingChanges(before, after, equal).slice(0, 5)) {
      diagnostics.push({ code: 'PULL_DIRECT_FORMATTING', message: `${where}: "${change.text.trim()}" changed from ${describeFormat(change.from)} to ${describeFormat(change.to)}, which pull does not write`, line: sp.line, paragraph: pair.o + 1 });
    }
    if (hunks.length === 0) continue;
    const edits: PullEdit[] = hunks.map((hunk) => {
      const piece = sp.pieces?.find((candidate) => candidate.raw && candidate.start <= hunk.oStart && hunk.oStart <= candidate.end);
      const line = piece?.raw ? lineOfOffset(piece.raw[Math.min(hunk.oStart - piece.start, piece.raw.length - 1)]!) : sp.line;
      return { line, deleted: before.text.slice(hunk.oStart, hunk.oEnd), inserted: after.text.slice(hunk.eStart, hunk.eEnd) };
    });
    const change: PullChange = { kind: 'changed', paragraph: pair.o + 1, line: edits[0]!.line, before: before.text, after: after.text, edits, applied: false };
    changes.push(change);
    const fail = (code: string, reason: string) => diagnostics.push({ code, message: `${where}: ${reason}; the paragraph is left as it was`, line: change.line, paragraph: change.paragraph });
    if (sp.problem || !sp.pieces) {
      fail('PULL_PARAGRAPH_NOT_MAPPED', `its source could not be mapped (${sp.problem ?? 'unknown'})`);
      continue;
    }
    if (JSON.stringify(before.fields) !== JSON.stringify(after.fields)) {
      fail('PULL_FIELD_CHANGED', `its fields changed (${before.fields.join(', ') || 'none'} to ${after.fields.join(', ') || 'none'})`);
      continue;
    }
    if (after.crossReferences.length > before.crossReferences.length) {
      fail('PULL_EDIT_IN_CROSS_REFERENCE', 'a cross-reference was added, which pull does not write');
      continue;
    }
    if (after.footnoteReferences.length !== before.footnoteReferences.length) {
      fail('PULL_FOOTNOTES_CHANGED', 'a footnote reference was added or removed, which pull does not write');
      continue;
    }
    const splices: Splice[] = [];
    let removedReferences = 0;
    let removesMarkup = false;
    let problem: PlanProblem | undefined;
    for (const hunk of hunks) {
      // A word hunk that crosses markup may still be expressible once the characters it keeps are trimmed
      // ("Plain **bold**" to "Plai**ld**" deletes from each side): plan that narrower edit when the word one fails.
      const wordNotes: PullDiagnostic[] = [];
      let planned = planHunk(source, sp, before, after, hunk, wordNotes);
      const narrow = trimHunk(before, after, hunk);
      // A word plan that removes markup is also retried narrowly: "foo{% literal %}bar" to "quxbar" edits "foo" only.
      const removes = !(planned instanceof PlanProblem) && planned.removesMarkup === true;
      if ((planned instanceof PlanProblem || wordNotes.length > 0 || removes) && narrow) {
        const narrowNotes: PullDiagnostic[] = [];
        const retry = planHunk(source, sp, before, after, narrow, narrowNotes);
        if (!(retry instanceof PlanProblem) && narrowNotes.length === 0) {
          planned = retry;
          wordNotes.length = 0;
        }
      }
      notes.push(...wordNotes);
      if (planned instanceof PlanProblem) {
        problem = planned;
        break;
      }
      splices.push(...planned.splices);
      removedReferences += planned.crossReferences;
      if (planned.removesMarkup) removesMarkup = true;
    }
    if (!problem && removedReferences !== before.crossReferences.length - after.crossReferences.length) {
      problem = new PlanProblem('PULL_EDIT_IN_CROSS_REFERENCE', 'the text of a cross-reference changed while its field stayed');
    }
    if (problem) {
      fail(problem.code, problem.reason);
      continue;
    }
    for (const note of notes) diagnostics.push({ ...note, message: `${where}: ${note.message}`, line: change.line, paragraph: pair.o + 1 });
    const index = pair.o;
    const text = after.text;
    plans.push({ changes: [change], splices, apply: (slots) => { slots.items[index]!.text = text; }, keepsSkeleton: !removesMarkup, where: { line: change.line, paragraph: index + 1 } });
  }

  // Deleted paragraphs, by block. The empty paragraph after a section-ending table goes with the table.
  const deleted = pairing.filter((pair) => pair.e === undefined).map((pair) => pair.o!);
  const deletedSet = new Set(deleted);
  const entryParagraphs = (entry: number) => map.paragraphs.filter((paragraph) => paragraph.entry === entry).map((paragraph) => paragraph.index);
  const byEntry = new Map<number, number[]>();
  for (const index of deleted) {
    let entry = map.paragraphs[index]!.entry;
    if (entry === -1 && index > 0) {
      const table = map.paragraphs[index - 1]!.entry;
      if (table !== -1 && entryParagraphs(table).every((other) => deletedSet.has(other))) entry = table;
    }
    byEntry.set(entry, [...(byEntry.get(entry) ?? []), index]);
  }
  for (const [entry, indexes] of byEntry) {
    const reports = indexes.map((index) => {
      const sp = map.paragraphs[index]!;
      const report: Extract<PullChange, { kind: 'deleted' }> = { kind: 'deleted', paragraph: index + 1, line: sp.line, endLine: sp.endLine, text: O[index]!.text, applied: false };
      return report;
    });
    changes.push(...reports);
    const unmapped = (reason: string, which = reports) => {
      for (const report of which) diagnostics.push({ code: 'PULL_UNMAPPED_DELETION', message: `paragraph ${report.paragraph}: ${reason}; it is left in the source`, line: report.line, paragraph: report.paragraph });
    };
    if (entry === -1) {
      unmapped('it is the empty paragraph generation adds after a table');
      continue;
    }
    const all = entryParagraphs(entry);
    const lines = map.entryLines[entry];
    if (all.every((index) => deletedSet.has(index)) && lines) {
      // The whole block goes, and a page break placed before it with it.
      const splices = [lineDeletion(source, starts, lines)];
      const previous = map.ast.children[entry - 1];
      if (previous?.type === 'tag' && previous.tag === 'page-break' && map.entryLines[entry - 1]) splices.push(lineDeletion(source, starts, map.entryLines[entry - 1]!));
      const removed = [...indexes];
      plans.push({ changes: reports, splices, apply: (slots) => { for (const index of removed) slots.items[index]!.text = null; }, keepsSkeleton: false, where: { line: reports[0]!.line, paragraph: indexes[0]! + 1 } });
      continue;
    }
    const coveredByParent = new Set<number>();
    for (const [k, index] of indexes.entries()) {
      const sp = map.paragraphs[index]!;
      const report = reports[k]!;
      if (coveredByParent.has(index)) continue;
      if (sp.kind === 'table-cell') {
        unmapped('a table cell cannot be deleted on its own; create a table without it', [report]);
        continue;
      }
      if (!sp.ownLines || !['list-item', 'quote', 'centered', 'legend'].includes(sp.kind)) {
        unmapped('it cannot be deleted without the rest of its block', [report]);
        continue;
      }
      let own = sp.ownLines;
      const removed = [index];
      const covered: typeof reports = [report];
      if (sp.listItem && sp.listItem.nested.length > 0) {
        if (!sp.listItem.nested.every((nested) => deletedSet.has(nested))) {
          unmapped('a list item with nested items that stay cannot be deleted on its own', [report]);
          continue;
        }
        const last = map.paragraphs[sp.listItem.nested.at(-1)!]!;
        own = [own[0], Math.max(own[1], last.ownLines?.[1] ?? last.endLine)];
        for (const nested of sp.listItem.nested) {
          coveredByParent.add(nested);
          removed.push(nested);
          const nestedReport = reports.find((candidate) => candidate.paragraph === nested + 1);
          if (nestedReport) covered.push(nestedReport);
        }
      }
      const splices = [lineDeletion(source, starts, own)];
      // The first item of an ordered list sets its start: the first item that stays takes its marker.
      const item = sp.listItem;
      if (item && /^\d+[.)]$/u.test(item.marker)) {
        const siblings = map.paragraphs.filter((other) => other.listItem?.list === item.list && other.listItem.indent === item.indent);
        if (siblings[0] === sp) {
          const heir = siblings.find((other) => !deletedSet.has(other.index));
          if (heir?.ownLines && heir.listItem!.marker !== item.marker) {
            const at = starts[heir.ownLines[0]]! + heir.listItem!.indent.length;
            splices.push({ start: at, end: at + heir.listItem!.marker.length, text: item.marker });
          }
        }
      }
      plans.push({ changes: covered, splices, apply: (slots) => { for (const r of removed) slots.items[r]!.text = null; }, keepsSkeleton: false, where: { line: report.line, paragraph: index + 1 } });
    }
  }

  // Added paragraphs, in runs: each run goes after the build paragraph before it.
  const runs: Array<{ after: number; next: number | undefined; paragraphs: number[] }> = [];
  let lastO = -1;
  for (const pair of pairing) {
    if (pair.o !== undefined) {
      lastO = pair.o;
      const open = runs.at(-1);
      if (open && open.next === undefined && open.after !== lastO) open.next = pair.o;
      continue;
    }
    const open = runs.at(-1);
    if (open && open.after === lastO && open.next === undefined) open.paragraphs.push(pair.e!);
    else runs.push({ after: lastO, next: undefined, paragraphs: [pair.e!] });
  }
  for (const run of runs) {
    // The next build paragraph that stays: the run is inserted before it.
    let next = run.next;
    while (next !== undefined && deletedSet.has(next)) next = next + 1 < O.length ? next + 1 : undefined;
    const prev = run.after >= 0 ? map.paragraphs[run.after] : undefined;
    const nextParagraph = next === undefined ? undefined : map.paragraphs[next];
    const report: PullChange = { kind: 'added', afterParagraph: run.after + 1, afterLine: prev?.endLine ?? 0, paragraphs: run.paragraphs.map((index) => E[index]!.text), applied: false };
    changes.push(report);
    const notes: PullDiagnostic[] = [];
    const fail = (code: string, reason: string) => diagnostics.push({ code, message: `paragraph added after paragraph ${run.after + 1}: ${reason}; it is not written`, line: report.afterLine || undefined });
    const blocks: AddedBlock[] = [];
    let problem: PlanProblem | undefined;
    for (const index of run.paragraphs) {
      const block = addedBlock(E[index]!, notes, `the added paragraph ${quote(E[index]!.text, 40)}`);
      if (block instanceof PlanProblem) {
        problem = block;
        break;
      }
      blocks.push(block);
    }
    if (problem) {
      fail(problem.code, problem.reason);
      continue;
    }
    if (new Set(blocks.map((block) => block.kind)).size > 1) {
      fail('PULL_UNMAPPED_INSERTION', 'the added paragraphs mix list items, quotes and other paragraphs');
      continue;
    }
    const kind = blocks[0]!.kind;
    const sameBlock = (x: SourceParagraph | undefined, y: SourceParagraph | undefined) => x !== undefined && y !== undefined && x.entry === y.entry && x.entry !== -1;
    let splice: Splice | undefined;
    if (kind === 'list' && (prev?.listItem || nextParagraph?.listItem)) {
      const context = prev?.listItem ? prev : nextParagraph!;
      const item = context.listItem!;
      let line = context === prev ? context.ownLines?.[1] : context.ownLines?.[0];
      // Directly after the item's own text, not after the blank line that ends the list.
      if (line !== undefined && context === prev) {
        while (line - 1 > context.ownLines![0] && source.slice(starts[line - 1]!, starts[line] ?? source.length).trim() === '') line -= 1;
      }
      if (line === undefined) {
        fail('PULL_UNMAPPED_INSERTION', 'the list item it follows has no source lines');
        continue;
      }
      const text = blocks.map((block) => `${item.indent}${item.marker} ${block.markdown.replaceAll('\\\n', `\\\n${item.indent}${' '.repeat(item.marker.length + 1)}`)}\n`).join('');
      splice = { start: starts[line] ?? source.length, end: starts[line] ?? source.length, text: (starts[line] ?? source.length) === source.length && !source.endsWith('\n') ? `\n${text}` : text };
    } else if (kind === 'quote' && prev?.quote && prev.ownLines) {
      const line = prev.ownLines[1];
      const text = blocks.map((block) => `>\n> ${block.markdown.replaceAll('\\\n', '\\\n> ')}\n`).join('');
      splice = { start: starts[line] ?? source.length, end: starts[line] ?? source.length, text };
    } else {
      if (kind === 'list') notes.push({ code: 'PULL_ADDED_PARAGRAPH_STYLE', message: 'a numbered paragraph outside a list is written as a body paragraph' });
      if (sameBlock(prev, nextParagraph)) {
        fail('PULL_UNMAPPED_INSERTION', `it sits inside a ${prev!.kind === 'table-cell' ? 'table' : prev!.kind === 'list-item' ? 'list' : 'block'} that it would split`);
        continue;
      }
      const markdown = blocks.map((block) => (block.kind === 'quote' ? `> ${block.markdown.replaceAll('\\\n', '\\\n> ')}` : block.markdown)).join('\n\n');
      // After the block holding the previous paragraph (a generated paragraph belongs to the table before it).
      let anchor = run.after;
      while (anchor >= 0 && map.paragraphs[anchor]!.entry === -1) anchor -= 1;
      if (anchor >= 0) {
        const end = entryEnd(map, map.paragraphs[anchor]!.entry);
        if (end === undefined) {
          fail('PULL_UNMAPPED_INSERTION', 'the block it follows has no source lines');
          continue;
        }
        splice = blockInsertion(source, starts, end, markdown);
      } else {
        const first = map.paragraphs.find((paragraph) => paragraph.entry !== -1);
        const line = first ? map.entryLines[first.entry]?.[0] : undefined;
        const offset = line === undefined ? source.length : starts[line]!;
        splice = { start: offset, end: offset, text: `${markdown}\n\n` };
      }
    }
    for (const note of notes) diagnostics.push({ ...note, message: `paragraph added after paragraph ${run.after + 1}: ${note.message}`, line: report.afterLine || undefined });
    const texts = run.paragraphs.map((index) => E[index]!.text);
    const after = run.after;
    plans.push({ changes: [report], splices: [splice], apply: (slots) => { (after < 0 ? slots.before : slots.items[after]!.after).push(...texts); }, keepsSkeleton: false, where: { line: report.afterLine } });
  }

  // An insertion where a deleted block was goes where the block started, so the deletion cannot swallow it.
  const deletions = plans.flatMap((plan) => plan.splices).filter((splice) => splice.start < splice.end && splice.text === '');
  for (const plan of plans) {
    for (const splice of plan.splices) {
      if (splice.start !== splice.end) continue;
      const covering = deletions.find((deletion) => deletion.start < splice.start && splice.start < deletion.end);
      if (covering) splice.start = splice.end = covering.start;
    }
  }

  // Document-level content create cannot express.
  if (edited.comments > built.comments) diagnostics.push({ code: 'PULL_COMMENTS', message: `the edited DOCX has ${edited.comments - built.comments} comment mark(s) or comment(s); creation Markdoc has no comments, so they are not carried` });
  for (const [element, count] of Object.entries(edited.unsupported)) {
    const was = built.unsupported[element] ?? 0;
    if (count > was) diagnostics.push({ code: 'PULL_UNSUPPORTED_CONTENT', message: `the edited DOCX has ${count - was} w:${element} element(s) create does not write; their content is not carried` });
  }
  if (edited.evenPageStories !== built.evenPageStories || edited.evenAndOddHeaders !== built.evenAndOddHeaders) {
    diagnostics.push({ code: 'PULL_HEADER_UNMAPPED', message: `the edited DOCX has ${edited.evenPageStories} even-page header or footer reference(s)${edited.evenAndOddHeaders ? ' and different odd and even pages' : ''}; create writes no even-page running text, so they are not carried` });
  }
  if (edited.settings !== built.settings) {
    diagnostics.push({ code: 'PULL_DOCUMENT_SETTINGS', message: `the document's layout settings changed (${built.settings || 'defaults'} to ${edited.settings || 'defaults'}); create does not write them, so they are not carried` });
  }
  if (edited.properties !== built.properties) {
    diagnostics.push({ code: 'PULL_DOCUMENT_PROPERTIES', message: `the document properties changed (${built.properties} to ${edited.properties}); create writes the title and author from the frontmatter, so edit them there` });
  }
  if (edited.pageSetup.length !== built.pageSetup.length) {
    diagnostics.push({ code: 'PULL_SECTION_STRUCTURE', message: `the edited DOCX has ${edited.pageSetup.length} section(s), the build ${built.pageSetup.length}; pull does not add or remove {% section %} tags` });
  }
  edited.pageSetup.forEach((setup, section) => {
    const was = built.pageSetup[section];
    if (was !== undefined && was !== setup) diagnostics.push({ code: 'PULL_PAGE_SETUP', message: `section ${section + 1}: its page setup changed (${was} to ${setup}); create sets page size and margins from the style profile`, section: section + 1 });
  });
  for (const [style, signature] of Object.entries(built.styles)) {
    const now = edited.styles[style];
    if (now === undefined) diagnostics.push({ code: 'PULL_STYLE_CHANGED', message: `style ${style} was deleted; create sets its styles from the style profile, so a rebuild would restore it` });
    else if (now !== signature) diagnostics.push({ code: 'PULL_STYLE_CHANGED', message: `style ${style} changed (${signature} to ${now}); create sets its styles from the style profile` });
  }
  if (JSON.stringify(edited.footnotes) !== JSON.stringify(built.footnotes)) {
    diagnostics.push({ code: 'PULL_FOOTNOTES_CHANGED', message: 'the footnotes changed (their text, formatting or number); pull does not write footnote edits, so they are not carried' });
  }

  // Apply and verify each body plan, last in the source first.
  let current = source;
  let slots: Slots = { before: [], items: O.map((paragraph) => ({ text: paragraph.text, after: [] })) };
  const builtStories = docStories(built);
  const editedStories = docStories(edited);
  const projectedNow = (text: string): { projection: CreationProjection } | { error: string } => {
    try {
      return { projection: lowerCreationMarkdoc(text, profile).projection };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
  let storiesExpected = projectedStories(input.base.lowering.projection);
  const verify = (candidate: string, expected: Slots, stories: VisibleStories, plan?: Plan): string | undefined => {
    const lowered = projectedNow(candidate);
    if ('error' in lowered) return `the source would no longer build (${lowered.error})`;
    const want = expectedParagraphs(expected);
    const got = lowered.projection.paragraphs;
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      const index = want.findIndex((text, k) => text !== got[k]);
      const at = index === -1 ? want.length : index;
      return `the source would read back ${quote(got[at] ?? '(nothing)')} where ${quote(want[at] ?? '(nothing)')} is expected`;
    }
    if (JSON.stringify(projectedStories(lowered.projection)) !== JSON.stringify(stories)) return 'the running text would change';
    if (plan?.keepsSkeleton && skeleton(candidate) !== skeleton(current)) return 'the edit would change the markup around it';
    return undefined;
  };
  for (const plan of [...plans].sort((x, y) => Math.max(...y.splices.map((s) => s.start)) - Math.max(...x.splices.map((s) => s.start)))) {
    const candidate = applySplices(current, plan.splices);
    const expected = cloneSlots(slots);
    plan.apply(expected);
    const problem = verify(candidate, expected, storiesExpected, plan);
    if (problem) {
      diagnostics.push({ code: 'PULL_EDIT_NOT_VERIFIED', message: `${plan.where.paragraph ? `paragraph ${plan.where.paragraph}` : 'an added paragraph'}: ${problem}; the change is not written`, line: plan.where.line || undefined, ...(plan.where.paragraph ? { paragraph: plan.where.paragraph } : {}) });
      continue;
    }
    current = candidate;
    slots = expected;
    for (const change of plan.changes) change.applied = true;
  }

  // Running text: each section whose visible header or footer changed, first to last.
  const sectionCount = Math.max(builtStories.length, editedStories.length);
  const sectionTags = map.ast.children.map((node, index) => ({ node, index })).filter(({ node }) => node.type === 'tag' && node.tag === 'section');
  for (let section = 0; section < sectionCount; section += 1) {
    const was = builtStories[section];
    const now = editedStories[section];
    if (!was || !now) continue;
    // First-page slots are reported only where a first page has its own (w:titlePg) on either side.
    const firstPages = built.firstPage[section] != null || edited.firstPage[section] != null;
    const slotsChanged = SLOTS.filter((slot) => !sameStory(was[slot], now[slot]) && (firstPages || !slot.startsWith('first-page')));
    if (slotsChanged.length === 0) continue;
    const tag = section === 0 ? undefined : sectionTags[section - 1];
    const line = section === 0 ? 1 : (tag?.node.lines[0] ?? 0) + 1;
    const reports = slotsChanged.map((slot): PullChange => ({ kind: 'running-text', section: section + 1, slot, line, before: textsOf(was[slot]), after: textsOf(now[slot]), applied: false }));
    changes.push(...reports);
    // A rebuild that already shows the edited running text (an inheriting section after an earlier one changed) needs nothing.
    const already = projectedNow(current);
    const currentStories = 'projection' in already ? projectedStories(already.projection) : undefined;
    const editedTexts = Object.fromEntries(SLOTS.map((slot) => [slot, textsOf(now[slot])])) as Record<RunningSlot, string[]>;
    const formatsMatch = SLOTS.every((slot) => JSON.stringify(was[slot].map((l) => l.signature)) === JSON.stringify(now[slot].map((l) => l.signature)));
    // A section that declares no running text of its own inherits it, formatting included; the final rebuild comparison checks that.
    const ownStory = (slot: RunningSlot) => (slot === 'header' ? edited.headers[section] : slot === 'footer' ? edited.footers[section] : edited.firstPage[section]?.[slot === 'first-page header' ? 'header' : 'footer'] ?? null);
    const inherits = slotsChanged.every((slot) => ownStory(slot) === null);
    if (currentStories && JSON.stringify(currentStories[section]) === JSON.stringify(editedTexts) && (formatsMatch || inherits) && section > 0) {
      storiesExpected = currentStories;
      for (const report of reports) report.applied = true;
      continue;
    }
    const failed = (reason: string) => diagnostics.push({ code: slotsChanged.some((slot) => slot.includes('header')) ? 'PULL_HEADER_UNMAPPED' : 'PULL_FOOTER_UNMAPPED', message: `section ${section + 1}: the ${slotsChanged.join(' and ')} changed, but ${reason}; it is not written`, line, section: section + 1 });
    const { keys, problems } = inferRunningKeys(edited, section);
    if (problems.length > 0) {
      failed(problems.join('; '));
      continue;
    }
    let splice: Splice;
    if (section === 0) splice = frontmatterSplice(current, keys);
    else {
      if (!tag) {
        failed('the source has no {% section %} tag for it');
        continue;
      }
      // Re-find the tag in the current source: earlier splices moved it.
      const currentAst = Markdoc.parse(current);
      const currentTag = currentAst.children.filter((node) => node.type === 'tag' && node.tag === 'section')[section - 1];
      const currentStarts = lineStartsOf(current);
      const lines = currentTag?.lines ?? [];
      if (!currentTag || lines.length === 0) {
        failed('its {% section %} tag could not be found');
        continue;
      }
      const attributes = Object.entries(keys).map(([key, value]) => sectionAttribute(key, value!));
      const first = Math.min(...lines);
      const last = Math.max(...lines);
      splice = { start: currentStarts[first]!, end: currentStarts[last] ?? current.length, text: `{% section${attributes.length ? ` ${attributes.join(' ')}` : ''} /%}\n` };
    }
    const candidate = applySplices(current, [splice]);
    const lowered = projectedNow(candidate);
    if ('error' in lowered) {
      failed(`the keys it needs do not build (${lowered.error})`);
      continue;
    }
    const nextStories = projectedStories(lowered.projection);
    if (JSON.stringify(nextStories[section]) !== JSON.stringify(editedTexts) || JSON.stringify(lowered.projection.paragraphs) !== JSON.stringify(expectedParagraphs(slots))) {
      failed('the keys that express it do not reproduce it');
      continue;
    }
    current = candidate;
    storiesExpected = nextStories;
    for (const report of reports) report.applied = true;
  }

  /**
   * What the paragraph texts, formats and running text do not show: list
   * labels and table structure, compared once the texts agree. With nothing
   * applied the build stands for the rebuild, so a numbering or table edit
   * alone is still reported.
   */
  const structureDiagnostics = (rebuiltDoc: PullDocx): PullDiagnostic[] => {
    const out: PullDiagnostic[] = [];
    const index = E.findIndex((paragraph, k) => paragraph.label !== rebuiltDoc.paragraphs[k]?.label);
    if (index !== -1) {
      const label = (value: string | undefined) => quote((value ?? '').split('|')[0] || '(none)');
      out.push({ code: 'PULL_NUMBERING_CHANGED', message: `paragraph ${index + 1} is numbered ${label(E[index]!.label)} in the edited DOCX and ${label(rebuiltDoc.paragraphs[index]?.label)} in the rebuild; pull does not write list numbering (start values, restarts, formats), so it is not carried` });
    }
    // A footnote mark moved or reformatted, or a bookmark moved, within text that reads the same: the texts and the
    // notes do not show it.
    const marked = E.findIndex((paragraph, k) => JSON.stringify(paragraph.footnoteReferences) !== JSON.stringify(rebuiltDoc.paragraphs[k]?.footnoteReferences ?? []));
    if (marked !== -1) {
      out.push({ code: 'PULL_FOOTNOTES_CHANGED', message: `paragraph ${marked + 1}'s footnote marks read at offsets ${JSON.stringify(E[marked]!.footnoteReferences)} in the edited DOCX and ${JSON.stringify(rebuiltDoc.paragraphs[marked]?.footnoteReferences ?? [])} in the rebuild; pull does not move a footnote mark, so it is not carried` });
    }
    const markFormatted = E.findIndex((paragraph, k) => JSON.stringify(paragraph.footnoteMarks) !== JSON.stringify(rebuiltDoc.paragraphs[k]?.footnoteMarks ?? []));
    if (markFormatted !== -1) {
      out.push({ code: 'PULL_FOOTNOTES_CHANGED', message: `paragraph ${markFormatted + 1}'s footnote mark is formatted ${E[markFormatted]!.footnoteMarks.map((format) => describeFormat(format)).join('; ') || '(none)'} in the edited DOCX and ${(rebuiltDoc.paragraphs[markFormatted]?.footnoteMarks ?? []).map((format) => describeFormat(format)).join('; ') || '(none)'} in the rebuild; pull does not write a footnote mark's formatting, so it is not carried` });
    }
    // Where a bookmark ends is compared only for one a cross-reference shows, as Word may leave text typed at a
    // heading's end outside its bookmark; there the range is what an updated cross-reference displays.
    const targets = new Set([...edited.referenceTargets, ...rebuiltDoc.referenceTargets]);
    const shownRanges = (paragraph: PullParagraph | undefined) => (paragraph?.bookmarkRanges ?? []).filter((range) => targets.has(range.slice(0, range.indexOf('@'))));
    const anchored = E.findIndex((paragraph, k) => JSON.stringify(paragraph.bookmarks) !== JSON.stringify(rebuiltDoc.paragraphs[k]?.bookmarks ?? []));
    // A moved bookmark is reported once, by where it starts.
    const ranged = anchored !== -1 ? -1 : E.findIndex((paragraph, k) => JSON.stringify(shownRanges(paragraph)) !== JSON.stringify(shownRanges(rebuiltDoc.paragraphs[k])));
    if (ranged !== -1) {
      out.push({ code: 'PULL_BOOKMARKS_CHANGED', message: `paragraph ${ranged + 1}'s cross-referenced bookmarks cover ${shownRanges(E[ranged]).map((range) => quote(range)).join(', ') || '(none)'} in the edited DOCX and ${shownRanges(rebuiltDoc.paragraphs[ranged]).map((range) => quote(range)).join(', ') || '(none)'} in the rebuild; pull does not change what an anchor covers, so it is not carried` });
    }
    if (anchored !== -1) {
      const shown = (paragraph: PullParagraph | undefined) => (paragraph?.bookmarks ?? []).map((bookmark) => quote(bookmark)).join(', ') || '(none)';
      out.push({ code: 'PULL_BOOKMARKS_CHANGED', message: `paragraph ${anchored + 1}'s bookmarks are ${shown(E[anchored])} in the edited DOCX and ${shown(rebuiltDoc.paragraphs[anchored])} in the rebuild; pull does not add, remove or move a bookmark (an anchor such as \`{% #target %}\`), so the change is not carried` });
    }
    // Another field given a switch, or moved within text that reads the same, reads the same.
    const switched = E.findIndex((paragraph, k) => JSON.stringify(paragraph.fieldPositions) !== JSON.stringify(rebuiltDoc.paragraphs[k]?.fieldPositions ?? []));
    if (switched !== -1) {
      const shown = (paragraph: PullParagraph | undefined) => (paragraph?.fieldInstructions ?? []).map((instruction) => quote(instruction)).join(', ') || '(none)';
      out.push({ code: 'PULL_FIELD_CHANGED', message: `paragraph ${switched + 1}'s fields are ${shown(E[switched])} in the edited DOCX and ${shown(rebuiltDoc.paragraphs[switched])} in the rebuild; pull does not write field instructions, so the change is not carried` });
    }
    // A cross-reference retargeted or given other switches keeps its text, so the texts do not show it.
    // So does one moved between two places with the same text: each is compared with where it reads.
    const instructions = (paragraph: PullParagraph | undefined) => (paragraph?.crossReferences ?? []).map((reference) => reference.instruction);
    const placed = (paragraph: PullParagraph | undefined) => (paragraph?.crossReferences ?? []).map((reference) => `${reference.offset}:${reference.instruction}`);
    const retargeted = E.findIndex((paragraph, k) => JSON.stringify(placed(paragraph)) !== JSON.stringify(placed(rebuiltDoc.paragraphs[k])));
    if (retargeted !== -1) {
      const shown = (paragraph: PullParagraph | undefined) => instructions(paragraph).map(quote).join(', ') || '(none)';
      const moved = JSON.stringify(instructions(E[retargeted])) === JSON.stringify(instructions(rebuiltDoc.paragraphs[retargeted]));
      out.push({ code: 'PULL_EDIT_IN_CROSS_REFERENCE', message: moved
        ? `paragraph ${retargeted + 1}'s cross-reference reads at another place in the edited DOCX than in the rebuild, within text that reads the same; pull does not move a cross-reference, so it is not carried`
        : `paragraph ${retargeted + 1}'s cross-reference fields are ${shown(E[retargeted])} in the edited DOCX and ${shown(rebuiltDoc.paragraphs[retargeted])} in the rebuild; pull does not retarget a cross-reference or change its switches, so it is not carried` });
    }
    if (JSON.stringify(edited.tables) !== JSON.stringify(rebuiltDoc.tables)) {
      const table = Math.max(0, edited.tables.findIndex((signature, k) => signature !== rebuiltDoc.tables[k]));
      const count = edited.tables.length === rebuiltDoc.tables.length ? '' : ` (${edited.tables.length} table(s) in the edited DOCX, ${rebuiltDoc.tables.length} in the rebuild)`;
      out.push({ code: 'PULL_TABLE_STRUCTURE', message: `table ${table + 1}'s structure or layout differs between the edited DOCX and the rebuild${count}: merged or split cells, rows, column widths, borders or shading; pull does not write table layout, so it is not carried` });
    }
    return out;
  };

  const appliedAny = changes.some((change) => change.applied);
  if (!appliedAny) {
    if (changes.length === 0) diagnostics.push(...structureDiagnostics(built));
    return { changes, diagnostics, complete: changes.length === 0 && diagnostics.length === 0 };
  }

  // The pulled source must build with every create check, and read back as the edited DOCX.
  let rebuilt: CreatedDocument;
  try {
    rebuilt = await createDocumentFromMarkdoc(current, profile === undefined ? {} : { profile });
  } catch (error) {
    throw new DocxMarkdocError('PULL_REBUILD_FAILED', `The pulled source does not pass create's checks: ${error instanceof Error ? error.message : String(error)}`, error instanceof DocxMarkdocError ? error.details : undefined);
  }
  const rebuiltDoc = await readPullDocx(rebuilt.docx);
  const allApplied = changes.every((change) => change.applied);
  let differs: string | undefined;
  const rebuiltTexts = rebuiltDoc.paragraphs.map((paragraph) => paragraph.text);
  const editedTexts = E.map((paragraph) => paragraph.text);
  if (JSON.stringify(rebuiltTexts) !== JSON.stringify(editedTexts)) {
    const index = editedTexts.findIndex((text, k) => text !== rebuiltTexts[k]);
    differs = `paragraph ${index + 1} reads ${quote(rebuiltTexts[index] ?? '(nothing)')} in the rebuild and ${quote(editedTexts[index] ?? '(nothing)')} in the edited DOCX`;
  } else {
    const index = E.findIndex((paragraph, k) => JSON.stringify(paragraph.formats) !== JSON.stringify(rebuiltDoc.paragraphs[k]!.formats));
    if (index !== -1) differs = `paragraph ${index + 1}'s run formatting differs between the rebuild and the edited DOCX`;
    else if (JSON.stringify(docStories(rebuiltDoc)) !== JSON.stringify(editedStories)) differs = 'the visible header or footer differs between the rebuild and the edited DOCX';
  }
  if (!differs) diagnostics.push(...structureDiagnostics(rebuiltDoc));
  if (differs && allApplied && diagnostics.length === 0) diagnostics.push({ code: 'PULL_REBUILD_DIFFERS', message: `${differs}; create --replace will not accept the rebuild over the edited DOCX` });
  return { changes, diagnostics, pulledSource: current, complete: allApplied && diagnostics.length === 0 && differs === undefined };
}

export { pairParagraphs, wordDiff };
