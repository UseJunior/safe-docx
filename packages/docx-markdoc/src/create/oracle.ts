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
 * - a footer page number is a PAGE field, and pages number continuously from 1;
 *   `page-number-format: dashed` shows it as `- 1 -` and `page-of-total` as
 *   `Page 1 of 3`, the total a NUMPAGES field; `footer-layout: one-line`
 *   puts the footer text, a tab and the number in one paragraph;
 * - a header is one paragraph of its text; a section that declares no header
 *   or footer inherits the previous one, first-page variants included; with
 *   `header-first` or `footer-first` in effect, a section's first page shows
 *   the variant (its text, or nothing for `none`; a footer variant keeps the
 *   page number) where there is one, and the section's own header or footer
 *   where there is not;
 * - a `{% fnref /%}` adds no text to its paragraph; its `{% footnote %}` body
 *   becomes a note numbered 1, 2, 3, … in the order of the references, and
 *   the body blocks themselves are not body paragraphs;
 * - a `{% xref to="id" /%}` shows the list number of the item marked
 *   `{% #id %}` as Word shows a REF field with `\w` (full context): the
 *   numbers of the item and its ancestors joined, with the period of `1.`
 *   dropped (`2`, `2(b)`, `2(b)(ii)`); `number="paragraph"` shows the item's
 *   own number (`\n`: `2`, `(b)`, `(ii)`); `format="section"` puts
 *   `Section ` before it; `number="relative"` shows the full number less
 *   the leading levels the target shares with where the xref sits (Word's
 *   `\r`): its position is the last numbered paragraph of the target's own
 *   list at or before the xref's paragraph, the target's own number is
 *   always kept, and in a footnote the number is shown in full (`(b)` from
 *   inside `2(a)`, `(ii)` from `2(b)(i)` or from the target itself, `2(b)`
 *   from `3(a)` or after a restarted list). An ordered list continues the
 *   ordered list before it as one Word list when its first marker is that
 *   list's next number; under numbered headings the headings and their
 *   clauses are one list;
 * - a `{% xref to="id" show="text" /%}` shows the text of the heading or
 *   list item marked `{% #id %}` (a REF field with no number switch): its
 *   inline text as this walker reads it, a fill in its brackets, without its
 *   number, without its footnote reference marks, and without the
 *   whitespace the `{% #id %}` annotation leaves at its end;
 * - with frontmatter `heading-numbers: legal`, each `##` heading is labelled
 *   `ARTICLE I`, `ARTICLE II`, … and each `###` `Section <article>.<nn>`
 *   (`Section 2.04`), restarting under each Article; an ordered list under
 *   a numbered heading numbers `(a)`, `(i)`, `(A)` by depth, its markers
 *   counted from 1 under each heading; an xref to a numbered heading shows
 *   its label in both forms, and to such a clause its label after the
 *   Section it is in (`Section 2.04(b)(i)`), or after the Article when no
 *   Section of that Article precedes it (`ARTICLE II(a)`);
 * - each paragraph of a `{% paragraph-layout %}` is a body paragraph carrying, in its own
 *   `w:pPr`, the tag's alignment as `w:jc` (`justify` is `both`) and its
 *   indents as `w:ind` in twips (1440 to the inch): `indent-left` as
 *   `w:left`, `indent-hanging` as `w:hanging` (see {@link SourceBodyEntry.layout});
 *   no other body paragraph sets either directly.
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
/** Marker for a footer NUMPAGES field (the page count) in the expected projection; any decimal number satisfies it. */
export const PAGE_COUNT_FIELD = '\u0000NUMPAGES';
/** Every field marker in an expected header or footer line. */
const FIELD_MARKERS = /\u0000(?:PAGE|NUMPAGES)(?![A-Z])/gu;
const hasFieldMarker = (text: string) => /\u0000(?:PAGE|NUMPAGES)(?![A-Z])/u.test(text);

/**
 * The page number a `page-number-format` shows, written with field markers.
 * Contract constants, duplicated on purpose from the lowering.
 */
const PAGE_NUMBER_TEXT: Record<string, string> = {
  plain: PAGE_NUMBER_FIELD,
  dashed: `- ${PAGE_NUMBER_FIELD} -`,
  'page-of-total': `Page ${PAGE_NUMBER_FIELD} of ${PAGE_COUNT_FIELD}`,
};

export type SourceBodyEntry = {
  text: string;
  /** 1-based source line. */
  line?: number;
  cell?: true;
  /** Section index (0-based); a `{% section %}` tag starts the next one. */
  section?: number;
  /** The generated label shown before this paragraph (`1.`, `(a)`, `(i)`, `•`, `ARTICLE II`, `Section 2.04`, …). */
  marker?: string;
  /** Table membership: which table (0-based, in order) and which row (0 = the repeating header row). */
  table?: { id: number; row: number };
  /** Offsets in `text` of the footnote references in this paragraph, in order. */
  footnoteMarks?: number[];
  /**
   * For a paragraph of a `{% paragraph-layout %}`: its direct `w:jc` and `w:ind` as one
   * token, `jc=<val>` then `ind.left=<twips>` and `ind.hanging=<twips>`
   * (`jc=left ind.left=720 ind.hanging=720`), in the form the read-back
   * writes. Absent on every other paragraph.
   */
  layout?: string;
};

/** `w:jc` values of the `{% paragraph-layout align %}` words, duplicated on purpose from the lowering. */
const LAYOUT_JC: Readonly<Record<string, string>> = { left: 'left', center: 'center', right: 'right', justify: 'both' };

/** A `{% paragraph-layout %}` attribute's text: a number (`indent-left=0.5`) reads as its decimal text. */
function layoutWord(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value : undefined;
}

/** The layout token a `{% paragraph-layout %}` tag's attributes call for, read straight from the source. */
function sourceParagraphLayout(node: MarkdocNode): string {
  const parts: string[] = [];
  const align = layoutWord(node.attributes.align);
  if (align !== undefined) parts.push(`jc=${LAYOUT_JC[align] ?? align}`);
  const twips = (key: string) => {
    const inches = layoutWord(node.attributes[key]);
    return inches === undefined ? undefined : Math.round(Number(inches) * 1440);
  };
  const left = twips('indent-left');
  const hanging = twips('indent-hanging');
  if (left !== undefined) parts.push(`ind.left=${left}`);
  if (hanging !== undefined) parts.push(`ind.hanging=${hanging}`);
  return parts.join(' ');
}

/** A footnote as written in the source: its id and its paragraphs' text. */
export type SourceFootnote = { id: string; paragraphs: string[] };

export type SourceProjection = {
  /** Body paragraphs in reading order, with the source line they came from; table cells are marked. */
  body: SourceBodyEntry[];
  /** Per section: the declared footer paragraphs, or null when the section declares none (it then inherits). */
  footers: Array<string[] | null>;
  /** Per section: the declared header paragraphs, or null when the section declares none (it then inherits). Absent means none anywhere. */
  headers?: Array<string[] | null>;
  /**
   * Per section: null when its first page shows its header and footer; with
   * `header-first` or `footer-first` in effect, its first page's header and
   * footer (null when the section has none). Absent when no section has one.
   */
  firstPage?: Array<{ header: string[] | null; footer: string[] | null } | null>;
  /** Footnotes in the order of their references in `body`; the note numbered n is entry n - 1. */
  footnotes?: SourceFootnote[];
  /**
   * Every `{% xref /%}` as written and where its number sits: body
   * references in reading order, then those in footnotes, note by note in
   * the order of the notes. Absent when the source has none.
   */
  crossReferences?: SourceCrossReference[];
  /** The text of each list item or heading marked `{% #id %}`, by id: what its bookmark must hold. */
  crossReferenceTargets?: Record<string, string>;
  /**
   * Every `{% xref /%}` tag in the source, found by walking the whole syntax
   * tree rather than the text walker, as `to|full`, `to|paragraph`, `to|relative` or `to|text`, sorted. A tag the text
   * walker never reaches is missing from `crossReferences` but not from here.
   */
  crossReferenceInventory?: string[];
  /**
   * Every `{% fnref /%}` tag in the source, found by walking the whole syntax tree rather than the text walker,
   * as its id, sorted. A reference the text walker never reaches is missing from `footnotes` but not from here.
   * Absent when the source has none.
   */
  footnoteReferenceInventory?: string[];
}

/** What an `{% xref /%}` tag shows, as one word: its number in full, its paragraph number, its relative number, or its target's text. */
export type CrossReferenceForm = 'full' | 'paragraph' | 'relative' | 'text';

/** The number forms of a number reference. */
type NumberForm = 'full' | 'paragraph' | 'relative';

function xrefForm(node: MarkdocNode): CrossReferenceForm {
  if (node.attributes.show === 'text') return 'text';
  return node.attributes.number === 'paragraph' || node.attributes.number === 'relative' ? node.attributes.number : 'full';
}

/** The form of a cross-reference as written in the source. */
export function sourceCrossReferenceForm(xref: Pick<SourceCrossReference, 'show' | 'number'>): CrossReferenceForm {
  return xref.show === 'text' ? 'text' : xref.number;
}

/** Every `{% xref /%}` tag under `node`, as `to|form`. */
function xrefInventory(node: MarkdocNode): string[] {
  const own = node.type === 'tag' && node.tag === 'xref' ? [`${String(node.attributes.to)}|${xrefForm(node)}`] : [];
  return [...own, ...node.children.flatMap(xrefInventory)];
}

/** Every `{% fnref /%}` tag under `node`, as its id. */
function fnrefInventory(node: MarkdocNode): string[] {
  const own = node.type === 'tag' && node.tag === 'fnref' ? [String(node.attributes.id)] : [];
  return [...own, ...node.children.flatMap(fnrefInventory)];
}

/**
 * A cross-reference as written in the source, and where what it shows sits:
 * in `body[entry].text`, or in paragraph `paragraph` of the note numbered
 * `note`, at `offset`, `length` characters long. `show` is what it shows;
 * `number` is the number form, and stays `'full'` for a text reference.
 * `shown` is the text it shows; a relative reference also carries its
 * target's full number (`fullNumber`), which it shows only where it shares
 * no level with its target.
 */
export type SourceCrossReference = { to: string; show: 'number' | 'text'; number: NumberForm; offset: number; length: number; shown: string; fullNumber?: string } & (
  | { story: 'body'; entry: number }
  | { story: 'footnote'; note: number; paragraph: number }
);

/** Stands in for an `{% xref /%}`'s result inside walker text until it is scanned: target, form, then what it shows. */
const XREF_OPEN = '\u0004';
const XREF_NUMBER = '\u0005';
const XREF_CLOSE = '\u0006';

type ScannedText = {
  text: string;
  footnotes: Array<{ offset: number; id: string }>;
  xrefs: Array<{ to: string; show: 'number' | 'text'; number: NumberForm; offset: number; length: number; shown: string; fullNumber?: string }>;
};

/** Remove the footnote and cross-reference stand-ins from walker text, recording where each sat. */
function scanMarks(raw: string): ScannedText {
  const out: ScannedText = { text: '', footnotes: [], xrefs: [] };
  for (let at = 0; at < raw.length;) {
    const char = raw[at]!;
    // Creation refuses sources holding these control characters, so a stand-in is always complete; an
    // unterminated one is kept as text rather than scanned, so the cursor always advances.
    const referenceClose = char === REFERENCE_OPEN ? raw.indexOf(REFERENCE_CLOSE, at) : -1;
    const middle = char === XREF_OPEN ? raw.indexOf(XREF_NUMBER, at) : -1;
    const xrefClose = middle === -1 ? -1 : raw.indexOf(XREF_CLOSE, middle);
    if (referenceClose !== -1) {
      const close = referenceClose;
      out.footnotes.push({ offset: out.text.length, id: raw.slice(at + 1, close) });
      at = close + 1;
    } else if (xrefClose !== -1) {
      const close = xrefClose;
      const [to = '', form = 'full', fullNumber] = raw.slice(at + 1, middle).split('|');
      const shown = raw.slice(middle + 1, close);
      out.xrefs.push({
        to,
        show: form === 'text' ? 'text' : 'number',
        number: form === 'paragraph' || form === 'relative' ? form : 'full',
        offset: out.text.length,
        length: shown.length,
        shown,
        ...(form === 'relative' ? { fullNumber: fullNumber ?? '' } : {}),
      });
      out.text += shown;
      at = close + 1;
    } else {
      out.text += char;
      at += 1;
    }
  }
  return out;
}

/** Stands in for a `{% fnref /%}` inside walker text until `push` turns it into an offset. */
const REFERENCE_OPEN = '\u0002';
const REFERENCE_CLOSE = '\u0003';

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

/** The label of clause `n` at `depth` of an ordered list under a numbered heading: `(a)`, `(i)`, `(A)`. */
export function clauseMarker(depth: number, n: number): string {
  if (depth === 0) return `(${letters(n)})`;
  return depth === 1 ? `(${roman(n)})` : `(${letters(n).toUpperCase()})`;
}

/**
 * The labels `heading-numbers: legal` gives, read from the source alone:
 * each `##` and `###` heading node's label, and for each ordered list under
 * a numbered heading the heading label its clauses' full numbers start with
 * (the Section, or the Article when no Section of it precedes the list).
 * Empty without heading numbering.
 */
/**
 * Where a numbered heading or a clause list under one sits: its label, the
 * level that label stands for (0 for an Article, 1 for a Section), and the
 * Article and Section numbers (the Section is NaN directly under an Article).
 */
type HeadingPlace = { label: string; level: number; values: number[] };

function headingLabels(ast: MarkdocNode): { headings: Map<MarkdocNode, HeadingPlace>; clauseContext: Map<MarkdocNode, HeadingPlace> } {
  const headings = new Map<MarkdocNode, HeadingPlace>();
  const clauseContext = new Map<MarkdocNode, HeadingPlace>();
  if (parseCreationFrontmatter(ast.attributes.frontmatter as string | undefined).headingNumbers !== 'legal') return { headings, clauseContext };
  let article = 0;
  let section = 0;
  let context: HeadingPlace | null = null;
  for (const node of ast.children) {
    if (node.type === 'heading' && node.attributes.level === 2) {
      article += 1;
      section = 0;
      context = { label: `ARTICLE ${roman(article).toUpperCase()}`, level: 0, values: [article] };
      headings.set(node, context);
    } else if (node.type === 'heading' && node.attributes.level === 3) {
      section += 1;
      context = { label: `Section ${article}.${String(section).padStart(2, '0')}`, level: 1, values: [article, section] };
      headings.set(node, context);
    } else if (node.type === 'list' && node.attributes.ordered === true && context !== null) {
      clauseContext.set(node, context);
    }
  }
  return { headings, clauseContext };
}

function lineOf(node: MarkdocNode): number | undefined {
  const start = node.lines?.[0];
  return start === undefined ? undefined : start + 1;
}

/**
 * A numbered paragraph's place in its Word list: the list (`headings`, or
 * `list <n>` for the n-th chain of continuing ordered lists) and the value
 * of each level from 0 through its own.
 */
type ListPlace = { list: string; values: number[] };

/**
 * What a cross-reference to each `{% #id %}` target shows: its number in
 * each form when it has one, and its text. A numbered target also has its
 * place and the parts of its full number, each with the level it stands for
 * ("Section 2.03" for level 1, "(b)" for 2), so a relative number can drop
 * the leading ones.
 */
type CrossReferenceText = { full?: string; paragraph?: string; text: string; place?: ListPlace; parts?: Array<{ level: number; text: string }>; plainList?: boolean };
type CrossReferenceTexts = ReadonlyMap<string, CrossReferenceText>;

/**
 * Where the walker is: the place of each Word list's last numbered
 * paragraph so far (the current paragraph included), and whether it is in
 * a footnote, where a relative number shows in full.
 */
type WalkPosition = { lists: Map<string, number[]>; footnote: boolean };

/** Join the parts of a number as `reader` shows it: LibreOffice keeps the period of `1.` before `(`. */
function joinParts(parts: ReadonlyArray<{ level: number; text: string }>, reader: ProjectionReader, plainList: boolean): string {
  return parts.map((part, index) => (reader === 'libreoffice' && plainList && part.level === 0 && index < parts.length - 1 ? `${part.text}.` : part.text)).join('');
}

/**
 * A relative number (Word's `\r`): the target's full number less the
 * leading levels whose values it shares with the last paragraph of its list
 * at the xref, keeping at least its own level; the full number when no
 * paragraph of its list comes before the xref, or in a footnote.
 */
function relativeNumber(target: CrossReferenceText, position: WalkPosition | undefined, reader: ProjectionReader): string | undefined {
  if (!target.place || !target.parts) return target.full;
  const at = position && !position.footnote ? position.lists.get(target.place.list) : undefined;
  if (!at) return target.full;
  const own = target.place.values.length - 1;
  let shared = 0;
  // A level shown at its start value (NaN: the Section level of a clause directly under an Article) is compared at that value, so two such levels match.
  const same = (a: number | undefined, b: number | undefined) => a === b || (Number.isNaN(a) && Number.isNaN(b));
  while (shared < Math.min(at.length, own + 1) && same(at[shared], target.place.values[shared])) shared += 1;
  const keepFrom = Math.min(shared, own);
  return joinParts(target.parts.filter((part) => part.level >= keepFrom), reader, target.plainList === true);
}

/**
 * The text a text reference to a heading or list item shows: the node's own
 * inline content (an item's, without its nested lists) read by this walker,
 * less footnote reference marks and the whitespace an `{% #id %}` annotation
 * leaves at the end. Validation refuses a text target holding an xref, so the
 * walker needs no reference texts here.
 */
function targetText(node: MarkdocNode): string {
  const content = node.type === 'item' ? node.children.filter((child) => child.type !== 'list') : [node];
  return scanMarks(content.map((child) => inlineText(child)).join('').replace(/\s+$/u, '')).text;
}

/**
 * Number every ordered list item and numbered heading that carries an id, by
 * the same contract as the markers: each top-level list counts on its own
 * from its first marker, nested lists from 1, and a list under a numbered
 * heading numbers its clauses after that heading's label. Every heading and
 * list item with an id, numbered or not, also gets its text.
 */
function crossReferenceTexts(ast: MarkdocNode, reader: ProjectionReader): { texts: Map<string, CrossReferenceText>; places: Map<MarkdocNode, ListPlace> } {
  const texts = new Map<string, CrossReferenceText>();
  // The place of every numbered heading and ordered list item, keyed by its node, for the walker's position.
  const places = new Map<MarkdocNode, ListPlace>();
  const { headings, clauseContext } = headingLabels(ast);
  const visit = (list: MarkdocNode, ancestors: readonly number[], context: HeadingPlace | undefined, chain: string) => {
    if (list.attributes.ordered !== true) {
      // Bullets show no number; a text reference may still name one.
      for (const item of list.children) {
        if (item.attributes.id !== undefined) texts.set(String(item.attributes.id), { text: targetText(item) });
        for (const child of item.children) if (child.type === 'list') visit(child, [], undefined, chain);
      }
      return;
    }
    const depth = ancestors.length;
    let n = depth === 0 && Number.isInteger(list.attributes.start) ? Number(list.attributes.start) : 1;
    for (const item of list.children) {
      const values = [...ancestors, n];
      let parts: Array<{ level: number; text: string }>;
      let place: ListPlace;
      if (context !== undefined) {
        // Clauses are levels 2 and deeper of the heading list, under the Section (or Article) they sit in.
        parts = [{ level: context.level, text: context.label }, ...values.map((value, level) => ({ level: level + 2, text: clauseMarker(level, value) }))];
        place = { list: 'headings', values: [context.values[0]!, context.values[1] ?? Number.NaN, ...values] };
      } else {
        parts = values.map((value, level) => ({ level, text: level === 0 ? String(value) : level === 1 ? `(${letters(value)})` : `(${roman(value)})` }));
        place = { list: chain, values };
      }
      places.set(item, place);
      // LibreOffice keeps the period of `1.` before `(`; Word drops it.
      const full = joinParts(parts, reader, context === undefined);
      const paragraph = parts.at(-1)!.text;
      if (item.attributes.id !== undefined) texts.set(String(item.attributes.id), { full, paragraph, text: targetText(item), place, parts, plainList: context === undefined });
      for (const child of item.children) if (child.type === 'list') visit(child, values, context, chain);
      n += 1;
    }
  };
  // Chains of continuing ordered lists outside numbered headings: a list whose first marker is the previous one's next number continues it.
  let chains = 0;
  let next: number | null = null;
  for (const node of ast.children) {
    if (node.type === 'list') {
      const context = clauseContext.get(node);
      let chain = `list ${chains}`;
      if (node.attributes.ordered === true && context === undefined) {
        const start = Number.isInteger(node.attributes.start) ? Number(node.attributes.start) : 1;
        if (next === null || start !== next) chains += 1;
        chain = `list ${chains}`;
        next = start + node.children.length;
      }
      visit(node, [], context, chain);
    }
    const heading = node.type === 'heading' ? headings.get(node) : undefined;
    if (heading) places.set(node, { list: 'headings', values: heading.values });
    if (node.type === 'heading' && node.attributes.id !== undefined) {
      texts.set(String(node.attributes.id), {
        ...(heading === undefined ? {} : { full: heading.label, paragraph: heading.label, place: { list: 'headings', values: heading.values }, parts: [{ level: heading.level, text: heading.label }] }),
        text: targetText(node),
      });
    }
  }
  return { texts, places };
}

function inlineText(node: MarkdocNode, references: CrossReferenceTexts = new Map(), position?: WalkPosition, reader: ProjectionReader = 'word'): string {
  const children = () => node.children.map((child) => inlineText(child, references, position, reader)).join('');
  switch (node.type) {
    case 'text': return String(node.attributes.content ?? '');
    case 'softbreak': return ' ';
    case 'hardbreak': return '\n';
    case 'tag':
      if (node.tag === 'fill') return `[${children()}]`;
      if (node.tag === 'fnref') return `${REFERENCE_OPEN}${String(node.attributes.id ?? '')}${REFERENCE_CLOSE}`;
      if (node.tag === 'xref') {
        const target = references.get(String(node.attributes.to));
        const form = xrefForm(node);
        const shown = form === 'text' ? target?.text
          : form === 'paragraph' ? target?.paragraph
          : form === 'relative' ? (target ? relativeNumber(target, position, reader) : undefined)
          : target?.full;
        // Validation rejects a dangling target before the oracle runs; an empty
        // expectation here would only make the comparison fail, never pass.
        const fullNumber = form === 'relative' ? `|${target?.full ?? ''}` : '';
        return `${form !== 'text' && node.attributes.format === 'section' ? 'Section ' : ''}${XREF_OPEN}${String(node.attributes.to)}|${form}${fullNumber}${XREF_NUMBER}${shown ?? ''}${XREF_CLOSE}`;
      }
      return children();
    default: return children();
  }
}

/**
 * Tags that stand for a whole block when they are a paragraph's only content.
 * Inline tags (`fill`, `literal`, `u`) are never blocks: a paragraph holding
 * only `{% u %}Defined Term{% /u %}` is still a body paragraph with that text.
 */
const BLOCK_TAGS: ReadonlySet<string> = new Set(['center', 'legend', 'paragraph-layout', 'signer', 'table', 'section', 'page-break', 'footnote']);

/** The one block tag a paragraph stands for when that tag is its only content. */
function soleTag(paragraph: MarkdocNode): MarkdocNode | undefined {
  if (paragraph.type !== 'paragraph') return undefined;
  const inline = paragraph.children.length === 1 && paragraph.children[0]!.type === 'inline' ? paragraph.children[0]! : undefined;
  const meaningful = inline?.children.filter((child) => !(child.type === 'text' && !String(child.attributes.content ?? '').trim())) ?? [];
  const only = meaningful.length === 1 ? meaningful[0]! : undefined;
  return only?.type === 'tag' && BLOCK_TAGS.has(only.tag ?? '') ? only : undefined;
}

function paragraphsOfTag(node: MarkdocNode): MarkdocNode[] {
  const paragraphs = node.children.filter((child) => child.type === 'paragraph');
  return paragraphs.length > 0 ? paragraphs : [node];
}

/**
 * Whose rendering of a cross-reference number to expect: Word's cached
 * result (the DOCX and its re-import), or LibreOffice's, which recalculates
 * REF fields on load (the PDF check).
 */
export type ProjectionReader = 'word' | 'libreoffice';

/** Read the expected plain text straight from the Markdoc source. */
export function projectSourceText(source: string, options: { reader?: ProjectionReader } = {}): SourceProjection {
  const ast = Markdoc.parse(source);
  const reader = options.reader ?? 'word';
  const { texts: crossReferences, places } = crossReferenceTexts(ast, reader);
  const position: WalkPosition = { lists: new Map(), footnote: false };
  const textOf = (node: MarkdocNode) => inlineText(node, crossReferences, position, reader);
  // A numbered paragraph becomes its list's position before its own text is read.
  const reach = (node: MarkdocNode) => {
    const place = places.get(node);
    if (place) position.lists.set(place.list, place.values);
  };
  const frontmatter = parseCreationFrontmatter(ast.attributes.frontmatter as string | undefined);
  const footerOf = (text: unknown, pageNumbers: unknown, format?: unknown, layout?: unknown): string[] => {
    const number = PAGE_NUMBER_TEXT[typeof format === 'string' ? format : 'plain'] ?? PAGE_NUMBER_FIELD;
    const hasText = typeof text === 'string' && text !== '';
    if (layout === 'one-line' && hasText && pageNumbers === true) return [`${text}\t${number}`];
    return [...(hasText ? [text] : []), ...(pageNumbers === true ? [number] : [])];
  };
  const body: SourceProjection['body'] = [];
  const footers: SourceProjection['footers'] = [
    frontmatter.footer || frontmatter.pageNumbers || frontmatter.footerFirst ? footerOf(frontmatter.footer, frontmatter.pageNumbers, frontmatter.pageNumberFormat, frontmatter.footerLayout) : null,
  ];
  // First-page text alone declares a header or footer that is empty on the other pages.
  const headers: Array<string[] | null> = [frontmatter.header ? [frontmatter.header] : frontmatter.headerFirst ? [] : null];
  // Each section's first-page variants as declared with its header and footer (undefined: none declared).
  const variant = (value: unknown, lines: (text: string) => string[]) => (typeof value !== 'string' ? undefined : value === 'none' ? [] : lines(value));
  const headerFirsts: Array<string[] | undefined> = [variant(frontmatter.headerFirst, (text) => [text])];
  const footerFirsts: Array<string[] | undefined> = [variant(frontmatter.footerFirst, (text) => footerOf(text, frontmatter.pageNumbers, frontmatter.pageNumberFormat, frontmatter.footerLayout))];
  let section = 0;
  let tables = 0;
  const references: string[] = [];
  const notes = new Map<string, ScannedText[]>();
  const bodyXrefs: SourceCrossReference[] = [];
  const push = (raw: string, node: MarkdocNode, extra: Partial<SourceBodyEntry> = {}) => {
    const { text, footnotes: marks, xrefs } = scanMarks(raw);
    references.push(...marks.map((mark) => mark.id));
    bodyXrefs.push(...xrefs.map((xref) => ({ ...xref, story: 'body' as const, entry: body.length })));
    body.push({ text, ...(lineOf(node) === undefined ? {} : { line: lineOf(node)! }), section, ...extra, ...(marks.length ? { footnoteMarks: marks.map((mark) => mark.offset) } : {}) });
  };
  const targets: Record<string, string> = {};
  const { headings, clauseContext } = headingLabels(ast);
  const listItems = (list: MarkdocNode, depth: number, clauses: boolean) => {
    const ordered = list.attributes.ordered === true;
    let n = depth === 0 && ordered && Number.isInteger(list.attributes.start) ? Number(list.attributes.start) : 1;
    for (const item of list.children) {
      for (const child of item.children) {
        if (child.type === 'list') listItems(child, depth + 1, clauses);
        else {
          reach(item);
          const itemText = textOf(child);
          if (item.attributes.id !== undefined) targets[String(item.attributes.id)] = scanMarks(itemText).text;
          push(itemText, item, { marker: clauses && ordered ? clauseMarker(depth, n) : listMarker(ordered, depth, n) });
        }
      }
      n += 1;
    }
  };
  const tag = (node: MarkdocNode) => {
    switch (node.tag) {
      case 'center':
      case 'legend':
        for (const paragraph of paragraphsOfTag(node)) push(paragraph === node ? node.children.map(textOf).join('') : textOf(paragraph), paragraph);
        return;
      case 'paragraph-layout': {
        const layout = sourceParagraphLayout(node);
        for (const paragraph of paragraphsOfTag(node)) push(paragraph === node ? node.children.map(textOf).join('') : textOf(paragraph), paragraph, { layout });
        return;
      }
      case 'signer': {
        const name = node.attributes.name !== undefined ? String(node.attributes.name) : paragraphsOfTag(node).map((paragraph) => (paragraph === node ? node.children.map(textOf).join('') : textOf(paragraph))).join('');
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
            for (const cell of tr.children) push(textOf(cell), cell, { cell: true, table: { id, row } });
            row += 1;
          }
        }
        return;
      }
      case 'footnote':
        position.footnote = true;
        notes.set(String(node.attributes.id), paragraphsOfTag(node).map((paragraph) => scanMarks(paragraph === node ? node.children.map(textOf).join('') : textOf(paragraph))));
        position.footnote = false;
        return;
      case 'section': {
        const { footer, header } = node.attributes;
        const pageNumbers = node.attributes['page-numbers'];
        footers.push(footer !== undefined || pageNumbers !== undefined || node.attributes['footer-first'] !== undefined ? footerOf(footer, pageNumbers, node.attributes['page-number-format'], node.attributes['footer-layout']) : null);
        headers.push(typeof header === 'string' ? [header] : header === false || node.attributes['header-first'] !== undefined ? [] : null);
        headerFirsts.push(variant(node.attributes['header-first'], (text) => [text]));
        footerFirsts.push(variant(node.attributes['footer-first'], (text) => footerOf(text, pageNumbers, node.attributes['page-number-format'], node.attributes['footer-layout'])));
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
    else if (node.type === 'list') listItems(node, 0, clauseContext.has(node));
    else if (node.type === 'blockquote') for (const child of node.children) push(textOf(child), child);
    else {
      const label = headings.get(node)?.label;
      reach(node);
      const text = textOf(node);
      if (node.type === 'heading' && node.attributes.id !== undefined) targets[String(node.attributes.id)] = scanMarks(text).text;
      push(text, node, label === undefined ? {} : { marker: label });
    }
  }
  const footnotes = references.map((id) => ({ id, paragraphs: (notes.get(id) ?? []).map((paragraph) => paragraph.text) }));
  const noteXrefs = references.flatMap((id, index) => (notes.get(id) ?? []).flatMap((paragraph, paragraphIndex) =>
    paragraph.xrefs.map((xref): SourceCrossReference => ({ ...xref, story: 'footnote', note: index + 1, paragraph: paragraphIndex }))));
  const xrefs = [...bodyXrefs, ...noteXrefs];
  const inventory = xrefInventory(ast).sort();
  const footnoteInventory = fnrefInventory(ast).sort();
  // A section that declares no header or footer inherits the previous one with its first-page variant.
  type Running = { lines: string[]; first?: string[] } | null;
  const inherit = (declared: Array<string[] | null>, firsts: Array<string[] | undefined>): Running[] => {
    const out: Running[] = [];
    declared.forEach((lines, index) => {
      const first = firsts[index];
      out.push(lines === null ? out[index - 1] ?? null : { lines, ...(first === undefined ? {} : { first }) });
    });
    return out;
  };
  const runningHeaders = inherit(headers, headerFirsts);
  const runningFooters = inherit(footers, footerFirsts);
  const firstPage = runningHeaders.map((header, index) => {
    const footer = runningFooters[index] ?? null;
    if (header?.first === undefined && footer?.first === undefined) return null;
    return { header: header ? header.first ?? header.lines : null, footer: footer ? footer.first ?? footer.lines : null };
  });
  return {
    body,
    footers,
    ...(headers.some((header) => header !== null) ? { headers } : {}),
    ...(firstPage.some((entry) => entry !== null) ? { firstPage } : {}),
    ...(footnotes.length ? { footnotes } : {}),
    ...(footnoteInventory.length ? { footnoteReferenceInventory: footnoteInventory } : {}),
    ...(xrefs.length || inventory.length ? { crossReferences: xrefs, crossReferenceTargets: targets, crossReferenceInventory: inventory } : {}),
  };
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
/** `glued[i]`: word `i` is a piece of the word before it and is shown without a space. */
function groupSpans(indices: readonly number[], words: readonly string[], glued?: readonly boolean[]): WordSpan[] {
  const spans: WordSpan[] = [];
  let run: number[] = [];
  const show = (from: number, to: number) => words.slice(from, to).map((word, offset) => (offset > 0 && !glued?.[from + offset] ? ` ${word}` : word)).join('');
  const flush = () => {
    if (!run.length) return;
    const first = run[0]!;
    const last = run.at(-1)!;
    spans.push({ words: run.map((i, offset) => (offset > 0 && !(glued?.[i] && i === run[offset - 1]! + 1) ? ` ${words[i]}` : words[i])).join(''), before: show(Math.max(0, first - CONTEXT_WORDS), first), after: show(last + 1, last + 1 + CONTEXT_WORDS) });
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
  // A line holding field markers matches its text with each marker read as a decimal number.
  const patterns = new Map<string, RegExp>();
  const patternOf = (text: string) => {
    if (!patterns.has(text)) {
      const parts = text.split(FIELD_MARKERS).map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
      patterns.set(text, new RegExp(`^${parts.join('\\d+')}$`, 'u'));
    }
    return patterns.get(text)!;
  };
  const matches = (e: { text: string }, a: string) => e.text === a || (hasFieldMarker(e.text) && patternOf(e.text).test(a));
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
      const { missing, extra } = wordSpans(normalizeOracleText(e.text.replace(FIELD_MARKERS, '')), a);
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
      if (hasFieldMarker(op.a!.text)) knownGenerated.push(`page number field rendered as "${op.b}"`);
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
  /**
   * Footnotes whose text is not where the page foot areas put it: missing or out of order (`page` is
   * where the search stopped), or a note that starts on a different page from its reference mark.
   */
  footnoteMismatches: Array<{ note: number; page: number; reason: string; words?: string }>;
  knownGenerated: {
    /** Per page: the footnote area removed from the end of the page (number, then text, per note), as found. */
    footnoteAreas: string[];
    /** The footer region removed from the head of each page, as found. */
    footerRegions: string[];
    listMarkers: number;
    repeatedTableHeaders: Array<{ page: number; table: number }>;
    /** Table rows found split across pages (cell fragments page by page) and read back in cell order. */
    splitRows: Array<{ table: number; row: number; pages: number[] }>;
    /** Lines LibreOffice exported without space glyphs (one PDF token), split back into source words on the evidence of the page's layout text. */
    joinedLines: Array<{ page: number; words: string }>;
    /**
     * Source words holding a dash that LibreOffice wrapped right after the dash at a line end ("re-" ending one
     * line, "evaluate" starting the next, for "re-evaluate"), rejoined; the tokens as read.
     */
    wrappedHyphens: Array<{ page: number; words: string }>;
    /** Source words holding a footnote number that came out broken right after the number ("Closing1 ."); the tokens as read. */
    markSplits: Array<{ page: number; words: string }>;
  };
  limitations: string;
};

/** Brackets a footnote number spliced into the expected text; private-use characters, untouched by NFKC. */
const MARK_OPEN = '\uE000';
const MARK_CLOSE = '\uE001';

/** `text` with each footnote number spliced in at its reference offset, bracketed by the mark sentinels. */
function withFootnoteMarks(text: string, offsets: readonly number[] | undefined, first: number): string {
  if (!offsets?.length) return text;
  let out = '';
  let at = 0;
  offsets.forEach((offset, index) => {
    out += `${text.slice(at, offset)}${MARK_OPEN}${first + index}${MARK_CLOSE}`;
    at = offset;
  });
  return out + text.slice(at);
}

/**
 * Remove each page's footnote area from the end of its words. LibreOffice writes the area after the body:
 * first the rest of a note continued from the page before (no number), then each note that starts on the page,
 * its number and then its text. Read in page order, the areas must spell every note in order exactly once, so
 * each page's area is the longest suffix that continues that sequence where the previous page left off.
 * Taking body words as note words can only lose them from the body alignment, so a wrong split fails.
 */
function stripFootnoteAreas(pages: string[][], notes: readonly SourceFootnote[], words: (text: string) => string[]): {
  bodies: string[][];
  areas: string[][];
  /** 0-based page where each note's number was found, or -1. */
  notePages: number[];
  /** How many words of the note sequence were found, out of `sequence.length`. */
  consumed: number;
  /** Per page: whether its footnote area opens with the rest of a note continued from the page before. */
  continues: boolean[];
  sequence: Array<{ word: string; note: number; number: boolean }>;
} {
  const sequence = notes.flatMap((note, index) => [
    { word: String(index + 1), note: index, number: true },
    ...words(note.paragraphs.join('\n')).map((word) => ({ word, note: index, number: false })),
  ]);
  const notePages = notes.map(() => -1);
  let cursor = 0;
  const bodies: string[][] = [];
  const areas: string[][] = [];
  const continues: boolean[] = [];
  pages.forEach((tokens, page) => {
    let length = Math.min(tokens.length, sequence.length - cursor);
    for (; length > 0; length -= 1) {
      const start = tokens.length - length;
      let match = true;
      for (let offset = 0; offset < length && match; offset += 1) match = tokens[start + offset] === sequence[cursor + offset]!.word;
      if (match) break;
    }
    for (let offset = 0; offset < length; offset += 1) {
      const token = sequence[cursor + offset]!;
      if (token.number) notePages[token.note] = page;
    }
    bodies.push(tokens.slice(0, tokens.length - length));
    areas.push(tokens.slice(tokens.length - length));
    continues.push(length > 0 && !sequence[cursor]!.number);
    cursor += length;
  });
  return { bodies, areas, notePages, consumed: cursor, continues, sequence };
}

export const PDF_WORD_NORMALIZATION = 'Unicode NFKC (folds ligatures such as "fi"), then whitespace runs split words. Nothing else.';
export const PDF_WORD_LIMITATIONS =
  'The text layer is read with pdftotext -raw (content-stream order; LibreOffice writes each page\'s footer first, then the body in document order, except that a table row split across pages comes out as each cell\'s fragment on each page; such a row is read back in cell order only when its words partition exactly into those fragments, every cell starting on the first page, and the pages after the first stay pinned to that row and its section). ' +
  'List labels are expected words, and so is each footnote number, joined to the text around its reference (LibreOffice sets it as a superscript with no space). pdftotext can break such a word right after the number when text follows it on the baseline ("Closing1 ." for "Closing1."); such a word, and any word spelled like it or like a run of its pieces, is compared on both sides as pieces broken after its numbers, and then each must come out as pdftotext can print it: a word holding the numbers whole or broken only there, into consecutive tokens on one page; any other such word whole. A word holding a footnote number in a table row split across pages must come out whole, or the row is not read back. Footnote text is read from the foot of each page, after the body: the rest of a note continued from the page before, then each note that starts there (its number, then its text); read in page order these areas must spell every note exactly once and in order, and each note must start on the page holding its reference (for a table row split across pages, the page where the mark is printed). A page holding nothing but the rest of a continued note belongs to the content before it and must show that section\'s footer. A repeated table header is expected without its footnote numbers, as LibreOffice draws it. ' +
  'Every page break is explained from the source: the checker searches for where each page can start between the source words around it (including inside wordless content such as empty table rows), and a start fixes what the page must show first, namely its section\'s footer and page number, the table header LibreOffice repeats when a table continues across the break, and the source words at the top of the page. Sections start on new pages. ' +
  'A justified line that LibreOffice exported without space glyphs reads back as one token. Such a token is split back into words only when it spells, character for character, a run of two or more consecutive source words and that is its one reading which the pdftotext -layout text of the same page (word boundaries by glyph position) shows more often than the raw text does, each split needing an occurrence of its own; without layout text, or with a different page count, nothing is split. The evidence is counted per page rather than tied to the line\'s position, so a changed run-together line passes only if the page\'s layout text shows the source reading in a place the raw text does not, which another run-together line that alignment placed as a single source word could supply. ' +
  'A source word holding a dash (Unicode Pd, as in "re-evaluate") can wrap right after the dash, so that one raw line ends with "re-" and the next starts with "evaluate". Such tokens are rejoined only when they are consecutive in one page\'s body (not in a table row read back across pages, and not compared as pieces), every one but the last ends in a dash and is the last word of its raw line, and, within one maximal run of alignment operations that are not matches (including a run at the start or end of the text), none of them was placed and a missing source word is exactly their concatenation; each missing word is used once, and the whole comparison is then repeated on the rejoined words. A dash followed by a space on one line, a dash at a line end whose joined form is not the missing source word, and a word wrapped across a page break are not rejoined and fail. So does a wrap whose fragment the first alignment matched to a neighbouring source word spelled the same ("re-" then "evaluate" for the source words "re-evaluate evaluate"), because only unplaced tokens are rejoined. The raw text cannot tell such a wrap from a line break after the dash, just as no line break between words is checked. ' +
  'Two observed LibreOffice behaviours are assumed: a header row is never left alone at a page bottom (it stays with the first body row), and a table\'s last row can spill its empty remainder onto the next page, repeating the header there. ' +
  'The check passes only when every start that fits explains the same source words; if none fits, or starts that fit disagree (for example, a table with empty trailing rows followed by a table with the same header, or two such tables back to back at a page start), it fails. The text alone cannot always show layout, so such cases fail even when the PDF is right (a false failure); an ambiguity is never settled by a guess.';

/** Added to the limitations when the source has a header or a first-page variant. */
export const PDF_HEADER_LIMITATIONS =
  'With a header, LibreOffice writes each page\'s header before its footer, and both before the body; the region at the head of each page is the header\'s words, then the footer\'s, with the page number and the page count as the PDF numbers them. With w:titlePg, the first page of each section must show its first-page header and footer, and its other pages the others. A page whose region matches no section\'s header and footer fails.';

/**
 * A source word as the PDF shows it, or a piece of one: a word holding a footnote number that text follows, and
 * any word spelled like it or like a run of its pieces, is compared as pieces broken right after its numbers.
 * `piece` locates the piece in its word (`word` counts source words); `mark` when the word holds the numbers.
 */
type ExpectedToken = { word: string; entry: number; piece?: { word: number; at: number; of: number; mark: boolean } };
/** A PDF token as read, or a piece of one (see `ExpectedToken`); `token` is its index among the tokens as read. */
type PdfPiece = PdfToken & { token: number; piece?: { at: number; of: number } };

/**
 * Word-level alignment of the source text against the PDF text layer, with
 * every piece of generated text modelled from the source: list labels, each
 * page's footer region, and repeated table header rows.
 */
export function comparePdfWords(source: SourceProjection, pageTexts: readonly string[], layoutTexts?: readonly string[]): PdfWordComparison {
  const words = (text: string) => text.normalize('NFKC').split(/[\s\u00a0]+/u).filter(Boolean);
  const expected: ExpectedToken[] = [];
  let listMarkers = 0;
  // A footnote reference shows its number where it sits, joined to the text around it ("Company1").
  const markTokens = new Map<number, number>();
  // Each entry's words as the PDF shows them, footnote numbers included; split rows use the same words, so a
  // mark in a split cell is expected there too.
  let nextNote = 1;
  const entryWords = source.body.map((entry) => {
    const marked = words(withFootnoteMarks(entry.text, entry.footnoteMarks, nextNote));
    nextNote += entry.footnoteMarks?.length ?? 0;
    return marked;
  });
  // pdftotext can break a word holding a footnote number right after the number when text follows it on the
  // baseline ("Closing1 ." for "Closing1."). Such a word, and any word on either side spelled like it or like a
  // run of two or more of its pieces, is compared as pieces broken after its numbers; `piecesFit` then requires
  // each word to come out as pdftotext can print it.
  const spellings = new Map<string, string[]>();
  const markedWords = entryWords.flat().map(markCuts).filter(({ cuts }) => cuts.length > 0);
  for (const { plain, cuts } of markedWords) if (!spellings.has(plain)) spellings.set(plain, cutAt(plain, cuts));
  for (const { plain, cuts } of markedWords) {
    const pieces = cutAt(plain, cuts);
    for (let from = 0; from < pieces.length; from += 1) {
      for (let to = from + 2; to <= pieces.length; to += 1) {
        const spelling = pieces.slice(from, to).join('');
        if (!spellings.has(spelling)) spellings.set(spelling, pieces.slice(from, to));
      }
    }
  }
  const asPieces = (tokens: readonly string[]) => tokens.flatMap((word) => spellings.get(word) ?? [word]);
  let sourceWords = 0;
  // One source word, list labels included, as its pieces.
  const pushWord = (pieces: readonly string[], entry: number, mark: boolean) => {
    const id = sourceWords;
    sourceWords += 1;
    pieces.forEach((piece, at) => {
      expected.push({ word: piece, entry, ...(pieces.length > 1 ? { piece: { word: id, at, of: pieces.length, mark } } : {}) });
    });
  };
  source.body.forEach((entry, index) => {
    if (entry.marker) {
      // A heading label is two words ("ARTICLE II", "Section 2.04").
      for (const marker of words(entry.marker)) pushWord(spellings.get(marker) ?? [marker], index, false);
      listMarkers += 1;
    }
    for (const word of entryWords[index]!) {
      const { plain, cuts, numbers } = markCuts(word);
      const pieces = cuts.length ? cutAt(plain, cuts) : spellings.get(plain) ?? [plain];
      const notesHere = [...word.matchAll(/\uE000(\d+)\uE001/gu)].map((match) => Number(match[1]) - 1);
      // Each footnote number belongs to the piece that holds its last digit.
      const ends = pieces.map((_, at) => pieces.slice(0, at + 1).join('').length);
      numbers.forEach((end, k) => markTokens.set(notesHere[k]!, expected.length + ends.findIndex((pieceEnd) => end <= pieceEnd)));
      pushWord(pieces, index, cuts.length > 0);
    }
  });
  const expectedGlued = expected.map((token) => (token.piece?.at ?? 0) > 0);
  const plainWords = entryWords.map((tokens) => tokens.map((word) => word.replace(/[\uE000\uE001]/gu, '')));

  // Effective header and footer per section: a section that declares none inherits the previous one. Their
  // words keep the field markers, which become the page number and the page count when a page is placed.
  const storyWords = (lines: readonly string[] | null | undefined) => (lines ?? []).flatMap((line) => line.split(/(\u0000(?:PAGE|NUMPAGES)(?![A-Z]))/u)).flatMap((part) => (part.startsWith('\u0000') ? [part] : words(part)));
  const effective: Array<{ header: string[]; footer: string[]; first?: { header: string[]; footer: string[] } }> = [];
  source.footers.forEach((declared, section) => {
    const header = source.headers?.[section];
    const first = source.firstPage?.[section];
    effective.push({
      header: header === null || header === undefined ? effective[section - 1]?.header ?? [] : storyWords(header),
      footer: declared === null ? effective[section - 1]?.footer ?? [] : storyWords(declared),
      ...(first ? { first: { header: storyWords(first.header), footer: storyWords(first.footer) } } : {}),
    });
  });
  const pageCount = String(pageTexts.length);
  /**
   * What LibreOffice writes at the head of a page of `section`: the header's words, then the footer's, the
   * PAGE field as the page number and NUMPAGES as the page count. `opens` is true on the section's first page,
   * which shows the first-page header and footer when the section has them (`header-first: none`).
   */
  const regionFor = (section: number, page: number, opens = false): string[] => {
    const own = effective[Math.min(section, effective.length - 1)] ?? { header: [], footer: [] };
    const story = opens && own.first ? own.first : own;
    return [...story.header, ...story.footer].map((word) => (word === PAGE_NUMBER_FIELD ? String(page + 1) : word === PAGE_COUNT_FIELD ? pageCount : word));
  };
  const headers = new Map<number, string[]>();
  // A repeated header row is a copy LibreOffice draws without footnote numbers (observed: "Holder1" on the
  // first page, "Holder" on the pages after), so its words carry none.
  source.body.forEach((entry) => {
    if (entry.table?.row === 0) headers.set(entry.table.id, [...(headers.get(entry.table.id) ?? []), ...words(entry.text)]);
  });

  const notes = source.footnotes ?? [];
  const footnoteAreas = stripFootnoteAreas(pageTexts.map(words), notes, words);
  const pages = footnoteAreas.bodies;
  // Footer region at each page head: the longest candidate region that matches; checked by the break model.
  const candidates = (page: number) => [...new Set(effective.flatMap((_, section) => [regionFor(section, page).join('\u0001'), regionFor(section, page, true).join('\u0001')]))].map((key) => (key ? key.split('\u0001') : []))
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
  // A page whose only text, besides its footer region, is the rest of a note continued from the page before.
  const noteOnly = new Set(bodies.flatMap((tokens, page) => (page > 0 && tokens.length === 0 && headRuns[page]!.length === 0 && footnoteAreas.continues[page] ? [page] : [])));
  // The body words in reading order, split rows rejoined. Each word keeps the page it is printed on (a reference's
  // page is where its mark is printed) and, outside rejoined rows, its index in its page's body.
  const readBodies = (pageBodies: readonly string[][]): { read: PdfToken[]; split: ReturnType<typeof joinSplitRows> } => {
    const rejoined = pageBodies.map((tokens) => [...tokens]);
    const physical = rejoined.map((tokens, page) => tokens.map(() => page));
    const origin = rejoined.map((tokens) => tokens.map((_, index) => index));
    const split = joinSplitRows(source, plainWords, rejoined, physical, origin);
    const read: PdfToken[] = [];
    rejoined.forEach((tokens, page) => {
      tokens.forEach((word, index) => read.push({ word, page, physicalPage: physical[page]![index]!, origin: origin[page]![index]! }));
    });
    return { read, split };
  };

  // Align the PDF words with the source, then explain page breaks and footnote placement.
  type Recovered = Pick<PdfWordComparison['knownGenerated'], 'joinedLines' | 'wrappedHyphens'>;
  type Evaluation = { result: PdfWordComparison; extraIdx: number[]; pdf: PdfPiece[]; ops: Array<Op<ExpectedToken, PdfPiece>> | null };
  const evaluate = (read: readonly PdfToken[], split: ReturnType<typeof joinSplitRows>, recovered: Recovered): Evaluation => {
    const pdf: PdfPiece[] = read.flatMap((token, index) => {
      const pieces = spellings.get(token.word);
      return pieces ? pieces.map((word, at) => ({ ...token, word, token: index, piece: { at, of: pieces.length } })) : [{ ...token, token: index }];
    });
    const fit = (() => {
      const raw = myersDiff(expected, pdf, (x, y) => x.word === y.word);
      return raw ? piecesFit(raw, expected, pdf) : undefined;
    })();
    const ops = fit?.ops ?? null;
    const markSplits = fit?.markSplits ?? [];

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
        noteOnly,
        found: (page) => regions[page]!.join(' '),
        region: (section, page, opens) => regionFor(section, page, opens).join(' '),
        sectionCount: effective.length,
        spell: (word) => spellings.get(word),
      });
      for (const index of model.explained) missing.delete(index);
      footerMismatches.push(...model.footerMismatches);
      unverifiedTableHeaders.push(...model.unverified);
      repeatedTableHeaders.push(...model.repeated);
    } else {
      expected.forEach((_, i) => missing.add(i));
    }
    const footnoteMismatches: PdfWordComparison['footnoteMismatches'] = [];
    const { consumed, sequence, notePages, areas } = footnoteAreas;
    if (consumed < sequence.length) {
      const stuck = sequence[consumed]!;
      const lastPage = areas.reduce((found, area, page) => (area.length > 0 ? page : found), -1);
      footnoteMismatches.push({
        note: stuck.note + 1,
        page: Math.max(lastPage, 0) + 1,
        reason: consumed === 0 ? 'no page ends with the first footnote' : 'the footnote text stops matching the page foot areas here',
        words: sequence.slice(consumed, consumed + 8).map((token) => token.word).join(' '),
      });
    }
    if (ops) {
      const markPage = new Map<number, number>();
      for (const op of ops) if (op.kind === 'equal') markPage.set(op.ai!, pdf[op.bi!]!.physicalPage);
      notes.forEach((_, note) => {
        const token = markTokens.get(note);
        const referencePage = token === undefined ? undefined : markPage.get(token);
        // A reference mark that did not align is already reported as missing.
        if (referencePage === undefined || notePages[note] === -1 || notePages[note] === referencePage) return;
        footnoteMismatches.push({ note: note + 1, page: notePages[note]! + 1, reason: `the note starts on page ${notePages[note]! + 1} but its reference is on page ${referencePage + 1}` });
      });
    }
    const missingSpans = groupSpans([...missing].sort((a, b) => a - b), expected.map((token) => token.word), expectedGlued);
    const unexplainedExtra = groupSpans(extraIdx, pdf.map((token) => token.word), pdf.map((token) => (token.piece?.at ?? 0) > 0));
    const result: PdfWordComparison = {
      passed: ops !== null && missingSpans.length === 0 && unexplainedExtra.length === 0 && footerMismatches.length === 0 && unverifiedTableHeaders.length === 0 && footnoteMismatches.length === 0,
      normalization: PDF_WORD_NORMALIZATION,
      alignment: ops ? 'complete' : 'over-budget',
      expectedWords: sourceWords,
      pdfWords: read.length,
      missing: missingSpans,
      unexplainedExtra,
      footerMismatches,
      unverifiedTableHeaders,
      footnoteMismatches,
      knownGenerated: {
        footnoteAreas: areas.map((area) => area.join(' ')),
        footerRegions: regions.map((region) => region.join(' ')),
        listMarkers,
        repeatedTableHeaders,
        splitRows: split.rows.map(({ table, row, pages: spanned }) => ({ table, row, pages: spanned.map((page) => page + 1) })),
        joinedLines: recovered.joinedLines,
        wrappedHyphens: recovered.wrappedHyphens,
        markSplits,
      },
      limitations: source.headers || source.firstPage ? `${PDF_WORD_LIMITATIONS} ${PDF_HEADER_LIMITATIONS}` : PDF_WORD_LIMITATIONS,
    };
    return { result, extraIdx, pdf, ops };
  };

  // Per page body word: whether it is the last word of its line in the raw text. pdftotext builds raw lines from
  // glyph baselines, so a line end there is where the PDF breaks the line. If a page's lines do not tokenize to its
  // words, no word on it counts as ending a line.
  const bodyLineEnds = pageTexts.map((text, page) => {
    const ends = text.normalize('NFKC').split('\n').flatMap((line) => words(line).map((_, at, all) => at === all.length - 1));
    if (ends.length !== words(text).length) return bodies[page]!.map(() => false);
    const offset = regions[page]!.length + headRuns[page]!.length;
    return ends.slice(offset, offset + bodies[page]!.length);
  });

  // A reading of the page bodies: the words as read (possibly split or rejoined below), where their lines end, and
  // the evaluation rebuilt from them (split rows, alignment, page model, footnotes).
  type Reading = { bodies: string[][]; lineEnds: boolean[][]; recovered: Recovered; evaluation: Evaluation };
  const evaluateBodies = (pageBodies: string[][], lineEnds: boolean[][], recovered: Recovered): Reading => {
    const read = readBodies(pageBodies);
    return { bodies: pageBodies, lineEnds, recovered, evaluation: evaluate(read.read, read.split, recovered) };
  };
  let reading = evaluateBodies(bodies, bodyLineEnds, { joinedLines: [], wrappedHyphens: [] });
  if (reading.evaluation.result.passed) return reading.evaluation.result;
  // Layout text is evidence only page for page; with a different page count it is not used at all.
  const layout = layoutTexts?.length === pageTexts.length ? layoutTexts : undefined;
  if (layout) {
    // A justified line LibreOffice exported without space glyphs reads back as one token. The candidates are the
    // tokens the first alignment could not place or, when it was over budget, every token; never a word of a
    // rejoined row, which matched the source exactly, nor a word compared as pieces. The readings, and the raw and
    // layout text they are counted in, are in pieces too, so a run-together line can end in a word that pdftotext
    // also broke after its footnote number ("TheClosing1" then ".").
    const unsplit = reading.evaluation;
    const joinable = (unsplit.ops ? unsplit.extraIdx.map((index) => unsplit.pdf[index]!) : unsplit.pdf)
      .filter((token) => token.origin >= 0 && !token.piece);
    const splits = splitJoinedTokens(joinable, expected.map((token) => token.word), reading.bodies, pageTexts.map((text) => asPieces(words(text))), layout.map((text) => asPieces(words(text))));
    if (splits.size > 0) {
      // Split the page bodies as read; only the last word of a split token can end its line.
      const resplit = reading.bodies.map((tokens, page) => tokens.flatMap((word, index) => splits.get(`${page}:${index}`) ?? [word]));
      const ends = reading.bodies.map((tokens, page) => tokens.flatMap((_, index) => {
        const end = reading.lineEnds[page]![index]!;
        const split = splits.get(`${page}:${index}`);
        return split ? split.map((__, at) => at === split.length - 1 && end) : [end];
      }));
      const joinedLines = [...splits].map(([key, split]) => ({ page: Number(key.split(':')[0]) + 1, words: split.join(' ') }));
      reading = evaluateBodies(resplit, ends, { ...reading.recovered, joinedLines });
      if (reading.evaluation.result.passed) return reading.evaluation.result;
    }
  }
  // A word holding a dash that LibreOffice wrapped right after the dash reads back as two tokens, one ending its
  // line. Rejoin them only where the alignment left exactly that source word missing (see `wrappedDashJoins`).
  const { ops, pdf } = reading.evaluation;
  const joins = ops ? wrappedDashJoins(ops, expected, pdf, reading.lineEnds) : new Map<string, number>();
  if (joins.size === 0) return reading.evaluation.result;
  const rejoined: string[][] = [];
  const rejoinedEnds: boolean[][] = [];
  const wrappedHyphens: Recovered['wrappedHyphens'] = [];
  reading.bodies.forEach((tokens, page) => {
    const out: string[] = [];
    const ends: boolean[] = [];
    for (let index = 0; index < tokens.length;) {
      const count = joins.get(`${page}:${index}`) ?? 1;
      if (count > 1) wrappedHyphens.push({ page: page + 1, words: tokens.slice(index, index + count).join(' ') });
      out.push(tokens.slice(index, index + count).join(''));
      ends.push(reading.lineEnds[page]![index + count - 1]!);
      index += count;
    }
    rejoined.push(out);
    rejoinedEnds.push(ends);
  });
  return evaluateBodies(rejoined, rejoinedEnds, { ...reading.recovered, wrappedHyphens }).evaluation.result;
}

/**
 * A source word holding a dash ("re-evaluate", "1990–2000") can wrap right after the dash: LibreOffice ends one
 * line with "re-" and starts the next with "evaluate", and `pdftotext -raw` reads two tokens. The raw text alone
 * cannot tell that wrap from a stray dash, so a rejoin needs both of these: the tokens are consecutive on one page
 * in the body as read (never in a rejoined table row, never compared as pieces), every token but the last ends in
 * a dash (Unicode Pd) and is the last word of its raw line; and, within one maximal run of alignment operations
 * that are not matches (a run at the start or end of the text included), the alignment left every one of them
 * unplaced and left a source word missing that is, character for character, their concatenation. Each missing
 * source word is used once. A fragment the alignment matched to a neighbouring source word spelled the same is
 * not rejoined (a false failure, never a guess). Returns, by `page:index` of the first token in the page bodies
 * as read, how many tokens to join. The caller then rebuilds the whole comparison from the joined bodies, so a
 * join passes only if the joined word then aligns.
 */
function wrappedDashJoins(
  ops: ReadonlyArray<Op<ExpectedToken, PdfPiece>>,
  expected: readonly ExpectedToken[],
  pdf: readonly PdfPiece[],
  lineEnds: readonly (readonly boolean[])[],
): Map<string, number> {
  const joins = new Map<string, number>();
  const plain = (index: number) => {
    const token = pdf[index];
    return token && !token.piece && token.origin >= 0 ? token : undefined;
  };
  // A token that can continue onto the next line: it ends in a dash and ends its raw line.
  const wraps = (token: PdfPiece) => /\p{Pd}$/u.test(token.word) && lineEnds[token.page]?.[token.origin] === true;
  for (let start = 0; start < ops.length;) {
    if (ops[start]!.kind === 'equal') {
      start += 1;
      continue;
    }
    let end = start;
    while (end < ops.length && ops[end]!.kind !== 'equal') end += 1;
    const stretch = ops.slice(start, end);
    start = end;
    const missing = new Map<string, number>();
    for (const op of stretch) {
      if (op.kind !== 'delete' || expected[op.ai!]!.piece) continue;
      const word = expected[op.ai!]!.word;
      missing.set(word, (missing.get(word) ?? 0) + 1);
    }
    const unplaced = new Set(stretch.flatMap((op) => (op.kind === 'insert' ? [op.bi!] : [])));
    const order = [...unplaced].sort((a, b) => a - b);
    for (let at = 0; at < order.length; at += 1) {
      const first = plain(order[at]!);
      if (!first) continue;
      let joined = first.word;
      for (let next = order[at]! + 1; ; next += 1) {
        const before = pdf[next - 1]!;
        const token = plain(next);
        if (!wraps(before) || !token || !unplaced.has(next) || token.page !== before.page || token.origin !== before.origin + 1) break;
        joined += token.word;
        const left = missing.get(joined) ?? 0;
        if (left > 0) {
          missing.set(joined, left - 1);
          joins.set(`${first.page}:${first.origin}`, next - order[at]! + 1);
          at = order.indexOf(next);
          break;
        }
      }
    }
  }
  return joins;
}

/** A body word as read: its page in the reading (after split rows are rejoined), where it is printed, and its index in its page's body (-1 in a rejoined row). */
type PdfToken = { word: string; page: number; physicalPage: number; origin: number };

/**
 * `word` (with mark sentinels) without them; `numbers`, the offset right after each footnote number; `cuts`, those
 * that text follows, where pdftotext can break the word.
 */
function markCuts(word: string): { plain: string; cuts: number[]; numbers: number[] } {
  const numbers: number[] = [];
  let plain = '';
  for (const char of word) {
    if (char === MARK_CLOSE) numbers.push(plain.length);
    else if (char !== MARK_OPEN) plain += char;
  }
  return { plain, numbers, cuts: [...new Set(numbers)].filter((cut) => cut > 0 && cut < plain.length) };
}

function cutAt(word: string, cuts: readonly number[]): string[] {
  const bounds = [0, ...cuts, word.length];
  return bounds.slice(1).map((end, index) => word.slice(bounds[index], end));
}

/**
 * Hold the alignment of pieces to what pdftotext can print. A source word holding a footnote number must align
 * whole, piece for piece in order, with PDF pieces that are consecutive and on one page, every PDF token among
 * them lying wholly inside the word: it was printed as one token or broken right after its numbers. Any other
 * word compared as pieces must align with exactly the pieces of one PDF token: it was printed whole. And the
 * pieces of one PDF token must all align inside one source word. A word that does not fit has its aligned
 * pieces, and their partners, turned into missing and extra words. Returns the alignment and, per source word
 * holding a number that came out as more than one token, its tokens as read.
 */
function piecesFit(ops: ReadonlyArray<Op<ExpectedToken, PdfPiece>>, expected: readonly ExpectedToken[], pdf: readonly PdfPiece[]): {
  ops: Array<Op<ExpectedToken, PdfPiece>>;
  markSplits: Array<{ page: number; words: string }>;
} {
  const partnerOf = new Map<number, number>();
  const sourceOf = new Map<number, number>();
  for (const op of ops) {
    if (op.kind !== 'equal') continue;
    partnerOf.set(op.ai!, op.bi!);
    sourceOf.set(op.bi!, op.ai!);
  }
  const unfit = new Set<number>();
  const reject = (sources: readonly number[]) => {
    for (const index of sources) if (partnerOf.has(index)) unfit.add(index);
  };
  const splits: Array<{ word: number; page: number; words: string }> = [];
  for (let start = 0; start < expected.length; start += 1) {
    const piece = expected[start]!.piece;
    if (!piece || piece.at !== 0) continue;
    const own = Array.from({ length: piece.of }, (_, offset) => start + offset);
    const partners = own.map((index) => partnerOf.get(index));
    if (partners.every((partner) => partner === undefined)) continue;
    const placed = partners.filter((partner): partner is number => partner !== undefined);
    let fits = placed.length === own.length && placed.every((partner, offset) => offset === 0 || partner === placed[offset - 1]! + 1)
      && placed.every((partner) => pdf[partner]!.physicalPage === pdf[placed[0]!]!.physicalPage);
    if (fits) {
      const tokens = [...new Set(placed.map((partner) => pdf[partner]!.token))];
      // Every PDF token involved lies wholly inside this word.
      fits = tokens.every((token) => placed.filter((partner) => pdf[partner]!.token === token).length === (pdf[placed.find((partner) => pdf[partner]!.token === token)!]!.piece?.of ?? 1));
      // A word without a footnote number was printed whole.
      if (fits && !piece.mark) fits = tokens.length === 1;
      if (fits && tokens.length > 1) {
        splits.push({
          word: piece.word,
          page: pdf[placed[0]!]!.physicalPage + 1,
          words: placed.map((partner, offset) => (offset > 0 && (pdf[partner]!.piece?.at ?? 0) === 0 ? ` ${pdf[partner]!.word}` : pdf[partner]!.word)).join(''),
        });
      }
    }
    if (!fits) reject(own);
  }
  // The pieces of one PDF token align inside one source word, or not at all.
  for (let start = 0; start < pdf.length; start += 1) {
    const piece = pdf[start]!.piece;
    if (!piece || piece.at !== 0) continue;
    const sources = Array.from({ length: piece.of }, (_, offset) => sourceOf.get(start + offset));
    if (sources.every((source) => source === undefined)) continue;
    const words = new Set(sources.map((source) => (source === undefined ? undefined : expected[source]!.piece?.word)));
    if (sources.some((source) => source === undefined) || words.size !== 1 || words.has(undefined)) {
      reject(sources.filter((source): source is number => source !== undefined));
    }
  }
  // Rejecting one piece of a source word rejects all of its aligned pieces, and its entry in `markSplits`.
  const rejectedWords = new Set([...unfit].flatMap((index) => (expected[index]!.piece ? [expected[index]!.piece!.word] : [])));
  expected.forEach((token, index) => {
    if (token.piece && rejectedWords.has(token.piece.word) && partnerOf.has(index)) unfit.add(index);
  });
  const markSplits = splits.filter((split) => !rejectedWords.has(split.word)).map(({ page, words }) => ({ page, words }));
  if (unfit.size === 0) return { ops: [...ops], markSplits };
  const out: Array<Op<ExpectedToken, PdfPiece>> = [];
  for (const op of ops) {
    if (op.kind === 'equal' && unfit.has(op.ai!)) {
      out.push({ kind: 'delete', a: op.a, ai: op.ai });
      out.push({ kind: 'insert', b: op.b, bi: op.bi });
    } else out.push(op);
  }
  return { ops: out, markSplits };
}

/**
 * A justified line that LibreOffice exported without space glyphs (observed with an underlined word on the
 * line) reads back from `pdftotext -raw` as one token: "anamountequalto(a)the…". The raw text cannot show where
 * the words of such a token break, so a split needs independent evidence: `pdftotext -layout`, which places words
 * by glyph position, prints the same line with its spaces. A candidate token is split only into a run of two or
 * more consecutive source words that spells it exactly, and only when that is its one reading that the layout
 * text of its page shows, spaced, more often than the raw text does. Every spaced occurrence in the raw text is
 * also in the layout text, so each split must account for an occurrence of its own: the tokens split into a
 * reading on a page may not outnumber the layout text's surplus occurrences of it. When they do, only the tokens
 * whose neighbours (split where a claim within its surplus split them) also stand around the reading in the
 * layout text remain, and if those still outnumber the surplus, none is split. Returns the split words by
 * `page:index` in the page bodies as read.
 */
function splitJoinedTokens(
  candidates: ReadonlyArray<{ word: string; page: number; origin: number }>,
  expected: readonly string[],
  bodies: readonly string[][],
  rawPages: readonly string[][],
  layoutPages: readonly string[][],
): Map<string, string[]> {
  const occurrences = (tokens: readonly string[], sequence: readonly string[]) => {
    let count = 0;
    for (let at = 0; at + sequence.length <= tokens.length; at += 1) if (sequence.every((word, offset) => tokens[at + offset] === word)) count += 1;
    return count;
  };
  const surplusMemo = new Map<string, number>();
  const surplus = (page: number, reading: readonly string[]) => {
    const key = `${page}\u0001${reading.join(' ')}`;
    let value = surplusMemo.get(key);
    if (value === undefined) {
      value = occurrences(layoutPages[page] ?? [], reading) - occurrences(rawPages[page] ?? [], reading);
      surplusMemo.set(key, value);
    }
    return value;
  };
  // Where each source word starts a run, looked up by the token's prefixes. The distinct runs that spell a
  // spelling are found once per spelling; a spelling that recurs in the source still visits each of its runs.
  const starts = new Map<string, number[]>();
  expected.forEach((word, index) => {
    const list = starts.get(word);
    if (list) list.push(index);
    else starts.set(word, [index]);
  });
  const runsMemo = new Map<string, string[][]>();
  const runsSpelling = (token: string): string[][] => {
    let runs = runsMemo.get(token);
    if (runs) return runs;
    const distinct = new Map<string, string[]>();
    for (let length = 1; length < token.length; length += 1) {
      for (const start of starts.get(token.slice(0, length)) ?? []) {
        let at = 0;
        let end = start;
        while (end < expected.length && at < token.length && token.startsWith(expected[end]!, at)) {
          at += expected[end]!.length;
          end += 1;
        }
        if (at === token.length && end - start >= 2) distinct.set(expected.slice(start, end).join(' '), expected.slice(start, end));
      }
    }
    runs = [...distinct.values()];
    runsMemo.set(token, runs);
    return runs;
  };
  const proposals = new Map<string, string[]>();
  for (const { word: token, page, origin } of candidates) {
    const readings = runsSpelling(token).filter((reading) => surplus(page, reading) > 0);
    if (readings.length === 1) proposals.set(`${page}:${origin}`, readings[0]!);
  }
  // Each split needs its own surplus occurrence. Claims on a reading within a page's surplus are accepted first.
  // Where the claims outnumber the surplus, keep only the tokens whose neighbours (as split by the accepted claims)
  // stand around the reading in the layout text; if those still outnumber it, none.
  const claims = new Map<string, string[]>();
  for (const [key, reading] of proposals) {
    const group = `${key.split(':')[0]}\u0001${reading.join(' ')}`;
    const list = claims.get(group);
    if (list) list.push(key);
    else claims.set(group, [key]);
  }
  const accepted = new Map<string, string[]>();
  const oversubscribed: Array<{ page: number; reading: string[]; keys: string[]; available: number }> = [];
  for (const [group, keys] of claims) {
    const page = Number(group.split('\u0001')[0]);
    const reading = proposals.get(keys[0]!)!;
    const available = surplus(page, reading);
    if (keys.length <= available) for (const key of keys) accepted.set(key, reading);
    else oversubscribed.push({ page, reading, keys, available });
  }
  const resolved = new Map<string, string[]>();
  for (const { page, reading, keys, available } of oversubscribed) {
    const body = bodies[page] ?? [];
    const neighbour = (index: number, side: 'before' | 'after'): string[] => {
      if (index < 0 || index >= body.length) return [];
      const split = accepted.get(`${page}:${index}`);
      return split ? [side === 'before' ? split.at(-1)! : split[0]!] : [body[index]!];
    };
    const inContext = keys.filter((key) => {
      const origin = Number(key.split(':')[1]);
      return occurrences(layoutPages[page] ?? [], [...neighbour(origin - 1, 'before'), ...reading, ...neighbour(origin + 1, 'after')]) > 0;
    });
    if (inContext.length <= available) for (const key of inContext) resolved.set(key, reading);
  }
  for (const [key, reading] of resolved) accepted.set(key, reading);
  return accepted;
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
function joinSplitRows(source: SourceProjection, entryWords: readonly string[][], bodies: string[][], physical: number[][], origin: number[][]): { rows: SplitRow[]; exhausted: boolean } {
  const rows = new Map<string, { table: number; row: number; section: number; cells: string[][] }>();
  source.body.forEach((entry, index) => {
    if (!entry.table) return;
    const key = `${entry.table.id}:${entry.table.row}`;
    const row = rows.get(key) ?? { table: entry.table.id, row: entry.table.row, section: entry.section ?? 0, cells: [] };
    row.cells.push([...entryWords[index]!]);
    rows.set(key, row);
  });
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
  /**
   * Can `parts` be read as fragments of `cells`, every part listing one fragment per cell in cell order?
   * On success, `lengths[part][cell]` is the fragment length the reading uses.
   */
  const partition = (cells: string[][], parts: string[][], lengths: number[][]): boolean => {
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
        lengths[part]![cell] = length;
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
          const lengths = parts.map(() => row.cells.map(() => 0));
          if (!sameWords(rowCounts, parts) || !partition(row.cells, parts, lengths)) continue;
          // Each cell reads its fragments page by page, so each word keeps the page it was printed on.
          const rowPages = row.cells.flatMap((_, cell) => lengths.flatMap((fragment, part) => Array<number>(fragment[cell]!).fill(page + part)));
          bodies[page] = [...bodies[page]!.slice(0, -tail), ...row.cells.flat()];
          physical[page] = [...physical[page]!.slice(0, -tail), ...rowPages];
          origin[page] = [...origin[page]!.slice(0, -tail), ...rowPages.map(() => -1)];
          for (let middlePage = page + 1; middlePage < last; middlePage += 1) {
            bodies[middlePage] = [];
            physical[middlePage] = [];
            origin[middlePage] = [];
          }
          bodies[last] = bodies[last]!.slice(head);
          physical[last] = physical[last]!.slice(head);
          origin[last] = origin[last]!.slice(head);
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
  /** Pages holding nothing but the rest of a note continued from the page before (and their footer region). */
  noteOnly: ReadonlySet<number>;
  found: (page: number) => string;
  /** The header and footer region a page of `section` shows; `opens` on the section's first page. */
  region: (section: number, page: number, opens: boolean) => string;
  sectionCount: number;
  /** The pieces a word is compared as (see `ExpectedToken`), or undefined for a word compared whole. */
  spell: (word: string) => readonly string[] | undefined;
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
  const { source, expected, headers, pages, firstOnPage, lastOnPage, aligned, headRuns, pinned, noteOnly, found, region } = input;
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
    // A page opens its section when it is the first page, or starts where the section changes (a spilled row
    // remainder and a page continuing a split row or a note never start a section).
    const opensSection = (page: number, placement: { pos: number; spill: boolean; pinned?: true }) =>
      page === 0 || (changes.includes(placement.pos) && !placement.spill && placement.pinned !== true);
    const tokenItemsFrom = (pos: number) => items.map((item, index) => ({ item, index })).filter(({ item, index }) => index >= pos && item.token !== undefined);

    /** A spill page holds the rest of the row before `pos`, so it belongs to that row's section and starts no new one. */
    type Placement = { pos: number; explained: number[]; end: number; table?: number; section: number; spill: boolean; pinned?: true };
    // How page `page` can start at `pos` with repeated header `table`: its head run is that header, then source words.
    const place = (page: number, pos: number, table: number | undefined, spill: boolean): Placement | undefined => {
      if (page === 0 && table !== undefined) return undefined;
      const generated = table === undefined ? [] : headers.get(table) ?? [];
      const head = headRuns[page]!;
      if (generated.some((word, offset) => head[offset] !== word) || head.length < generated.length) return undefined;
      // The source words in the head run, compared as pieces like the body (see `piecesFit`): each token's pieces lie
      // inside one source word, and a word other than a reference word is one whole token.
      const rest = head.slice(generated.length).flatMap((word, token) => (input.spell(word) ?? [word]).map((piece, _at, all) => ({ piece, token, of: all.length })));
      const next = tokenItemsFrom(pos).slice(0, rest.length);
      if (next.length < rest.length || next.some(({ item }, offset) => expected[item.token!]!.word !== rest[offset]!.piece)) return undefined;
      const fits = next.every(({ item }, offset) => {
        const own = expected[item.token!]!.piece;
        const { token, of } = rest[offset]!;
        const sameToken = next.filter((_, other) => rest[other]!.token === token);
        if (of > 1 && (!own || sameToken.some(({ item: other }) => expected[other.token!]!.piece?.word !== own.word))) return false;
        if (!own || own.mark) return true;
        // A literal word compared as pieces must be exactly one token's pieces, all in this head run.
        const ofWord = next.filter(({ item: other }) => expected[other.token!]!.piece?.word === own.word);
        return ofWord.length === own.of && of === own.of && sameToken.length === own.of;
      });
      if (!fits) return undefined;
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
      const continuedNote = !pin && noteOnly.has(page);
      for (let pos = from; pos <= hi; pos += 1) {
        // A page continuing a split row starts inside that row (its words were read back onto the row's first
        // page), shows the repeated header unless the split row is the header itself, and has the row's section.
        const before = beforeEntry(pos);
        const inRow = pin && before !== undefined && source.body[before]!.table?.id === pin.table && source.body[before]!.table?.row === pin.row;
        if (pin && !inRow) continue;
        const options: Array<{ table?: number; spill: boolean }> = pin ? [{ table: pin.row === 0 ? undefined : pin.table, spill: false }] : continuedNote ? [{ spill: false }] : headersAt(pos);
        for (const { table, spill } of options) {
          const placed = place(page, pos, table, spill);
          // A page holding only a continued note belongs to the content before it: that section's footer, and
          // it starts no section (like a pinned page, it is never the page where a section change lands).
          const placement = placed && pin
            ? { ...placed, section: pin.section, pinned: true as const }
            : placed && continuedNote
              ? { ...placed, section: sectionOf(beforeEntry(pos) ?? afterEntry(pos) ?? 0), pinned: true as const }
              : placed;
          if (!placement) continue;
          if (footers && region(placement.section, page, opensSection(page, placement)) !== found(page)) continue;
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
        const want = region(placement.section, page, opensSection(page, placement));
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
