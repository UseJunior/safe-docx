/**
 * Track Changes Acceptor/Rejector (AST-based)
 *
 * AST-based utilities to accept or reject all track changes in a document.
 * Replaces the regex-based implementation for better reliability with nested structures.
 */

import { parseDocumentXml, serializeToXml } from './xmlToWmlElement.js';
import {
  removeAllByTagName,
  unwrapAllByTagName,
  findAllByTagName,
  renameElement,
  insertChildAt,
  childElements,
  getLeafText,
  NODE_TYPE,
} from '@usejunior/docx-core';

/**
 * Remove w:hyperlink elements left with no element children after change
 * resolution. Word drops a hyperlink whose entire content was a resolved
 * tracked change (all link text deleted + accepted, or all link text
 * inserted + rejected); keeping the empty wrapper would ship a contentless
 * `<w:hyperlink r:id=".."/>` husk. Hyperlinks that still hold any element
 * (runs, bookmarks, range markers) are kept.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.22
 * @see https://github.com/UseJunior/safe-docx/issues/368
 */
function removeEmptyHyperlinks(root: Element): void {
  for (const hyperlink of findAllByTagName(root, 'w:hyperlink')) {
    if (childElements(hyperlink).length === 0 && hyperlink.parentNode) {
      hyperlink.parentNode.removeChild(hyperlink);
    }
  }
}

/** xmldom does not implement parentElement; use parentNode with an Element guard. */
function parentElement(node: Node): Element | undefined {
  const p = node.parentNode;
  return p && p.nodeType === NODE_TYPE.ELEMENT ? (p as Element) : undefined;
}

function getParagraphPPr(p: Element): Element | undefined {
  return childElements(p).find((c) => c.tagName === 'w:pPr');
}

function paragraphHasParaMarker(p: Element, tagName: 'w:ins' | 'w:del'): boolean {
  // Strict paragraph-mark marker shape: w:p > w:pPr > w:rPr > (w:ins | w:del),
  // navigated by direct children only — NOT a descendant search. A descendant
  // search would mistake a marker nested inside a w:pPrChange snapshot (which
  // stores a prior w:pPr/w:rPr) for the live paragraph mark, and would diverge
  // from the primitive rejectChanges (primitives/reject_changes.ts), which both
  // reject paths must agree with.
  const pPr = getParagraphPPr(p);
  if (!pPr) return false;
  const rPr = childElements(pPr).find((c) => c.tagName === 'w:rPr');
  if (!rPr) return false;
  return childElements(rPr).some((c) => c.tagName === tagName);
}

function removeParaMarkers(root: Element): void {
  // Remove paragraph-level revision markers (<w:ins/> / <w:del/>) that live under <w:pPr>.
  for (const p of findAllByTagName(root, 'w:p')) {
    const pPr = getParagraphPPr(p);
    if (!pPr) continue;

    const markers = [
      ...findAllByTagName(pPr, 'w:ins'),
      ...findAllByTagName(pPr, 'w:del'),
    ];
    for (const m of markers) {
      if (m.parentNode) m.parentNode.removeChild(m);
    }
  }
}

function findContainingParagraph(node: Element | undefined): Element | undefined {
  let current: Element | undefined = node;
  while (current) {
    if (current.tagName === 'w:p') {
      return current;
    }
    current = parentElement(current);
  }
  return undefined;
}

function findNeighborParagraphOutsideRemoval(
  paragraph: Element,
  paragraphsToRemove: ReadonlySet<Element>,
  direction: 'previous' | 'next'
): Element | undefined {
  const parent = parentElement(paragraph);
  if (!parent) {
    return undefined;
  }

  const siblings = childElements(parent);
  const paragraphIndex = siblings.indexOf(paragraph);
  if (paragraphIndex < 0) {
    return undefined;
  }

  const step = direction === 'previous' ? -1 : 1;
  for (let i = paragraphIndex + step; i >= 0 && i < siblings.length; i += step) {
    const sibling = siblings[i];
    if (sibling?.tagName !== 'w:p') {
      continue;
    }
    if (paragraphsToRemove.has(sibling)) {
      continue;
    }
    return sibling;
  }

  return undefined;
}

function paragraphContentStartIndex(paragraph: Element): number {
  const children = childElements(paragraph);
  let idx = 0;
  while (idx < children.length && children[idx]?.tagName === 'w:pPr') {
    idx++;
  }
  return idx;
}

// Marker-ish elements that may sit between two paragraphs at block level
// without ending the search for a merge target: the full EG_RangeMarkupElements
// schema group (wml.xsd), plus permStart/permEnd range markers and proofErr
// proofing anchors.
const RANGE_MARKUP_BLOCK_SIBLING_TAGS = new Set([
  'w:bookmarkStart', 'w:bookmarkEnd',
  'w:commentRangeStart', 'w:commentRangeEnd',
  'w:moveFromRangeStart', 'w:moveFromRangeEnd',
  'w:moveToRangeStart', 'w:moveToRangeEnd',
  'w:customXmlInsRangeStart', 'w:customXmlInsRangeEnd',
  'w:customXmlDelRangeStart', 'w:customXmlDelRangeEnd',
  'w:customXmlMoveFromRangeStart', 'w:customXmlMoveFromRangeEnd',
  'w:customXmlMoveToRangeStart', 'w:customXmlMoveToRangeEnd',
  'w:permStart', 'w:permEnd',
  'w:proofErr',
]);

/**
 * Find the next sibling paragraph a paragraph-mark revision can merge into,
 * skipping block-level range/annotation markers. Returns undefined when the
 * next block is not a paragraph (table, sdt, sectPr, end of parent).
 */
function findFollowingSiblingParagraph(p: Element): Element | undefined {
  const parent = parentElement(p);
  if (!parent) return undefined;
  const siblings = childElements(parent);
  const idx = siblings.indexOf(p);
  if (idx < 0) return undefined;
  for (let i = idx + 1; i < siblings.length; i++) {
    const sibling = siblings[i]!;
    if (sibling.tagName === 'w:p') return sibling;
    if (RANGE_MARKUP_BLOCK_SIBLING_TAGS.has(sibling.tagName)) continue;
    return undefined;
  }
  return undefined;
}

/** True iff the paragraph still holds content beyond w:pPr and bare annotation markers. */
function paragraphHasContent(p: Element): boolean {
  return childElements(p).some(
    (c) => c.tagName !== 'w:pPr' && !RANGE_MARKUP_BLOCK_SIBLING_TAGS.has(c.tagName)
  );
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
  const parent = parentElement(p);
  if (!parent) return false;
  const siblings = childElements(parent).filter(
    (c) => !RANGE_MARKUP_BLOCK_SIBLING_TAGS.has(c.tagName) && c.tagName !== 'w:sectPr'
  );
  const idx = siblings.indexOf(p);
  if (idx < 0) return false;
  const prev = siblings[idx - 1];
  const next = siblings[idx + 1];
  if (!prev && !next) return false;
  if (prev?.tagName === 'w:tbl' && !next) return false;
  if (prev?.tagName === 'w:tbl' && next?.tagName === 'w:tbl') return false;
  return true;
}

/**
 * Resolve a paragraph whose paragraph MARK revision was applied (deleted mark
 * accepted, or inserted mark rejected): the paragraph break disappears, so the
 * paragraph's remaining content merges into the FOLLOWING paragraph. The
 * surviving (following) paragraph keeps its own w:pPr — formatting follows the
 * surviving paragraph mark — and the merged-away paragraph's w:pPr is dropped.
 *
 * The revision targets only the mark, never the paragraph's contents, so the
 * contents must not be dropped wholesale (they are removed only via their own
 * run-level w:del / w:ins wrappers). When no following sibling paragraph
 * exists (last block, or the next block is a table), there is no break to
 * remove into: content-bearing paragraphs are kept, and emptied ones are
 * removed only where removal keeps the parent structurally valid
 * (canSafelyRemoveEmptyParagraph).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
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

  // The merged content precedes the target's own content in document order.
  let insertIndex = paragraphContentStartIndex(target);
  for (const child of childElements(p)) {
    if (child.tagName === 'w:pPr') continue;
    p.removeChild(child);
    insertChildAt(target, child, insertIndex);
    insertIndex++;
  }
  parent.removeChild(p);
}

function moveBookmarkMarker(
  marker: Element,
  targetParagraph: Element,
  position: 'start' | 'end'
): void {
  if (marker.tagName === 'w:bookmarkStart') {
    const markerId = marker.getAttribute('w:id');
    const markerName = marker.getAttribute('w:name');
    for (const existing of findAllByTagName(targetParagraph, 'w:bookmarkStart')) {
      if (markerId && existing.getAttribute('w:id') === markerId) {
        if (marker.parentNode) marker.parentNode.removeChild(marker);
        return;
      }
      if (markerName && existing.getAttribute('w:name') === markerName) {
        if (marker.parentNode) marker.parentNode.removeChild(marker);
        return;
      }
    }
  }

  if (marker.tagName === 'w:bookmarkEnd') {
    const markerId = marker.getAttribute('w:id');
    if (markerId) {
      for (const existing of findAllByTagName(targetParagraph, 'w:bookmarkEnd')) {
        if (existing.getAttribute('w:id') === markerId) {
          if (marker.parentNode) marker.parentNode.removeChild(marker);
          return;
        }
      }
    }
  }

  if (marker.parentNode) {
    marker.parentNode.removeChild(marker);
  }

  if (position === 'start') {
    insertChildAt(targetParagraph, marker, paragraphContentStartIndex(targetParagraph));
    return;
  }

  targetParagraph.appendChild(marker);
}

function collectBookmarksById(nodes: Element[]): Map<string, Element[]> {
  const byId = new Map<string, Element[]>();
  for (const node of nodes) {
    const id = node.getAttribute('w:id');
    if (!id) {
      continue;
    }
    const existing = byId.get(id);
    if (existing) {
      existing.push(node);
    } else {
      byId.set(id, [node]);
    }
  }
  return byId;
}

function hasCounterpartOutsideRemovedParagraphs(
  counterpartNodes: Element[] | undefined,
  paragraphsToRemove: ReadonlySet<Element>,
  sourceParagraph: Element
): boolean {
  if (!counterpartNodes || counterpartNodes.length === 0) {
    return false;
  }

  for (const node of counterpartNodes) {
    if (!node.parentNode) {
      continue;
    }
    const nodeParagraph = findContainingParagraph(node);
    if (!nodeParagraph || nodeParagraph === sourceParagraph) {
      continue;
    }
    if (!paragraphsToRemove.has(nodeParagraph)) {
      return true;
    }
  }

  return false;
}

function collectReferencedBookmarkNamesOutsideRemovedParagraphs(
  root: Element,
  paragraphsToRemove: ReadonlySet<Element>
): Set<string> {
  const names = new Set<string>();
  const refRegex = /\b(?:PAGEREF|REF)\s+([^\s\\]+)/g;

  for (const instrText of findAllByTagName(root, 'w:instrText')) {
    const paragraph = findContainingParagraph(instrText);
    if (paragraph && paragraphsToRemove.has(paragraph)) {
      continue;
    }

    const text = getLeafText(instrText) ?? '';
    for (const match of text.matchAll(refRegex)) {
      const name = match[1]?.trim();
      if (name) {
        names.add(name);
      }
    }
  }

  return names;
}

function getBookmarkNameForId(startsById: Map<string, Element[]>, id: string): string | undefined {
  const starts = startsById.get(id);
  if (!starts) return undefined;
  for (const start of starts) {
    const name = start.getAttribute('w:name');
    if (name) return name;
  }
  return undefined;
}

/**
 * Preserve bookmark markers that span outside paragraphs being removed during Reject All.
 *
 * Inserted paragraphs are removed wholesale. If they contain a bookmark boundary whose
 * counterpart sits in a kept paragraph, dropping that boundary corrupts bookmark pairing.
 * Move those boundary markers into adjacent kept paragraphs before removal.
 */
function preserveCrossParagraphBookmarksForReject(
  root: Element,
  paragraphsToRemove: ReadonlySet<Element>
): void {
  if (paragraphsToRemove.size === 0) {
    return;
  }

  const startsById = collectBookmarksById(findAllByTagName(root, 'w:bookmarkStart'));
  const endsById = collectBookmarksById(findAllByTagName(root, 'w:bookmarkEnd'));
  const referencedNamesOutsideRemoved = collectReferencedBookmarkNamesOutsideRemovedParagraphs(
    root,
    paragraphsToRemove
  );

  for (const paragraph of paragraphsToRemove) {
    const startTarget =
      findNeighborParagraphOutsideRemoval(paragraph, paragraphsToRemove, 'next') ??
      findNeighborParagraphOutsideRemoval(paragraph, paragraphsToRemove, 'previous');
    const endTarget =
      findNeighborParagraphOutsideRemoval(paragraph, paragraphsToRemove, 'previous') ??
      findNeighborParagraphOutsideRemoval(paragraph, paragraphsToRemove, 'next');

    if (!startTarget && !endTarget) {
      continue;
    }

    for (const start of findAllByTagName(paragraph, 'w:bookmarkStart')) {
      if (!start.parentNode || !startTarget) {
        continue;
      }

      if (parentElement(start) === paragraph && findFollowingSiblingParagraph(paragraph)) {
        // A direct child of a merging paragraph rides the Step-3 merge in
        // document order; pre-moving it here would reorder the boundary
        // relative to the surviving untracked content.
        continue;
      }

      const id = start.getAttribute('w:id');
      if (!id) {
        continue;
      }

      const startName = start.getAttribute('w:name');
      const hasDuplicateStartOutside = hasCounterpartOutsideRemovedParagraphs(
        startsById.get(id),
        paragraphsToRemove,
        paragraph
      );
      if (hasDuplicateStartOutside) {
        // A surviving start marker with this ID already exists outside removed
        // paragraphs. Moving this marker would create duplicate starts after
        // Reject All.
        continue;
      }

      const hasCounterpartOutside = hasCounterpartOutsideRemovedParagraphs(
        endsById.get(id),
        paragraphsToRemove,
        paragraph
      );
      const referencedOutside = startName ? referencedNamesOutsideRemoved.has(startName) : false;

      if (!hasCounterpartOutside && !referencedOutside) {
        continue;
      }

      moveBookmarkMarker(start, startTarget, 'start');
    }

    for (const end of findAllByTagName(paragraph, 'w:bookmarkEnd')) {
      if (!end.parentNode || !endTarget) {
        continue;
      }

      if (parentElement(end) === paragraph && findFollowingSiblingParagraph(paragraph)) {
        // A direct child of a merging paragraph rides the Step-3 merge in
        // document order; pre-moving it here would reorder the boundary
        // relative to the surviving untracked content.
        continue;
      }

      const id = end.getAttribute('w:id');
      if (!id) {
        continue;
      }

      const hasDuplicateEndOutside = hasCounterpartOutsideRemovedParagraphs(
        endsById.get(id),
        paragraphsToRemove,
        paragraph
      );
      if (hasDuplicateEndOutside) {
        // A surviving end marker with this ID already exists outside removed
        // paragraphs. Moving this marker would create duplicate ends after
        // Reject All.
        continue;
      }

      const hasCounterpartOutside = hasCounterpartOutsideRemovedParagraphs(
        startsById.get(id),
        paragraphsToRemove,
        paragraph
      );
      const pairedName = getBookmarkNameForId(startsById, id);
      const referencedOutside = pairedName ? referencedNamesOutsideRemoved.has(pairedName) : false;

      if (!hasCounterpartOutside && !referencedOutside) {
        continue;
      }

      moveBookmarkMarker(end, endTarget, 'end');
    }
  }
}

/**
 * Accept all track changes in document XML (AST-based).
 *
 * - Removes w:del elements entirely (deleted content disappears)
 * - Unwraps w:ins elements (inserted content becomes normal)
 * - Handles w:moveFrom (remove) and w:moveTo (unwrap)
 * - Removes format change tracking elements
 *
 * @param documentXml - The document.xml content with track changes
 * @returns Document XML with all changes accepted
 */
export function acceptAllChanges(documentXml: string): string {
  const root = parseDocumentXml(documentXml);

  // Merge a paragraph on Accept All iff its paragraph MARK is a tracked deletion
  // (<w:pPr><w:rPr><w:del .../></w:rPr>) — the paragraph BREAK itself was deleted, so accepting
  // the deletion merges the paragraph's surviving content into the following paragraph
  // (resolveParagraphMarkRevision). The contents are deleted only via their own run-level
  // w:del wrappers. This is the Word/LibreOffice-faithful, purely mark-based rule (the
  // accept-side mirror of rejectAllChanges).
  //
  // We deliberately do NOT touch a paragraph based on content (e.g. "all runs are inside w:del"
  // or "w:moveFrom"). A run-level deletion under an UNTRACKED paragraph mark means text was
  // deleted from a pre-existing paragraph; Word and LibreOffice both keep that paragraph (empty)
  // on accept, and a content-based drop over-deletes it. safe-docx's own deleted paragraphs
  // always carry the PPR-DEL mark (wrapParagraphAsDeleted), so the mark-based rule covers them
  // without the old content heuristic.
  const markDeletedParagraphs: Element[] = [];
  for (const p of findAllByTagName(root, 'w:p')) {
    if (paragraphHasParaMarker(p, 'w:del')) {
      markDeletedParagraphs.push(p);
    }
  }

  // Remove w:del elements entirely (deleted content disappears)
  removeAllByTagName(root, 'w:del');

  // Remove w:moveFrom elements entirely
  removeAllByTagName(root, 'w:moveFrom');

  // Remove move range markers
  removeAllByTagName(root, 'w:moveFromRangeStart');
  removeAllByTagName(root, 'w:moveFromRangeEnd');
  removeAllByTagName(root, 'w:moveToRangeStart');
  removeAllByTagName(root, 'w:moveToRangeEnd');

  // Unwrap w:ins elements (keep content, remove wrapper)
  unwrapAllByTagName(root, 'w:ins');

  // Unwrap w:moveTo elements
  unwrapAllByTagName(root, 'w:moveTo');

  // Remove format change tracking
  removeAllByTagName(root, 'w:rPrChange');
  removeAllByTagName(root, 'w:pPrChange');

  // Strip paragraph-level markers now that changes are accepted.
  removeParaMarkers(root);

  // Resolve the PPR-DEL-marked paragraphs (their paragraph mark was deleted):
  // merge each into its following paragraph (document order, so consecutive
  // mark-deleted paragraphs cascade forward into the first surviving one).
  for (const p of markDeletedParagraphs) {
    resolveParagraphMarkRevision(p);
  }

  // Drop hyperlink wrappers emptied by the accepted deletions above.
  removeEmptyHyperlinks(root);

  return serializeToXml(root);
}

/**
 * Reject all track changes in document XML (AST-based).
 *
 * - Removes w:ins elements entirely (inserted content disappears)
 * - Unwraps w:del elements and converts w:delText to w:t
 * - Handles w:moveFrom (unwrap) and w:moveTo (remove)
 * - Removes format change tracking elements
 *
 * @param documentXml - The document.xml content with track changes
 * @returns Document XML with all changes rejected
 */
export function rejectAllChanges(documentXml: string): string {
  const root = parseDocumentXml(documentXml);

  // Step 1: Merge a paragraph on Reject All iff its paragraph MARK is a tracked
  // insertion (<w:pPr><w:rPr><w:ins .../></w:rPr>) — i.e. the paragraph break itself
  // was inserted, so rejecting the insertion merges the paragraph's surviving content
  // into the following paragraph (resolveParagraphMarkRevision). The contents
  // disappear only via their own run-level w:ins wrappers. This is the
  // Word/LibreOffice-faithful, purely mark-based rule.
  //
  // We deliberately do NOT touch a paragraph based on content (e.g. "all runs are inside
  // w:ins"). A run-level insertion under an UNTRACKED paragraph mark means text was
  // inserted into a pre-existing paragraph; Word and LibreOffice both keep that
  // paragraph (empty) on reject, and a content-based drop over-deletes it. safe-docx's
  // own inserted paragraphs always carry the PPR-INS mark now (wrapParagraphAsInserted),
  // so the mark-based rule covers them without the old content heuristic.
  const markInsertedParagraphs = new Set<Element>();
  for (const p of findAllByTagName(root, 'w:p')) {
    if (paragraphHasParaMarker(p, 'w:ins')) {
      markInsertedParagraphs.add(p);
    }
  }

  // Bookmarks nested inside w:ins content are dropped with Step 2's wrapper
  // removal, so boundaries whose counterpart lives in a kept paragraph must
  // move out first. (Direct-child bookmarks would survive the Step-3 merge.)
  preserveCrossParagraphBookmarksForReject(root, markInsertedParagraphs);

  // Step 2: Remove w:ins elements entirely (inserted content disappears)
  removeAllByTagName(root, 'w:ins');

  // Step 3: Resolve the PPR-INS-marked paragraphs (their paragraph mark was
  // inserted): merge each into its following paragraph (document order, so
  // consecutive mark-inserted paragraphs cascade forward into the first
  // surviving one).
  for (const p of markInsertedParagraphs) {
    resolveParagraphMarkRevision(p);
  }

  // Remove w:moveTo elements entirely
  removeAllByTagName(root, 'w:moveTo');

  // Remove move range markers
  removeAllByTagName(root, 'w:moveFromRangeStart');
  removeAllByTagName(root, 'w:moveFromRangeEnd');
  removeAllByTagName(root, 'w:moveToRangeStart');
  removeAllByTagName(root, 'w:moveToRangeEnd');

  // Unwrap w:del elements (keep content, remove wrapper)
  unwrapAllByTagName(root, 'w:del');

  // Unwrap w:moveFrom elements
  unwrapAllByTagName(root, 'w:moveFrom');

  // Convert w:delText to w:t
  for (const delText of findAllByTagName(root, 'w:delText')) {
    renameElement(delText, 'w:t');
  }

  // Convert w:delInstrText to w:instrText
  for (const delInstrText of findAllByTagName(root, 'w:delInstrText')) {
    renameElement(delInstrText, 'w:instrText');
  }

  // Remove format change tracking
  removeAllByTagName(root, 'w:rPrChange');
  removeAllByTagName(root, 'w:pPrChange');

  // Strip paragraph-level markers now that changes are rejected.
  removeParaMarkers(root);

  // Drop hyperlink wrappers emptied by the rejected insertions above.
  removeEmptyHyperlinks(root);

  return serializeToXml(root);
}

/**
 * Extract plain text content from document XML (AST-based).
 *
 * @param documentXml - The document.xml content
 * @returns Plain text content
 */
export function extractTextContent(documentXml: string): string {
  const root = parseDocumentXml(documentXml);
  const texts: string[] = [];

  // Extract text from w:t elements
  for (const t of findAllByTagName(root, 'w:t')) {
    const text = getLeafText(t) ?? '';
    if (text) {
      texts.push(text);
    }
  }

  // Also extract from w:delText (for rejected changes before conversion)
  for (const delText of findAllByTagName(root, 'w:delText')) {
    const text = getLeafText(delText) ?? '';
    if (text) {
      texts.push(text);
    }
  }

  return texts.join('');
}

/**
 * Extract text in document order, respecting paragraph breaks (AST-based).
 */
export function extractTextWithParagraphs(documentXml: string): string {
  const root = parseDocumentXml(documentXml);
  const paragraphs: string[] = [];

  // Find all paragraphs
  for (const p of findAllByTagName(root, 'w:p')) {
    const texts: string[] = [];

    // Extract text from w:t elements within this paragraph
    for (const t of findAllByTagName(p, 'w:t')) {
      const text = getLeafText(t) ?? '';
      if (text) {
        texts.push(text);
      }
    }

    // Also check w:delText
    for (const delText of findAllByTagName(p, 'w:delText')) {
      const text = getLeafText(delText) ?? '';
      if (text) {
        texts.push(text);
      }
    }

    paragraphs.push(texts.join(''));
  }

  return paragraphs.join('\n');
}

/**
 * Normalize text for comparison (handles whitespace differences).
 *
 * Performs the following normalization:
 * - Convert CRLF and CR to LF
 * - Convert tabs to spaces
 * - Collapse multiple spaces to single space
 * - Strip trailing spaces from each line
 * - Collapse multiple newlines to single newline
 * - Trim leading/trailing whitespace
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ +/g, ' ')
    .replace(/ \n/g, '\n') // Strip trailing spaces from lines
    .replace(/\n /g, '\n') // Strip leading spaces from lines
    .replace(/\n+/g, '\n')
    .trim();
}

/**
 * Compare two texts and return detailed differences.
 */
export function compareTexts(
  expected: string,
  actual: string
): {
  identical: boolean;
  normalizedIdentical: boolean;
  expectedLength: number;
  actualLength: number;
  differences: string[];
} {
  const normalizedExpected = normalizeText(expected);
  const normalizedActual = normalizeText(actual);

  const differences: string[] = [];

  if (expected !== actual) {
    // Find first difference
    let firstDiff = 0;
    while (firstDiff < expected.length && firstDiff < actual.length) {
      if (expected[firstDiff] !== actual[firstDiff]) {
        break;
      }
      firstDiff++;
    }

    if (firstDiff < expected.length || firstDiff < actual.length) {
      const context = 50;
      const start = Math.max(0, firstDiff - context);
      const expectedSnippet = expected.slice(start, firstDiff + context);
      const actualSnippet = actual.slice(start, firstDiff + context);

      differences.push(`First difference at position ${firstDiff}:`);
      differences.push(`  Expected: "...${expectedSnippet}..."`);
      differences.push(`  Actual:   "...${actualSnippet}..."`);
    }
  }

  return {
    identical: expected === actual,
    normalizedIdentical: normalizedExpected === normalizedActual,
    expectedLength: expected.length,
    actualLength: actual.length,
    differences,
  };
}
