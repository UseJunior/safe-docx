/**
 * Block-level structural rules shared by the revision resolvers
 * (accept_changes, reject_changes) and the untracked paragraph-blanking path
 * in text.ts. This module is a leaf: it must import nothing but namespaces,
 * because text.ts sits below bookmarks.ts and table_rows.ts in the import
 * graph and the resolvers sit above them (`npm run check:cycles`).
 *
 * @see https://github.com/UseJunior/safe-docx/issues/740
 */

import { OOXML } from './namespaces.js';

const W_NS = OOXML.W_NS;

function isW(node: Node | null, localName: string): node is Element {
  return !!node && node.nodeType === 1 && (node as Element).namespaceURI === W_NS
    && (node as Element).localName === localName;
}

// Marker-ish elements that may sit between two paragraphs at block level
// without ending the search for a merge target: the full EG_RangeMarkupElements
// schema group (wml.xsd), plus permStart/permEnd range markers and proofErr
// proofing anchors.
export const RANGE_MARKUP_BLOCK_SIBLING_LOCALS: ReadonlySet<string> = new Set([
  'bookmarkStart', 'bookmarkEnd',
  'commentRangeStart', 'commentRangeEnd',
  'moveFromRangeStart', 'moveFromRangeEnd',
  'moveToRangeStart', 'moveToRangeEnd',
  'customXmlInsRangeStart', 'customXmlInsRangeEnd',
  'customXmlDelRangeStart', 'customXmlDelRangeEnd',
  'customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd',
  'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd',
  'permStart', 'permEnd',
  'proofErr',
]);

/**
 * True iff removing an emptied paragraph keeps its parent structurally valid
 * for Word: the parent must retain at least one block element, must not end
 * on a w:tbl (a trailing table needs a following paragraph), and two tables
 * must not become adjacent (Word merges back-to-back tables). w:sectPr is
 * ignored — a trailing body sectPr is not a block element.
 */
export function canSafelyRemoveEmptyParagraph(p: Element): boolean {
  const blockSibling = (start: Node | null, dir: 'previousSibling' | 'nextSibling'): Element | null => {
    let sibling = start;
    while (sibling) {
      if (sibling.nodeType === 1) {
        const el = sibling as Element;
        if (
          (el.namespaceURI === W_NS && RANGE_MARKUP_BLOCK_SIBLING_LOCALS.has(el.localName ?? '')) ||
          isW(el, 'sectPr')
        ) {
          sibling = sibling[dir];
          continue;
        }
        return el;
      }
      sibling = sibling[dir];
    }
    return null;
  };

  const prev = blockSibling(p.previousSibling, 'previousSibling');
  const next = blockSibling(p.nextSibling, 'nextSibling');
  if (!prev && !next) return false;
  if (prev && isW(prev, 'tbl') && !next) return false;
  if (prev && next && isW(prev, 'tbl') && isW(next, 'tbl')) return false;
  return true;
}
