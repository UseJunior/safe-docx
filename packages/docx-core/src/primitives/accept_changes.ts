/**
 * accept_changes — accept all tracked changes in a OOXML document body.
 *
 * Resolves the supported revision subset by:
 * - Removing w:del elements and their content
 * - Unwrapping w:ins elements (promoting children)
 * - Removing w:moveFrom (source), unwrapping w:moveTo (destination)
 * - Removing all *PrChange property change records
 * - Stripping paragraph-level revision markers, merging a paragraph whose
 *   mark was a tracked deletion into the following paragraph
 * - Cleaning up move range markers and rsidDel attributes
 *
 * Numbering, table-grid/exception, cell-topology, custom XML, and extension
 * conflict records are not semantically resolved here; see the advanced
 * revision classification manifest.
 *
 * Operates on the W3C DOM (`@xmldom/xmldom`) — the same API used
 * throughout docx-primitives-ts (contrast with docx-comparison's
 * custom WmlElement AST).
 */

import { OOXML } from './namespaces.js';
import { retainLeadingParagraphFormatting, isEmptyParagraphFormattingRun, removeEmptyParagraphMarkProperties } from './paragraph_merge_formatting.js';
import { removeResolvedRowMarker, removeTableRowAndEmptyTable } from './table_rows.js';
import { RANGE_MARKUP_BLOCK_SIBLING_LOCALS, canSafelyRemoveEmptyParagraph } from './paragraph_structure.js';

const W_NS = OOXML.W_NS;

export type AcceptChangesResult = {
  insertionsAccepted: number;
  deletionsAccepted: number;
  movesResolved: number;
  propertyChangesResolved: number;
  /**
   * Compatibility field. Supported row-level markers are resolved and report 0.
   */
  unresolvedRowRevisions: number;
};

/**
 * Predicate selecting which revision elements a sweep processes. The default
 * ({@link ACCEPT_ALL}) processes every revision — the original whole-document
 * behavior. `acceptAIEdits`/`rejectAIEdits` (#123) pass a predicate that matches
 * only the targeted revision ids so foreign (non-target) revisions are left
 * byte-untouched.
 */
export type RevisionFilter = (el: Element) => boolean;

const ACCEPT_ALL: RevisionFilter = () => true;

/** The package-wide revision id (`w:id`) of a revision element, if any. */
export function revisionElementId(el: Element): string | null {
  return el.getAttributeNS(W_NS, 'id') ?? el.getAttribute('w:id');
}

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
 * `w:tr > w:trPr > w:del` marks the row itself as deleted and
 * `w:tr > w:trPr > w:ins` marks it as inserted. A sweep that matches on local
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

function acceptSelectedRowRevisions(root: Element, filter: RevisionFilter): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  for (const marker of collectByLocalName(root, 'del').filter(filter).filter(isRowPropertyRevisionMarker)) {
    const row = marker.parentNode?.parentNode;
    if (row?.parentNode && isW(row as Element, 'tr')) {
      removeTableRowAndEmptyTable(root, row as Element);
      deletions++;
    }
  }
  for (const marker of collectByLocalName(root, 'ins').filter(filter).filter(isRowPropertyRevisionMarker)) {
    removeResolvedRowMarker(marker);
    insertions++;
  }
  return { insertions, deletions };
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
function paragraphHasContent(p: Element, forFormatting = false): boolean {
  for (let i = 0; i < p.childNodes.length; i++) {
    const child = p.childNodes[i]!;
    if (child.nodeType !== 1) continue;
    if (isW(child, 'pPr')) continue;
    const el = child as Element;
    if (forFormatting && isEmptyParagraphFormattingRun(el)) continue;
    if (el.namespaceURI === W_NS && RANGE_MARKUP_BLOCK_SIBLING_LOCALS.has(el.localName ?? '')) continue;
    return true;
  }
  return false;
}

/**
 * Resolve a paragraph whose paragraph MARK revision was applied (deleted mark
 * accepted): the paragraph break disappears, so the paragraph's remaining
 * content merges into the FOLLOWING paragraph. When leading content survives,
 * its base formatting survives too; otherwise the following formatting stays.
 * This formatting choice is independently reader-characterized, not inferred
 * from the paragraph-mark rule alone.
 *
 * The revision targets only the mark, never the paragraph's contents, so the
 * contents must not be dropped wholesale. When no following sibling paragraph
 * exists (last block, or the next block is a table), there is no break to
 * remove into: content-bearing paragraphs are kept, and emptied ones are
 * removed only where removal keeps the parent structurally valid
 * (canSafelyRemoveEmptyParagraph).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @see https://github.com/UseJunior/safe-docx/issues/431
 */
function resolveParagraphMarkRevision(p: Element): void {
  const parent = p.parentNode;
  if (!parent) return;

  const target = findFollowingSiblingParagraph(p);
  if (!target) {
    removeEmptyParagraphMarkProperties(p);
    if (!paragraphHasContent(p) && canSafelyRemoveEmptyParagraph(p)) {
      parent.removeChild(p);
    }
    return;
  }

  if (paragraphHasContent(p, true)) retainLeadingParagraphFormatting(p, target);

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
 * An emptied paragraph with no following sibling paragraph has no break to
 * merge into and is removed, taking its direct children with it. A bookmark
 * boundary there whose opposite endpoint survives elsewhere would be orphaned,
 * so move it first to the nearest same-story paragraph in document order
 * (#1019): appended to the previous one, else prepended to the next.
 */
function rescueBookmarksFromUnmergedEmptyParagraph(
  root: Element,
  p: Element,
  bookmarksById: ReadonlyMap<string, readonly Element[]>,
): void {
  if (!Array.from(p.childNodes).some(c => isW(c, 'bookmarkStart') || isW(c, 'bookmarkEnd'))) return;
  if (!p.parentNode || paragraphHasContent(p) || findFollowingSiblingParagraph(p) || !canSafelyRemoveEmptyParagraph(p)) return;
  const idOf = (marker: Element) => marker.getAttributeNS(W_NS, 'id') ?? marker.getAttribute('w:id');
  const attached = (node: Node): boolean => {
    let current: Node | null = node;
    while (current && current !== root) current = current.parentNode;
    return current === root;
  };
  // Rescue only a boundary that stays paired: its opposite endpoint survives
  // (here or elsewhere) and no same-kind duplicate survives elsewhere.
  const live = (localName: string, id: string, outsideOnly: boolean) => (bookmarksById.get(id) ?? [])
    .some(other => other.localName === localName && (!outsideOnly || other.parentNode !== p) && attached(other));
  const markers = Array.from(p.childNodes).filter((marker): marker is Element => {
    if (!isW(marker, 'bookmarkStart') && !isW(marker, 'bookmarkEnd')) return false;
    const id = idOf(marker);
    const opposite = isW(marker, 'bookmarkStart') ? 'bookmarkEnd' : 'bookmarkStart';
    return !!id && live(opposite, id, false) && !live(marker.localName, id, true);
  });
  if (markers.length === 0) return;
  // Descend into block containers (tables, content controls) beside the
  // removed paragraph, but never into a nested story (a text box's
  // paragraphs sit inside a w:p).
  const sameStory = (candidate: Element, container: Node): boolean => {
    for (let a = candidate.parentNode; a && a !== container; a = a.parentNode) {
      if (isW(a, 'p') || isW(a, 'txbxContent')) return false;
    }
    return true;
  };
  const nearest = (step: (n: Node) => Node | null, last: boolean): Element | null => {
    for (let n = step(p); n; n = step(n)) {
      if (isW(n, 'p')) return n;
      if (n.nodeType !== 1) continue;
      const nested = Array.from((n as Element).getElementsByTagNameNS(W_NS, 'p'))
        .filter(candidate => sameStory(candidate, n));
      if (nested.length > 0) return nested[last ? nested.length - 1 : 0]!;
    }
    return null;
  };
  const previous = nearest(n => n.previousSibling, true);
  const target = previous ?? nearest(n => n.nextSibling, false);
  if (!target) return;
  let ref: Node | null = null;
  if (!previous) {
    for (let i = 0; i < target.childNodes.length && !ref; i++) {
      if (!isW(target.childNodes[i]!, 'pPr')) ref = target.childNodes[i]!;
    }
  }
  for (const marker of markers) target.insertBefore(marker, ref);
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Accept all tracked changes in the document body or story root, producing a
 * document with supported revision records resolved.
 *
 * Mutates the Document in place (same convention as simplifyRedlines
 * and mergeRuns).
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
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.36
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.37
 * @ooxmlSpec ooxml.ecma376.5ed.part1.revisions.moves
 * @ooxmlSpec ooxml.ecma376.5ed.part1.revisions.run-properties-paragraph-mark
 * @ooxmlSpec ooxml.ecma376.5ed.part1.revisions.section-properties
 * @ooxmlSpec ooxml.ecma376.5ed.part1.revisions.table-properties
 * @ooxmlSpec ooxml.ecma376.5ed.part1.revisions.table-cell-properties
 */
export function acceptChanges(
  doc: Document,
  opts?: { filter?: RevisionFilter },
): AcceptChangesResult {
  const filter = opts?.filter ?? ACCEPT_ALL;
  const selective = filter !== ACCEPT_ALL;
  const root = doc.getElementsByTagNameNS(W_NS, 'body').item(0) ?? doc.documentElement;
  if (!root) {
    return {
      insertionsAccepted: 0,
      deletionsAccepted: 0,
      movesResolved: 0,
      propertyChangesResolved: 0,
      unresolvedRowRevisions: 0,
    };
  }

  // Resolve row topology before collecting paragraph-mark revisions: a selected
  // deleted row disappears as one revision, while an inserted row is retained
  // and only its row marker is stripped.
  const rowRevisions = acceptSelectedRowRevisions(root, filter);

  // Phase A — Identify deleted or moved-from paragraph marks.
  const markDeletedParagraphs: Element[] = [];
  const allParagraphs = collectByLocalName(root, 'p');
  // Capture selected direct mark/property histories before other phases remove
  // them, including accepted insertions which do not remove a paragraph break.
  const resolvedMarkProperties = allParagraphs.filter(p =>
    ['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange'].some(kind => paragraphHasParaMarker(p, kind, filter)));

  for (const p of allParagraphs) {
    // A paragraph-mark deletion (w:p > w:pPr > w:rPr > w:del) means the
    // paragraph BREAK was deleted — accepting it merges the paragraph into the
    // following one (resolveParagraphMarkRevision); the contents are deleted
    // only via their own run-level w:del wrappers.
    // We deliberately do NOT touch a paragraph based on content ("all runs inside
    // w:del/w:moveFrom"): a run-level deletion under an untracked mark means text was
    // deleted from a pre-existing paragraph, which Word/LibreOffice keep (empty) on
    // accept. safe-docx's deleted paragraphs always carry the mark now, so the
    // mark-based rule suffices and is Word-faithful. (Mirrors acceptAllChanges and the
    // reject-side rule.)
    if (paragraphHasParaMarker(p, 'del', filter) || paragraphHasParaMarker(p, 'moveFrom', filter)) {
      markDeletedParagraphs.push(p);
    }
  }

  // A bookmark endpoint inside a selected deletion can have its paired endpoint
  // live outside that wrapper so the combined redline visibly brackets deleted
  // text. Accepting the deletion must remove that live original-side endpoint
  // as well; otherwise a cross-paragraph range becomes orphaned.
  const deletedBookmarkIds = new Set<string>();
  for (const deletion of [...collectByLocalName(root, 'del'), ...collectByLocalName(root, 'moveFrom')].filter(filter)) {
    for (const localName of ['bookmarkStart', 'bookmarkEnd']) {
      for (const boundary of collectByLocalName(deletion, localName)) {
        const id = boundary.getAttributeNS(W_NS, 'id') ?? boundary.getAttribute('w:id');
        if (id) deletedBookmarkIds.add(id);
      }
    }
  }
  for (const paragraph of markDeletedParagraphs) {
    const direct = Array.from(paragraph.childNodes)
      .filter((child): child is Element => child.nodeType === 1);
    const substantive = direct.filter((child) =>
      !isW(child, 'pPr') && !isW(child, 'bookmarkStart') && !isW(child, 'bookmarkEnd'));
    if (substantive.length === 0 || !substantive.every((child) =>
      (isW(child, 'del') || isW(child, 'moveFrom')) && filter(child))) {
      continue;
    }
    // Harvest only endpoint pairs local to this paragraph (the mirror of
    // Reject's moveTo guard). A boundary whose counterpart lives in a kept
    // paragraph rides the Phase-E merge into the surviving content instead of
    // being dropped with its live counterpart (#1019).
    const endIds = new Set(direct.filter((child) => isW(child, 'bookmarkEnd'))
      .map((child) => child.getAttributeNS(W_NS, 'id') ?? child.getAttribute('w:id')));
    for (const start of direct.filter((child) => isW(child, 'bookmarkStart'))) {
      const id = start.getAttributeNS(W_NS, 'id') ?? start.getAttribute('w:id');
      if (id && endIds.has(id)) deletedBookmarkIds.add(id);
    }
  }
  const isInsideRevision = (marker: Element): boolean => {
    let current: Node | null = marker.parentNode;
    while (current && current !== root) {
      if (isW(current, 'del') || isW(current, 'ins') || isW(current, 'moveFrom') || isW(current, 'moveTo')) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  };
  if (deletedBookmarkIds.size > 0) {
    for (const localName of ['bookmarkStart', 'bookmarkEnd']) {
      for (const marker of collectByLocalName(root, localName)) {
        const id = marker.getAttributeNS(W_NS, 'id') ?? marker.getAttribute('w:id');
        if (id && deletedBookmarkIds.has(id) && !isInsideRevision(marker)) {
          marker.parentNode?.removeChild(marker);
        }
      }
    }
  }

  // Phase B — Remove deletions and move sources.
  const deletionsAccepted = rowRevisions.deletions + removeAllByLocalName(root, 'del', filter, isRowPropertyRevisionMarker);
  const moveFromRemoved = removeAllByLocalName(root, 'moveFrom', filter);
  removeAllByLocalName(root, 'moveFromRangeStart', filter);
  removeAllByLocalName(root, 'moveFromRangeEnd', filter);
  removeAllByLocalName(root, 'moveToRangeStart', filter);
  removeAllByLocalName(root, 'moveToRangeEnd', filter);

  // Phase C — Unwrap insertions and move destinations (depth-sorted)
  const insertionsAccepted = rowRevisions.insertions + unwrapAllByLocalName(root, 'ins', filter);
  const moveToUnwrapped = unwrapAllByLocalName(root, 'moveTo', filter);

  // Phase D — Remove property change records
  let propertyChangesResolved = 0;
  for (const localName of PR_CHANGE_LOCALS) {
    propertyChangesResolved += removeAllByLocalName(root, localName, filter);
  }

  // Phase E — Cleanup
  // Strip paragraph-level revision markers from w:pPr/w:rPr (only those the
  // filter selects, so a selective accept leaves foreign paragraph-mark
  // revisions byte-untouched).
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
  // paragraph (document order, so consecutive mark-deleted paragraphs cascade
  // forward into the first surviving one).
  const bookmarksById = new Map<string, Element[]>();
  for (const marker of [...collectByLocalName(root, 'bookmarkStart'), ...collectByLocalName(root, 'bookmarkEnd')]) {
    const id = marker.getAttributeNS(W_NS, 'id') ?? marker.getAttribute('w:id');
    if (id) bookmarksById.set(id, [...(bookmarksById.get(id) ?? []), marker]);
  }
  for (const p of markDeletedParagraphs) {
    rescueBookmarksFromUnmergedEmptyParagraph(root, p, bookmarksById);
    resolveParagraphMarkRevision(p);
  }
  for (const p of resolvedMarkProperties) removeEmptyParagraphMarkProperties(p);

  // Strip w:rsidDel attributes on remaining elements. Skipped in selective
  // mode: rsidDel is a document-wide save-id, and a selective accept must not
  // mutate elements outside the targeted revision set (the mixed-author
  // byte-identical invariant, #125). The accepted revisions are removed/unwrapped
  // above, taking their own rsidDel with them.
  if (!selective) {
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
  }

  return {
    insertionsAccepted,
    deletionsAccepted,
    movesResolved: moveFromRemoved + moveToUnwrapped,
    propertyChangesResolved,
    unresolvedRowRevisions: 0,
  };
}
