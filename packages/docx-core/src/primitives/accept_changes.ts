/**
 * accept_changes — accept all tracked changes in a OOXML document body.
 *
 * Produces a clean document with no revision markup by:
 * - Removing w:del elements and their content
 * - Unwrapping w:ins elements (promoting children)
 * - Removing w:moveFrom (source), unwrapping w:moveTo (destination)
 * - Removing all *PrChange property change records
 * - Stripping paragraph-level revision markers
 * - Cleaning up move range markers and rsidDel attributes
 *
 * Operates on the W3C DOM (`@xmldom/xmldom`) — the same API used
 * throughout docx-primitives-ts (contrast with docx-comparison's
 * custom WmlElement AST).
 */

import { OOXML } from './namespaces.js';

const W_NS = OOXML.W_NS;

export type AcceptChangesResult = {
  insertionsAccepted: number;
  deletionsAccepted: number;
  movesResolved: number;
  propertyChangesResolved: number;
};

// ── DOM helpers (internal) ──────────────────────────────────────────

function isW(node: Node, localName: string): node is Element {
  return (
    node.nodeType === 1 &&
    (node as Element).namespaceURI === W_NS &&
    (node as Element).localName === localName
  );
}

function getDepth(node: Node): number {
  let depth = 0;
  let cur: Node | null = node.parentNode;
  while (cur) {
    depth++;
    cur = cur.parentNode;
  }
  return depth;
}

function collectByLocalName(container: Document | Element, localName: string): Element[] {
  return Array.from(container.getElementsByTagNameNS(W_NS, localName));
}

function removeAllByLocalName(container: Document | Element, localName: string): number {
  const elements = collectByLocalName(container, localName);
  let count = 0;
  for (const el of elements) {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
      count++;
    }
  }
  return count;
}

function unwrapAllByLocalName(container: Document | Element, localName: string): number {
  const elements = collectByLocalName(container, localName);
  // Sort deepest-first to handle nested wrappers correctly
  elements.sort((a, b) => getDepth(b) - getDepth(a));
  let count = 0;
  for (const el of elements) {
    const parent = el.parentNode;
    if (!parent) continue;
    // Promote all children to the parent
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el);
    }
    parent.removeChild(el);
    count++;
  }
  return count;
}

/**
 * Check if a paragraph has a paragraph-level revision marker.
 * Pattern: w:p > w:pPr > w:rPr > w:del (or w:ins)
 */
function paragraphHasParaMarker(p: Element, markerLocalName: string): boolean {
  for (let i = 0; i < p.childNodes.length; i++) {
    const child = p.childNodes[i]!;
    if (!isW(child, 'pPr')) continue;
    for (let j = 0; j < child.childNodes.length; j++) {
      const pPrChild = child.childNodes[j]!;
      if (!isW(pPrChild, 'rPr')) continue;
      for (let k = 0; k < pPrChild.childNodes.length; k++) {
        const rPrChild = pPrChild.childNodes[k]!;
        if (isW(rPrChild, markerLocalName)) return true;
      }
    }
  }
  return false;
}

// Property change element local names (all 6 types)
const PR_CHANGE_LOCALS = [
  'rPrChange', 'pPrChange', 'sectPrChange',
  'tblPrChange', 'trPrChange', 'tcPrChange',
];

// ── Public API ──────────────────────────────────────────────────────

/**
 * Accept all tracked changes in the document body or story root, producing a
 * clean document with no revision markup.
 *
 * Mutates the Document in place (same convention as simplifyRedlines
 * and mergeRuns).
 */
export function acceptChanges(doc: Document): AcceptChangesResult {
  const root = doc.getElementsByTagNameNS(W_NS, 'body').item(0) ?? doc.documentElement;
  if (!root) {
    return { insertionsAccepted: 0, deletionsAccepted: 0, movesResolved: 0, propertyChangesResolved: 0 };
  }

  // Phase A — Identify paragraphs to remove
  const paragraphsToRemove = new Set<Element>();
  const allParagraphs = collectByLocalName(root, 'p');

  for (const p of allParagraphs) {
    // Remove a paragraph iff its paragraph MARK is a tracked deletion
    // (w:p > w:pPr > w:rPr > w:del) — the paragraph break itself was deleted.
    // We deliberately do NOT drop a paragraph based on content ("all runs inside
    // w:del/w:moveFrom"): a run-level deletion under an untracked mark means text was
    // deleted from a pre-existing paragraph, which Word/LibreOffice keep (empty) on
    // accept. safe-docx's deleted paragraphs always carry the mark now, so the
    // mark-based rule suffices and is Word-faithful. (Mirrors acceptAllChanges and the
    // reject-side rule.)
    if (paragraphHasParaMarker(p, 'del')) {
      paragraphsToRemove.add(p);
    }
  }

  // Phase B — Remove deletions and move sources
  const deletionsAccepted = removeAllByLocalName(root, 'del');
  const moveFromRemoved = removeAllByLocalName(root, 'moveFrom');
  removeAllByLocalName(root, 'moveFromRangeStart');
  removeAllByLocalName(root, 'moveFromRangeEnd');
  removeAllByLocalName(root, 'moveToRangeStart');
  removeAllByLocalName(root, 'moveToRangeEnd');

  // Phase C — Unwrap insertions and move destinations (depth-sorted)
  const insertionsAccepted = unwrapAllByLocalName(root, 'ins');
  const moveToUnwrapped = unwrapAllByLocalName(root, 'moveTo');

  // Phase D — Remove property change records
  let propertyChangesResolved = 0;
  for (const localName of PR_CHANGE_LOCALS) {
    propertyChangesResolved += removeAllByLocalName(root, localName);
  }

  // Phase E — Cleanup
  // Strip paragraph-level revision markers from w:pPr/w:rPr
  for (const p of collectByLocalName(root, 'p')) {
    for (let i = 0; i < p.childNodes.length; i++) {
      const child = p.childNodes[i]!;
      if (!isW(child, 'pPr')) continue;
      for (let j = 0; j < child.childNodes.length; j++) {
        const pPrChild = child.childNodes[j]!;
        if (!isW(pPrChild, 'rPr')) continue;
        // Remove w:ins and w:del marker elements inside pPr > rPr
        const toRemove: Element[] = [];
        for (let k = 0; k < pPrChild.childNodes.length; k++) {
          const rPrChild = pPrChild.childNodes[k]!;
          if (isW(rPrChild, 'ins') || isW(rPrChild, 'del')) {
            toRemove.push(rPrChild as Element);
          }
        }
        for (const el of toRemove) {
          pPrChild.removeChild(el);
        }
      }
    }
  }

  // Remove paragraphs collected in Phase A (check parentNode still exists)
  for (const p of paragraphsToRemove) {
    if (p.parentNode) {
      p.parentNode.removeChild(p);
    }
  }

  // Strip w:rsidDel attributes on remaining elements
  const allElements = root.getElementsByTagNameNS(W_NS, '*');
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i]!;
    if (el.hasAttributeNS(W_NS, 'rsidDel')) {
      el.removeAttributeNS(W_NS, 'rsidDel');
    }
    // Also check prefixed form
    if (el.hasAttribute('w:rsidDel')) {
      el.removeAttribute('w:rsidDel');
    }
  }

  return {
    insertionsAccepted,
    deletionsAccepted,
    movesResolved: moveFromRemoved + moveToUnwrapped,
    propertyChangesResolved,
  };
}
