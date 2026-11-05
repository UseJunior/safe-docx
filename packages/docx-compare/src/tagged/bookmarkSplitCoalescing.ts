import { XMLSerializer } from '@xmldom/xmldom';
import { parseXml } from '@usejunior/docx-core';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MARKER_TAGS = ['bookmarkStart', 'bookmarkEnd'] as const;

/** Character offsets of a bookmark range in a projection's linear text. */
type RangeSignature = readonly [start: number, end: number];

function wAttr(element: Element, name: string): string | null {
  return element.getAttributeNS(W_NS, name) || element.getAttribute(`w:${name}`);
}

/**
 * Record where each paired bookmark starts and ends in a projected story, as a
 * position in a post-order walk: every element other than a bookmark marker
 * counts one when it closes (property subtrees such as `w:pPr`/`w:rPr` are
 * skipped), and `w:t` additionally counts its characters. Placements that
 * differ only by zero-width position (a body-level start immediately before a
 * paragraph versus inside it before its first run) get the same signature,
 * while any content element between two placements, even an empty
 * `w:fldSimple`, a `w:cr` or a drawing, separates them.
 */
function rangeSignatures(documentXml: string): Map<string, RangeSignature> {
  const document = parseXml(documentXml);
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();
  let offset = 0;
  const visit = (element: Element): void => {
    if (element.namespaceURI === W_NS) {
      if (element.localName === 'bookmarkStart' || element.localName === 'bookmarkEnd') {
        const id = wAttr(element, 'id');
        if (id) (element.localName === 'bookmarkStart' ? starts : ends).set(id, offset);
        return;
      }
      if (/Pr$/.test(element.localName)) return;
      if (element.localName === 't') offset += (element.textContent ?? '').length;
    }
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 1) visit(child as Element);
    }
    offset += 1;
  };
  visit(document.documentElement);
  const signatures = new Map<string, RangeSignature>();
  for (const [id, start] of starts) {
    const end = ends.get(id);
    if (end !== undefined) signatures.set(id, [start, end]);
  }
  return signatures;
}

function sameSignature(left: RangeSignature | undefined, right: RangeSignature | undefined): boolean {
  return left !== undefined && right !== undefined && left[0] === right[0] && left[1] === right[1];
}

function markersWithId(root: Element, id: string): Element[] {
  return MARKER_TAGS.flatMap((tag) => Array.from(root.getElementsByTagNameNS(W_NS, tag)))
    .filter((marker) => wAttr(marker, 'id') === id);
}

function isRevisionWrapper(node: Node | null, localName: 'ins' | 'del'): node is Element {
  return node?.nodeType === 1 &&
    (node as Element).namespaceURI === W_NS &&
    (node as Element).localName === localName;
}

function hasElementChild(element: Element): boolean {
  return Array.from(element.childNodes).some((child) => child.nodeType === 1);
}

/** Remove `marker`, and its `w:ins` wrapper when that leaves the wrapper empty. */
function removeMarker(marker: Element): void {
  const parent = marker.parentNode;
  parent?.removeChild(marker);
  if (isRevisionWrapper(parent, 'ins') && !hasElementChild(parent)) {
    parent.parentNode?.removeChild(parent);
  }
}

/** Lift `marker` out of a `w:del` wrapper it alone occupies. */
function unwrapMarker(marker: Element): void {
  const parent = marker.parentNode;
  if (!isRevisionWrapper(parent, 'del')) return;
  if (Array.from(parent.childNodes).some((child) => child.nodeType === 1 && child !== marker)) return;
  parent.parentNode?.replaceChild(marker, parent);
}

/**
 * Collapse a bookmark that publication split into an original-side and a
 * revised-side alternative back into the single source range, when one range
 * already lands at the same place in both projections.
 *
 * Publication splits a bookmark whose endpoint sits in side-only content (for
 * example, a start inside a deleted paragraph while the revised start opens
 * the next paragraph). Both alternatives then carry the source name, and the
 * collision is resolved by renaming the original side, so Reject All no
 * longer yields the original bookmark name (#1280). When the original-side
 * range, placed as-is, already reproduces the revised range in Accept All
 * (because everything between the two positions is content Accept removes),
 * the split is redundant: one range satisfies both projections. Each candidate
 * is verified against both projections before it is adopted, and kept split
 * otherwise.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @see https://github.com/UseJunior/safe-docx/issues/1280
 */
export function coalesceProjectionEquivalentBookmarkSplits(documentXml: string): string {
  const document = parseXml(documentXml);
  const startsByName = new Map<string, Element[]>();
  for (const start of Array.from(document.getElementsByTagNameNS(W_NS, 'bookmarkStart'))) {
    const name = wAttr(start, 'name');
    if (!name) continue;
    startsByName.set(name, [...(startsByName.get(name) ?? []), start]);
  }
  const candidates = [...startsByName.values()]
    .filter((starts) => starts.length === 2)
    .map((starts) => starts.map((start) => wAttr(start, 'id')))
    .filter((ids): ids is [string, string] => ids.every((id) => id !== null) && ids[0] !== ids[1]);
  if (candidates.length === 0) return documentXml;

  interface Pair { originalId: string; revisedId: string }
  const classify = (
    accepted: Map<string, RangeSignature>,
    rejected: Map<string, RangeSignature>,
    [firstId, secondId]: [string, string],
  ): Pair | undefined => {
    // The original-side alternative survives Reject only; the revised side survives Accept.
    const originalId = rejected.has(firstId) && !rejected.has(secondId) ? firstId
      : rejected.has(secondId) && !rejected.has(firstId) ? secondId : undefined;
    if (!originalId) return undefined;
    const revisedId = originalId === firstId ? secondId : firstId;
    return accepted.has(revisedId) ? { originalId, revisedId } : undefined;
  };
  /** Merge `pairs` into a copy of `xml`; the merged XML when every pair verifies. */
  const tryMerge = (xml: string, pairs: readonly Pair[]): { xml: string } | undefined => {
    const accepted = rangeSignatures(acceptAllChanges(xml));
    const rejected = rangeSignatures(rejectAllChanges(xml));
    const candidate = parseXml(xml);
    const root = candidate.documentElement;
    for (const { originalId, revisedId } of pairs) {
      const originalMarkers = markersWithId(root, originalId);
      const revisedMarkers = markersWithId(root, revisedId);
      if (originalMarkers.length !== 2 || revisedMarkers.length !== 2) return undefined;
      revisedMarkers.forEach(removeMarker);
      originalMarkers.forEach(unwrapMarker);
    }
    const candidateXml = new XMLSerializer().serializeToString(candidate);
    const candidateAccepted = rangeSignatures(acceptAllChanges(candidateXml));
    const candidateRejected = rangeSignatures(rejectAllChanges(candidateXml));
    const verified = pairs.every(({ originalId, revisedId }) =>
      sameSignature(candidateRejected.get(originalId), rejected.get(originalId)) &&
      sameSignature(candidateAccepted.get(originalId), accepted.get(revisedId)));
    return verified ? { xml: candidateXml } : undefined;
  };

  const initialAccepted = rangeSignatures(acceptAllChanges(documentXml));
  const initialRejected = rangeSignatures(rejectAllChanges(documentXml));
  const pairs = candidates
    .map((ids) => classify(initialAccepted, initialRejected, ids))
    .filter((pair): pair is Pair => pair !== undefined);
  if (pairs.length === 0) return documentXml;
  // One verification pass for the common case where every candidate collapses;
  // fall back to verifying each pair alone only when the batch fails.
  const batch = tryMerge(documentXml, pairs);
  if (batch) return batch.xml;
  let xml = documentXml;
  for (const pair of pairs) {
    const merged = tryMerge(xml, [pair]);
    if (merged) xml = merged.xml;
  }
  return xml;
}
