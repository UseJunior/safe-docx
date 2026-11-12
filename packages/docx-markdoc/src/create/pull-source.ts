import Markdoc, { type Node as MarkdocNode } from '@markdoc/markdoc';
import { SIGNATURE_LINE } from './profile.js';
import { soleInlineTag } from './validate.js';

/**
 * A formatting container in a paragraph's inline markup: the paragraph
 * itself (`root`), `**strong**`, `*em*`, `{% u %}`, `{% fill %}` or
 * `{% literal %}`. Text directly inside one container can be rewritten as one
 * span of the source; text in two containers cannot without moving markup.
 */
export type SourceHolder = {
  id: number;
  parent: number | null;
  kind: 'root' | 'strong' | 'em' | 'u' | 'fill' | 'literal' | 'attribute';
  /** The container's extent in the paragraph's read-back text. */
  start: number;
  end: number;
  /** The container's extent in the source, its markup included; absent for the root. */
  rawStart?: number;
  rawEnd?: number;
};

/**
 * A piece of a paragraph's read-back text and where it comes from. `text`
 * and `soft` pieces are source text (a soft line break reads as one space)
 * with the source offset of each character in `raw` (and one past the last);
 * a `fixed` piece is text the markup generates (a cross-reference's number,
 * the brackets of a fill-in, a signature line, a line break) or a footnote
 * mark, which reads as nothing.
 */
export type SourcePiece = {
  kind: 'text' | 'soft' | 'fixed';
  what?: 'cross-reference' | 'fill-bracket' | 'line-break' | 'footnote-reference' | 'generated';
  text: string;
  start: number;
  end: number;
  raw?: number[];
  holder: number;
  /** An xref's tag extent in the source. */
  rawStart?: number;
  rawEnd?: number;
};

export type SourceParagraphKind = 'title' | 'heading' | 'body' | 'quote' | 'list-item' | 'centered' | 'legend' | 'laid-out' | 'signer' | 'table-cell' | 'generated';

/** Where one read-back paragraph comes from in the creation source. */
export type SourceParagraph = {
  /** Index into the read-back paragraphs. */
  index: number;
  /** Index of its top-level node in `Markdoc.parse(source).children`, or -1 for a generated paragraph. */
  entry: number;
  kind: SourceParagraphKind;
  /** 1-based first and last source line of the paragraph's own markup. */
  line: number;
  endLine: number;
  /** 0-based [first, end) lines of the paragraph's own markup, for a paragraph that can be deleted without its block. */
  ownLines?: [number, number];
  /** Present when the inline markup maps onto the read-back text exactly. */
  pieces?: SourcePiece[];
  holders?: SourceHolder[];
  /** Why the inline markup could not be mapped. */
  problem?: string;
  /** For a list item: its line's indentation and marker, its list, and the read-back indexes of the items nested under it. */
  listItem?: { indent: string; marker: string; list: MarkdocNode; nested: number[] };
  /** For a paragraph of a blockquote: the quote. */
  quote?: MarkdocNode;
};

export type SourceMap = {
  source: string;
  ast: MarkdocNode;
  /** Offset of the start of each line (0-based), and the source length as a final entry. */
  lineStarts: number[];
  paragraphs: SourceParagraph[];
  /** Per top-level node: 0-based [first, end) lines, or undefined for a node without lines. */
  entryLines: Array<[number, number] | undefined>;
};

/** What one read-back paragraph of the build is: its text and the cached results of its cross-references. */
export type BuiltParagraph = { text: string; crossReferences: ReadonlyArray<{ text: string }> };

function nodeLines(node: MarkdocNode): [number, number] | undefined {
  const lines = node.lines ?? [];
  if (lines.length === 0) return undefined;
  return [Math.min(...lines), Math.max(...lines)];
}

export function lineStartsOf(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) if (source[index] === '\n') starts.push(index + 1);
  starts.push(source.length);
  return starts;
}

/** `{% … %}` extents in `source` between `from` and `to`, skipping escaped braces. */
function tagRegions(source: string, from: number, to: number): Array<[number, number]> {
  const regions: Array<[number, number]> = [];
  let at = from;
  while (at < to) {
    const open = source.indexOf('{%', at);
    if (open === -1 || open >= to) break;
    if (open > 0 && source[open - 1] === '\\') {
      at = open + 2;
      continue;
    }
    const close = source.indexOf('%}', open + 2);
    if (close === -1) break;
    regions.push([open, close + 2]);
    at = close + 2;
  }
  return regions;
}

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/u;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The character an entity at `at` stands for and its length, or undefined. */
function entityAt(source: string, at: number): { char: string; length: number } | undefined {
  const match = /^&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z]+);/u.exec(source.slice(at, at + 12));
  if (!match) return undefined;
  const name = match[1]!;
  const char = name.startsWith('#x') || name.startsWith('#X')
    ? String.fromCodePoint(Number.parseInt(name.slice(2), 16))
    : name.startsWith('#') ? String.fromCodePoint(Number.parseInt(name.slice(1), 10)) : ENTITIES[name];
  return char === undefined ? undefined : { char, length: match[0].length };
}

/**
 * Match `content` against the source at `start`, allowing a backslash escape
 * or an entity for any character. Returns the source offset of each character
 * and one past the last, or undefined.
 */
function matchAt(source: string, start: number, content: string, limit: number): number[] | undefined {
  const map: number[] = [];
  let at = start;
  for (const char of content) {
    if (at >= limit) return undefined;
    // A character outside the BMP is two code units in both strings.
    const units = char.length;
    if (source[at] === '\\' && source.slice(at + 1, at + 1 + units) === char && ASCII_PUNCTUATION.test(char)) {
      map.push(at);
      at += 2;
      continue;
    }
    // An entity first: `&amp;` stands for `&`, which would otherwise match its first character alone.
    const entity = source[at] === '&' ? entityAt(source, at) : undefined;
    if (entity && entity.char === char && units === 1) {
      map.push(at);
      at += entity.length;
      continue;
    }
    if (source.slice(at, at + units) === char) {
      for (let unit = 0; unit < units; unit += 1) map.push(at + unit);
      at += units;
      continue;
    }
    return undefined;
  }
  if (at > limit) return undefined;
  map.push(at);
  return map;
}

/** A unit of a top-level block that renders one read-back paragraph. */
type ParagraphUnit = {
  kind: SourceParagraphKind;
  children: MarkdocNode[];
  lines: [number, number] | undefined;
  /** The heading or list item whose `{% #id %}` trims its text's trailing space. */
  trim?: MarkdocNode;
  signer?: MarkdocNode;
  ownLines?: [number, number];
  listItem?: { item: MarkdocNode; list: MarkdocNode };
  quote?: MarkdocNode;
  /** A `center`, `legend` or `paragraph-layout` tag written on one line: its text sits between the tags. */
  inlineTag?: boolean;
};

/** The paragraphs a block tag renders, in order (`center`, `legend`, `paragraph-layout`, `signer`, `table`). */
function tagUnits(tag: MarkdocNode, outer: MarkdocNode): ParagraphUnit[] | undefined {
  const outerLines = nodeLines(outer);
  switch (tag.tag) {
    case 'center':
    case 'legend':
    case 'paragraph-layout': {
      const kind = tag.tag === 'center' ? 'centered' : tag.tag === 'legend' ? 'legend' : 'laid-out';
      const paragraphs = tag.children.filter((child) => child.type === 'paragraph');
      if (paragraphs.length === 0) return [{ kind, children: tag.children, lines: outerLines, inlineTag: true }];
      return paragraphs.map((paragraph) => ({ kind, children: paragraph.children, lines: nodeLines(paragraph), ownLines: nodeLines(paragraph) }));
    }
    case 'signer':
      return [{ kind: 'signer', children: [], lines: outerLines, signer: tag }];
    case 'table': {
      const grid = tag.children.find((child) => child.type === 'table');
      if (!grid) return undefined;
      return grid.children.flatMap((group) => group.children.flatMap((row) => row.children.map((cell): ParagraphUnit => ({
        kind: 'table-cell',
        children: cell.children.some((child) => child.type === 'paragraph')
          ? cell.children.filter((child) => child.type === 'paragraph').flatMap((paragraph) => paragraph.children)
          : cell.children,
        lines: nodeLines(cell),
      }))));
    }
    default:
      return undefined;
  }
}

/** Every paragraph a list renders, depth first, as the engine renders them. */
function listUnits(list: MarkdocNode): ParagraphUnit[] {
  const out: ParagraphUnit[] = [];
  for (const item of list.children) {
    let first = true;
    const nested = item.children.find((child) => child.type === 'list');
    const itemLines = nodeLines(item);
    for (const child of item.children) {
      if (first && (child.type === 'paragraph' || child.type === 'inline')) {
        const own: [number, number] | undefined = itemLines ? [itemLines[0], nested ? nodeLines(nested)?.[0] ?? itemLines[1] : itemLines[1]] : undefined;
        out.push({ kind: 'list-item', children: [child], lines: nodeLines(child), trim: item, ...(own ? { ownLines: own } : {}), listItem: { item, list } });
        first = false;
      } else if (child.type === 'list') {
        out.push(...listUnits(child));
      } else if (child.type === 'paragraph' || child.type === 'inline') {
        out.push({ kind: 'list-item', children: [child], lines: nodeLines(child) });
      }
    }
  }
  return out;
}

/** The paragraphs one top-level node renders, or undefined for a node `pull` does not recognize. */
function entryUnits(node: MarkdocNode): ParagraphUnit[] | undefined {
  const lines = nodeLines(node);
  if (node.type === 'heading') return [{ kind: node.attributes.level === 1 ? 'title' : 'heading', children: node.children, lines, trim: node }];
  if (node.type === 'paragraph') {
    const tag = soleInlineTag(node);
    return tag ? tagUnits(tag, node) : [{ kind: 'body', children: node.children, lines }];
  }
  if (node.type === 'blockquote') return node.children.map((child) => ({ kind: 'quote', children: child.children, lines: nodeLines(child), ownLines: nodeLines(child), quote: node }));
  if (node.type === 'list') return listUnits(node);
  if (node.type === 'tag') return tagUnits(node, node);
  return undefined;
}

/** The text node whose trailing space a trailing `{% #id %}` drops, as the lowering does. */
function trimmedTextNode(target: MarkdocNode | undefined): MarkdocNode | undefined {
  if (!target || target.attributes.id === undefined) return undefined;
  const inline = target.children.find((child) => child.type === 'inline' || child.type === 'paragraph');
  const holder = inline?.type === 'paragraph' ? inline.children.find((child) => child.type === 'inline') : inline;
  const last = holder?.children.at(-1);
  return last?.type === 'text' ? last : undefined;
}

class MapFailure extends Error {}

/**
 * Walk one paragraph's inline markup alongside its source text, producing
 * pieces whose concatenation must equal the read-back text. Every tag is
 * consumed at the cursor, and every text is found before the next tag, so a
 * piece never takes its characters from markup.
 */
function mapUnit(source: string, unit: ParagraphUnit, built: BuiltParagraph): { pieces: SourcePiece[]; holders: SourceHolder[] } {
  if (!unit.lines) throw new MapFailure('the block has no source lines');
  const starts = lineStartsOf(source);
  const regionStart = starts[unit.lines[0]] ?? 0;
  const regionEnd = starts[unit.lines[1]] ?? source.length;
  const tags = tagRegions(source, regionStart, regionEnd);
  const pieces: SourcePiece[] = [];
  const holders: SourceHolder[] = [{ id: 0, parent: null, kind: 'root', start: 0, end: 0 }];
  let cursor = regionStart;
  let text = '';
  let crossReference = 0;
  const trimmed = trimmedTextNode(unit.trim);
  const nextTagStart = () => tags.find(([start]) => start >= cursor)?.[0] ?? regionEnd;
  const fixed = (value: string, holder: number, what: SourcePiece['what'], extra: Partial<SourcePiece> = {}) => {
    pieces.push({ kind: 'fixed', what, text: value, start: text.length, end: text.length + value.length, holder, ...extra });
    text += value;
  };
  const consumeTag = (): [number, number] => {
    const region = tags.find(([start]) => start >= cursor);
    if (!region || source.slice(cursor, region[0]).trim() !== '') throw new MapFailure('a tag was not where its node is');
    cursor = region[1];
    return region;
  };
  const openHolder = (kind: SourceHolder['kind'], parent: number, rawStart: number): SourceHolder => {
    const holder: SourceHolder = { id: holders.length, parent, kind, start: text.length, end: text.length, rawStart };
    holders.push(holder);
    return holder;
  };
  const addText = (content: string, holder: number) => {
    if (!content) return;
    const limit = nextTagStart();
    for (let start = cursor; start < limit; start += 1) {
      const map = matchAt(source, start, content, limit);
      if (!map) continue;
      pieces.push({ kind: 'text', text: content, start: text.length, end: text.length + content.length, raw: map, holder });
      text += content;
      cursor = map.at(-1)!;
      return;
    }
    throw new MapFailure(`text '${content.slice(0, 40)}' was not found in its source`);
  };
  /** A line break in the source: the newline and the indentation or quote markers after it. */
  const lineBreak = (): [number, number] => {
    const match = /^[ \t\\]*\r?\n[ \t]*(?:>[ \t]?)*[ \t]*/u.exec(source.slice(cursor, regionEnd));
    if (!match) throw new MapFailure('a line break was not where its node is');
    const range: [number, number] = [cursor, cursor + match[0].length];
    cursor = range[1];
    return range;
  };
  const walk = (children: readonly MarkdocNode[], holder: number): void => {
    for (const node of children) {
      switch (node.type) {
        case 'inline':
        case 'paragraph':
          walk(node.children, holder);
          break;
        case 'text': {
          let content = String(node.attributes.content ?? '');
          if (node === trimmed) content = content.replace(/\s+$/u, '');
          addText(content, holder);
          break;
        }
        case 'softbreak': {
          const [from, to] = lineBreak();
          pieces.push({ kind: 'soft', text: ' ', start: text.length, end: text.length + 1, raw: [from, to], holder });
          text += ' ';
          break;
        }
        case 'hardbreak': {
          const [from, to] = lineBreak();
          fixed('\n', holder, 'line-break', { rawStart: from, rawEnd: to });
          break;
        }
        case 'strong':
        case 'em': {
          const size = node.type === 'strong' ? 2 : 1;
          const delimiter = source.slice(cursor, cursor + size);
          if (!/^(\*+|_+)$/u.test(delimiter) || delimiter.length !== size) throw new MapFailure('an emphasis delimiter was not where its node is');
          const inner = openHolder(node.type, holder, cursor);
          cursor += size;
          walk(node.children, inner.id);
          if (source.slice(cursor, cursor + size) !== delimiter) throw new MapFailure('an emphasis does not close where its node ends');
          cursor += size;
          inner.end = text.length;
          inner.rawEnd = cursor;
          break;
        }
        case 'tag': {
          if (node.tag === 'fill' || node.tag === 'u' || node.tag === 'literal') {
            const [open] = consumeTag();
            const inner = openHolder(node.tag, holder, open);
            if (node.tag === 'fill') fixed('[', inner.id, 'fill-bracket');
            walk(node.children, inner.id);
            const [, close] = consumeTag();
            if (node.tag === 'fill') fixed(']', inner.id, 'fill-bracket');
            inner.end = text.length;
            inner.rawEnd = close;
          } else if (node.tag === 'xref') {
            const [open, close] = consumeTag();
            if (node.attributes.format === 'section' && node.attributes.show !== 'text') fixed('Section ', holder, 'generated');
            const site = built.crossReferences[crossReference];
            crossReference += 1;
            if (!site) throw new MapFailure('a cross-reference has no field in the build');
            fixed(site.text, holder, 'cross-reference', { rawStart: open, rawEnd: close });
          } else if (node.tag === 'fnref') {
            consumeTag();
            fixed('', holder, 'footnote-reference');
          } else {
            throw new MapFailure(`inline tag {% ${node.tag} %} is not mapped`);
          }
          break;
        }
        default:
          throw new MapFailure(`inline '${node.type}' is not mapped`);
      }
    }
  };
  if (unit.signer) {
    const signer = unit.signer;
    const [open, close] = [regionStart, regionEnd];
    fixed(SIGNATURE_LINE, 0, 'generated');
    fixed('\n', 0, 'generated');
    const attribute = (name: 'name' | 'date') => {
      const value = String(signer.attributes[name]);
      const pattern = new RegExp(`\\b${name}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'u');
      const match = pattern.exec(source.slice(open, close));
      if (!match) throw new MapFailure(`signer ${name} was not found in its tag`);
      const valueStart = open + match.index + match[0].length - match[1]!.length - 1;
      const map: number[] = [];
      let at = valueStart;
      for (const char of value) {
        const escaped = source[at] === '\\';
        if (source.slice(at + (escaped ? 1 : 0), at + (escaped ? 1 : 0) + char.length) !== char) throw new MapFailure(`signer ${name} does not read as its attribute`);
        map.push(at);
        if (char.length === 2) map.push(at + 1);
        at += (escaped ? 1 : 0) + char.length;
      }
      map.push(at);
      const holder: SourceHolder = { id: holders.length, parent: 0, kind: 'attribute', start: text.length, end: text.length + value.length, rawStart: valueStart, rawEnd: at };
      holders.push(holder);
      pieces.push({ kind: 'text', text: value, start: text.length, end: text.length + value.length, raw: map, holder: holder.id });
      text += value;
    };
    if (signer.attributes.name !== undefined) attribute('name');
    else {
      cursor = consumeTag()[1];
      walk(signer.children, 0);
    }
    if (signer.attributes.date !== undefined) {
      fixed('\t', 0, 'generated');
      attribute('date');
    }
  } else {
    if (unit.inlineTag) consumeTag();
    walk(unit.children, 0);
  }
  holders[0]!.end = text.length;
  if (text !== built.text) throw new MapFailure('the source markup does not reproduce the built paragraph');
  if (crossReference !== built.crossReferences.length) throw new MapFailure('the build has a cross-reference the source does not place');
  return { pieces, holders };
}

/**
 * Map every read-back paragraph of a build to the creation source it came
 * from: its top-level block (through the lowering's `paragraphEntries`), the
 * lines of its own markup, and, where the inline markup reproduces the text
 * exactly, the source offset of every character. A paragraph whose markup
 * cannot be mapped keeps its lines and a `problem`; `pull` then reports its
 * edits instead of applying them.
 */
export function buildSourceMap(source: string, paragraphEntries: readonly number[], built: readonly BuiltParagraph[]): SourceMap {
  const ast = Markdoc.parse(source);
  const lineStarts = lineStartsOf(source);
  const entryLines = ast.children.map((node) => {
    const lines = nodeLines(node);
    return lines ? [lines[0], lines[1]] as [number, number] : undefined;
  });
  const byEntry = new Map<number, number[]>();
  paragraphEntries.forEach((entry, index) => byEntry.set(entry, [...(byEntry.get(entry) ?? []), index]));
  const paragraphs: SourceParagraph[] = [];
  for (const [index, entry] of paragraphEntries.entries()) {
    if (entry === -1) {
      // The empty paragraph docx-core adds after a section-ending table: anchor it to the table before it.
      const before = paragraphs[index - 1];
      paragraphs.push({ index, entry, kind: 'generated', line: before?.endLine ?? 1, endLine: before?.endLine ?? 1, problem: 'it is the empty paragraph generation adds after a table' });
      continue;
    }
    const indexes = byEntry.get(entry)!;
    const position = indexes.indexOf(index);
    const node = ast.children[entry]!;
    const units = entryUnits(node);
    const lines = entryLines[entry];
    const at = lines ? lines[0] + 1 : 1;
    const endAt = lines ? lines[1] : at;
    if (!units || units.length !== indexes.length) {
      paragraphs.push({ index, entry, kind: 'body', line: at, endLine: endAt, problem: 'its block is not one pull recognizes' });
      continue;
    }
    const unit = units[position]!;
    const unitLines = unit.lines ?? lines;
    const base: SourceParagraph = {
      index,
      entry,
      kind: unit.kind,
      line: unitLines ? unitLines[0] + 1 : at,
      endLine: unitLines ? Math.max(unitLines[0] + 1, unitLines[1]) : endAt,
      ...(unit.ownLines ? { ownLines: unit.ownLines } : {}),
      ...(unit.quote ? { quote: unit.quote } : {}),
    };
    if (unit.listItem) {
      const lineText = source.slice(lineStarts[unit.listItem.item.lines[0]!]!, lineStarts[unit.listItem.item.lines[0]! + 1]! ?? source.length);
      const marker = /^([ \t]*)([-*+]|\d+[.)])[ \t]+/u.exec(lineText);
      if (marker) base.listItem = { indent: marker[1]!, marker: marker[2]!, list: unit.listItem.list, nested: [] };
    }
    try {
      const mapped = mapUnit(source, unit, built[index] ?? { text: '', crossReferences: [] });
      paragraphs.push({ ...base, ...mapped });
    } catch (error) {
      if (!(error instanceof MapFailure)) throw error;
      paragraphs.push({ ...base, problem: error.message });
    }
  }
  // Nested list items: an item's own lines end where its nested list begins.
  for (const paragraph of paragraphs) {
    if (!paragraph.listItem || !paragraph.ownLines) continue;
    const [, own] = paragraph.ownLines;
    const itemEnd = paragraph.listItem ? nodeLinesOfItem(paragraph, paragraphs) : own;
    paragraph.listItem.nested = paragraphs
      .filter((other) => other.entry === paragraph.entry && other.index > paragraph.index && other.line - 1 >= own && other.line - 1 < itemEnd)
      .map((other) => other.index);
  }
  return { source, ast, lineStarts, paragraphs, entryLines };
}

/** The 0-based end line of the list item a paragraph is the first paragraph of. */
function nodeLinesOfItem(paragraph: SourceParagraph, paragraphs: readonly SourceParagraph[]): number {
  void paragraphs;
  const list = paragraph.listItem!.list;
  const find = (node: MarkdocNode): MarkdocNode | undefined => {
    for (const item of node.children) {
      const lines = nodeLines(item);
      if (item.type === 'item' && lines && lines[0] + 1 === paragraph.line) return item;
      for (const child of item.children) {
        if (child.type !== 'list') continue;
        const found = find(child);
        if (found) return found;
      }
    }
    return undefined;
  };
  const item = find(list);
  return item ? nodeLines(item)![1] : paragraph.ownLines![1];
}
