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
const REVISION_WRAPPER_TAGS = new Set(['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo']);

/**
 * Whether a marker's counterpart (matched on `w:id`) also lives inside `paragraph`.
 *
 * A bookmark range is identified by the `w:id` shared between its
 * `w:bookmarkStart` and `w:bookmarkEnd`; the name lives on the start only.
 * A range with both ends inside one paragraph covers only that paragraph's
 * content, so it must travel with the paragraph. A range with one end outside
 * spans surviving content and has to keep an anchor there.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 */
function bookmarkRangeIsEnclosedBy(paragraph: Element, marker: Element): boolean {
  const id = marker.getAttribute('w:id');
  if (!id) return false;
  const counterpartTag =
    marker.tagName === 'w:bookmarkStart' ? 'w:bookmarkEnd' : 'w:bookmarkStart';

  // An unmatched marker has no range to preserve; the orphan repair below
  // synthesizes a counterpart, so treat it as spanning and hoist it out.
  const counterparts = Array.from(paragraph.getElementsByTagName(counterpartTag)) as Element[];
  return counterparts.some((candidate) => candidate.getAttribute('w:id') === id);
}

/**
 * Lift the bookmark markers nested inside an inline revision wrapper out to the
 * wrapper's own level, keeping starts before it and ends after it.
 *
 * A marker inside `<w:del>` vanishes on Accept All even though the surrounding
 * paragraph survives, so it cannot stay there. Splitting the two sides around
 * the wrapper — rather than dropping both in front of it — keeps the range
 * spanning the content it named instead of collapsing it to zero length. Word
 * emits boundary markers as siblings of the wrapper in the same arrangement.
 */
function liftMarkersAroundWrapper(wrapper: Element): void {
  const parent = wrapper.parentNode;
  if (!parent) return;

  const starts = Array.from(wrapper.getElementsByTagName('w:bookmarkStart')) as Element[];
  const ends = Array.from(wrapper.getElementsByTagName('w:bookmarkEnd')) as Element[];

  for (const start of starts) {
    parent.insertBefore(start, wrapper);
  }
  let anchor: Node = wrapper;
  for (const end of ends) {
    parent.insertBefore(end, anchor.nextSibling);
    anchor = end;
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
function hoistBookmarkMarkers(node: Element): void {
  if (REVISION_WRAPPER_TAGS.has(node.tagName)) {
    liftMarkersAroundWrapper(node);
    return;
  }

  for (const child of childElements(node)) {
    hoistBookmarkMarkers(child);
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

export function enforceConsumerCompatibility(root: Element, allocateRevisionId: () => number): void {
  // 1. Reposition bookmark markers so their ranges survive both projections.
  hoistBookmarkMarkers(root);

  // 2. Remove empty w:t tags
  const textNodes = Array.from(root.getElementsByTagName('w:t'));
  for (const t of textNodes) {
    if (!t.textContent || t.textContent.length === 0) {
      if (t.parentNode) {
        t.parentNode.removeChild(t);
      }
    }
  }

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
