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
 * Linearize a projected story as visible text plus one separator per paragraph
 * and record where each paired bookmark starts and ends in it. Two bookmark
 * placements that differ only by zero-width position (a body-level start
 * immediately before a paragraph versus inside it before its first run) get the
 * same signature, which is what a reader of the projection observes.
 */
function rangeSignatures(documentXml: string): Map<string, RangeSignature> {
  const document = parseXml(documentXml);
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();
  let offset = 0;
  const visit = (node: Node): void => {
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.namespaceURI === W_NS) {
      if (element.localName === 'bookmarkStart') {
        const id = wAttr(element, 'id');
        if (id) starts.set(id, offset);
        return;
      }
      if (element.localName === 'bookmarkEnd') {
        const id = wAttr(element, 'id');
        if (id) ends.set(id, offset);
        return;
      }
      if (element.localName === 't') {
        offset += (element.textContent ?? '').length;
        return;
      }
      if (element.localName === 'tab' || element.localName === 'br') {
        offset += 1;
        return;
      }
    }
    for (const child of Array.from(element.childNodes)) visit(child);
    if (element.namespaceURI === W_NS && element.localName === 'p') offset += 1;
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
  let document = parseXml(documentXml);
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

  let xml = documentXml;
  for (const [firstId, secondId] of candidates) {
    const accepted = rangeSignatures(acceptAllChanges(xml));
    const rejected = rangeSignatures(rejectAllChanges(xml));
    // The original-side alternative survives Reject only; the revised side survives Accept.
    const originalId = rejected.has(firstId) && !rejected.has(secondId) ? firstId
      : rejected.has(secondId) && !rejected.has(firstId) ? secondId : undefined;
    if (!originalId) continue;
    const revisedId = originalId === firstId ? secondId : firstId;
    if (!accepted.has(revisedId)) continue;

    const candidate = parseXml(xml);
    const root = candidate.documentElement;
    const originalMarkers = markersWithId(root, originalId);
    const revisedMarkers = markersWithId(root, revisedId);
    if (originalMarkers.length !== 2 || revisedMarkers.length !== 2) continue;
    revisedMarkers.forEach(removeMarker);
    originalMarkers.forEach(unwrapMarker);
    const candidateXml = new XMLSerializer().serializeToString(candidate);
    const candidateAccepted = rangeSignatures(acceptAllChanges(candidateXml));
    const candidateRejected = rangeSignatures(rejectAllChanges(candidateXml));
    if (
      sameSignature(candidateRejected.get(originalId), rejected.get(originalId)) &&
      sameSignature(candidateAccepted.get(originalId), accepted.get(revisedId))
    ) {
      xml = candidateXml;
      document = candidate;
    }
  }
  return xml === documentXml ? documentXml : new XMLSerializer().serializeToString(document);
}
