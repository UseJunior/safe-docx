/**
 * Header/footer bindings when a tracked revision removes a section boundary.
 *
 * Word records a tracked section-break insertion or deletion on the paragraph
 * mark that owns the full live `w:sectPr`. Word 16 moves the header/footer
 * references onto that inserted boundary, which leaves the following section
 * with no references of its own, linked to previous. Accepting the deleted
 * mark or rejecting the inserted one merges the boundary away. Without a
 * transfer rule the bindings leave with it and the surviving section shows no
 * header or footer. `w:sectPrChange` (CT_SectPrBase) cannot record reference
 * changes, so the rule lives in the appliers.
 *
 * Word's rule (Accept All / Reject All, Word 16 for Mac, #1144):
 * - the surviving section is the next section in document order: the next
 *   paragraph-owned `w:sectPr`, else the body-level one;
 * - when the survivor has no `w:headerReference`/`w:footerReference` at all,
 *   every reference of the removed section is copied to it;
 * - when the survivor has any reference of its own, nothing is copied, not
 *   even a type or kind (header/footer) it lacks;
 * - `w:titlePg` and page setup stay the survivor's own.
 *
 * Relationship ids stay valid: both sections live in the same part.
 *
 * Shared by docx-core `acceptChanges`/`rejectChanges` and docx-compare's
 * `acceptAllChanges`/`rejectAllChanges` so the appliers stay in lockstep.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @see https://github.com/UseJunior/safe-docx/issues/1144
 */

import { OOXML } from './namespaces.js';

const W_NS = OOXML.W_NS;

function isW(node: Node | null | undefined, localName: string): node is Element {
  return !!node && node.nodeType === 1
    && (node as Element).namespaceURI === W_NS
    && (node as Element).localName === localName;
}

function isHeaderFooterReference(node: Node): node is Element {
  return isW(node, 'headerReference') || isW(node, 'footerReference');
}

/** A live section boundary: body-level `w:sectPr`, or `w:p > w:pPr > w:sectPr`. */
function isLiveSectionProperties(element: Element): boolean {
  if (!isW(element, 'sectPr')) return false;
  const parent = element.parentNode;
  if (isW(parent, 'body')) return true;
  return isW(parent, 'pPr') && isW(parent.parentNode, 'p');
}

/** True when `node` sits in a text-box story (`w:txbxContent`), not the main story. */
function insideTextBox(node: Node): boolean {
  for (let current = node.parentNode; current; current = current.parentNode) {
    if (isW(current, 'txbxContent')) return true;
  }
  return false;
}

/** The node after `node`'s subtree in document order. */
function nextOutsideSubtree(node: Node): Node | null {
  for (let current: Node | null = node; current; current = current.parentNode) {
    if (current.nextSibling) return current.nextSibling;
  }
  return null;
}

/**
 * The section properties of the section that follows `paragraph`'s own
 * boundary: the next paragraph-owned `w:sectPr` after the paragraph in
 * document order, else the body-level `w:sectPr`. History snapshots
 * (`w:sectPrChange > w:sectPr`) never count, and text-box stories
 * (`w:txbxContent`) are skipped: they are separate stories, not part of the
 * main story's section sequence.
 */
export function followingSectionProperties(paragraph: Element): Element | null {
  let current = nextOutsideSubtree(paragraph);
  while (current) {
    if (current.nodeType === 1) {
      const element = current as Element;
      if (isLiveSectionProperties(element)) return element;
      const textBoxStory = element.namespaceURI === W_NS && element.localName === 'txbxContent';
      if (element.firstChild && !textBoxStory) {
        current = element.firstChild;
        continue;
      }
    }
    current = nextOutsideSubtree(current);
  }
  return null;
}

/**
 * Copy the removed section's header/footer references onto the surviving
 * section, the way Word does: all of them when the survivor has none, and
 * none when the survivor has any of its own. `w:titlePg` is not carried. The
 * copies go first, where CT_SectPr places EG_HdrFtrReferences.
 *
 * @returns true when references were copied.
 */
export function carryForwardHeaderFooterRefs(removed: Element, survivor: Element): boolean {
  if (Array.from(survivor.childNodes).some(isHeaderFooterReference)) return false;
  const references = Array.from(removed.childNodes).filter(isHeaderFooterReference);
  if (references.length === 0) return false;
  const first = survivor.firstChild;
  for (const reference of references) survivor.insertBefore(reference.cloneNode(true), first);
  return true;
}

/**
 * Call before `paragraph`'s own section boundary is removed (its paragraph
 * merged or dropped, or its `w:sectPr` taken away): carries the boundary's
 * header/footer references forward to the following section per
 * {@link carryForwardHeaderFooterRefs}. A paragraph without a section
 * boundary, a paragraph in a text-box story, or a document without a
 * following section, is left alone.
 */
export function carryHeaderFooterRefsFromRemovedBoundary(paragraph: Element): boolean {
  // A text-box paragraph's w:sectPr is not a boundary of the main story.
  if (insideTextBox(paragraph)) return false;
  const pPr = Array.from(paragraph.childNodes).find((node): node is Element => isW(node, 'pPr'));
  const removed = pPr && Array.from(pPr.childNodes).find((node): node is Element => isW(node, 'sectPr'));
  if (!removed || !Array.from(removed.childNodes).some(isHeaderFooterReference)) return false;
  const survivor = followingSectionProperties(paragraph);
  return survivor ? carryForwardHeaderFooterRefs(removed, survivor) : false;
}
