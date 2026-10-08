import type { Node as MarkdocNode } from '@markdoc/markdoc';
import { DocxMarkdocError } from '../errors.js';

/**
 * The closed creation grammar, checked before any rendering so every
 * unsupported construct fails with a stable code and a source line instead of
 * being flattened by the lenient engine.
 */

const FRONTMATTER_KEYS = new Set(['title', 'author', 'date', 'footer', 'page-numbers', 'fill-ins']);

/** Block tags and the attributes each admits. */
export const CREATION_BLOCK_TAGS: Record<string, ReadonlySet<string>> = {
  center: new Set(),
  legend: new Set(),
  signer: new Set(['name', 'date']),
  'page-break': new Set(),
  section: new Set(['footer', 'page-numbers']),
  table: new Set(['widths']),
};
const INLINE_TAGS: Record<string, ReadonlySet<string>> = { literal: new Set(), fill: new Set() };
/** Tags that structure the document and may appear only at the top level. */
const TOP_LEVEL_ONLY = new Set(['page-break', 'section']);

const LEGACY_HINTS: Array<[RegExp, string]> = [
  [/^<center\b/i, '{% center %}…{% /center %}'],
  [/^<legend\b/i, '{% legend %}…{% /legend %}'],
  [/^<signer\b/i, '{% signer name="…" date="…" /%}'],
  [/^<!--\s*pagebreak\s*-->$/i, '{% page-break /%}'],
  [/^<!--\s*page-numbers\s*-->$/i, 'frontmatter `page-numbers: true` or {% section page-numbers=true /%}'],
  [/^<!--\s*section\b[\s\S]*-->$/i, '{% section footer="…" /%}'],
  [/^<!--[\s\S]*-->$/, 'a Markdoc tag (HTML comments are not markup here)'],
];

export type CreationFrontmatter = {
  title?: string;
  author?: string;
  date?: string;
  footer?: string;
  pageNumbers?: boolean;
  /**
   * How fill-ins are written. 'markup' (default): only {% fill %}…{% /fill %}
   * is a fill-in and bare brackets are literal text. 'brackets': the v0.24
   * behaviour, where every […] is a highlighted fill-in.
   */
  fillIns?: 'markup' | 'brackets';
};

export function lineOf(node: MarkdocNode | undefined): number | undefined {
  const start = node?.lines?.[0];
  return start === undefined ? undefined : start + 1;
}

export function creationError(code: string, message: string, node?: MarkdocNode, line?: number): never {
  const at = line ?? lineOf(node);
  throw new DocxMarkdocError(code, at === undefined ? message : `${message} (line ${at})`, at === undefined ? undefined : { line: at });
}

/** Parse the closed `key: value` frontmatter; no YAML dependency, no surprises. */
export function parseCreationFrontmatter(raw: string | undefined): CreationFrontmatter {
  const result: CreationFrontmatter = {};
  if (!raw) return result;
  for (const [index, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue;
    const match = /^([a-z-]+):\s*(.*)$/.exec(line.trim());
    if (!match || !FRONTMATTER_KEYS.has(match[1]!)) {
      throw new DocxMarkdocError('UNSUPPORTED_CREATION_FRONTMATTER', `Unsupported frontmatter line ${index + 2}: '${line.trim()}'. Allowed keys: ${[...FRONTMATTER_KEYS].join(', ')}.`);
    }
    const key = match[1]!;
    let value = match[2]!.trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (key === 'fill-ins') {
      if (value !== 'markup' && value !== 'brackets') {
        throw new DocxMarkdocError('UNSUPPORTED_CREATION_FRONTMATTER', `fill-ins must be markup or brackets, got '${value}'.`);
      }
      result.fillIns = value;
    } else if (key === 'page-numbers') {
      if (value !== 'true' && value !== 'false') {
        throw new DocxMarkdocError('UNSUPPORTED_CREATION_FRONTMATTER', `page-numbers must be true or false, got '${value}'.`);
      }
      result.pageNumbers = value === 'true';
    } else if (key === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z)?$/.test(value) || Number.isNaN(Date.parse(value))) {
        throw new DocxMarkdocError('UNSUPPORTED_CREATION_FRONTMATTER', `date must be YYYY-MM-DD or a UTC ISO timestamp, got '${value}'.`);
      }
      result.date = value;
    } else {
      if (!value) throw new DocxMarkdocError('UNSUPPORTED_CREATION_FRONTMATTER', `${key} must not be empty.`);
      (result as Record<string, string>)[key] = value;
    }
  }
  return result;
}

/** The block tag a paragraph stands for when its only content is one tag (`{% center %}x{% /center %}` on one line). */
export function soleInlineTag(paragraph: MarkdocNode): MarkdocNode | undefined {
  if (paragraph.type !== 'paragraph') return undefined;
  const inline = paragraph.children.length === 1 && paragraph.children[0]!.type === 'inline' ? paragraph.children[0]! : undefined;
  if (!inline) return undefined;
  const meaningful = inline.children.filter((child) => !(child.type === 'text' && !String(child.attributes.content ?? '').trim()));
  const only = meaningful.length === 1 ? meaningful[0]! : undefined;
  return only?.type === 'tag' && only.tag !== undefined && only.tag in CREATION_BLOCK_TAGS ? only : undefined;
}

function checkAttributes(node: MarkdocNode, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(node.attributes)) {
    if (!allowed.has(key)) creationError('UNSUPPORTED_CREATION_ATTRIBUTE', `Tag '${node.tag}' does not admit attribute '${key}'.`, node);
  }
}

function inlineText(node: MarkdocNode, skipLiteral = false): string {
  if (node.type === 'text') return String(node.attributes.content ?? '');
  if (node.type === 'softbreak') return ' ';
  if (node.type === 'hardbreak') return '\n';
  if (skipLiteral && node.type === 'tag' && node.tag === 'literal') return '';
  return node.children.map((child) => inlineText(child, skipLiteral)).join('');
}

/** True while validating a document whose frontmatter opts into bracket fill-ins (v0.24 behaviour). */
let bracketFillIns = false;

/**
 * Check one run of inline content: admitted node types, legacy markup, and
 * fill-ins. `highlight` is false where nothing may be highlighted (a legend).
 * Bare brackets are literal text unless the document opts into bracket
 * fill-ins, in which case they must balance.
 */
function checkInline(children: MarkdocNode[], line: number | undefined, highlight: boolean): void {
  // Whole-paragraph legacy pseudo-HTML first: it gets a migration hint rather than a generic HTML error.
  const text = children.map((child) => inlineText(child)).join('').trim();
  // Legacy detection looks only at text outside {% literal %}: literal markup is content, not a migration leftover.
  const markupText = children.map((child) => inlineText(child, true)).join('').trim();
  for (const [pattern, hint] of LEGACY_HINTS) {
    if (markupText && pattern.test(markupText)) creationError('LEGACY_MARKUP', `Legacy markup '${markupText.slice(0, 40)}' is not supported; use ${hint}.`, undefined, line);
  }
  let depth = 0;
  const visit = (node: MarkdocNode, literal: boolean): void => {
    switch (node.type) {
      case 'inline':
      case 'strong':
      case 'em':
        node.children.forEach((child) => visit(child, literal));
        return;
      case 'softbreak':
      case 'hardbreak':
        return;
      case 'text': {
        const content = String(node.attributes.content ?? '');
        if (!literal && /<\/?[A-Za-z][A-Za-z0-9-]*(\s[^<>]*)?\/?>/.test(content)) {
          creationError('UNSUPPORTED_HTML', `HTML is not supported in created documents ('${content.match(/<[^>]*>/)![0]}'); use Markdoc, or wrap literal text in {% literal %}.`, undefined, line);
        }
        if (literal || !highlight || !bracketFillIns) return;
        for (const char of String(node.attributes.content ?? '')) {
          if (char === '[') depth += 1;
          if (char === ']') {
            if (depth === 0) creationError('UNBALANCED_FILL_IN', `Unmatched ']' in fill-in text (fill-ins: brackets); wrap literal brackets in {% literal %}.`, undefined, line);
            depth -= 1;
          }
        }
        return;
      }
      case 'tag': {
        const allowed = INLINE_TAGS[node.tag ?? ''];
        if (!allowed) creationError('UNSUPPORTED_CREATION_SYNTAX', `Tag '{% ${node.tag} %}' cannot appear inside text.`, node, line);
        checkAttributes(node, allowed);
        if (node.tag === 'fill') {
          if (literal) creationError('INVALID_FILL_IN', '{% fill %} cannot appear inside {% literal %}.', node, line);
          if (!highlight) creationError('INVALID_FILL_IN', '{% fill %} cannot appear in a legend, which is never highlighted.', node, line);
          if (!node.children.map((child) => inlineText(child)).join('').trim()) creationError('INVALID_FILL_IN', '{% fill %} needs text, such as {% fill %}Effective Date{% /fill %}.', node, line);
          node.children.forEach((child) => visit(child, false));
          return;
        }
        node.children.forEach((child) => visit(child, true));
        return;
      }
      default:
        creationError('UNSUPPORTED_CREATION_SYNTAX', `Unsupported inline syntax '${node.type}'.`, node, line);
    }
  };
  children.forEach((child) => visit(child, false));
  if (!text) creationError('EMPTY_CREATION_BLOCK', 'Empty block.', undefined, line);
  if (depth > 0) creationError('UNBALANCED_FILL_IN', `Unclosed '[' in fill-in text (fill-ins: brackets); wrap literal brackets in {% literal %}.`, undefined, line);
}

function checkList(list: MarkdocNode, depth: number): void {
  if (depth > 2) creationError('LIST_TOO_DEEP', 'Lists may nest at most three levels.', list);
  for (const item of list.children) {
    if (item.type !== 'item') creationError('UNSUPPORTED_CREATION_SYNTAX', `Unexpected list child '${item.type}'.`, item);
    const text = item.children.filter((child) => child.type === 'inline' || child.type === 'paragraph');
    const nested = item.children.filter((child) => child.type === 'list');
    const other = item.children.find((child) => !['inline', 'paragraph', 'list'].includes(child.type));
    if (other) creationError('UNSUPPORTED_CREATION_SYNTAX', `List items may not contain '${other.type}'.`, other);
    if (text.length !== 1) creationError('UNSUPPORTED_CREATION_SYNTAX', 'Each list item must hold exactly one paragraph of text.', item);
    checkInline(text[0]!.type === 'paragraph' ? text[0]!.children : [text[0]!], lineOf(item), true);
    for (const child of nested) {
      if ((child.attributes.ordered === true) !== (list.attributes.ordered === true)) {
        creationError('MIXED_LIST_NESTING', 'A nested list must match its parent list type (ordered or bullet).', child);
      }
      if (child.attributes.ordered === true && Number.isInteger(child.attributes.start) && child.attributes.start !== 1) {
        creationError('NESTED_LIST_START', 'A nested list always numbers from (a) or (i); start it at 1.', child);
      }
      checkList(child, depth + 1);
    }
  }
}

function checkTable(node: MarkdocNode): void {
  const grid = node.children.find((child) => child.type === 'table');
  if (!grid || node.children.some((child) => child !== grid)) creationError('UNSUPPORTED_CREATION_SYNTAX', '{% table %} must contain one Markdoc table.', node);
  const rows = grid.children.flatMap((group) => group.children);
  const columns = rows[0]?.children.length ?? 0;
  if (columns === 0) creationError('EMPTY_CREATION_TABLE', 'A table needs at least one row and one column.', node);
  for (const row of rows) {
    if (row.type !== 'tr') creationError('UNSUPPORTED_CREATION_SYNTAX', `Unexpected table node '${row.type}'.`, row);
    if (row.children.length !== columns) creationError('RAGGED_CREATION_TABLE', `Every row must have ${columns} cells.`, row.children[0] ?? row, lineOf(row) ?? lineOf(node));
    for (const cell of row.children) {
      const content = cell.children.flatMap((child) => (child.type === 'paragraph' ? child.children : [child]));
      if (content.length > 0) checkInline(content, lineOf(cell) ?? lineOf(node), true);
    }
  }
  const widths = node.attributes.widths;
  if (widths !== undefined) {
    const parts = typeof widths === 'string' ? widths.split(',').map((part) => Number(part.trim())) : [];
    if (parts.length !== columns || parts.some((part) => !Number.isFinite(part) || part <= 0)) {
      creationError('INVALID_TABLE_WIDTHS', `widths must list ${columns} positive numbers, such as "30,70".`, node);
    }
  }
}

function checkBlockTag(node: MarkdocNode, topLevel: boolean, line: number | undefined): void {
  const allowed = CREATION_BLOCK_TAGS[node.tag ?? ''];
  if (!allowed) creationError('UNSUPPORTED_CREATION_TAG', `Unsupported tag '{% ${node.tag} %}'.`, node, line);
  checkAttributes(node, allowed);
  if (TOP_LEVEL_ONLY.has(node.tag!) && !topLevel) creationError('UNSUPPORTED_CREATION_SYNTAX', `{% ${node.tag} /%} must stand at the top level.`, node, line);
  switch (node.tag) {
    case 'center':
    case 'legend': {
      const paragraphs = node.children.filter((child) => child.type === 'paragraph');
      if (paragraphs.length > 0) {
        const other = node.children.find((child) => child.type !== 'paragraph');
        if (other) creationError('UNSUPPORTED_CREATION_SYNTAX', `{% ${node.tag} %} may contain only paragraphs, not '${other.type}'.`, other);
        for (const paragraph of paragraphs) checkInline(paragraph.children, lineOf(paragraph), node.tag === 'center');
      } else {
        checkInline(node.children, line, node.tag === 'center');
      }
      return;
    }
    case 'signer': {
      // The name is either name="…" (plain text) or the tag's inline content, which may hold {% fill %}.
      const { name, date } = node.attributes;
      const content = node.children.flatMap((child) => (child.type === 'paragraph' ? child.children : [child]));
      if (node.children.some((child) => child.type !== 'paragraph' && child.type !== 'inline' && child.type !== 'text' && child.type !== 'tag' && child.type !== 'strong' && child.type !== 'em')) {
        creationError('UNSUPPORTED_CREATION_SYNTAX', '{% signer %} content must be one line of text.', node, line);
      }
      if (node.children.filter((child) => child.type === 'paragraph').length > 1) creationError('INVALID_SIGNER', '{% signer %} content must be one paragraph.', node, line);
      if (name !== undefined && content.length > 0) creationError('INVALID_SIGNER', 'Give the signer name either as name="…" or as the tag content, not both.', node, line);
      if (name === undefined && content.length === 0) creationError('INVALID_SIGNER', '{% signer /%} requires a name: name="…" or {% signer %}Name{% /signer %}.', node, line);
      if (name !== undefined && (typeof name !== 'string' || !name.trim())) creationError('INVALID_SIGNER', '{% signer /%} requires a non-empty name="…".', node, line);
      if (date !== undefined && (typeof date !== 'string' || !date.trim())) creationError('INVALID_SIGNER', 'signer date="…" must be a non-empty string.', node, line);
      if (content.length > 0) checkInline(content, line, true);
      for (const value of [name, date]) {
        if (typeof value === 'string') checkInline([{ type: 'text', attributes: { content: value }, children: [] } as unknown as MarkdocNode], line, true);
      }
      return;
    }
    case 'page-break':
      if (node.children.length > 0) creationError('UNSUPPORTED_CREATION_SYNTAX', '{% page-break /%} takes no content.', node, line);
      return;
    case 'section': {
      if (node.children.length > 0) creationError('UNSUPPORTED_CREATION_SYNTAX', '{% section /%} is self-closing.', node, line);
      const { footer } = node.attributes;
      const pageNumbers = node.attributes['page-numbers'];
      if (footer !== undefined && (typeof footer !== 'string' || !footer.trim())) creationError('INVALID_SECTION', 'section footer="…" must be a non-empty string.', node, line);
      if (pageNumbers !== undefined && typeof pageNumbers !== 'boolean') creationError('INVALID_SECTION', 'section page-numbers must be true or false.', node, line);
      return;
    }
    case 'table':
      checkTable(node);
      return;
  }
}

/** Markdoc's own parse errors (for example an unclosed tag) fail before anything else. */
function checkParseErrors(node: MarkdocNode): void {
  const error = node.errors?.[0];
  if (error) creationError('INVALID_CREATION_MARKDOC', `Markdoc error: ${error.message}.`, node);
  node.children.forEach(checkParseErrors);
}

/** Validate every top-level block of a parsed creation document. */
export function validateCreationAst(children: MarkdocNode[], options: { fillIns?: 'markup' | 'brackets' } = {}): void {
  bracketFillIns = options.fillIns === 'brackets';
  try {
    validateBlocks(children);
  } finally {
    bracketFillIns = false;
  }
}

function validateBlocks(children: MarkdocNode[]): void {
  children.forEach(checkParseErrors);
  for (const node of children) {
    const line = lineOf(node);
    switch (node.type) {
      case 'heading': {
        const level = Number(node.attributes.level);
        if (level < 1 || level > 3) creationError('UNSUPPORTED_HEADING_LEVEL', `Heading level ${level} is not supported; use #, ## or ###.`, node);
        checkInline(node.children, line, true);
        break;
      }
      case 'paragraph': {
        const tag = soleInlineTag(node);
        if (tag) checkBlockTag(tag, true, line);
        else checkInline(node.children, line, true);
        break;
      }
      case 'blockquote':
        for (const child of node.children) {
          if (child.type !== 'paragraph') creationError('UNSUPPORTED_CREATION_SYNTAX', `Quotes may contain only paragraphs, not '${child.type}'.`, child);
          checkInline(child.children, lineOf(child), true);
        }
        break;
      case 'list':
        checkList(node, 0);
        break;
      case 'tag':
        checkBlockTag(node, true, line);
        break;
      default:
        creationError('UNSUPPORTED_CREATION_SYNTAX', `Unsupported block syntax '${node.type}'.`, node);
    }
  }
}
