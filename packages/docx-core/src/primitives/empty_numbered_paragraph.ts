/**
 * Detection of an empty numbered paragraph: a paragraph that still shows a
 * list label (its own `w:numPr`, or numbering inherited through its paragraph
 * style chain) but has nothing after the label once its tracked changes are
 * accepted. Word renders such a paragraph as a bare label, for example `(b)`
 * followed by nothing, and no text extraction shows it.
 *
 * The edit tools ask these questions of the one paragraph an edit touched,
 * before and after the edit, so they report only damage the edit caused and
 * never an empty numbered paragraph the input already had. The paragraph
 * removal rules (when a blanked paragraph is removed or keeps its mark) live
 * in text.ts and are not changed here.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1047
 * @see https://github.com/UseJunior/safe-docx/issues/740
 */

import { OOXML, W } from './namespaces.js';
import type { NumberingModel } from './numbering.js';
import { resolveParagraphNumbering, type ResolvedParagraphNumbering } from './paragraph_list_numbering.js';
import { RANGE_MARKUP_BLOCK_SIBLING_LOCALS, canSafelyRemoveEmptyParagraph } from './paragraph_structure.js';
import type { StylesModel } from './styles.js';

const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

/** Run content that renders something other than whitespace, besides `w:t`. */
const RENDERED_W_ELEMENTS: ReadonlySet<string> = new Set([
  'drawing',
  'pict',
  'object',
  'sym',
  'footnoteReference',
  'endnoteReference',
  'noBreakHyphen',
]);

/**
 * Subtrees that render nothing once tracked changes are accepted: paragraph
 * properties, run properties, field instructions, and deleted or moved-away
 * content (accept-all removes `w:del` and `w:moveFrom`).
 */
const NON_RENDERING_W_SUBTREES: ReadonlySet<string> = new Set([
  W.pPr,
  W.rPr,
  W.del,
  W.moveFrom,
  'instrText',
  'delInstrText',
]);

function isW(el: Element, localName: string): boolean {
  return el.namespaceURI === OOXML.W_NS && el.localName === localName;
}

function directChild(parent: Element, localName: string): Element | null {
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && isW(n as Element, localName)) return n as Element;
  }
  return null;
}

/**
 * True when the paragraph shows something after its list label once its
 * tracked changes are accepted: non-whitespace text (in `w:t`, including a
 * field's cached result and inserted text), a `w:sym` glyph, embedded
 * content (`w:drawing`, `w:pict`, `w:object`, math), a footnote or endnote
 * reference mark, or a non-breaking hyphen. Whitespace, tabs and breaks,
 * range markers (bookmarks, comment ranges), field instructions and comment
 * reference marks render nothing after the label, and text inside `w:del` or
 * `w:moveFrom` is gone once the deletion is accepted.
 */
export function paragraphHasVisibleContent(paragraph: Element): boolean {
  const visit = (el: Element): boolean => {
    if (el.namespaceURI === MATH_NS) return true;
    if (el.namespaceURI === OOXML.W_NS) {
      const local = el.localName ?? '';
      if (NON_RENDERING_W_SUBTREES.has(local)) return false;
      if (RENDERED_W_ELEMENTS.has(local)) return true;
      if (local === W.t) return /\S/u.test(el.textContent ?? '');
    }
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1 && visit(n as Element)) return true;
    }
    return false;
  };
  for (let n = paragraph.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && visit(n as Element)) return true;
  }
  return false;
}

/**
 * True when the paragraph mark carries a tracked deletion (or a move away),
 * so accepting it merges the paragraph into the next one: the paragraph and
 * its label go away on accept and are not left behind as a bare label.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 */
export function isParagraphMarkTrackedDeleted(paragraph: Element): boolean {
  const pPr = directChild(paragraph, W.pPr);
  const markRPr = pPr ? directChild(pPr, W.rPr) : null;
  return !!markRPr && (!!directChild(markRPr, W.del) || !!directChild(markRPr, W.moveFrom));
}

/**
 * The list numbering the paragraph displays, direct or inherited through its
 * style chain (see `resolveParagraphNumbering`), or null when it shows no
 * label. A numbering reference to a `w:num` the numbering part does not
 * define, or a document without a numbering part, shows no label.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.19
 */
export function resolveDisplayedListNumbering(
  paragraph: Element,
  styles: StylesModel,
  numbering: NumberingModel | null,
): ResolvedParagraphNumbering | null {
  if (!numbering) return null;
  const resolved = resolveParagraphNumbering(paragraph, styles, numbering);
  if (!resolved || !numbering.nums.has(resolved.numId)) return null;
  return resolved;
}

/** The next block sibling when it is a paragraph, skipping range markers (the merge target of an accepted mark deletion). */
function hasFollowingSiblingParagraph(paragraph: Element): boolean {
  for (let n = paragraph.nextSibling; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    if (isW(el, W.p)) return true;
    if (el.namespaceURI === OOXML.W_NS && RANGE_MARKUP_BLOCK_SIBLING_LOCALS.has(el.localName ?? '')) continue;
    return false;
  }
  return false;
}

/**
 * True when the paragraph keeps a child once its tracked deletions are
 * accepted: anything other than paragraph properties, range markers, and
 * `w:del` / `w:moveFrom` content. Mirrors the accept-all resolver, which keeps
 * a mark-deleted paragraph that has no following paragraph to merge into
 * whenever it still owns such a child, whitespace runs included.
 */
function keepsChildrenOnAccept(paragraph: Element): boolean {
  for (let n = paragraph.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    if (isW(el, W.pPr) || isW(el, W.del) || isW(el, W.moveFrom)) continue;
    if (el.namespaceURI === OOXML.W_NS && RANGE_MARKUP_BLOCK_SIBLING_LOCALS.has(el.localName ?? '')) continue;
    return true;
  }
  return false;
}

/**
 * True when accepting the paragraph's tracked mark deletion takes the
 * paragraph, and its label, away. With a following paragraph the paragraph
 * merges into it. Without one (before a table, at the end of a cell or other
 * container) accept-all removes it only when nothing but properties and
 * markers is left and removal keeps the container valid; otherwise it keeps
 * the paragraph, label included, as it does a table cell's only paragraph or
 * a paragraph still holding whitespace.
 */
function isRemovedOnAccept(paragraph: Element): boolean {
  if (!isParagraphMarkTrackedDeleted(paragraph)) return false;
  if (hasFollowingSiblingParagraph(paragraph)) return true;
  return !keepsChildrenOnAccept(paragraph) && canSafelyRemoveEmptyParagraph(paragraph);
}

/**
 * True when the paragraph is still in its document, displays a list label,
 * has no visible content after it (see {@link paragraphHasVisibleContent}),
 * and accepting its tracked changes does not remove it. A whole-paragraph
 * tracked deletion, whose text sits in `w:delText` and whose mark is
 * deleted, is not an empty numbered paragraph: accepting it removes the label
 * too.
 */
export function isEmptyNumberedParagraph(
  paragraph: Element,
  styles: StylesModel,
  numbering: NumberingModel | null,
): boolean {
  if (!paragraph.parentNode) return false;
  if (isRemovedOnAccept(paragraph)) return false;
  if (paragraphHasVisibleContent(paragraph)) return false;
  return resolveDisplayedListNumbering(paragraph, styles, numbering) !== null;
}
