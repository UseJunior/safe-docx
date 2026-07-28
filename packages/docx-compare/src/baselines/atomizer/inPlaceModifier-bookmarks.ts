/**
 * In-Place AST Modifier
 *
 * Modifies the revised document's AST in-place to add track changes markup.
 * This replaces the reconstruction-based approach with direct tree manipulation.
 */

import { childElements, findChildByTagName, insertAfterElement } from '@usejunior/docx-core';
import {
  findAncestor,
  findTreeRoot,
  hasAncestorTag,
  paragraphHasParaInsMarker,
  type RevisionIdState,
} from './inPlaceModifier-shared.js';

export interface ParagraphBoundaryBookmarkMarkers {
  leading: Element[];
  trailing: Element[];
  sourceLeading: Element[];
  sourceTrailing: Element[];
}

export function cloneParagraphBoundaryBookmarkMarkers(
  sourceParagraph: Element | undefined
): ParagraphBoundaryBookmarkMarkers {
  const kids = sourceParagraph ? childElements(sourceParagraph) : [];
  if (!sourceParagraph || kids.length === 0) {
    return { leading: [], trailing: [], sourceLeading: [], sourceTrailing: [] };
  }

  const children = kids;
  let firstRunIdx = -1;
  let lastRunIdx = -1;
  for (let i = 0; i < children.length; i++) {
    if (children[i]?.tagName === 'w:r') {
      if (firstRunIdx < 0) firstRunIdx = i;
      lastRunIdx = i;
    }
  }

  const leading: Element[] = [];
  const trailing: Element[] = [];
  const sourceLeading: Element[] = [];
  const sourceTrailing: Element[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (child.tagName === 'w:bookmarkStart') {
      if (firstRunIdx < 0 || i < firstRunIdx) {
        const cloned = child.cloneNode(true) as Element;
        leading.push(cloned);
        sourceLeading.push(child);
      }
      continue;
    }
    if (child.tagName === 'w:bookmarkEnd') {
      if (lastRunIdx < 0 || i > lastRunIdx) {
        const cloned = child.cloneNode(true) as Element;
        trailing.push(cloned);
        sourceTrailing.push(child);
      }
    }
  }

  return { leading, trailing, sourceLeading, sourceTrailing };
}

export function insertLeadingMarkers(
  paragraph: Element,
  markers: Element[]
): Element | null {
  if (markers.length === 0) return null;

  const pPr = findChildByTagName(paragraph, 'w:pPr');
  if (pPr) {
    let anchor: Element = pPr;
    for (const marker of markers) {
      insertAfterElement(anchor, marker);
      anchor = marker;
    }
    return anchor;
  }

  for (let i = markers.length - 1; i >= 0; i--) {
    paragraph.insertBefore(markers[i]!, paragraph.firstChild);
  }
  return markers[markers.length - 1] ?? null;
}

export type BookmarkMarkerTag = 'w:bookmarkStart' | 'w:bookmarkEnd';

export function isBookmarkMarkerTag(tagName: string): tagName is BookmarkMarkerTag {
  return tagName === 'w:bookmarkStart' || tagName === 'w:bookmarkEnd';
}

/**
 * Bookmark markers adjacent to a source run, keyed by which side of the run
 * they sit on. The side decides where a reconstructed fragment must re-emit
 * them: a marker that preceded the run goes in front of the fragment's
 * revision wrapper, a marker that followed it goes after — collapsing both
 * onto one side shrinks or grows the bookmark's range (issue #643).
 */
export interface AdjacentSourceBookmarkMarkers {
  before: Element[];
  after: Element[];
}

/**
 * Collect direct paragraph bookmark markers adjacent to a source run.
 *
 * Markers between runs (or at paragraph boundaries) are represented as siblings
 * of w:r under w:p. We clone nearby markers so reconstructed deleted/moveFrom
 * fragments preserve bookmark names/IDs needed for Reject All parity.
 */
export function collectAdjacentSourceBookmarkMarkers(
  sourceRun: Element
): AdjacentSourceBookmarkMarkers {
  const paragraph = sourceRun.parentNode as Element | null;
  if (!paragraph || paragraph.tagName !== 'w:p') {
    return { before: [], after: [] };
  }

  const children = childElements(paragraph);
  const runIndex = children.indexOf(sourceRun);
  if (runIndex < 0) {
    return { before: [], after: [] };
  }

  const before: Element[] = [];
  for (let i = runIndex - 1; i >= 0; i--) {
    const child = children[i];
    if (!child) break;
    if (child.tagName === 'w:r') break;
    if (isBookmarkMarkerTag(child.tagName)) {
      before.unshift(child);
    }
  }

  const after: Element[] = [];
  for (let i = runIndex + 1; i < children.length; i++) {
    const child = children[i];
    if (!child) break;
    if (child.tagName === 'w:r') break;
    if (isBookmarkMarkerTag(child.tagName)) {
      after.push(child);
    }
  }

  return { before, after };
}


export interface BookmarkSurvivalContext {
  isParagraphRemovedOnReject?: (paragraph: Element) => boolean;
}

export function markerSurvivesReject(marker: Element, context?: BookmarkSurvivalContext): boolean {
  // Markers nested in inserted/move-to content are removed by Reject All.
  if (hasAncestorTag(marker, new Set(['w:ins', 'w:moveTo']))) {
    return false;
  }

  // Paragraph-level insertion markers remove whole paragraphs on Reject All.
  const paragraph = findAncestor(marker, 'w:p');
  if (paragraph && context?.isParagraphRemovedOnReject?.(paragraph)) {
    return false;
  }
  if (paragraphHasParaInsMarker(paragraph)) {
    return false;
  }

  return true;
}

export function targetTreeHasEquivalentBookmarkMarker(
  targetParagraph: Element,
  marker: Element,
  context?: BookmarkSurvivalContext
): boolean {
  const treeRoot = findTreeRoot(targetParagraph);

  if (marker.tagName === 'w:bookmarkStart') {
    const markerId = marker.getAttribute('w:id');
    const markerName = marker.getAttribute('w:name');
    for (const existing of Array.from(treeRoot.getElementsByTagName('w:bookmarkStart')) as Element[]) {
      if (!markerSurvivesReject(existing, context)) {
        continue;
      }
      const existingName = existing.getAttribute('w:name');
      const existingId = existing.getAttribute('w:id');
      if (markerName && existingName === markerName) return true;
      if (!markerName && markerId && existingId === markerId) return true;
    }
    return false;
  }

  if (marker.tagName === 'w:bookmarkEnd') {
    const markerId = marker.getAttribute('w:id');
    if (!markerId) return false;
    for (const existing of Array.from(treeRoot.getElementsByTagName('w:bookmarkEnd')) as Element[]) {
      if (!markerSurvivesReject(existing, context)) {
        continue;
      }
      if (existing.getAttribute('w:id') === markerId) return true;
    }
  }

  return false;
}

export function cloneUnemittedSourceBookmarkMarkers(
  sourceRun: Element,
  targetParagraph: Element,
  state: RevisionIdState,
  context?: BookmarkSurvivalContext
): AdjacentSourceBookmarkMarkers {
  const markers = collectAdjacentSourceBookmarkMarkers(sourceRun);

  const cloneUnemitted = (side: Element[]): Element[] => {
    const clones: Element[] = [];
    for (const marker of side) {
      if (state.emittedSourceBookmarkMarkers.has(marker)) {
        continue;
      }

      if (targetTreeHasEquivalentBookmarkMarker(targetParagraph, marker, context)) {
        state.emittedSourceBookmarkMarkers.add(marker);
        continue;
      }

      state.emittedSourceBookmarkMarkers.add(marker);
      const cloned = marker.cloneNode(true) as Element;
      clones.push(cloned);
    }
    return clones;
  };

  return { before: cloneUnemitted(markers.before), after: cloneUnemitted(markers.after) };
}

export function insertMarkersBeforeWrapper(wrapper: Element, markers: Element[]): void {
  const parent = wrapper.parentNode;
  if (!parent) return;
  for (const marker of markers) {
    if (!marker) continue;
    parent.insertBefore(marker, wrapper);
  }
}

/**
 * Insert `markers` directly after `anchor`, preserving their order.
 *
 * Used for source markers that FOLLOWED the source run: they must re-emit
 * after the fragment's revision wrapper so the bookmark range still closes
 * after the content it covered, not collapse to the wrapper's leading edge.
 */
export function insertMarkersAfterElement(anchor: Element, markers: Element[]): void {
  const parent = anchor.parentNode;
  if (!parent) return;
  let cursor: Element = anchor;
  for (const marker of markers) {
    if (!marker) continue;
    // A marker being MOVED forward may already sit exactly where it belongs;
    // re-inserting a node before itself corrupts the xmldom child list.
    if (cursor.nextSibling !== marker) insertAfterElement(cursor, marker);
    cursor = marker;
  }
}

/**
 * Place the clones of the markers that FOLLOWED `sourceRun` directly after
 * `anchor`, the fragment just emitted for that run.
 *
 * Word-level atomization fragments one source run into several wrappers, each
 * inserted after the previous one — which would leave markers anchored after
 * the FIRST fragment stranded mid-run. Every fragment therefore re-anchors its
 * run's trailing clones after itself (DOM insertion moves an already-inserted
 * node), so the clones come to rest after the run's final fragment, exactly
 * where the source markers sat. Dropping them in front of the wrapper instead
 * — the pre-fix behavior — collapsed the bookmark range to the wrapper's
 * leading edge (issue #643, observed on NVCA heading bookmarks).
 *
 * @see https://github.com/UseJunior/safe-docx/issues/643
 */
export function emitTrailingSourceBookmarkClones(
  sourceRun: Element,
  anchor: Element,
  newClones: Element[],
  state: RevisionIdState,
): void {
  const pending = state.trailingSourceBookmarkClones.get(sourceRun) ?? [];
  const clones = [...pending, ...newClones];
  if (clones.length === 0) return;
  insertMarkersAfterElement(anchor, clones);
  state.trailingSourceBookmarkClones.set(sourceRun, clones);
}

/**
 * The insertion anchor to hand the NEXT atom after emitting a fragment for
 * `sourceRun`: past the run's trailing marker clones when they directly
 * follow the fragment, otherwise the fragment itself.
 *
 * Without this, every later atom would insert via
 * `insertAfterElement(previousFragment, …)` — between the fragment and its
 * trailing markers — pushing the markers rightward past content that was
 * never inside their bookmark range (issue #643).
 */
export function anchorPastTrailingBookmarkClones(
  anchor: Element,
  sourceRun: Element | undefined,
  state: RevisionIdState,
): Element {
  if (!sourceRun) return anchor;
  const clones = state.trailingSourceBookmarkClones.get(sourceRun);
  if (!clones || clones.length === 0) return anchor;
  const last = clones[clones.length - 1]!;
  return last.parentNode !== null && last.parentNode === anchor.parentNode ? last : anchor;
}

export function filterEquivalentBookmarkMarkers(
  markers: Element[],
  targetNode: Element,
  context?: BookmarkSurvivalContext
): Element[] {
  return markers.filter((marker) => !targetTreeHasEquivalentBookmarkMarker(targetNode, marker, context));
}

/**
 * Track change wrapper tag names.
 */
