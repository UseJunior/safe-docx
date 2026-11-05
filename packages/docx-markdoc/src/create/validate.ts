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
 * it names (`to`). It shows the target's number (`show="number"`, the
 * default): its full number (`number="full"`, the default), its own level's
 * number (`number="paragraph"`) or its number relative to where the xref sits
 * (`number="relative"`), the first two optionally preceded by the word
 * "Section " (`format="section"`). Or it shows the target's text (`show="text"`), which
 * takes neither `number` nor `format`. A new inline tag needs an entry here, a branch in `visit()` below, a renderer
 * (an engine branch or a creation theme plugin) and, when it changes the text,
 * a case in the round-trip oracle.
 */
const INLINE_TAGS: Record<string, ReadonlySet<string>> = {
  literal: new Set(),
  fill: new Set(),
  u: new Set(),
  fnref: new Set(['id']),
  xref: new Set(['to', 'show', 'number', 'format']),
};
/**
 * `{% xref show="…" %}` values: the target's number (a REF field with a number
 * switch) or its text (a REF field without one). A new form needs an entry
 * here and its own REF instruction shape, so an import can tell the forms
 * apart from the instruction alone.
 */
export const XREF_SHOWS: ReadonlySet<string> = new Set(['number', 'text']);
/**
 * `{% xref number="…" %}` values: the full number ("2(b)"), the target
 * level's own ("(b)"), or the number relative to where the xref sits (Word's
 * `\r`: "(b)" from inside "2(a)", "2(b)" from inside "3(a)").
 */
export const XREF_NUMBERS: ReadonlySet<string> = new Set(['full', 'paragraph', 'relative']);
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
  // Bold, italic or underline around the current node.
  let formatted = 0;
  const visit = (node: MarkdocNode, literal: boolean): void => {
    switch (node.type) {
      case 'inline':
        node.children.forEach((child) => visit(child, literal));
        return;
      case 'strong':
      case 'em':
        formatted += 1;
        node.children.forEach((child) => visit(child, literal));
        formatted -= 1;
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
          checkCrossReferenceTag(node, line, literal ? 'literal' : fillDepth > 0 ? 'fill' : null, formatted > 0);
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
          formatted += 1;
          node.children.forEach((child) => visit(child, literal));
          formatted -= 1;
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
function checkCrossReferenceTag(node: MarkdocNode, line: number | undefined, inside: 'literal' | 'fill' | null, formatted = false): void {
  if (node.children.length > 0) creationError('INVALID_CROSS_REFERENCE', '{% xref /%} is self-closing; its text is the target\'s number.', node, line);
  if (inside) creationError('INVALID_CROSS_REFERENCE', `{% xref /%} cannot appear inside {% ${inside} %}.`, node, line);
  const { to, show, number, format } = node.attributes;
  if (typeof to !== 'string' || !TARGET_ID_RE.test(to)) {
    creationError('INVALID_CROSS_REFERENCE', `{% xref /%} needs to="…" naming a kebab-case id, such as to="purchase-price-adjustment"; got ${JSON.stringify(to ?? null)}.`, node, line);
  }
  if (show !== undefined && (typeof show !== 'string' || !XREF_SHOWS.has(show))) {
    creationError('INVALID_CROSS_REFERENCE', `{% xref /%} show must be "number" or "text", got ${JSON.stringify(show)}.`, node, line);
  }
  if (show === 'text' && (number !== undefined || format !== undefined)) {
    creationError('INVALID_CROSS_REFERENCE', `{% xref show="text" /%} shows the target's text, so it takes no ${number !== undefined ? 'number' : 'format'}; drop it, or use show="number".`, node, line);
  }
  if (show === 'text' && formatted) {
    // Word writes the result as the target's runs with their own formatting when it updates the field.
    creationError('INVALID_CROSS_REFERENCE', '{% xref show="text" /%} shows the target\'s text with the target\'s formatting, and Word drops bold, italic or underline around it when fields update; move it outside the emphasis.', node, line);
  }
  if (number !== undefined && (typeof number !== 'string' || !XREF_NUMBERS.has(number))) {
    creationError('INVALID_CROSS_REFERENCE', `{% xref /%} number must be "full", "paragraph" or "relative", got ${JSON.stringify(number)}.`, node, line);
  }
  if (number === 'relative' && format !== undefined) {
    // A relative number reads "(b)" in one place and "2(b)" in another, so one fixed word before it does not fit both.
    creationError('INVALID_CROSS_REFERENCE', '{% xref number="relative" /%} changes with where it sits ("(b)" here, "2(b)" elsewhere), so it takes no format; write the word before it yourself, or use number="full".', node, line);
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
      // The signature block renders one line of name (#1261): no line break in it, inline or block form, and in
      // block form exactly one paragraph with nothing beside it. Anything else (a tag on its own line after the
      // name, a block fill, a list) would never reach the page. These run before the generic syntax guard, so
      // every multi-line shape fails as INVALID_SIGNER.
      const lineBreak = (child: MarkdocNode): MarkdocNode | undefined =>
        child.type === 'softbreak' || child.type === 'hardbreak' ? child : child.children.map(lineBreak).find(Boolean);
      const broken = content.map(lineBreak).find(Boolean);
      if (broken) creationError('INVALID_SIGNER', '{% signer %} content must be one line of text; put the whole name on one line.', broken, line);
      if (node.children.filter((child) => child.type === 'paragraph').length > 1) creationError('INVALID_SIGNER', '{% signer %} content must be one paragraph.', node, line);
      if (!node.inline && (node.children.length > 1 || (node.children.length === 1 && node.children[0]!.type !== 'paragraph'))) {
        const stray = node.children.find((child) => child.type !== 'paragraph') ?? node.children[1]!;
        creationError('INVALID_SIGNER', `{% signer %} content must be one line of text, with nothing after it but {% /signer %}; found ${stray.type === 'tag' ? `{% ${stray.tag} %}` : `'${stray.type}'`} on its own line.`, stray, lineOf(stray) ?? line);
      }
      if (node.children.some((child) => child.type !== 'paragraph' && child.type !== 'inline' && child.type !== 'text' && child.type !== 'tag' && child.type !== 'strong' && child.type !== 'em')) {
        creationError('UNSUPPORTED_CREATION_SYNTAX', '{% signer %} content must be one line of text.', node, line);
      }
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
 * generates ("ARTICLE IV", "Article IV", "Section 2.04": an Article
 * number, a period and two digits ending the number). Ordinary words after
 * "Article" ("Article Civil Rights", "Article Integrity") and statutory
 * references ("Section 409A", "Section 1.409A", "Section 1.409") are not.
 */
const GENERATED_HEADING_NUMBER: Record<number, RegExp> = {
  2: new RegExp(`^(?:ARTICLE|Article|article)\\s+${ROMAN_NUMERAL}`, 'u'),
  3: /^Section\s+\d+\.\d{2}(?![\p{L}\p{M}\p{N}]|\.\p{N})/iu,
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
type TargetSite = { kind: 'heading' | 'numbered' | 'bullet'; line?: number; headingNumbered?: true; articleClause?: true; node: MarkdocNode };

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
      node,
      ...(here === undefined ? {} : { line: here }),
      ...(numberedByHeading ? { headingNumbered: true as const } : {}),
      ...(numberedByHeading && kind === 'numbered' && scope === 'article' ? { articleClause: true as const } : {}),
    });
  }
  const childOrdered = node.type === 'list' ? node.attributes.ordered === true : ordered;
  for (const child of node.children) collectTargets(child, childOrdered, here, out, scope);
}

/** Every `{% xref /%}` under `node`, in document order, with the line of its nearest block. */
type CrossReferenceSite = { to: string; show?: string; number?: string; format?: string; line?: number; node: MarkdocNode };

function collectCrossReferences(node: MarkdocNode, line: number | undefined, out: CrossReferenceSite[]): void {
  const here = lineOf(node) ?? line;
  if (node.type === 'tag' && node.tag === 'xref') {
    const { show, number, format } = node.attributes;
    out.push({
      node,
      to: String(node.attributes.to),
      ...(show === undefined ? {} : { show: String(show) }),
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
/**
 * The content of a heading or list item that a text reference shows: the
 * item's own paragraph, without its nested lists.
 */
function targetContent(target: MarkdocNode): MarkdocNode[] {
  return target.type === 'item' ? target.children.filter((child) => child.type !== 'list') : target.children;
}

function holdsTag(node: MarkdocNode, tag: string): boolean {
  return (node.type === 'tag' && node.tag === tag) || node.children.some((child) => holdsTag(child, tag));
}

function holdsType(node: MarkdocNode, type: string): boolean {
  return node.type === type || node.children.some((child) => holdsType(child, type));
}

/**
 * A text reference shows its target's text, so any heading or list item may
 * be its target, numbered or not. The target may hold text, emphasis, fills
 * and footnote references (Word leaves the reference mark out of the
 * result); a cross-reference or a line break in it is refused, because what
 * Word shows for one inside a REF result is not measured, and a target
 * without text would show nothing.
 */
function checkTextReferenceTarget(reference: CrossReferenceSite, target: TargetSite): void {
  const content = targetContent(target.node);
  const fail = (why: string) => creationError(
    'XREF_TEXT_TARGET_UNSUPPORTED',
    `{% xref to="${reference.to}" show="text" /%} names a target (line ${target.line ?? '?'}) that ${why}.`,
    undefined,
    reference.line,
  );
  if (content.some((node) => holdsTag(node, 'xref'))) fail('holds a cross-reference; a text reference shows text only, so point it at a target without one');
  if (content.some((node) => holdsType(node, 'hardbreak'))) fail('holds a line break; a text reference shows one line of text');
  const text = content.map((node) => inlineText(node).replace(/\[xref\]/gu, '')).join('');
  if (!text.trim()) fail('has no text to show');
}

/**
 * Where each relative reference sits, as Word and LibreOffice number it, for
 * the rules in {@link checkRelativeReference}. Word numbers a `\r` field
 * relative to the last paragraph of its target's own list (`w:numId`) at or
 * before the field; LibreOffice relative to the last paragraph of any list
 * sharing the target's definition. A field in a footnote shows the full
 * number in both (scripts/oracle/word/evidence/issue-1258-word-16.114.json).
 *
 * The ordered lists outside numbered headings share one definition. A list
 * continues the one before it when its first marker is the next number,
 * and otherwise restarts as a new Word list (`list-numbering.ts`), so each
 * chain of continuing lists is one Word list. Under numbered headings, the
 * headings and their clauses are one list of their own definition.
 */
type RelativeSites = {
  /** The chain of continuing ordered lists each target outside numbered headings belongs to, by id. */
  targetChain: Map<string, number>;
  /** Per relative xref: the chain of the last ordered list item outside numbered headings at or before it (undefined before the first). */
  chainAt: Map<MarkdocNode, number | undefined>;
  /** Relative xrefs in a footnote. */
  inFootnote: Set<MarkdocNode>;
  /** Per relative xref sitting in or after clauses directly under an Article (before the next heading): that run of clauses, counted from 0. */
  articleClauseRunAt: Map<MarkdocNode, number>;
  /** Per id of a clause directly under an Article: its run of clauses. */
  articleClauseRunOf: Map<string, number>;
};

function relativeSites(children: MarkdocNode[], headingNumbers: boolean): RelativeSites {
  const sites: RelativeSites = { targetChain: new Map(), chainAt: new Map(), inFootnote: new Set(), articleClauseRunAt: new Map(), articleClauseRunOf: new Map() };
  let headingsBegun = false;
  let chain: number | undefined;
  let chains = 0;
  let next: number | null = null;
  let articleScope = false;
  let articleClauses: number | null = null;
  let articleClauseRuns = 0;
  const ids = (node: MarkdocNode, out: string[] = []): string[] => {
    if (node.type !== 'tag' && node.type !== 'document' && typeof node.attributes.id === 'string') out.push(node.attributes.id);
    for (const child of node.children) ids(child, out);
    return out;
  };
  const relativeXrefs = (node: MarkdocNode, out: MarkdocNode[] = []): MarkdocNode[] => {
    if (node.type === 'tag' && node.tag === 'xref' && node.attributes.number === 'relative') out.push(node);
    for (const child of node.children) relativeXrefs(child, out);
    return out;
  };
  for (const node of children) {
    const footnote = (node.type === 'tag' ? node : soleInlineTag(node))?.tag === 'footnote';
    if (headingNumbers && node.type === 'heading' && Number(node.attributes.level) >= 2) {
      headingsBegun = true;
      articleScope = node.attributes.level === 2;
      articleClauses = null;
    }
    if (node.type === 'list' && node.attributes.ordered === true) {
      if (!headingsBegun) {
        const start = Number.isInteger(node.attributes.start) ? Number(node.attributes.start) : 1;
        if (next === null || start !== next) chain = chains++;
        next = start + node.children.length;
        for (const id of ids(node)) sites.targetChain.set(id, chain!);
      } else if (articleScope) {
        if (articleClauses === null) articleClauses = articleClauseRuns++;
        for (const id of ids(node)) sites.articleClauseRunOf.set(id, articleClauses);
      }
    }
    for (const xref of relativeXrefs(node)) {
      if (footnote) {
        sites.inFootnote.add(xref);
        continue;
      }
      sites.chainAt.set(xref, chain);
      if (articleClauses !== null) sites.articleClauseRunAt.set(xref, articleClauses);
    }
  }
  return sites;
}

/**
 * A relative reference shows what Word shows only where Word and LibreOffice
 * (which renders the PDF) agree and Word's result is measured:
 *
 * - to an item of an ordered list outside numbered headings, it must sit
 *   before every such list, or after an item of its target's own list with
 *   no other such list starting in between. Elsewhere Word numbers it
 *   relative to the target's list ("2(b)") and LibreOffice relative to the
 *   latest list ("(b)");
 * - to a clause directly under an Article, it must sit in or after that
 *   Article's clauses (before the next heading), where both drop the
 *   Article and the start-value Section level they share ("(b)"); elsewhere
 *   Word shows "ARTICLE II(b)" and LibreOffice "Section 2.01(b)", as for the
 *   full number (`XREF_FULL_NUMBER_UNDER_ARTICLE`).
 *
 * A reference to any other numbered heading or clause may sit anywhere in
 * the body, also in or after clauses directly under an Article: Word
 * compares the Section level there at its start value
 * (scripts/oracle/word/evidence/issue-1284-word-16.114.json), and from such
 * a position every other target either shares no level but its Article
 * (the Article heading itself) or sits in another Article, so both readers
 * show the same number.
 *
 * In a footnote a relative reference shows the full number, in both.
 */
function checkRelativeReference(reference: CrossReferenceSite, target: TargetSite, sites: RelativeSites): void {
  if (reference.number !== 'relative' || sites.inFootnote.has(reference.node)) return;
  if (target.headingNumbered) return;
  const own = sites.targetChain.get(reference.to);
  const at = sites.chainAt.get(reference.node);
  if (at !== undefined && at !== own) {
    creationError(
      'XREF_RELATIVE_ACROSS_LISTS',
      `{% xref to="${reference.to}" number="relative" /%} sits after a numbered list other than its target's (line ${target.line ?? '?'}); Word numbers it relative to the target's list and LibreOffice relative to the latest list, so they show different numbers. Use number="full".`,
      undefined,
      reference.line,
    );
  }
}

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
  const sites = relativeSites(children, headingNumbers);
  for (const reference of references) {
    const target = targets.get(reference.to);
    if (!target) {
      creationError('XREF_UNKNOWN_ID', `{% xref to="${reference.to}" /%} names no {% #${reference.to} %} target.`, undefined, reference.line);
    }
    if (reference.show === 'text') {
      checkTextReferenceTarget(reference, target);
      continue;
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
    const sameArticleClauses = reference.number === 'relative' && !sites.inFootnote.has(reference.node)
      && sites.articleClauseRunAt.get(reference.node) !== undefined
      && sites.articleClauseRunAt.get(reference.node) === sites.articleClauseRunOf.get(reference.to);
    if (target.articleClause && reference.number !== 'paragraph' && !sameArticleClauses) {
      creationError(
        'XREF_FULL_NUMBER_UNDER_ARTICLE',
        `{% xref to="${reference.to}"${reference.number === 'relative' ? ' number="relative"' : ''} /%} names a clause directly under an Article (line ${target.line ?? '?'}), whose full number Word shows as "ARTICLE I(a)" and LibreOffice as "Section 1.01(a)"; use number="paragraph"${reference.number === 'relative' ? ', or place the reference in or after that Article\'s clauses' : ''}, or put the clause under a ### Section.`,
        undefined,
        reference.line,
      );
    }
    checkRelativeReference(reference, target, sites);
  }
}
