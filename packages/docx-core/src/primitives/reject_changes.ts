/**
 * reject_changes — reject all tracked changes in a OOXML document body.
 *
 * Restores the document for the supported revision subset by:
 * - Removing w:ins elements AND their content (insertions undone)
 * - Unwrapping w:del elements and converting w:delText → w:t (deletions restored)
 * - Unwrapping w:moveFrom (keep at original position), removing w:moveTo and content
 * - Restoring original properties from *PrChange records
 * - Preserving cross-paragraph bookmark boundaries when resolving inserted paragraph marks
 * - Stripping paragraph-level revision markers, merging a paragraph whose
 *   mark was a tracked insertion into the following paragraph
 * - Stripping rsidDel attributes
 *
 * Numbering, table-grid/exception, cell-topology, custom XML, and extension
 * conflict records are not semantically resolved here; see the advanced
 * revision classification manifest.
 *
 * Operates on the W3C DOM (`@xmldom/xmldom`).
 */

import { OOXML } from './namespaces.js';
import type { RevisionFilter } from './accept_changes.js';

const W_NS = OOXML.W_NS;

const ACCEPT_ALL: RevisionFilter = () => true;

/** True iff `el` has an ancestor element with the given WordprocessingML local name. */
function hasWAncestor(el: Node, localName: string): boolean {
  let cur: Node | null = el.parentNode;
  while (cur) {
    if (
      cur.nodeType === 1 &&
      (cur as Element).namespaceURI === W_NS &&
      (cur as Element).localName === localName
    ) {
      return true;
    }
    cur = cur.parentNode;
  }
  return false;
}

export type RejectChangesResult = {
  insertionsRemoved: number;
  deletionsRestored: number;
  movesReverted: number;
  propertyChangesReverted: number;
  /**
   * Row-level revision markers left in place because this engine cannot resolve
   * them. A non-zero count means the output still holds tracked-change markup
   * and does not match what a word processor would project. Reported separately
   * from the resolved counters: a preserved marker is not a reverted change.
   */
  unresolvedRowRevisions: number;
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

/**
 * True iff this element is a row-level revision marker — a `w:ins`/`w:del`
 * whose direct parent is `w:trPr`.
 *
 * These describe the ROW rather than wrapping a span of content:
 * `w:tr > w:trPr > w:ins` marks the row itself as inserted and
 * `w:tr > w:trPr > w:del` marks it as deleted. A sweep that matches on local
 * name alone cannot tell them apart from the content wrappers, and removing one
 * strips the `w:id`/`w:author`/`w:date` evidence while leaving the `w:tr` it
 * described in the document.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/845
 */
function isRowPropertyRevisionMarker(el: Element): boolean {
  const parent = el.parentNode;
  return parent !== null && isW(parent, 'trPr');
}

/** Row-level markers the filter selects, which this engine cannot resolve. */
function countUnresolvedRowRevisions(
  container: Document | Element,
  localName: string,
  filter: RevisionFilter,
): number {
  return collectByLocalName(container, localName).filter(filter).filter(isRowPropertyRevisionMarker)
    .length;
}

function removeAllByLocalName(
  container: Document | Element,
  localName: string,
  filter: RevisionFilter = ACCEPT_ALL,
  exclude?: (el: Element) => boolean,
): number {
  const elements = collectByLocalName(container, localName).filter(filter);
  let count = 0;
  for (const el of elements) {
    if (exclude?.(el)) continue;
    if (el.parentNode) {
      el.parentNode.removeChild(el);
      count++;
    }
  }
  return count;
}

function unwrapAllByLocalName(
  container: Document | Element,
  localName: string,
  filter: RevisionFilter = ACCEPT_ALL,
): number {
  const elements = collectByLocalName(container, localName).filter(filter);
  // Sort deepest-first to handle nested wrappers correctly
  elements.sort((a, b) => getDepth(b) - getDepth(a));
  let count = 0;
  for (const el of elements) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el);
    }
    parent.removeChild(el);
    count++;
  }
  return count;
}

/**
 * Check if a paragraph has a paragraph-level revision marker the filter selects.
 * Pattern: w:p > w:pPr > w:rPr > w:ins (or w:del)
 */
function paragraphHasParaMarker(
  p: Element,
  markerLocalName: string,
  filter: RevisionFilter = ACCEPT_ALL,
): boolean {
  for (let i = 0; i < p.childNodes.length; i++) {
    const child = p.childNodes[i]!;
    if (!isW(child, 'pPr')) continue;
    for (let j = 0; j < child.childNodes.length; j++) {
      const pPrChild = child.childNodes[j]!;
      if (!isW(pPrChild, 'rPr')) continue;
      for (let k = 0; k < pPrChild.childNodes.length; k++) {
        const rPrChild = pPrChild.childNodes[k]!;
        if (isW(rPrChild, markerLocalName) && filter(rPrChild)) return true;
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

// Marker-ish elements that may sit between two paragraphs at block level
// without ending the search for a merge target: the full EG_RangeMarkupElements
// schema group (wml.xsd), plus permStart/permEnd range markers and proofErr
// proofing anchors.
const RANGE_MARKUP_BLOCK_SIBLING_LOCALS = new Set([
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
 * Find the next sibling paragraph a paragraph-mark revision can merge into,
 * skipping block-level range/annotation markers. Returns null when the next
 * block is not a paragraph (table, sdt, sectPr, end of parent).
 */
function findFollowingSiblingParagraph(p: Element): Element | null {
  let sibling: Node | null = p.nextSibling;
  while (sibling) {
    if (sibling.nodeType === 1) {
      if (isW(sibling, 'p')) return sibling;
      const el = sibling as Element;
      if (el.namespaceURI === W_NS && RANGE_MARKUP_BLOCK_SIBLING_LOCALS.has(el.localName ?? '')) {
        sibling = sibling.nextSibling;
        continue;
      }
      return null;
    }
    sibling = sibling.nextSibling;
  }
  return null;
}

/** True iff the paragraph still holds content beyond w:pPr and bare annotation markers. */
function paragraphHasContent(p: Element): boolean {
  for (let i = 0; i < p.childNodes.length; i++) {
    const child = p.childNodes[i]!;
    if (child.nodeType !== 1) continue;
    if (isW(child, 'pPr')) continue;
    const el = child as Element;
    if (el.namespaceURI === W_NS && RANGE_MARKUP_BLOCK_SIBLING_LOCALS.has(el.localName ?? '')) continue;
    return true;
  }
  return false;
}

/**
 * True iff removing an emptied mark-revised paragraph keeps its parent
 * structurally valid for Word: the parent must retain at least one block
 * element, must not end on a w:tbl (a trailing table needs a following
 * paragraph), and two tables must not become adjacent (Word merges
 * back-to-back tables). w:sectPr is ignored — a trailing body sectPr is not a
 * block element.
 */
function canSafelyRemoveEmptyParagraph(p: Element): boolean {
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

/**
 * Resolve a paragraph whose paragraph MARK revision was applied (inserted mark
 * rejected): the inserted paragraph break disappears, so the paragraph's
 * surviving content merges into the FOLLOWING paragraph. The surviving
 * (following) paragraph keeps its own w:pPr — formatting follows the surviving
 * paragraph mark — and the merged-away paragraph's w:pPr is dropped.
 *
 * The revision targets only the mark, never the paragraph's contents, so the
 * contents must not be dropped wholesale (they disappear only via their own
 * run-level w:ins wrappers). When no following sibling paragraph exists (last
 * block, or the next block is a table), there is no break to remove into:
 * content-bearing paragraphs are kept, and emptied ones are removed only where
 * removal keeps the parent structurally valid (canSafelyRemoveEmptyParagraph).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @see https://github.com/UseJunior/safe-docx/issues/431
 */
function resolveParagraphMarkRevision(p: Element): void {
  const parent = p.parentNode;
  if (!parent) return;

  const target = findFollowingSiblingParagraph(p);
  if (!target) {
    if (!paragraphHasContent(p) && canSafelyRemoveEmptyParagraph(p)) {
      parent.removeChild(p);
    }
    return;
  }

  // Insertion point: before the target's first non-pPr child (the merged
  // content precedes the target's own content in document order).
  let ref: Node | null = null;
  for (let i = 0; i < target.childNodes.length; i++) {
    const c = target.childNodes[i]!;
    if (c.nodeType === 1 && isW(c as Element, 'pPr')) continue;
    ref = c;
    break;
  }

  const toMove: Node[] = [];
  for (let i = 0; i < p.childNodes.length; i++) {
    const c = p.childNodes[i]!;
    if (c.nodeType === 1 && isW(c as Element, 'pPr')) continue;
    toMove.push(c);
  }
  for (const c of toMove) {
    target.insertBefore(c, ref);
  }
  parent.removeChild(p);
}

/**
 * Relocate orphaned bookmarks from a paragraph being removed to an
 * adjacent kept paragraph. This preserves cross-paragraph bookmark boundaries.
 */
function relocateBookmarks(p: Element, paragraphsToRemove: Set<Element>): void {
  const parent = p.parentNode;
  if (!parent) return;

  // Find an adjacent kept paragraph (prefer next, fallback to previous)
  let target: Element | null = null;
  let sibling: Node | null = p.nextSibling;
  while (sibling) {
    if (sibling.nodeType === 1 && isW(sibling as Element, 'p') && !paragraphsToRemove.has(sibling as Element)) {
      target = sibling as Element;
      break;
    }
    sibling = sibling.nextSibling;
  }
  if (!target) {
    sibling = p.previousSibling;
    while (sibling) {
      if (sibling.nodeType === 1 && isW(sibling as Element, 'p') && !paragraphsToRemove.has(sibling as Element)) {
        target = sibling as Element;
        break;
      }
      sibling = sibling.previousSibling;
    }
  }
  if (!target) return;

  // Move bookmarkStart/bookmarkEnd elements that are direct children of the
  // paragraph — but only when the paragraph will NOT merge into a following
  // paragraph. The Phase-G merge carries direct children in document order;
  // pre-relocating them here would reorder bookmark boundaries relative to the
  // surviving untracked content. Without a merge target the paragraph may be
  // removed outright, so the markers must be rescued.
  const toMove: Element[] = [];
  if (!findFollowingSiblingParagraph(p)) {
    for (let i = 0; i < p.childNodes.length; i++) {
      const child = p.childNodes[i]!;
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (isW(el, 'bookmarkStart') || isW(el, 'bookmarkEnd')) {
        toMove.push(el);
      }
    }
  }

  // Also check sibling bookmarks that actually ENVELOP this paragraph
  // (sibling-style: <bookmarkStart/><p/><bookmarkEnd/>). Merely moving every
  // consecutive bookmark beside the paragraph corrupts adjacent, unrelated
  // Safe DOCX paragraph anchors—for example, a deleted source paragraph may
  // leave its empty start/end pair immediately after an inserted paragraph.
  // A sibling bookmark belongs to this paragraph only when the start on the
  // left and end on the right share the same w:id.
  const precedingStarts = new Map<string, Element>();
  let prev: Node | null = p.previousSibling;
  while (prev) {
    if (prev.nodeType === 1) {
      const el = prev as Element;
      if (isW(el, 'bookmarkStart')) {
        const id = el.getAttributeNS(W_NS, 'id') ?? el.getAttribute('w:id');
        if (id !== null) precedingStarts.set(id, el);
        prev = prev.previousSibling;
        continue;
      }
      break;
    }
    prev = prev.previousSibling;
  }
  const followingEnds = new Map<string, Element>();
  let next: Node | null = p.nextSibling;
  while (next) {
    if (next.nodeType === 1) {
      const el = next as Element;
      if (isW(el, 'bookmarkEnd')) {
        const id = el.getAttributeNS(W_NS, 'id') ?? el.getAttribute('w:id');
        if (id !== null) followingEnds.set(id, el);
        next = next.nextSibling;
        continue;
      }
      break;
    }
    next = next.nextSibling;
  }
  for (const [id, start] of precedingStarts) {
    const end = followingEnds.get(id);
    if (end) toMove.push(start, end);
  }

  const firstNonPPr = Array.from(target.childNodes).find(
    (n) => !(n.nodeType === 1 && isW(n as Element, 'pPr')),
  ) ?? null;
  for (const bm of toMove) {
    // Insert at the beginning of the target paragraph (after pPr if present)
    if (bm.parentNode) bm.parentNode.removeChild(bm);
    target.insertBefore(bm, firstNonPPr);
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Reject all tracked changes in the document body or story root, restoring
 * the document to its pre-edit state.
 *
 * Mutates the Document in place (same convention as acceptChanges).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.21
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.22
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.25
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.26
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.29
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.30
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.31
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.32
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.34
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.36
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.37
 */
export function rejectChanges(
  doc: Document,
  opts?: { filter?: RevisionFilter },
): RejectChangesResult {
  const filter = opts?.filter ?? ACCEPT_ALL;
  const selective = filter !== ACCEPT_ALL;
  const root = doc.getElementsByTagNameNS(W_NS, 'body').item(0) ?? doc.documentElement;
  if (!root) {
    return {
      insertionsRemoved: 0,
      deletionsRestored: 0,
      movesReverted: 0,
      propertyChangesReverted: 0,
      unresolvedRowRevisions: 0,
    };
  }

  // Phase A — Identify paragraphs whose MARK is a tracked insertion
  const markInsertedParagraphs = new Set<Element>();
  const allParagraphs = collectByLocalName(root, 'p');

  for (const p of allParagraphs) {
    // A paragraph-mark insertion (w:p > w:pPr > w:rPr > w:ins) means the
    // paragraph BREAK was inserted — rejecting it merges the paragraph into the
    // following one (resolveParagraphMarkRevision); the contents disappear only
    // via their own run-level w:ins wrappers.
    // We deliberately do NOT touch a paragraph based on content ("all runs inside
    // w:ins/w:moveTo"): a run-level insertion under an untracked mark means text was
    // inserted into a pre-existing paragraph, which Word/LibreOffice keep (empty) on
    // reject. safe-docx's inserted paragraphs always carry the mark now, so the
    // mark-based rule suffices and is Word-faithful. (Mirrors rejectAllChanges.)
    if (paragraphHasParaMarker(p, 'ins', filter)) {
      markInsertedParagraphs.add(p);
    }
  }

  // Phase B — Preserve cross-paragraph bookmark boundaries. Direct-child
  // bookmarks of a paragraph that will merge ride the Phase-G merge in
  // document order; relocateBookmarks rescues the rest (direct children of a
  // paragraph with no merge target, which may be removed outright, plus
  // adjacent sibling-style markers).
  for (const p of markInsertedParagraphs) {
    relocateBookmarks(p, markInsertedParagraphs);
  }

  // Phase C — Remove insertions and move destinations
  // A `w:trPr > w:ins` marks the ROW as inserted; rejecting it should remove the
  // whole `w:tr`, which this engine does not implement (conformance-adapter.ts
  // already classifies the combination as unsupported). Sweeping it as a content
  // insertion would strip the marker and keep the row — silent divergence with no
  // residual record. Preserve it and report it instead (#845).
  //
  // The mirror direction needs no guard: rejecting a `w:trPr > w:del` correctly
  // keeps the row and drops the marker, which Phase D's unwrap already does.
  const unresolvedRowRevisions = countUnresolvedRowRevisions(root, 'ins', filter);
  const insertionsRemoved = removeAllByLocalName(root, 'ins', filter, isRowPropertyRevisionMarker);
  const moveToRemoved = removeAllByLocalName(root, 'moveTo', filter);
  removeAllByLocalName(root, 'moveToRangeStart', filter);
  removeAllByLocalName(root, 'moveToRangeEnd', filter);
  removeAllByLocalName(root, 'moveFromRangeStart', filter);
  removeAllByLocalName(root, 'moveFromRangeEnd', filter);

  // Phase D — Unwrap deletions and convert w:delText → w:t
  const deletionsRestored = unwrapAllByLocalName(root, 'del', filter);

  // Rename w:delText → w:t so getParagraphText() sees the restored text — but
  // only for delTexts whose w:del wrapper was just unwrapped (no surviving w:del
  // ancestor). In selective mode a foreign (non-target) revision is left intact,
  // so we additionally exclude delText inside a surviving w:moveFrom (a foreign
  // move source also carries w:delText that must not be touched); a targeted del
  // is never nested in a foreign move (that case hard-errors as ambiguous).
  const delTexts = collectByLocalName(root, 'delText').filter(
    (dt) => !hasWAncestor(dt, 'del') && (!selective || !hasWAncestor(dt, 'moveFrom')),
  );
  for (const dt of delTexts) {
    const parent = dt.parentNode;
    if (!parent) continue;
    const t = doc.createElementNS(W_NS, 'w:t');
    // Copy text content
    if (dt.textContent) {
      t.appendChild(doc.createTextNode(dt.textContent));
    }
    // Copy xml:space attribute if present
    const xmlSpace = dt.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'space')
      ?? dt.getAttribute('xml:space');
    if (xmlSpace) {
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', xmlSpace);
    }
    parent.replaceChild(t, dt);
  }

  // Phase E — Unwrap move sources (keep content at original position)
  const moveFromUnwrapped = unwrapAllByLocalName(root, 'moveFrom', filter);

  // Phase F — Restore original properties from *PrChange records
  let propertyChangesReverted = 0;
  for (const localName of PR_CHANGE_LOCALS) {
    const changes = collectByLocalName(root, localName).filter(filter);
    // Sort deepest-first
    changes.sort((a, b) => getDepth(b) - getDepth(a));
    for (const change of changes) {
      const parentProp = change.parentNode as Element | null;
      if (!parentProp) continue;
      const grandParent = parentProp.parentNode;
      if (!grandParent) continue;

      // The *PrChange element contains the original properties.
      // Extract the original property element (e.g. rPr inside rPrChange).
      // The expected mapping:
      //   rPrChange → child rPr = original run properties
      //   pPrChange → child pPr = original paragraph properties
      //   etc.
      const expectedChildLocal = localName.replace('Change', '');
      let originalProps: Element | null = null;
      for (let i = 0; i < change.childNodes.length; i++) {
        const child = change.childNodes[i]!;
        if (child.nodeType === 1 && isW(child as Element, expectedChildLocal)) {
          originalProps = child as Element;
          break;
        }
      }

      if (originalProps) {
        // Replace the current property element with the original
        const restored = originalProps.cloneNode(true) as Element;
        // CT_SectPrChange carries CT_SectPrBase, which intentionally excludes
        // header/footer references. Those live bindings are not part of the
        // page-setup property revision and must survive rejection.
        // A `w:trPr` may carry BOTH a row-level revision marker and a
        // `w:trPrChange`. Restoring the snapshot replaces the whole `w:trPr`,
        // which would silently destroy any surviving marker — including the
        // unresolved `w:ins` Phase C deliberately preserved (making the reported
        // `unresolvedRowRevisions` disagree with the document) and any FOREIGN
        // marker a selective reject promised to leave byte-untouched.
        //
        // `w:trPrChange` carries CT_TrPrBase, which has no row-revision
        // children of its own, so transplanting the survivors cannot collide
        // with the restored properties.
        if (localName === 'trPrChange') {
          const survivingRowMarkers = Array.from(parentProp.childNodes)
            .filter((node): node is Element =>
              node.nodeType === 1
              && (isW(node as Element, 'ins') || isW(node as Element, 'del')))
            .map((marker) => marker.cloneNode(true));
          for (const marker of survivingRowMarkers.reverse()) {
            restored.insertBefore(marker, restored.firstChild);
          }
        }
        if (localName === 'sectPrChange') {
          const liveReferences = Array.from(parentProp.childNodes)
            .filter((node): node is Element =>
              node.nodeType === 1
              && (
                isW(node as Element, 'headerReference')
                || isW(node as Element, 'footerReference')
              ))
            .map((reference) => reference.cloneNode(true));
          for (const reference of liveReferences.reverse()) {
            restored.insertBefore(reference, restored.firstChild);
          }
        }
        grandParent.replaceChild(restored, parentProp);
      } else {
        // Original props were empty — remove the parent property element entirely
        grandParent.removeChild(parentProp);
      }
      propertyChangesReverted++;
    }
  }

  // Phase G — Cleanup
  // Strip paragraph-level revision markers from w:pPr/w:rPr
  for (const p of collectByLocalName(root, 'p')) {
    for (let i = 0; i < p.childNodes.length; i++) {
      const child = p.childNodes[i]!;
      if (!isW(child, 'pPr')) continue;
      for (let j = 0; j < child.childNodes.length; j++) {
        const pPrChild = child.childNodes[j]!;
        if (!isW(pPrChild, 'rPr')) continue;
        const toRemove: Element[] = [];
        for (let k = 0; k < pPrChild.childNodes.length; k++) {
          const rPrChild = pPrChild.childNodes[k]!;
          if ((isW(rPrChild, 'ins') || isW(rPrChild, 'del')) && filter(rPrChild)) {
            toRemove.push(rPrChild as Element);
          }
        }
        for (const el of toRemove) {
          pPrChild.removeChild(el);
        }
      }
    }
  }

  // Resolve paragraphs collected in Phase A: merge each into its following
  // paragraph (document order, so consecutive mark-inserted paragraphs cascade
  // forward into the first surviving one).
  for (const p of markInsertedParagraphs) {
    resolveParagraphMarkRevision(p);
  }

  // Strip w:rsidDel attributes on remaining elements. Skipped in selective mode
  // so a targeted reject leaves foreign elements byte-untouched (#125).
  if (!selective) {
    const allElements = root.getElementsByTagNameNS(W_NS, '*');
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i]!;
      if (el.hasAttributeNS(W_NS, 'rsidDel')) {
        el.removeAttributeNS(W_NS, 'rsidDel');
      }
      if (el.hasAttribute('w:rsidDel')) {
        el.removeAttribute('w:rsidDel');
      }
    }
  }

  return {
    insertionsRemoved,
    deletionsRestored,
    movesReverted: moveFromUnwrapped + moveToRemoved,
    propertyChangesReverted,
    unresolvedRowRevisions,
  };
}
