import type { Node as MarkdocNode } from '@markdoc/markdoc';
import { BookmarkNameError, bookmarkNamesForSlugs } from '@usejunior/docx-core';
import { DocxMarkdocError } from '../errors.js';
import { HEADING_NUMBER_SCHEMES, type HeadingNumberScheme } from './list-numbering.js';

/**
 * The closed creation grammar, checked before any rendering so every
 * unsupported construct fails with a stable code and a source line instead of
 * being flattened by the lenient engine.
 */

const FRONTMATTER_KEYS = new Set(['title', 'author', 'date', 'footer', 'page-numbers', 'fill-ins', 'heading-numbers']);

/** Block tags and the attributes each admits. */
export const CREATION_BLOCK_TAGS: Record<string, ReadonlySet<string>> = {
  center: new Set(),
  legend: new Set(),
  signer: new Set(['name', 'date']),
  'page-break': new Set(),
  section: new Set(['footer', 'page-numbers']),
  table: new Set(['widths']),
  footnote: new Set(['id']),
};
/**
 * Inline tags and the attributes each admits. `literal` makes its content
 * literal text and `fill` marks a fill-in (both checked below); `u` underlines
 * its content and, like `**` and `*`, keeps the context it sits in; `fnref`
 * places the reference mark of the `{% footnote %}` block with the same id;
 * `xref` places a cross-reference to the heading or list item whose `{% #id %}`
 * it names (`to`), as its full number (`number="full"`, the default) or its
 * own level's number (`number="paragraph"`), optionally preceded by the word
 * "Section " (`format="section"`). A new inline tag needs an entry here, a branch in `visit()` below, a renderer
 * (an engine branch or a creation theme plugin) and, when it changes the text,
 * a case in the round-trip oracle.
 */
const INLINE_TAGS: Record<string, ReadonlySet<string>> = {
  literal: new Set(),
  fill: new Set(),
  u: new Set(),
  fnref: new Set(['id']),
  xref: new Set(['to', 'number', 'format']),
};
/** `{% xref number="…" %}` values: the full number ("2(b)") or the target level's own ("(b)"). */
export const XREF_NUMBERS: ReadonlySet<string> = new Set(['full', 'paragraph']);
/** `{% xref format="…" %}` values: "section" puts the word "Section " before the number. */
export const XREF_FORMATS: ReadonlySet<string> = new Set(['section']);
/** A target id: lowercase kebab-case starting with a letter, such as `purchase-price-adjustment`. */
const TARGET_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Tags that structure the document and may appear only at the top level. */
const TOP_LEVEL_ONLY = new Set(['page-break', 'section', 'footnote']);

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
  /**
   * How `##` and `###` headings are numbered. 'legal': `##` is "ARTICLE I",
   * `###` is "Section 1.01", and ordered lists under them are `(a)`, `(i)`,
   * `(A)`. Absent, headings are not numbered.
   */
  headingNumbers?: HeadingNumberScheme;
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
    } else if (key === 'heading-numbers') {
      if (!(HEADING_NUMBER_SCHEMES as readonly string[]).includes(value)) {
        throw new DocxMarkdocError('UNSUPPORTED_CREATION_FRONTMATTER', `heading-numbers must be ${HEADING_NUMBER_SCHEMES.join(' or ')}, got '${value}'.`);
      }
      result.headingNumbers = value as HeadingNumberScheme;
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
  // A cross-reference renders as its target's number: it is text, not an empty block.
  if (node.type === 'tag' && node.tag === 'xref') return '[xref]';
  return node.children.map((child) => inlineText(child, skipLiteral)).join('');
}

/** True while validating a document whose frontmatter opts into bracket fill-ins (v0.24 behaviour). */
let bracketFillIns = false;
/** True while validating the paragraphs of a `{% footnote %}` body. */
let inFootnoteBody = false;

/** The id of a `{% fnref %}` or `{% footnote %}`: a non-empty string, else INVALID_FOOTNOTE. */
function footnoteId(node: MarkdocNode, line: number | undefined): string {
  const id = node.attributes.id;
  if (typeof id !== 'string' || !id.trim()) {
    creationError('INVALID_FOOTNOTE', `{% ${node.tag} %} requires a non-empty id="…", such as id="1".`, node, line);
  }
  return id;
}

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
  let fillDepth = 0;
  const visit = (node: MarkdocNode, literal: boolean): void => {
    switch (node.type) {
      case 'inline':
      case 'strong':
      case 'em':
        node.children.forEach((child) => visit(child, literal));
        return;
      case 'softbreak':
        return;
      case 'hardbreak':
        if (inFootnoteBody) creationError('INVALID_FOOTNOTE', 'A footnote cannot contain a line break; start a new paragraph instead.', node, line);
        return;
      case 'text': {
        const content = String(node.attributes.content ?? '');
        if (!literal && /<\/?[A-Za-z][A-Za-z0-9-]*(\s[^<>]*)?\/?>/.test(content)) {
          const html = content.match(/<[^>]*>/)![0];
          const hint = /^<\/?u\s*>$/i.test(html) ? 'use {% u %}…{% /u %} to underline' : 'use Markdoc';
          creationError('UNSUPPORTED_HTML', `HTML is not supported in created documents ('${html}'); ${hint}, or wrap literal text in {% literal %}.`, undefined, line);
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
        if (inFootnoteBody && (node.tag === 'fnref' || node.tag === 'footnote')) {
          creationError('NESTED_FOOTNOTE', 'A footnote cannot contain another footnote or a footnote reference.', node, line);
        }
        const allowed = INLINE_TAGS[node.tag ?? ''];
        if (!allowed) creationError('UNSUPPORTED_CREATION_SYNTAX', `Tag '{% ${node.tag} %}' cannot appear inside text.`, node, line);
        checkAttributes(node, allowed);
        if (node.tag === 'fnref') {
          footnoteId(node, line);
          if (node.children.length > 0) creationError('INVALID_FOOTNOTE', '{% fnref /%} is self-closing; put the note text in a {% footnote %} block.', node, line);
          if (literal || fillDepth > 0) creationError('INVALID_FOOTNOTE', `{% fnref /%} cannot appear inside {% ${literal ? 'literal' : 'fill'} %}.`, node, line);
          return;
        }
        if (node.tag === 'xref') {
          checkCrossReferenceTag(node, line, literal ? 'literal' : fillDepth > 0 ? 'fill' : null);
          return;
        }
        if (node.tag === 'fill') {
          if (literal) creationError('INVALID_FILL_IN', '{% fill %} cannot appear inside {% literal %}.', node, line);
          if (!highlight) creationError('INVALID_FILL_IN', '{% fill %} cannot appear in a legend, which is never highlighted.', node, line);
          if (!node.children.map((child) => inlineText(child)).join('').trim()) creationError('INVALID_FILL_IN', '{% fill %} needs text, such as {% fill %}Effective Date{% /fill %}.', node, line);
          fillDepth += 1;
          node.children.forEach((child) => visit(child, false));
          fillDepth -= 1;
          return;
        }
        if (node.tag === 'u') {
          if (!node.children.map((child) => inlineText(child)).join('')) creationError('INVALID_UNDERLINE', '{% u %} needs text, such as {% u %}Purchase Price{% /u %}.', node, line);
          node.children.forEach((child) => visit(child, literal));
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

/** One `{% xref /%}`: self-closing, outside literal text and fill-ins, with a well-formed id and options. */
function checkCrossReferenceTag(node: MarkdocNode, line: number | undefined, inside: 'literal' | 'fill' | null): void {
  if (node.children.length > 0) creationError('INVALID_CROSS_REFERENCE', '{% xref /%} is self-closing; its text is the target\'s number.', node, line);
  if (inside) creationError('INVALID_CROSS_REFERENCE', `{% xref /%} cannot appear inside {% ${inside} %}.`, node, line);
  const { to, number, format } = node.attributes;
  if (typeof to !== 'string' || !TARGET_ID_RE.test(to)) {
    creationError('INVALID_CROSS_REFERENCE', `{% xref /%} needs to="…" naming a kebab-case id, such as to="purchase-price-adjustment"; got ${JSON.stringify(to ?? null)}.`, node, line);
  }
  if (number !== undefined && (typeof number !== 'string' || !XREF_NUMBERS.has(number))) {
    creationError('INVALID_CROSS_REFERENCE', `{% xref /%} number must be "full" or "paragraph", got ${JSON.stringify(number)}.`, node, line);
  }
  if (format !== undefined && (typeof format !== 'string' || !XREF_FORMATS.has(format))) {
    creationError('INVALID_CROSS_REFERENCE', `{% xref /%} format must be "section", got ${JSON.stringify(format)}.`, node, line);
  }
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
    case 'footnote':
      checkFootnoteBlock(node, line);
      return;
  }
}

/**
 * A footnote body: one line of text, or paragraphs of text. Each paragraph
 * may hold inline formatting, `{% u %}`, `{% fill %}` and `{% literal %}`,
 * but not a list, table, heading, line break, or another footnote.
 */
function checkFootnoteBlock(node: MarkdocNode, line: number | undefined): void {
  footnoteId(node, line);
  if (node.children.length === 0) creationError('INVALID_FOOTNOTE', '{% footnote %} needs text, such as {% footnote id="1" %}See Section 2.{% /footnote %}.', node, line);
  const blockForm = node.children.some((child) => child.type !== 'inline' && child.type !== 'text' && child.type !== 'tag' && child.type !== 'strong' && child.type !== 'em' && child.type !== 'softbreak' && child.type !== 'hardbreak');
  inFootnoteBody = true;
  try {
    if (!blockForm) {
      checkInline(node.children, line, true);
      return;
    }
    for (const child of node.children) {
      if (child.type === 'tag' && child.tag === 'footnote') creationError('NESTED_FOOTNOTE', 'A footnote cannot contain another footnote.', child);
      if (child.type !== 'paragraph') creationError('INVALID_FOOTNOTE', `A footnote may contain only paragraphs of text, not '${child.type === 'tag' ? `{% ${child.tag} %}` : child.type}'.`, child);
      if (soleInlineTag(child)?.tag === 'footnote') creationError('NESTED_FOOTNOTE', 'A footnote cannot contain another footnote.', child);
      checkInline(child.children, lineOf(child), true);
    }
  } finally {
    inFootnoteBody = false;
  }
}

type FootnoteSite = { id: string; line?: number };

/** Every `{% fnref %}` under `node`, in document order, with the line of its nearest block. */
function collectReferences(node: MarkdocNode, line: number | undefined, out: FootnoteSite[]): void {
  const here = lineOf(node) ?? line;
  if (node.type === 'tag' && node.tag === 'fnref') out.push({ id: String(node.attributes.id), ...(here === undefined ? {} : { line: here }) });
  for (const child of node.children) collectReferences(child, here, out);
}

/**
 * Pair every reference with exactly one body: each id has one `{% footnote %}`
 * block and one `{% fnref /%}`. Word gives every reference its own note, so a
 * reference reused for a second mark is an error, as is an unused body.
 */
function checkFootnotePairs(children: MarkdocNode[]): void {
  const bodies = new Map<string, FootnoteSite>();
  const references: FootnoteSite[] = [];
  for (const node of children) {
    const tag = node.type === 'tag' ? node : soleInlineTag(node);
    if (tag?.tag === 'footnote') {
      const id = String(tag.attributes.id);
      const at = lineOf(node);
      if (bodies.has(id)) creationError('DUPLICATE_FOOTNOTE_ID', `Footnote id="${id}" is defined twice (first at line ${bodies.get(id)!.line ?? '?'}).`, undefined, at);
      bodies.set(id, { id, ...(at === undefined ? {} : { line: at }) });
    } else {
      collectReferences(node, undefined, references);
    }
  }
  const referenced = new Map<string, FootnoteSite>();
  for (const reference of references) {
    if (referenced.has(reference.id)) {
      creationError('DUPLICATE_FOOTNOTE_REFERENCE', `Footnote id="${reference.id}" is referenced twice (first at line ${referenced.get(reference.id)!.line ?? '?'}); each reference needs its own footnote.`, undefined, reference.line);
    }
    referenced.set(reference.id, reference);
    if (!bodies.has(reference.id)) {
      creationError('FOOTNOTE_REFERENCE_WITHOUT_BODY', `{% fnref id="${reference.id}" /%} has no {% footnote id="${reference.id}" %} body.`, undefined, reference.line);
    }
  }
  for (const body of bodies.values()) {
    if (!referenced.has(body.id)) {
      creationError('FOOTNOTE_BODY_WITHOUT_REFERENCE', `{% footnote id="${body.id}" %} is never referenced; add {% fnref id="${body.id}" /%} where its mark belongs.`, undefined, body.line);
    }
  }
}

/** Markdoc's own parse errors (for example an unclosed tag) fail before anything else. */
function checkParseErrors(node: MarkdocNode): void {
  const error = node.errors?.[0];
  if (error) creationError('INVALID_CREATION_MARKDOC', `Markdoc error: ${error.message}.`, node);
  node.children.forEach(checkParseErrors);
}

/** Validate every top-level block of a parsed creation document. */
/**
 * Characters XML 1.0 cannot hold: the C0 controls other than tab, line feed
 * and carriage return. A source holding one would produce a document Word
 * refuses, and the verification walker uses some of them as private
 * stand-ins, so they are refused before anything else.
 */
const XML_INVALID_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u;

export function checkCreationSourceCharacters(source: string): void {
  const match = XML_INVALID_CONTROL.exec(source);
  if (!match) return;
  const line = source.slice(0, match.index).split('\n').length;
  const code = match[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
  creationError('INVALID_CHARACTER', `The source holds control character U+${code}, which a Word document cannot hold.`, undefined, line);
}

export function validateCreationAst(children: MarkdocNode[], options: { fillIns?: 'markup' | 'brackets'; headingNumbers?: HeadingNumberScheme } = {}): void {
  bracketFillIns = options.fillIns === 'brackets';
  try {
    validateBlocks(children);
    if (options.headingNumbers) checkHeadingNumbering(children);
    checkFootnotePairs(children);
    checkCrossReferenceTargets(children, options.headingNumbers !== undefined);
  } finally {
    bracketFillIns = false;
    inFootnoteBody = false;
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

/**
 * A canonical upper-case Roman numeral (I to MMMCMXCIX), as `upperRoman`
 * writes it, that ends a word: no letter, combining mark or digit of any
 * script follows it, so "Légal" and "Même" are words, not "L" and "M".
 */
const ROMAN_NUMERAL = '(?=[IVXLCDM])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})(?![\\p{L}\\p{M}\\p{N}])';
/**
 * Heading text that already starts with the number the heading definition
 * generates ("ARTICLE IV", "Article IV", "Section 2.04"). Ordinary words
 * after "Article" ("Article Civil Rights", "Article Integrity") and
 * statutory references ("Section 409A") are not numbers.
 */
const GENERATED_HEADING_NUMBER: Record<number, RegExp> = {
  2: new RegExp(`^(?:ARTICLE|Article|article)\\s+${ROMAN_NUMERAL}`, 'u'),
  3: /^Section\s+\d+\.\d+/iu,
};

/**
 * With `heading-numbers` on, `##` and `###` headings are numbered and the
 * ordered lists under them are their clauses. A `###` needs a `##` before it
 * (a Section number names its Article). A heading must not repeat the
 * number it is given. The clauses restart at `(a)` under each heading, so
 * the first ordered list under a heading starts at `1.` and a later one
 * continues the previous list under the same heading: the numbers Word
 * shows then equal the markers (`3.` is `(c)`).
 *
 * Clauses may sit directly under an Article only when no Section of that
 * Article follows them. Word counts a clause paragraph that skips the
 * Section level as if the Section level were at its start value, so the
 * next Section would read "Section 1.02" with no 1.01 (evidence:
 * scripts/oracle/word/evidence/issue-1254-word-16.114.json, levels 0, 2, 1;
 * and issue-1250-word-16.114.json).
 */
function checkHeadingNumbering(children: MarkdocNode[]): void {
  let articles = 0;
  let next: number | null = null;
  // Line of an ordered list placed directly under the current Article, before any of its Sections.
  let articleClauses: number | undefined | null = null;
  // Whether the current heading is an Article (`##`) rather than a Section.
  let inArticleScope = false;
  for (const node of children) {
    if (node.type === 'heading') {
      const level = Number(node.attributes.level);
      if (level < 2) continue;
      if (level === 3 && articles === 0) {
        creationError('HEADING_NUMBER_SKIPS_LEVEL', 'A ### heading is a Section of the ## Article before it (heading-numbers: legal); put a ## heading first.', node);
      }
      if (level === 3 && articleClauses !== null) {
        creationError(
          'SECTION_AFTER_ARTICLE_CLAUSES',
          `This Section follows clauses placed directly under its Article (line ${articleClauses ?? '?'}); Word counts those clauses as the Article's first Section, so this heading would read Section N.02, not N.01. Put the clauses under a ### Section.`,
          node,
        );
      }
      if (level === 2) articles += 1;
      articleClauses = null;
      inArticleScope = level === 2;
      const text = node.children.map((child) => inlineText(child)).join('').trim();
      if (GENERATED_HEADING_NUMBER[level]!.test(text)) {
        creationError('DUPLICATE_HEADING_NUMBER', `Heading '${text.slice(0, 40)}' repeats the number heading-numbers gives it; write only the heading text.`, node);
      }
      next = 1;
      continue;
    }
    if (node.type !== 'list' || node.attributes.ordered !== true || next === null) continue;
    if (inArticleScope && articleClauses === null) articleClauses = lineOf(node);
    const start = Number.isInteger(node.attributes.start) ? Number(node.attributes.start) : 1;
    if (start !== next) {
      creationError(
        'HEADING_LIST_START',
        `Under a numbered heading, clauses number (a), (b), … and restart at each heading, so this list must start at ${next}. (${next === 1 ? 'the first list under the heading' : 'continuing the list before it under the same heading'}), not ${start}.`,
        node,
      );
    }
    next = start + node.children.length;
  }
}

/**
 * Where a target's number comes from: `headingNumbered` marks a numbered
 * heading, or an ordered list item under one, numbered by the heading
 * definition ("Section 1.01", "Section 1.01(a)"); `articleClause` marks such
 * an item directly under an Article, before any Section.
 */
type TargetSite = { kind: 'heading' | 'numbered' | 'bullet'; line?: number; headingNumbered?: true; articleClause?: true };

/** Which numbered heading a top-level block sits under, with `heading-numbers` on. */
type HeadingScope = 'none' | 'article' | 'section';

/**
 * Every `{% #id %}` target, keyed by id: a heading, or a list item of an
 * ordered (numbered) or bullet list. An id anywhere else fails with
 * ID_PLACEMENT; tag attributes named `id` (`fnref`, `footnote`) are not
 * targets.
 */
function collectTargets(node: MarkdocNode, ordered: boolean, line: number | undefined, out: Map<string, TargetSite>, scope: HeadingScope = 'none'): void {
  const here = lineOf(node) ?? line;
  const id = node.type === 'tag' || node.type === 'document' ? undefined : node.attributes.id;
  if (id !== undefined) {
    if (node.type !== 'heading' && node.type !== 'item') {
      creationError('ID_PLACEMENT', `An id ({% #${String(id)} %}) may mark only a heading or a list item, not '${node.type}'.`, undefined, here);
    }
    if (typeof id !== 'string' || !TARGET_ID_RE.test(id)) {
      creationError('INVALID_ID', `Id '${String(id)}' must be lowercase kebab-case starting with a letter, such as purchase-price-adjustment.`, undefined, here);
    }
    const earlier = out.get(id);
    if (earlier) creationError('DUPLICATE_ID', `Id '${id}' is used twice (first at line ${earlier.line ?? '?'}).`, undefined, here);
    const kind = node.type === 'heading' ? 'heading' : ordered ? 'numbered' : 'bullet';
    const numberedByHeading = scope !== 'none' && (kind === 'numbered' || (kind === 'heading' && Number(node.attributes.level) >= 2));
    out.set(id, {
      kind,
      ...(here === undefined ? {} : { line: here }),
      ...(numberedByHeading ? { headingNumbered: true as const } : {}),
      ...(numberedByHeading && kind === 'numbered' && scope === 'article' ? { articleClause: true as const } : {}),
    });
  }
  const childOrdered = node.type === 'list' ? node.attributes.ordered === true : ordered;
  for (const child of node.children) collectTargets(child, childOrdered, here, out, scope);
}

/** Every `{% xref /%}` under `node`, in document order, with the line of its nearest block. */
type CrossReferenceSite = { to: string; number?: string; format?: string; line?: number };

function collectCrossReferences(node: MarkdocNode, line: number | undefined, out: CrossReferenceSite[]): void {
  const here = lineOf(node) ?? line;
  if (node.type === 'tag' && node.tag === 'xref') {
    const { number, format } = node.attributes;
    out.push({
      to: String(node.attributes.to),
      ...(number === undefined ? {} : { number: String(number) }),
      ...(format === undefined ? {} : { format: String(format) }),
      ...(here === undefined ? {} : { line: here }),
    });
  }
  for (const child of node.children) collectCrossReferences(child, here, out);
}

/**
 * Ids are unique and map to distinct Word bookmark names; every
 * `{% xref /%}` names an id that marks a numbered list item or, with
 * `heading-numbers`, a numbered heading. The title, unnumbered headings and
 * bullets carry no number, so Word would show "0" or a bullet glyph for
 * them. A number the heading definition gives already reads "Section 1.01"
 * or "ARTICLE I", so `format="section"` does not apply to it.
 *
 * A clause directly under an Article (no Section of the Article before it)
 * may be referenced only by its own number: its full number is
 * "ARTICLE III(a)" in Word but "Section 3.01(a)" in LibreOffice, which
 * recalculates the field and shows the Section level at its start value.
 */
function checkCrossReferenceTargets(children: MarkdocNode[], headingNumbers = false): void {
  const targets = new Map<string, TargetSite>();
  let scope: HeadingScope = 'none';
  for (const node of children) {
    if (headingNumbers && node.type === 'heading' && node.attributes.level === 2) scope = 'article';
    if (headingNumbers && node.type === 'heading' && node.attributes.level === 3) scope = 'section';
    collectTargets(node, false, undefined, targets, headingNumbers && node.type === 'heading' && Number(node.attributes.level) >= 2 ? 'section' : scope);
  }
  try {
    bookmarkNamesForSlugs(targets.keys());
  } catch (error) {
    if (!(error instanceof BookmarkNameError)) throw error;
    creationError('ID_COLLISION', `${error.message}.`, undefined, targets.get(error.slugs.at(-1)!)?.line);
  }
  const references: CrossReferenceSite[] = [];
  for (const node of children) collectCrossReferences(node, undefined, references);
  for (const reference of references) {
    const target = targets.get(reference.to);
    if (!target) {
      creationError('XREF_UNKNOWN_ID', `{% xref to="${reference.to}" /%} names no {% #${reference.to} %} target.`, undefined, reference.line);
    }
    if (target.kind !== 'numbered' && !target.headingNumbered) {
      creationError(
        'XREF_TARGET_NOT_NUMBERED',
        target.kind === 'heading'
          ? `{% xref to="${reference.to}" /%} names an unnumbered heading (line ${target.line ?? '?'}); number ## and ### headings with frontmatter heading-numbers: legal, or point it at a numbered list item.`
          : `{% xref to="${reference.to}" /%} names a bullet item (line ${target.line ?? '?'}), which has no number in a created document; point it at a numbered list item.`,
        undefined,
        reference.line,
      );
    }
    if (target.headingNumbered && reference.format === 'section') {
      creationError(
        'INVALID_CROSS_REFERENCE',
        `{% xref to="${reference.to}" format="section" /%} names a target numbered by heading-numbers, whose number already reads "Section 1.01" or "ARTICLE I"; drop format="section".`,
        undefined,
        reference.line,
      );
    }
    if (target.articleClause && reference.number !== 'paragraph') {
      creationError(
        'XREF_FULL_NUMBER_UNDER_ARTICLE',
        `{% xref to="${reference.to}" /%} names a clause directly under an Article (line ${target.line ?? '?'}), whose full number Word shows as "ARTICLE I(a)" and LibreOffice as "Section 1.01(a)"; use number="paragraph", or put the clause under a ### Section.`,
        undefined,
        reference.line,
      );
    }
  }
}
