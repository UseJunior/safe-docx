import { childElements, findChildByTagName } from '@usejunior/docx-core';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function willSurviveAccept(node: Element): boolean {
  let curr: Element | null = node;
  let paragraph: Element | null = null;
  while (curr) {
    if (curr.tagName === 'w:del' || curr.tagName === 'w:moveFrom') {
      return false; // Inside a deleted inline wrapper
    }
    if (curr.tagName === 'w:p') {
      paragraph = curr;
    }
    curr = curr.parentNode as Element | null;
  }

  if (paragraph) {
    const pPr = findChildByTagName(paragraph, 'w:pPr');
    if (pPr) {
      const rPr = findChildByTagName(pPr, 'w:rPr');
      if (rPr) {
        const dels = Array.from(rPr.getElementsByTagName('w:del'));
        if (dels.length > 0) return false; // Paragraph-level deletion
      }
    }
  }

  return true;
}

function isParagraphInsertedOrDeleted(p: Element): boolean {
  const pPr = findChildByTagName(p, 'w:pPr');
  if (!pPr) return false;
  // Paragraph is inserted if there's a w:ins in pPr (not inside rPr)
  // or deleted if there's a w:del in pPr/rPr.
  // Actually, safe-docx marks them in rPr for deletion and pPr for insertion.
  const rPr = findChildByTagName(pPr, 'w:rPr');
  if (rPr && Array.from(rPr.getElementsByTagName('w:del')).length > 0) return true;
  if (Array.from(pPr.getElementsByTagName('w:ins')).length > 0) return true;
  return false;
}

const BOOKMARK_MARKER_TAGS = ['w:bookmarkStart', 'w:bookmarkEnd'] as const;
const BOOKMARK_MARKER_TAG_SET: ReadonlySet<string> = new Set(BOOKMARK_MARKER_TAGS);
const REVISION_WRAPPER_TAGS = new Set(['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo']);

/**
 * Whether a marker's counterpart (matched on `w:id`) also lives inside `container`.
 *
 * A bookmark range is identified by the `w:id` shared between its
 * `w:bookmarkStart` and `w:bookmarkEnd`; the name lives on the start only. A
 * range with both boundaries inside one container covers only that container's
 * content, so it can be repositioned as a unit. A range with one boundary
 * outside reaches into content the container does not own, and moving the inside
 * boundary changes which text the range covers.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 */
function bookmarkRangeIsEnclosedBy(container: Element, marker: Element): boolean {
  const id = marker.getAttribute('w:id');
  if (!id) return false;
  const counterpartTag =
    marker.tagName === 'w:bookmarkStart' ? 'w:bookmarkEnd' : 'w:bookmarkStart';

  // An unmatched marker has no range to preserve; the orphan repair below
  // synthesizes a counterpart, so treat it as spanning and hoist it out.
  const counterparts = Array.from(container.getElementsByTagName(counterpartTag)) as Element[];
  return counterparts.some((candidate) => candidate.getAttribute('w:id') === id);
}

/**
 * Whether both boundaries are carried by wrappers with the same projection
 * semantics, even when tagged serialization emitted separate sibling wrappers.
 */
function bookmarkRangeHasMatchingRevisionWrappers(
  wrapper: Element,
  marker: Element,
): boolean {
  const id = marker.getAttribute('w:id');
  if (!id) return false;
  const counterpartTag =
    marker.tagName === 'w:bookmarkStart' ? 'w:bookmarkEnd' : 'w:bookmarkStart';
  const document = marker.ownerDocument;
  const counterpart = Array.from(document.getElementsByTagName(counterpartTag))
    .find((candidate) => candidate.getAttribute('w:id') === id);
  if (!counterpart) return false;
  let ancestor = counterpart.parentNode as Element | null;
  while (ancestor && !REVISION_WRAPPER_TAGS.has(ancestor.tagName)) {
    ancestor = ancestor.parentNode as Element | null;
  }
  return ancestor?.tagName === wrapper.tagName;
}

/** Whether the marker has any sibling before/after it inside its parent. */
function hasSibling(marker: Element, direction: 'previous' | 'next'): boolean {
  let node = direction === 'previous' ? marker.previousSibling : marker.nextSibling;
  while (node) {
    // Elements count as content; so do non-whitespace text nodes. Interelement
    // whitespace never carries content in WordprocessingML run containers.
    if (node.nodeType === 1) return true;
    if (node.nodeType === 3 && (node.nodeValue ?? '').trim().length > 0) return true;
    node = direction === 'previous' ? node.previousSibling : node.nextSibling;
  }
  return false;
}

/**
 * Move `marker` out of every revision wrapper between it and `boundary`,
 * splitting each wrapper the marker sits partway through so the marker keeps
 * its exact position in the content stream.
 *
 * At each level the marker is either at an edge of its container — then it
 * steps directly outside that edge, which is exact and creates nothing — or it
 * has content on both sides, and the container is split in two: the trailing
 * content moves into a fresh clone of the container (attributes copied, fresh
 * `w:id`) placed after the marker. Both projections then keep the original
 * span: accepting or rejecting the two halves is equivalent to accepting or
 * rejecting the one wrapper they came from, and the marker stays anchored
 * between the same two runs of content.
 *
 * Clones a marker only ever steps over — never into — are collected in
 * `createdTails` so the caller can drop any that later markers empty out.
 */
function splitWrapperAtMarker(
  marker: Element,
  boundary: Node,
  allocateRevisionId: () => number,
  createdTails: Element[],
): void {
  while (marker.parentNode && marker.parentNode !== boundary) {
    const container = marker.parentNode as Element;
    const containerParent = container.parentNode;
    if (!containerParent) return;

    if (!hasSibling(marker, 'previous')) {
      containerParent.insertBefore(marker, container);
    } else if (!hasSibling(marker, 'next')) {
      containerParent.insertBefore(marker, container.nextSibling);
    } else {
      const tail = container.cloneNode(false) as Element;
      if (container.getAttribute('w:id') !== null) {
        tail.setAttribute('w:id', String(allocateRevisionId()));
      }
      while (marker.nextSibling) {
        tail.appendChild(marker.nextSibling);
      }
      containerParent.insertBefore(marker, container.nextSibling);
      containerParent.insertBefore(tail, marker.nextSibling);
      createdTails.push(tail);
    }
  }
}

/**
 * Lift the bookmark markers nested inside an inline revision wrapper out to the
 * wrapper's own level, splitting the wrapper wherever a marker sits partway
 * through its content.
 *
 * A marker inside `<w:del>` vanishes on Accept All even though the surrounding
 * paragraph survives, so it cannot stay there. Every marker is walked out via
 * {@link splitWrapperAtMarker}, which preserves the marker's exact position in
 * the content stream:
 *
 * - A range the wrapper encloses entirely comes out placed around the wrapper —
 *   start before, end after — so it still spans the content it named. Dropping
 *   both boundaries in front of the wrapper (what this pass used to do)
 *   collapses it to zero length, which is how the rebuild path lost the range
 *   in issue #641.
 * - A boundary partway inside the wrapper used to be dropped in front of it,
 *   silently shrinking the range (or growing it, for a start boundary).
 *   Splitting the wrapper at the boundary — attributes copied onto the second
 *   half, fresh `w:id` — keeps the original span in both projections
 *   (issue #643).
 *
 * Markers are processed in document order so each split sees the pieces earlier
 * splits produced; a tail clone that later markers empty out entirely is
 * dropped rather than emitted as a contentless revision wrapper.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/641
 * @see https://github.com/UseJunior/safe-docx/issues/643
 */
function liftMarkersAroundWrapper(
  wrapper: Element,
  allocateRevisionId: () => number,
  preserveEnclosedRanges: boolean,
): void {
  const parent = wrapper.parentNode;
  if (!parent) return;

  // Collect markers in document order before mutating anything.
  const markers: Element[] = [];
  const collect = (node: Element): void => {
    for (const child of childElements(node)) {
      if (BOOKMARK_MARKER_TAG_SET.has(child.tagName)) {
        markers.push(child);
      } else {
        collect(child);
      }
    }
  };
  collect(wrapper);

  const createdTails: Element[] = [];
  for (const marker of markers) {
    // Tagged construction owns both source bookmark inventories. When both
    // boundaries belong to one side-only wrapper, keeping them inside is what
    // makes the range disappear and return with that side's content. Legacy
    // repair mode retains its historical hoisting policy.
    if (
      preserveEnclosedRanges &&
      (bookmarkRangeIsEnclosedBy(wrapper, marker) ||
        bookmarkRangeHasMatchingRevisionWrappers(wrapper, marker))
    ) continue;
    splitWrapperAtMarker(marker, parent, allocateRevisionId, createdTails);
  }

  // A tail created for one marker can be emptied by the next marker stepping
  // out of it (adjacent boundaries); an empty revision wrapper says nothing
  // and only confuses consumers, so drop it.
  for (const tail of createdTails) {
    if (!tail.firstChild && tail.parentNode) {
      tail.parentNode.removeChild(tail);
    }
  }
}

/**
 * Move bookmark markers to positions that keep their ranges meaningful in both
 * the Accept All and Reject All projections.
 *
 * Two moves happen, in this order:
 *
 * 1. Out of inline revision wrappers, as described on
 *    {@link liftMarkersAroundWrapper}.
 *
 * 2. Out of a wholly inserted or deleted paragraph, but only for ranges whose
 *    other end lies outside that paragraph. Those need an anchor in content the
 *    projection keeps. A range enclosed by the paragraph stays put: hoisting it
 *    to body level collapses it to a zero-length span that no longer names the
 *    text it was created for, and such a range is meant to travel with the
 *    content it covers (issue #641).
 */
function hoistBookmarkMarkers(
  node: Element,
  allocateRevisionId: () => number,
  preserveEnclosedRanges: boolean,
): void {
  if (REVISION_WRAPPER_TAGS.has(node.tagName)) {
    liftMarkersAroundWrapper(node, allocateRevisionId, preserveEnclosedRanges);
    return;
  }

  for (const child of childElements(node)) {
    hoistBookmarkMarkers(child, allocateRevisionId, preserveEnclosedRanges);
  }

  if (node.tagName !== 'w:p' || !isParagraphInsertedOrDeleted(node) || !node.parentNode) {
    return;
  }

  // Wrapper lifting above has already moved nested markers to paragraph level,
  // so every marker of this paragraph is now visible to the enclosure test.
  for (const markerTag of BOOKMARK_MARKER_TAGS) {
    for (const marker of Array.from(node.getElementsByTagName(markerTag)) as Element[]) {
      if (bookmarkRangeIsEnclosedBy(node, marker)) continue;
      node.parentNode.insertBefore(marker, node);
    }
  }
}

export function enforceConsumerCompatibility(
  root: Element,
  allocateRevisionId: () => number,
  options: { repairBookmarkInventory?: boolean } = {},
): void {
  // 1. Reposition bookmark markers so their ranges survive both projections.
  hoistBookmarkMarkers(
    root,
    allocateRevisionId,
    options.repairBookmarkInventory === false,
  );

  // 2. Remove empty w:t tags
  const textNodes = Array.from(root.getElementsByTagName('w:t'));
  for (const t of textNodes) {
    if (!t.textContent || t.textContent.length === 0) {
      if (t.parentNode) {
        t.parentNode.removeChild(t);
      }
    }
  }

  // Tagged construction carries the exact bookmark inventory of both inputs.
  // It needs range hoisting/splitting, but must not deduplicate or synthesize
  // source-authored markers. Legacy callers retain repair behavior.
  if (options.repairBookmarkInventory === false) return;

  // 3. Balance markers and remove duplicates
  const starts = Array.from(root.getElementsByTagName('w:bookmarkStart'));
  const ends = Array.from(root.getElementsByTagName('w:bookmarkEnd'));

  // A. Deduplicate by Name (Word crashes/behaves badly if names duplicate)
  // Group starts by name
  const startsByName = new Map<string, Element[]>();
  for (const start of starts) {
    const name = start.getAttribute('w:name');
    if (!name) {
      start.parentNode?.removeChild(start);
      continue;
    }
    const group = startsByName.get(name) || [];
    group.push(start);
    startsByName.set(name, group);
  }

  const validStarts = [];
  for (const group of startsByName.values()) {
    // Prefer the first one that survives "Accept All"
    let bestStart = group[0];
    for (let i = 0; i < group.length; i++) {
      if (willSurviveAccept(group[i]!)) {
        bestStart = group[i];
        break;
      }
    }

    // Keep the best one, remove the rest
    for (const start of group) {
      if (start === bestStart) {
        validStarts.push(start);
      } else {
        start.parentNode?.removeChild(start);
      }
    }
  }

  // B. Deduplicate Ends by ID (only keep the first end for a given ID)
  // Also drop ends that don't have an ID.
  const seenEndIds = new Set<string>();
  const validEnds = [];
  for (const end of ends) {
    const id = end.getAttribute('w:id');
    if (!id || seenEndIds.has(id)) {
      end.parentNode?.removeChild(end);
      continue;
    }
    seenEndIds.add(id);
    validEnds.push(end);
  }

  // C. Map valid ends by ID for fast lookup
  const endMap = new Map<string, Element>();
  for (const end of validEnds) {
    const id = end.getAttribute('w:id');
    if (id) endMap.set(id, end);
  }

  // D. Process valid starts: fix IDs to be globally unique, and ensure there's a matching end
  const seenIds = new Set<string>();
  for (const start of validStarts) {
    const oldId = start.getAttribute('w:id');
    if (!oldId) continue;

    // We must ensure the ID is unique across the document
    let newId = oldId;
    if (seenIds.has(newId)) {
      newId = String(allocateRevisionId());
      start.setAttribute('w:id', newId);
    }
    seenIds.add(newId);

    // Now find the matching end and update its ID if necessary
    const end = endMap.get(oldId);
    if (end) {
      if (newId !== oldId) {
        end.setAttribute('w:id', newId);
      }
      // Remove it from the map so we know it's matched
      endMap.delete(oldId);
    } else {
      // Missing an end tag. Insert a fake one immediately after.
      const doc = root.ownerDocument;
      if (doc) {
        console.warn(`[Consumer Compatibility] Warning: Orphaned bookmarkStart name=${start.getAttribute('w:name')}. Inserting synthetic end.`);
        const newEnd = doc.createElementNS(W_NS, 'w:bookmarkEnd');
        newEnd.setAttribute('w:id', newId);
        if (start.nextSibling) {
          start.parentNode?.insertBefore(newEnd, start.nextSibling);
        } else {
          start.parentNode?.appendChild(newEnd);
        }
      }
    }
  }

  // E. Any ends left in endMap had no matching start. 
  for (const [oldId, end] of endMap.entries()) {
    const doc = root.ownerDocument;
    if (doc) {
      let newId = oldId;
      if (seenIds.has(newId)) {
        newId = String(allocateRevisionId());
        end.setAttribute('w:id', newId);
      }
      seenIds.add(newId);

      console.warn(`[Consumer Compatibility] Warning: Orphaned bookmarkEnd id=${oldId}. Inserting synthetic start.`);
      const newStart = doc.createElementNS(W_NS, 'w:bookmarkStart');
      newStart.setAttribute('w:id', newId);
      newStart.setAttribute('w:name', `_Recovered_${newId}`);
      end.parentNode?.insertBefore(newStart, end);
    }
  }
}
