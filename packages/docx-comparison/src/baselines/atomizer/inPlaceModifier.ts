/**
 * In-Place AST Modifier
 *
 * Modifies the revised document's AST in-place to add track changes markup.
 * This replaces the reconstruction-based approach with direct tree manipulation.
 *
 * Key operations:
 * - wrapAsInserted: Wrap run elements with <w:ins> for inserted content
 * - insertDeletedContent: Clone and insert deleted content with <w:del> wrapper
 * - wrapAsMoveFrom/wrapAsMoveTo: Add move tracking with range markers
 * - addFormatChange: Add <w:rPrChange> for formatting differences
 */

import type { ComparisonUnitAtom, WmlElement } from '../../core-types.js';
import { CorrelationStatus } from '../../core-types.js';
import { EMPTY_PARAGRAPH_TAG } from '../../atomizer.js';
import {
  wrapElement,
  insertAfterElement,
  insertBeforeElement,
  prependChild,
  createElement,
  cloneElement,
  backfillParentReferences,
  findAllByTagName,
  renameElement,
  appendChild,
} from './wmlElementUtils.js';
import { serializeToXml } from './xmlToWmlElement.js';
import { warn } from './debug.js';

function findAncestorByTag(atom: ComparisonUnitAtom, tagName: string): WmlElement | undefined {
  for (let i = atom.ancestorElements.length - 1; i >= 0; i--) {
    const el = atom.ancestorElements[i]!;
    if (el.tagName === tagName) return el;
  }
  return undefined;
}

function attachSourceElementPointers(atoms: ComparisonUnitAtom[]): void {
  for (const atom of atoms) {
    atom.sourceRunElement = findAncestorByTag(atom, 'w:r');
    atom.sourceParagraphElement = findAncestorByTag(atom, 'w:p');
  }
}

/**
 * Determine whether an atom is "whitespace-only" for paragraph-level classification.
 *
 * We treat pure whitespace runs/tabs/breaks as ignorable noise, because LCS alignment
 * can mark them Equal even when a whole paragraph was inserted/deleted. If we don't
 * ignore them, Word can end up with a stub paragraph after Accept/Reject All.
 */
function isWhitespaceAtom(atom: ComparisonUnitAtom): boolean {
  const el = atom.contentElement;
  if (el.tagName === EMPTY_PARAGRAPH_TAG) return true;
  if (el.tagName === 'w:t') return ((el.textContent ?? '').trim() === '');
  return el.tagName === 'w:tab' || el.tagName === 'w:br' || el.tagName === 'w:cr';
}

/**
 * Returns true if every non-empty atom in this paragraph is of the specified status,
 * ignoring whitespace-only atoms.
 *
 * Mirrors the rebuild reconstructor's whole-paragraph classification so that inplace
 * output behaves the same under Word's Accept/Reject All.
 */
function isEntireParagraphAtomsWithStatus(
  atoms: ComparisonUnitAtom[],
  status: CorrelationStatus
): boolean {
  let sawAnyContent = false;
  let sawTargetStatus = false;

  for (const atom of atoms) {
    const el = atom.contentElement;
    if (el.tagName === EMPTY_PARAGRAPH_TAG) continue;

    sawAnyContent = true;

    if (atom.correlationStatus === status) {
      sawTargetStatus = true;
      continue;
    }

    if (isWhitespaceAtom(atom)) continue;
    return false;
  }

  return sawAnyContent && sawTargetStatus;
}

/**
 * Options for in-place modification.
 */
export interface InPlaceModifierOptions {
  /** Author name for track changes */
  author: string;
  /** Timestamp for track changes */
  date: Date;
}

/**
 * State for tracking revision IDs during modification.
 */
interface RevisionIdState {
  nextId: number;
  moveRangeIds: Map<string, { sourceRangeId: number; destRangeId: number }>;
  /** Track which run elements have already been wrapped */
  wrappedRuns: Set<WmlElement>;
  /**
   * Source bookmark markers cloned into inserted deleted/moveFrom content.
   * Prevents duplicate marker emission when a single source run is split into
   * multiple atoms (word-level atomization).
   */
  emittedSourceBookmarkMarkers: Set<WmlElement>;
}

/**
 * Create initial revision ID state.
 */
function createRevisionIdState(): RevisionIdState {
  return {
    nextId: 1,
    moveRangeIds: new Map(),
    wrappedRuns: new Set(),
    emittedSourceBookmarkMarkers: new Set(),
  };
}

/**
 * Allocate a new revision ID.
 */
function allocateRevisionId(state: RevisionIdState): number {
  return state.nextId++;
}

/**
 * Get or allocate move range IDs for a move name.
 */
function getMoveRangeIds(
  state: RevisionIdState,
  moveName: string
): { sourceRangeId: number; destRangeId: number } {
  let ids = state.moveRangeIds.get(moveName);
  if (!ids) {
    ids = {
      sourceRangeId: allocateRevisionId(state),
      destRangeId: allocateRevisionId(state),
    };
    state.moveRangeIds.set(moveName, ids);
  }
  return ids;
}

/**
 * Format date for OOXML (ISO 8601 without milliseconds).
 */
function formatDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Convert w:t elements to w:delText within an element tree.
 *
 * @param element - The element to process
 */
function convertToDelText(element: WmlElement): void {
  if (element.tagName === 'w:t') {
    renameElement(element, 'w:delText');
  }
  if (element.children) {
    for (const child of element.children) {
      convertToDelText(child);
    }
  }
}

/**
 * Build the content elements that should be inserted for an atom.
 *
 * Collapsed field atoms use a synthetic w:t as their top-level contentElement,
 * but retain the original field sequence in collapsedFieldAtoms. For insertion,
 * we must replay the original sequence rather than the synthetic text.
 */
function getInsertableAtomContentElements(atom: ComparisonUnitAtom): WmlElement[] {
  if (atom.collapsedFieldAtoms && atom.collapsedFieldAtoms.length > 0) {
    return atom.collapsedFieldAtoms.map((fieldAtom) => fieldAtom.contentElement);
  }
  return [atom.contentElement];
}

/**
 * Clone a source run and replace its non-rPr children with atom content.
 *
 * This keeps run-level formatting while allowing atom-level fragment insertion.
 */
function cloneRunWithAtomContent(
  sourceRun: WmlElement,
  atom: ComparisonUnitAtom
): WmlElement {
  const clonedRun = cloneElement(sourceRun);
  backfillParentReferences(clonedRun);

  const retainedChildren: WmlElement[] = [];
  for (const child of clonedRun.children ?? []) {
    if (child.tagName === 'w:rPr') {
      child.parent = clonedRun;
      retainedChildren.push(child);
    }
  }

  for (const contentElement of getInsertableAtomContentElements(atom)) {
    const fragment = cloneElement(contentElement);
    backfillParentReferences(fragment);
    fragment.parent = clonedRun;
    retainedChildren.push(fragment);
  }

  clonedRun.children = retainedChildren;
  return clonedRun;
}

interface ParagraphBoundaryBookmarkMarkers {
  leading: WmlElement[];
  trailing: WmlElement[];
  sourceLeading: WmlElement[];
  sourceTrailing: WmlElement[];
}

function cloneParagraphBoundaryBookmarkMarkers(
  sourceParagraph: WmlElement | undefined
): ParagraphBoundaryBookmarkMarkers {
  if (!sourceParagraph?.children || sourceParagraph.children.length === 0) {
    return { leading: [], trailing: [], sourceLeading: [], sourceTrailing: [] };
  }

  const children = sourceParagraph.children;
  let firstRunIdx = -1;
  let lastRunIdx = -1;
  for (let i = 0; i < children.length; i++) {
    if (children[i]?.tagName === 'w:r') {
      if (firstRunIdx < 0) firstRunIdx = i;
      lastRunIdx = i;
    }
  }

  const leading: WmlElement[] = [];
  const trailing: WmlElement[] = [];
  const sourceLeading: WmlElement[] = [];
  const sourceTrailing: WmlElement[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (child.tagName === 'w:bookmarkStart') {
      if (firstRunIdx < 0 || i < firstRunIdx) {
        const cloned = cloneElement(child);
        backfillParentReferences(cloned);
        leading.push(cloned);
        sourceLeading.push(child);
      }
      continue;
    }
    if (child.tagName === 'w:bookmarkEnd') {
      if (lastRunIdx < 0 || i > lastRunIdx) {
        const cloned = cloneElement(child);
        backfillParentReferences(cloned);
        trailing.push(cloned);
        sourceTrailing.push(child);
      }
    }
  }

  return { leading, trailing, sourceLeading, sourceTrailing };
}

function insertLeadingMarkers(
  paragraph: WmlElement,
  markers: WmlElement[]
): WmlElement | null {
  if (markers.length === 0) return null;

  const pPr = paragraph.children?.find((c) => c.tagName === 'w:pPr') ?? null;
  if (pPr) {
    let anchor: WmlElement = pPr;
    for (const marker of markers) {
      insertAfterElement(anchor, marker);
      anchor = marker;
    }
    return anchor;
  }

  for (let i = markers.length - 1; i >= 0; i--) {
    prependChild(paragraph, markers[i]!);
  }
  return markers[markers.length - 1] ?? null;
}

type BookmarkMarkerTag = 'w:bookmarkStart' | 'w:bookmarkEnd';

function isBookmarkMarkerTag(tagName: string): tagName is BookmarkMarkerTag {
  return tagName === 'w:bookmarkStart' || tagName === 'w:bookmarkEnd';
}

/**
 * Collect direct paragraph bookmark markers adjacent to a source run.
 *
 * Markers between runs (or at paragraph boundaries) are represented as siblings
 * of w:r under w:p. We clone nearby markers so reconstructed deleted/moveFrom
 * fragments preserve bookmark names/IDs needed for Reject All parity.
 */
function collectAdjacentSourceBookmarkMarkers(sourceRun: WmlElement): WmlElement[] {
  const paragraph = sourceRun.parent;
  if (!paragraph || paragraph.tagName !== 'w:p' || !paragraph.children) {
    return [];
  }

  const children = paragraph.children;
  const runIndex = children.indexOf(sourceRun);
  if (runIndex < 0) {
    return [];
  }

  const before: WmlElement[] = [];
  for (let i = runIndex - 1; i >= 0; i--) {
    const child = children[i];
    if (!child) break;
    if (child.tagName === 'w:r') break;
    if (isBookmarkMarkerTag(child.tagName)) {
      before.unshift(child);
    }
  }

  const after: WmlElement[] = [];
  for (let i = runIndex + 1; i < children.length; i++) {
    const child = children[i];
    if (!child) break;
    if (child.tagName === 'w:r') break;
    if (isBookmarkMarkerTag(child.tagName)) {
      after.push(child);
    }
  }

  return [...before, ...after];
}

function findTreeRoot(node: WmlElement): WmlElement {
  let current: WmlElement = node;
  while (current.parent) {
    current = current.parent;
  }
  return current;
}

function findAncestor(node: WmlElement | undefined, tagName: string): WmlElement | undefined {
  let current = node;
  while (current) {
    if (current.tagName === tagName) return current;
    current = current.parent;
  }
  return undefined;
}

function hasAncestorTag(node: WmlElement | undefined, tagNames: ReadonlySet<string>): boolean {
  let current = node?.parent;
  while (current) {
    if (tagNames.has(current.tagName)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function paragraphHasParaInsMarker(paragraph: WmlElement | undefined): boolean {
  if (!paragraph || paragraph.tagName !== 'w:p') {
    return false;
  }
  const pPr = (paragraph.children ?? []).find((c) => c.tagName === 'w:pPr');
  if (!pPr) {
    return false;
  }
  return findAllByTagName(pPr, 'w:ins').length > 0;
}

interface BookmarkSurvivalContext {
  isParagraphRemovedOnReject?: (paragraph: WmlElement) => boolean;
}

function markerSurvivesReject(marker: WmlElement, context?: BookmarkSurvivalContext): boolean {
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

function targetTreeHasEquivalentBookmarkMarker(
  targetParagraph: WmlElement,
  marker: WmlElement,
  context?: BookmarkSurvivalContext
): boolean {
  const treeRoot = findTreeRoot(targetParagraph);

  if (marker.tagName === 'w:bookmarkStart') {
    const markerId = marker.attributes['w:id'];
    const markerName = marker.attributes['w:name'];
    for (const existing of findAllByTagName(treeRoot, 'w:bookmarkStart')) {
      if (!markerSurvivesReject(existing, context)) {
        continue;
      }
      const existingName = existing.attributes['w:name'];
      const existingId = existing.attributes['w:id'];
      if (markerName && existingName === markerName) return true;
      if (!markerName && markerId && existingId === markerId) return true;
    }
    return false;
  }

  if (marker.tagName === 'w:bookmarkEnd') {
    const markerId = marker.attributes['w:id'];
    if (!markerId) return false;
    for (const existing of findAllByTagName(treeRoot, 'w:bookmarkEnd')) {
      if (!markerSurvivesReject(existing, context)) {
        continue;
      }
      if (existing.attributes['w:id'] === markerId) return true;
    }
  }

  return false;
}

function cloneUnemittedSourceBookmarkMarkers(
  sourceRun: WmlElement,
  targetParagraph: WmlElement,
  state: RevisionIdState,
  context?: BookmarkSurvivalContext
): WmlElement[] {
  const markers = collectAdjacentSourceBookmarkMarkers(sourceRun);
  const clones: WmlElement[] = [];

  for (const marker of markers) {
    if (state.emittedSourceBookmarkMarkers.has(marker)) {
      continue;
    }

    if (targetTreeHasEquivalentBookmarkMarker(targetParagraph, marker, context)) {
      state.emittedSourceBookmarkMarkers.add(marker);
      continue;
    }

    state.emittedSourceBookmarkMarkers.add(marker);
    const cloned = cloneElement(marker);
    backfillParentReferences(cloned);
    clones.push(cloned);
  }

  return clones;
}

function prependMarkersToWrapper(wrapper: WmlElement, markers: WmlElement[]): void {
  for (let i = markers.length - 1; i >= 0; i--) {
    const marker = markers[i];
    if (!marker) continue;
    prependChild(wrapper, marker);
  }
}

function filterEquivalentBookmarkMarkers(
  markers: WmlElement[],
  targetNode: WmlElement,
  context?: BookmarkSurvivalContext
): WmlElement[] {
  return markers.filter((marker) => !targetTreeHasEquivalentBookmarkMarker(targetNode, marker, context));
}

/**
 * Track change wrapper tag names.
 */
type TrackChangeTag = 'w:ins' | 'w:del' | 'w:moveFrom' | 'w:moveTo';

const TRACK_CHANGE_WRAPPERS = new Set<TrackChangeTag>([
  'w:ins',
  'w:del',
  'w:moveFrom',
  'w:moveTo',
]);

type AtomRunBoundary = 'start' | 'end';

/**
 * Resolve the run associated with an atom boundary.
 *
 * For collapsed field atoms, sourceRunElement points at the first run in the
 * field sequence. For insertion-point tracking we often need the trailing run,
 * otherwise deleted/moved fragments can be inserted inside the field sequence.
 */
function getAtomRunAtBoundary(
  atom: ComparisonUnitAtom,
  boundary: AtomRunBoundary
): WmlElement | undefined {
  if (atom.collapsedFieldAtoms && atom.collapsedFieldAtoms.length > 0) {
    const fieldAtoms =
      boundary === 'start'
        ? atom.collapsedFieldAtoms
        : [...atom.collapsedFieldAtoms].reverse();

    for (const fieldAtom of fieldAtoms) {
      const run = fieldAtom.sourceRunElement ?? findAncestorByTag(fieldAtom, 'w:r');
      if (run) return run;
    }
  }

  return atom.sourceRunElement ?? findAncestorByTag(atom, 'w:r');
}

/**
 * Resolve all run elements represented by an atom.
 *
 * For collapsed-field atoms, we must treat the entire field run sequence as a
 * single logical unit. Wrapping only the first run leaves trailing field-code
 * runs untracked, which can leak revised field text after Reject All.
 */
function getAtomRuns(atom: ComparisonUnitAtom): WmlElement[] {
  if (!atom.collapsedFieldAtoms || atom.collapsedFieldAtoms.length === 0) {
    const run = atom.sourceRunElement ?? findAncestorByTag(atom, 'w:r');
    return run ? [run] : [];
  }

  const runs: WmlElement[] = [];
  const seen = new Set<WmlElement>();
  for (const fieldAtom of atom.collapsedFieldAtoms) {
    const run = fieldAtom.sourceRunElement ?? findAncestorByTag(fieldAtom, 'w:r');
    if (!run || seen.has(run)) continue;
    seen.add(run);
    runs.push(run);
  }
  return runs;
}

/**
 * Convert a run node to the correct insertion anchor.
 *
 * If the run is wrapped in a track-change container, the insertion anchor
 * must be the wrapper (a paragraph child), not the nested run.
 */
function getRunInsertionAnchor(run: WmlElement): WmlElement {
  const parent = run.parent;
  if (parent && TRACK_CHANGE_WRAPPERS.has(parent.tagName as TrackChangeTag)) {
    return parent;
  }
  return run;
}

/**
 * Options for wrapping a run with track change markup.
 */
interface WrapRunOptions {
  /** The run element to wrap */
  run: WmlElement;
  /** The track change tag name */
  tagName: TrackChangeTag;
  /** Author name for track changes */
  author: string;
  /** Formatted date string */
  dateStr: string;
  /** Revision ID state */
  state: RevisionIdState;
  /** Whether to convert w:t to w:delText (for deleted/moveFrom content) */
  convertTextToDelText?: boolean;
}

/**
 * Wrap a run element with track change markup.
 *
 * This is the shared implementation for wrapAsInserted, wrapAsDeleted,
 * and the inner wrapping logic of move operations.
 *
 * @param options - Wrapping options
 * @returns true if wrapped, false if run was already wrapped or has no parent
 */
function wrapRunWithTrackChange(options: WrapRunOptions): boolean {
  const { run, tagName, author, dateStr, state, convertTextToDelText = false } = options;

  // Skip if already wrapped
  if (state.wrappedRuns.has(run)) {
    return false;
  }

  // Convert w:t to w:delText if requested (for deleted content)
  if (convertTextToDelText) {
    convertToDelText(run);
  }

  const id = allocateRevisionId(state);
  const wrapper = createElement(tagName, {
    'w:id': String(id),
    'w:author': author,
    'w:date': dateStr,
  });

  const result = wrapElement(run, wrapper);
  if (result) {
    state.wrappedRuns.add(run);
  }
  return result;
}

/**
 * Ensure w:pPr/w:rPr exists and add a paragraph-mark revision marker (w:ins/w:del)
 * in the paragraph properties.
 *
 * This is the critical piece for whole-paragraph insert/delete idempotency:
 * - Reject All should remove inserted paragraphs entirely (no stub breaks)
 * - Accept All should remove deleted paragraphs entirely
 */
function addParagraphMarkRevisionMarker(
  paragraph: WmlElement,
  markerTag: 'w:ins' | 'w:del',
  author: string,
  dateStr: string,
  state: RevisionIdState
): void {
  if (!paragraph.children) paragraph.children = [];

  // Find or create pPr.
  let pPr = paragraph.children.find((c) => c.tagName === 'w:pPr');
  if (!pPr) {
    pPr = createElement('w:pPr');
    // pPr should be the first child in a paragraph.
    paragraph.children.unshift(pPr);
    pPr.parent = paragraph;
  }

  if (!pPr.children) pPr.children = [];

  // Find or create rPr within pPr (paragraph mark properties).
  let rPr = pPr.children.find((c) => c.tagName === 'w:rPr');
  if (!rPr) {
    rPr = createElement('w:rPr');
    // Keep existing pPr children order stable; rPr commonly appears after spacing/jc.
    pPr.children.push(rPr);
    rPr.parent = pPr;
  }

  if (!rPr.children) rPr.children = [];

  // Avoid duplicating markers.
  if (rPr.children.some((c) => c.tagName === markerTag)) return;

  const id = allocateRevisionId(state);
  const marker = createElement(markerTag, {
    'w:id': String(id),
    'w:author': author,
    'w:date': dateStr,
  });

  // Insert marker at the start of rPr for consistency with Aspose/Word patterns.
  marker.parent = rPr;
  rPr.children.unshift(marker);
}

/**
 * Wrap a run element with <w:ins> to mark it as inserted.
 *
 * @param run - The w:r element to wrap
 * @param author - Author name for track changes
 * @param dateStr - Formatted date string
 * @param state - Revision ID state
 * @returns true if wrapped, false if run was already wrapped or has no parent
 */
export function wrapAsInserted(
  run: WmlElement,
  author: string,
  dateStr: string,
  state: RevisionIdState
): boolean {
  return wrapRunWithTrackChange({
    run,
    tagName: 'w:ins',
    author,
    dateStr,
    state,
  });
}

/**
 * Wrap a run element with <w:del> to mark it as deleted.
 * Also converts w:t to w:delText within the run.
 *
 * @param run - The w:r element to wrap
 * @param author - Author name for track changes
 * @param dateStr - Formatted date string
 * @param state - Revision ID state
 * @returns true if wrapped, false if run was already wrapped or has no parent
 */
export function wrapAsDeleted(
  run: WmlElement,
  author: string,
  dateStr: string,
  state: RevisionIdState
): boolean {
  return wrapRunWithTrackChange({
    run,
    tagName: 'w:del',
    author,
    dateStr,
    state,
    convertTextToDelText: true,
  });
}

/**
 * Clone a deleted run from the original document and insert it into the revised document.
 *
 * @param deletedAtom - Atom with the deleted content
 * @param insertAfterRun - The run to insert after (null to insert at beginning of paragraph)
 * @param targetParagraph - The paragraph to insert into
 * @param author - Author name
 * @param dateStr - Formatted date
 * @param state - Revision ID state
 * @returns The inserted del element, or null if insertion failed
 */
export function insertDeletedRun(
  deletedAtom: ComparisonUnitAtom,
  insertAfterRun: WmlElement | null,
  targetParagraph: WmlElement,
  author: string,
  dateStr: string,
  state: RevisionIdState,
  context?: BookmarkSurvivalContext
): WmlElement | null {
  // Get the source run element from the deleted atom
  const sourceRun = deletedAtom.sourceRunElement;
  if (!sourceRun) {
    return null;
  }

  // Clone only the atom fragment while preserving run-level formatting.
  // For collapsed fields, replay the original field sequence rather than
  // the synthetic collapsed w:t placeholder.
  const clonedRun = cloneRunWithAtomContent(sourceRun, deletedAtom);

  // Convert w:t to w:delText
  convertToDelText(clonedRun);

  // Create w:del wrapper
  const id = allocateRevisionId(state);
  const del = createElement('w:del', {
    'w:id': String(id),
    'w:author': author,
    'w:date': dateStr,
  });

  // Add cloned run as child of del
  appendChild(del, clonedRun);

  // Insert at correct position
  if (insertAfterRun) {
    insertAfterElement(insertAfterRun, del);
  } else {
    // Insert at the beginning of the paragraph (after pPr if present)
    const pPr = targetParagraph.children?.find(c => c.tagName === 'w:pPr');
    if (pPr) {
      insertAfterElement(pPr, del);
    } else {
      prependChild(targetParagraph, del);
    }
  }

  const sourceMarkers = cloneUnemittedSourceBookmarkMarkers(sourceRun, targetParagraph, state, context);
  if (sourceMarkers.length > 0) prependMarkersToWrapper(del, sourceMarkers);

  return del;
}

/**
 * Clone a moved-from run from the original document and insert it into the revised document.
 *
 * MovedSource atoms have their sourceRunElement in the ORIGINAL tree, but we need to
 * insert the content into the REVISED tree. This function clones the run, wraps it with
 * <w:moveFrom> and range markers, and inserts at the correct position.
 *
 * @param atom - Atom with the moved-from content
 * @param moveName - Name for linking source and destination
 * @param insertAfterRun - The run to insert after (null to insert at beginning of paragraph)
 * @param targetParagraph - The paragraph to insert into
 * @param author - Author name
 * @param dateStr - Formatted date
 * @param state - Revision ID state
 * @returns The inserted moveFrom element, or null if insertion failed
 */
export function insertMoveFromRun(
  atom: ComparisonUnitAtom,
  moveName: string,
  insertAfterRun: WmlElement | null,
  targetParagraph: WmlElement,
  author: string,
  dateStr: string,
  state: RevisionIdState,
  context?: BookmarkSurvivalContext
): WmlElement | null {
  // Get the source run element from the atom (in original tree)
  const sourceRun = atom.sourceRunElement;
  if (!sourceRun) {
    return null;
  }

  // Clone only the atom fragment while preserving run-level formatting.
  // For collapsed fields, replay the original field sequence rather than
  // the synthetic collapsed w:t placeholder.
  const clonedRun = cloneRunWithAtomContent(sourceRun, atom);

  // Convert w:t to w:delText (moved-from content appears as deleted)
  convertToDelText(clonedRun);

  // Get or allocate move range IDs
  const ids = getMoveRangeIds(state, moveName);
  const moveId = allocateRevisionId(state);

  // Create range start marker
  const rangeStart = createElement('w:moveFromRangeStart', {
    'w:id': String(ids.sourceRangeId),
    'w:name': moveName,
    'w:author': author,
    'w:date': dateStr,
  });

  // Create moveFrom wrapper
  const moveFrom = createElement('w:moveFrom', {
    'w:id': String(moveId),
    'w:author': author,
    'w:date': dateStr,
  });

  // Create range end marker
  const rangeEnd = createElement('w:moveFromRangeEnd', {
    'w:id': String(ids.sourceRangeId),
  });

  // Add cloned run as child of moveFrom
  appendChild(moveFrom, clonedRun);

  // Insert at correct position: rangeStart -> moveFrom(run) -> rangeEnd
  if (insertAfterRun) {
    insertAfterElement(insertAfterRun, rangeStart);
    insertAfterElement(rangeStart, moveFrom);
    insertAfterElement(moveFrom, rangeEnd);
  } else {
    // Insert at the beginning of the paragraph (after pPr if present)
    const pPr = targetParagraph.children?.find(c => c.tagName === 'w:pPr');
    if (pPr) {
      insertAfterElement(pPr, rangeStart);
      insertAfterElement(rangeStart, moveFrom);
      insertAfterElement(moveFrom, rangeEnd);
    } else {
      prependChild(targetParagraph, rangeEnd);
      prependChild(targetParagraph, moveFrom);
      prependChild(targetParagraph, rangeStart);
    }
  }

  const sourceMarkers = cloneUnemittedSourceBookmarkMarkers(sourceRun, targetParagraph, state, context);
  if (sourceMarkers.length > 0) prependMarkersToWrapper(moveFrom, sourceMarkers);

  return moveFrom;
}

/**
 * Clone a deleted paragraph from the original document and insert it.
 *
 * @param deletedAtom - Atom representing the deleted paragraph
 * @param insertAfterParagraph - Paragraph to insert after (null to insert at body start)
 * @param targetBody - The body element to insert into
 * @param author - Author name
 * @param dateStr - Formatted date
 * @param state - Revision ID state
 * @returns The inserted paragraph, or null if insertion failed
 */
export function insertDeletedParagraph(
  deletedAtom: ComparisonUnitAtom,
  insertAfterParagraph: WmlElement | null,
  targetBody: WmlElement,
  author: string,
  dateStr: string,
  state: RevisionIdState
): WmlElement | null {
  // Get the source paragraph from the deleted atom
  const sourceParagraph = deletedAtom.sourceParagraphElement;
  if (!sourceParagraph) {
    return null;
  }

  // Clone the paragraph
  const clonedParagraph = cloneElement(sourceParagraph);
  backfillParentReferences(clonedParagraph);

  // Wrap runs with w:del (wrapAsDeleted handles w:t -> w:delText conversion internally)
  const runs = findAllByTagName(clonedParagraph, 'w:r');
  for (const run of runs) {
    wrapAsDeleted(run, author, dateStr, state);
  }

  // Insert at correct position
  if (insertAfterParagraph) {
    insertAfterElement(insertAfterParagraph, clonedParagraph);
  } else {
    prependChild(targetBody, clonedParagraph);
  }

  return clonedParagraph;
}

/**
 * Move direction for wrapping operations.
 */
type MoveDirection = 'from' | 'to';

/**
 * Configuration for move wrapping based on direction.
 */
interface MoveWrapConfig {
  wrapperTag: 'w:moveFrom' | 'w:moveTo';
  rangeStartTag: 'w:moveFromRangeStart' | 'w:moveToRangeStart';
  rangeEndTag: 'w:moveFromRangeEnd' | 'w:moveToRangeEnd';
  rangeIdKey: 'sourceRangeId' | 'destRangeId';
  convertTextToDelText: boolean;
}

const MOVE_CONFIG: Record<MoveDirection, MoveWrapConfig> = {
  from: {
    wrapperTag: 'w:moveFrom',
    rangeStartTag: 'w:moveFromRangeStart',
    rangeEndTag: 'w:moveFromRangeEnd',
    rangeIdKey: 'sourceRangeId',
    convertTextToDelText: true, // Moved-from content appears as deleted
  },
  to: {
    wrapperTag: 'w:moveTo',
    rangeStartTag: 'w:moveToRangeStart',
    rangeEndTag: 'w:moveToRangeEnd',
    rangeIdKey: 'destRangeId',
    convertTextToDelText: false, // Moved-to content keeps w:t
  },
};

/**
 * Wrap a run element with move tracking (shared implementation for moveFrom/moveTo).
 *
 * @param run - The w:r element to wrap
 * @param moveName - Name for linking source and destination
 * @param direction - 'from' for moveFrom, 'to' for moveTo
 * @param author - Author name
 * @param dateStr - Formatted date
 * @param state - Revision ID state
 * @returns true if wrapped
 */
function wrapAsMove(
  run: WmlElement,
  moveName: string,
  direction: MoveDirection,
  author: string,
  dateStr: string,
  state: RevisionIdState
): boolean {
  if (state.wrappedRuns.has(run)) {
    return false;
  }

  const parent = run.parent;
  if (!parent || !parent.children) {
    return false;
  }

  const config = MOVE_CONFIG[direction];
  const ids = getMoveRangeIds(state, moveName);
  const moveId = allocateRevisionId(state);
  const rangeId = ids[config.rangeIdKey];

  // Convert w:t to w:delText if needed (for moveFrom content)
  if (config.convertTextToDelText) {
    convertToDelText(run);
  }

  // Create range start marker
  const rangeStart = createElement(config.rangeStartTag, {
    'w:id': String(rangeId),
    'w:name': moveName,
    'w:author': author,
    'w:date': dateStr,
  });

  // Create move wrapper
  const moveWrapper = createElement(config.wrapperTag, {
    'w:id': String(moveId),
    'w:author': author,
    'w:date': dateStr,
  });

  // Create range end marker
  const rangeEnd = createElement(config.rangeEndTag, {
    'w:id': String(rangeId),
  });

  // Insert: rangeStart -> moveWrapper(run) -> rangeEnd
  insertBeforeElement(run, rangeStart);
  wrapElement(run, moveWrapper);
  insertAfterElement(moveWrapper, rangeEnd);

  state.wrappedRuns.add(run);
  return true;
}

/**
 * Wrap a run element with <w:moveFrom> for moved-from content.
 *
 * @param run - The w:r element to wrap
 * @param moveName - Name for linking source and destination
 * @param author - Author name
 * @param dateStr - Formatted date
 * @param state - Revision ID state
 * @returns true if wrapped
 */
export function wrapAsMoveFrom(
  run: WmlElement,
  moveName: string,
  author: string,
  dateStr: string,
  state: RevisionIdState
): boolean {
  return wrapAsMove(run, moveName, 'from', author, dateStr, state);
}

/**
 * Wrap a run element with <w:moveTo> for moved-to content.
 *
 * @param run - The w:r element to wrap
 * @param moveName - Name for linking source and destination
 * @param author - Author name
 * @param dateStr - Formatted date
 * @param state - Revision ID state
 * @returns true if wrapped
 */
export function wrapAsMoveTo(
  run: WmlElement,
  moveName: string,
  author: string,
  dateStr: string,
  state: RevisionIdState
): boolean {
  return wrapAsMove(run, moveName, 'to', author, dateStr, state);
}

/**
 * Add format change tracking to a run's properties.
 *
 * @param run - The w:r element with changed formatting
 * @param oldRunProperties - The original run properties (w:rPr)
 * @param author - Author name
 * @param dateStr - Formatted date
 * @param state - Revision ID state
 */
export function addFormatChange(
  run: WmlElement,
  oldRunProperties: WmlElement | null,
  author: string,
  dateStr: string,
  state: RevisionIdState
): void {
  // Find or create w:rPr
  let rPr = run.children?.find(c => c.tagName === 'w:rPr');
  if (!rPr) {
    rPr = createElement('w:rPr');
    // Insert rPr at the beginning of run's children
    prependChild(run, rPr);
  }

  // Create rPrChange
  const id = allocateRevisionId(state);
  const rPrChange = createElement('w:rPrChange', {
    'w:id': String(id),
    'w:author': author,
    'w:date': dateStr,
  });

  // Clone old properties as children of rPrChange
  if (oldRunProperties?.children) {
    for (const child of oldRunProperties.children) {
      const cloned = cloneElement(child);
      appendChild(rPrChange, cloned);
    }
  }

  // Add rPrChange to rPr
  appendChild(rPr, rPrChange);
}

/**
 * Wrap an inserted empty paragraph with <w:ins>.
 *
 * For empty paragraphs (no content, only pPr), we wrap the entire paragraph.
 *
 * @param paragraph - The w:p element
 * @param author - Author name
 * @param dateStr - Formatted date
 * @param state - Revision ID state
 */
export function wrapParagraphAsInserted(
  paragraph: WmlElement,
  author: string,
  dateStr: string,
  state: RevisionIdState
): boolean {
  // IMPORTANT: <w:ins> is not a container for <w:p> in WordprocessingML.
  // For paragraph insertions (including empty paragraphs), we encode a paragraph-mark
  // revision marker in w:pPr/w:rPr instead of wrapping the paragraph element.
  addParagraphMarkRevisionMarker(paragraph, 'w:ins', author, dateStr, state);
  return true;
}

/**
 * Wrap a deleted empty paragraph with <w:del>.
 *
 * @param paragraph - The w:p element
 * @param author - Author name
 * @param dateStr - Formatted date
 * @param state - Revision ID state
 */
export function wrapParagraphAsDeleted(
  paragraph: WmlElement,
  author: string,
  dateStr: string,
  state: RevisionIdState
): boolean {
  // See wrapParagraphAsInserted: represent paragraph deletion via a paragraph-mark
  // revision marker in w:pPr/w:rPr so Accept/Reject All behaves correctly.
  addParagraphMarkRevisionMarker(paragraph, 'w:del', author, dateStr, state);
  return true;
}

/**
 * Modify the revised document's AST in-place based on comparison results.
 *
 * @param revisedRoot - Root element of the revised document
 * @param mergedAtoms - Atoms with correlation status from comparison
 * @param options - Modification options
 * @returns The modified XML string
 */
export function modifyRevisedDocument(
  revisedRoot: WmlElement,
  originalAtoms: ComparisonUnitAtom[],
  revisedAtoms: ComparisonUnitAtom[],
  mergedAtoms: ComparisonUnitAtom[],
  options: InPlaceModifierOptions
): string {
  const { author, date } = options;
  const dateStr = formatDate(date);
  const state = createRevisionIdState();

  // In-place mode needs concrete AST node pointers for run/paragraph edits.
  // Populate these once up-front so handlers don't have to rescan ancestor chains.
  attachSourceElementPointers(originalAtoms);
  attachSourceElementPointers(revisedAtoms);

  // Process atoms and apply track changes to the revised tree
  // Group atoms by paragraph for efficient processing
  const ctx = processAtoms(
    mergedAtoms,
    originalAtoms,
    revisedAtoms,
    author,
    dateStr,
    state,
    revisedRoot
  );

  // Add paragraph-mark revision markers for whole-paragraph insert/delete cases.
  // This is required for idempotency in Word:
  // - Reject All should remove inserted paragraphs entirely
  // - Accept All should remove deleted paragraphs entirely
  applyWholeParagraphRevisionMarkers(mergedAtoms, ctx);

  // Merge adjacent <w:ins>/<w:del> siblings to reduce revision fragmentation.
  mergeAdjacentTrackChangeSiblings(ctx.body, 'w:ins');
  mergeAdjacentTrackChangeSiblings(ctx.body, 'w:del');

  // Serialize the modified tree
  return serializeToXml(revisedRoot);
}

// =============================================================================
// Atom Processing with Strategy Pattern
// =============================================================================

/**
 * Context passed to each atom handler during processing.
 *
 * Position Tracking Explanation:
 * When processing the merged atom list, atoms arrive in document order.
 * For DELETED content, we need to clone it from the original document and
 * insert it at the correct position in the revised document.
 *
 * Since deleted atoms don't physically exist in the revised tree, we need
 * reference points:
 * - lastProcessedRun: The last run we touched - used as insertion point for deleted runs
 * - lastProcessedParagraph: The current paragraph - used to know WHICH paragraph to insert into
 *
 * Example: Original "A B C" -> Revised "A C"
 * 1. Process "A" (Equal) → track its run as lastProcessedRun
 * 2. Process "B" (Deleted) → insert AFTER lastProcessedRun (after "A")
 * 3. Process "C" (Equal) → update tracking
 */
interface ProcessingContext {
  /** Author name for track changes */
  author: string;
  /** Formatted date string */
  dateStr: string;
  /** Revision ID state */
  state: RevisionIdState;
  /** Document body element */
  body: WmlElement;
  /**
   * Last processed run element - used as insertion point for deleted content.
   * When we encounter deleted content, we insert it AFTER this run.
   */
  lastProcessedRun: WmlElement | null;
  /**
   * Last processed paragraph - used to know which paragraph to insert content into.
   * Also used as insertion point for deleted paragraphs.
   */
  lastProcessedParagraph: WmlElement | null;
  /**
   * Last processed unified paragraph index - used to detect paragraph boundaries.
   * When an atom has a different paragraphIndex, we need to handle paragraph breaks.
   */
  lastParagraphIndex: number | undefined;
  /**
   * Map from unified paragraph index to revised paragraph element.
   * Used to determine which revised paragraph to insert deleted content into.
   * Only contains paragraphs that exist in the revised document.
   */
  unifiedParaToElement: Map<number, WmlElement>;
  /**
   * Reverse lookup: revised paragraph element -> unified paragraph index.
   */
  revisedParagraphToUnifiedIndex: Map<WmlElement, number>;
  /**
   * Paragraphs classified as whole-paragraph inserted by merged-atom status.
   * These paragraphs are removed by Reject All once paragraph-level markers are applied.
   */
  fullyInsertedParagraphIndices: Set<number>;
  /**
   * Map of paragraphs we've created for deleted content.
   * When a deleted atom's unified paragraph doesn't exist in revised,
   * we create a new paragraph and track it here.
   */
  createdParagraphs: Map<number, WmlElement>;
  /**
   * Last insertion anchor within each created paragraph.
   * This can be a run wrapper (w:del/w:moveFrom) or a leading bookmark marker.
   * Used as insertion point for subsequent inserted deleted/moved fragments.
   */
  createdParagraphLastRun: Map<number, WmlElement>;
  /**
   * Trailing bookmark markers from source paragraphs that should be appended
   * after all inserted deleted/moved fragments have been placed.
   */
  createdParagraphTrailingBookmarks: Map<number, WmlElement[]>;
}

/**
 * Result from an atom handler, indicating how to update position tracking.
 */
interface HandlerResult {
  /** New value for lastProcessedRun (null means no change) */
  newLastRun?: WmlElement | null;
  /** New value for lastProcessedParagraph (null means no change) */
  newLastParagraph?: WmlElement | null;
  /** New value for lastParagraphIndex */
  newLastParagraphIndex?: number;
}

/**
 * Handler function type for processing atoms by status.
 */
type AtomHandler = (atom: ComparisonUnitAtom, ctx: ProcessingContext) => HandlerResult;

function isParagraphRemovedOnRejectInContext(paragraph: WmlElement, ctx: ProcessingContext): boolean {
  if (paragraphHasParaInsMarker(paragraph)) {
    return true;
  }
  const unifiedIndex = ctx.revisedParagraphToUnifiedIndex.get(paragraph);
  return unifiedIndex !== undefined && ctx.fullyInsertedParagraphIndices.has(unifiedIndex);
}

/**
 * Handle Inserted atoms - wrap the run with <w:ins>.
 * Inserted atoms have sourceRunElement in the REVISED tree.
 */
function handleInserted(atom: ComparisonUnitAtom, ctx: ProcessingContext): HandlerResult {
  const runs = getAtomRuns(atom);
  if (runs.length > 0) {
    for (const run of runs) {
      wrapAsInserted(run, ctx.author, ctx.dateStr, ctx.state);
    }
    const endRun = getAtomRunAtBoundary(atom, 'end') ?? runs[runs.length - 1]!;
    const insertionPoint = getRunInsertionAnchor(endRun);
    return {
      newLastRun: insertionPoint,
      newLastParagraph: atom.sourceParagraphElement ?? ctx.lastProcessedParagraph,
      newLastParagraphIndex: atom.paragraphIndex,
    };
  } else if (atom.isEmptyParagraph && atom.sourceParagraphElement) {
    // Empty inserted paragraph: mark paragraph properties instead of wrapping <w:p>.
    wrapParagraphAsInserted(atom.sourceParagraphElement, ctx.author, ctx.dateStr, ctx.state);
    return {
      newLastParagraph: atom.sourceParagraphElement,
      newLastParagraphIndex: atom.paragraphIndex,
    };
  }
  return {};
}

/**
 * Handle Deleted atoms - clone from original and insert with <w:del>.
 * Deleted atoms have sourceRunElement in the ORIGINAL tree.
 * We need to clone and insert into the REVISED tree.
 *
 * Paragraph placement logic:
 * 1. If the atom's unified paragraph exists in the revised document, insert there
 * 2. If we've already created a paragraph for this unified index, use it
 * 3. Otherwise, create a new paragraph and insert it at the correct position
 */
function handleDeleted(atom: ComparisonUnitAtom, ctx: ProcessingContext): HandlerResult {
  const bookmarkSurvivalContext: BookmarkSurvivalContext = {
    isParagraphRemovedOnReject: (paragraph) => isParagraphRemovedOnRejectInContext(paragraph, ctx),
  };

  // Handle empty deleted paragraphs specially
  if (atom.isEmptyParagraph && atom.sourceParagraphElement) {
    const createdPara = insertDeletedParagraph(
      atom,
      ctx.lastProcessedParagraph,
      ctx.body,
      ctx.author,
      ctx.dateStr,
      ctx.state
    );
    if (createdPara && atom.paragraphIndex !== undefined) {
      ctx.createdParagraphs.set(atom.paragraphIndex, createdPara);
    }
    if (createdPara) {
      wrapParagraphAsDeleted(createdPara, ctx.author, ctx.dateStr, ctx.state);
    }
    return {
      newLastParagraph: createdPara ?? ctx.lastProcessedParagraph,
      newLastParagraphIndex: atom.paragraphIndex,
    };
  }

  if (atom.sourceRunElement) {
    const unifiedPara = atom.paragraphIndex;
    let targetParagraph: WmlElement | undefined;
    let insertAfterRun: WmlElement | null = null;

    // Determine target paragraph and insertion point
    if (unifiedPara !== undefined) {
      // Check if this unified paragraph exists in the revised document
      const revisedPara = ctx.unifiedParaToElement.get(unifiedPara);
      const revisedParagraphRemovedOnReject =
        revisedPara !== undefined &&
        (ctx.fullyInsertedParagraphIndices.has(unifiedPara) || paragraphHasParaInsMarker(revisedPara));

      if (revisedPara && !revisedParagraphRemovedOnReject) {
        // Paragraph exists in revised and survives Reject All - insert into it.
        targetParagraph = revisedPara;
        // If this is the same paragraph we last processed, use lastProcessedRun
        if (ctx.lastParagraphIndex === unifiedPara) {
          insertAfterRun = ctx.lastProcessedRun;
        }
        // Otherwise, insert at the beginning of the paragraph (insertAfterRun = null)
      } else {
        // Paragraph is absent in revised OR will be removed on Reject All.
        // Route deleted content into a created paragraph so reject output keeps
        // original-order text and bookmark markers.
        const createdPara = ctx.createdParagraphs.get(unifiedPara);
        if (createdPara) {
          targetParagraph = createdPara;
          insertAfterRun = ctx.createdParagraphLastRun.get(unifiedPara) ?? null;
        } else {
          // Need to create a new paragraph for this deleted content
          const newPara = createElement('w:p');
          const boundaryMarkers = cloneParagraphBoundaryBookmarkMarkers(atom.sourceParagraphElement);
          for (const marker of [...boundaryMarkers.sourceLeading, ...boundaryMarkers.sourceTrailing]) {
            ctx.state.emittedSourceBookmarkMarkers.add(marker);
          }
          const leadingMarkers = filterEquivalentBookmarkMarkers(
            boundaryMarkers.leading,
            ctx.body,
            bookmarkSurvivalContext
          );
          const trailingMarkers = filterEquivalentBookmarkMarkers(
            boundaryMarkers.trailing,
            ctx.body,
            bookmarkSurvivalContext
          );

          // Preserve paragraph properties from the original paragraph for fidelity.
          const srcP = atom.sourceParagraphElement;
          const srcPPr = srcP?.children?.find((c) => c.tagName === 'w:pPr');
          if (srcPPr) {
            const clonedPPr = cloneElement(srcPPr);
            appendChild(newPara, clonedPPr);
            backfillParentReferences(newPara);
          }

          if (ctx.lastProcessedParagraph) {
            insertAfterElement(ctx.lastProcessedParagraph, newPara);
          } else {
            prependChild(ctx.body, newPara);
          }
          ctx.createdParagraphs.set(unifiedPara, newPara);
          const leadingTail = insertLeadingMarkers(newPara, leadingMarkers);
          if (leadingTail) {
            ctx.createdParagraphLastRun.set(unifiedPara, leadingTail);
          }
          if (trailingMarkers.length > 0) {
            ctx.createdParagraphTrailingBookmarks.set(unifiedPara, trailingMarkers);
          }
          targetParagraph = newPara;
          insertAfterRun = leadingTail;
        }
      }
    }

    // Fall back to last processed paragraph if we couldn't determine target
    if (!targetParagraph) {
      targetParagraph = ctx.lastProcessedParagraph ??
        (ctx.body.children?.find(c => c.tagName === 'w:p') as WmlElement | undefined);
    }

    if (!targetParagraph) {
      warn('inPlaceModifier', 'Cannot insert deleted content: no target paragraph found', {
        atomText: atom.contentElement?.textContent,
      });
      return {};
    }

    const del = insertDeletedRun(
      atom,
      insertAfterRun,
      targetParagraph,
      ctx.author,
      ctx.dateStr,
      ctx.state,
      bookmarkSurvivalContext
    );

    if (del) {
      // Track last run in created paragraphs
      if (unifiedPara !== undefined && ctx.createdParagraphs.has(unifiedPara)) {
        ctx.createdParagraphLastRun.set(unifiedPara, del);
      }
      return {
        newLastRun: del,
        newLastParagraph: targetParagraph,
        newLastParagraphIndex: atom.paragraphIndex,
      };
    }
  }
  return {};
}

/**
 * Handle MovedSource atoms - clone from original and insert with <w:moveFrom>.
 *
 * MovedSource atoms have sourceRunElement pointing to the ORIGINAL tree.
 * We need to clone the content and insert it into the REVISED tree.
 *
 * Paragraph placement logic (same as handleDeleted):
 * 1. If the atom's unified paragraph exists in the revised document, insert there
 * 2. If we've already created a paragraph for this unified index, use it
 * 3. Otherwise, create a new paragraph and insert it at the correct position
 */
function handleMovedSource(atom: ComparisonUnitAtom, ctx: ProcessingContext): HandlerResult {
  const bookmarkSurvivalContext: BookmarkSurvivalContext = {
    isParagraphRemovedOnReject: (paragraph) => isParagraphRemovedOnRejectInContext(paragraph, ctx),
  };

  if (atom.sourceRunElement) {
    const unifiedPara = atom.paragraphIndex;
    let targetParagraph: WmlElement | undefined;
    let insertAfterRun: WmlElement | null = null;

    // Determine target paragraph and insertion point
    if (unifiedPara !== undefined) {
      // Check if this unified paragraph exists in the revised document
      const revisedPara = ctx.unifiedParaToElement.get(unifiedPara);
      const revisedParagraphRemovedOnReject =
        revisedPara !== undefined &&
        (ctx.fullyInsertedParagraphIndices.has(unifiedPara) || paragraphHasParaInsMarker(revisedPara));

      if (revisedPara && !revisedParagraphRemovedOnReject) {
        // Paragraph exists in revised and survives Reject All - insert into it.
        targetParagraph = revisedPara;
        // If this is the same paragraph we last processed, use lastProcessedRun
        if (ctx.lastParagraphIndex === unifiedPara) {
          insertAfterRun = ctx.lastProcessedRun;
        }
        // Otherwise, insert at the beginning of the paragraph (insertAfterRun = null)
      } else {
        // Paragraph is absent in revised OR will be removed on Reject All.
        // Route moved-from content into a created paragraph for reject fidelity.
        const createdPara = ctx.createdParagraphs.get(unifiedPara);
        if (createdPara) {
          targetParagraph = createdPara;
          insertAfterRun = ctx.createdParagraphLastRun.get(unifiedPara) ?? null;
        } else {
          // Need to create a new paragraph for this moved-from content
          const newPara = createElement('w:p');
          const boundaryMarkers = cloneParagraphBoundaryBookmarkMarkers(atom.sourceParagraphElement);
          for (const marker of [...boundaryMarkers.sourceLeading, ...boundaryMarkers.sourceTrailing]) {
            ctx.state.emittedSourceBookmarkMarkers.add(marker);
          }
          const leadingMarkers = filterEquivalentBookmarkMarkers(
            boundaryMarkers.leading,
            ctx.body,
            bookmarkSurvivalContext
          );
          const trailingMarkers = filterEquivalentBookmarkMarkers(
            boundaryMarkers.trailing,
            ctx.body,
            bookmarkSurvivalContext
          );

          // Preserve paragraph properties from the original paragraph for fidelity.
          const srcP = atom.sourceParagraphElement;
          const srcPPr = srcP?.children?.find((c) => c.tagName === 'w:pPr');
          if (srcPPr) {
            const clonedPPr = cloneElement(srcPPr);
            appendChild(newPara, clonedPPr);
            backfillParentReferences(newPara);
          }

          if (ctx.lastProcessedParagraph) {
            insertAfterElement(ctx.lastProcessedParagraph, newPara);
          } else {
            prependChild(ctx.body, newPara);
          }
          ctx.createdParagraphs.set(unifiedPara, newPara);
          const leadingTail = insertLeadingMarkers(newPara, leadingMarkers);
          if (leadingTail) {
            ctx.createdParagraphLastRun.set(unifiedPara, leadingTail);
          }
          if (trailingMarkers.length > 0) {
            ctx.createdParagraphTrailingBookmarks.set(unifiedPara, trailingMarkers);
          }
          targetParagraph = newPara;
          insertAfterRun = leadingTail;
        }
      }
    }

    // Fall back to last processed paragraph if we couldn't determine target
    if (!targetParagraph) {
      targetParagraph = ctx.lastProcessedParagraph ??
        (ctx.body.children?.find(c => c.tagName === 'w:p') as WmlElement | undefined);
    }

    if (!targetParagraph) {
      warn('inPlaceModifier', 'Cannot insert moved-from content: no target paragraph found', {
        atomText: atom.contentElement?.textContent,
      });
      return {};
    }

    const moveFrom = insertMoveFromRun(
      atom,
      atom.moveName || 'move1',
      insertAfterRun,
      targetParagraph,
      ctx.author,
      ctx.dateStr,
      ctx.state,
      bookmarkSurvivalContext
    );

    if (moveFrom) {
      // Track last run in created paragraphs
      if (unifiedPara !== undefined && ctx.createdParagraphs.has(unifiedPara)) {
        ctx.createdParagraphLastRun.set(unifiedPara, moveFrom);
      }
      return {
        newLastRun: moveFrom,
        newLastParagraph: targetParagraph,
        newLastParagraphIndex: atom.paragraphIndex,
      };
    }
  }
  return {};
}

/**
 * Handle MovedDestination atoms - wrap with <w:moveTo>.
 * MovedDestination atoms have sourceRunElement in the REVISED tree.
 */
function handleMovedDestination(atom: ComparisonUnitAtom, ctx: ProcessingContext): HandlerResult {
  const runs = getAtomRuns(atom);
  if (runs.length > 0) {
    for (const run of runs) {
      wrapAsMoveTo(run, atom.moveName || 'move1', ctx.author, ctx.dateStr, ctx.state);
    }
    const endRun = getAtomRunAtBoundary(atom, 'end') ?? runs[runs.length - 1]!;
    const insertionPoint = getRunInsertionAnchor(endRun);
    return {
      newLastRun: insertionPoint,
      newLastParagraph: atom.sourceParagraphElement ?? ctx.lastProcessedParagraph,
      newLastParagraphIndex: atom.paragraphIndex,
    };
  }
  return {};
}

/**
 * Handle FormatChanged atoms - add <w:rPrChange>.
 * FormatChanged atoms have sourceRunElement in the REVISED tree.
 */
function handleFormatChanged(atom: ComparisonUnitAtom, ctx: ProcessingContext): HandlerResult {
  const run = getAtomRunAtBoundary(atom, 'start');
  if (run && atom.formatChange?.oldRunProperties) {
    addFormatChange(run, atom.formatChange.oldRunProperties, ctx.author, ctx.dateStr, ctx.state);
    const insertionPoint = getRunInsertionAnchor(getAtomRunAtBoundary(atom, 'end') ?? run);
    return {
      newLastRun: insertionPoint,
      newLastParagraph: atom.sourceParagraphElement ?? ctx.lastProcessedParagraph,
      newLastParagraphIndex: atom.paragraphIndex,
    };
  }
  return {};
}

/**
 * Handle Equal/Unknown atoms - just track position.
 *
 * IMPORTANT: For inplace mode, we must track positions in the REVISED tree.
 * - Non-empty Equal atoms come from the revised tree (sourceRunElement/sourceParagraphElement point to revised)
 * - Empty paragraph Equal atoms come from the ORIGINAL tree (see createMergedAtomList)
 *
 * For empty paragraphs, we need to look up the corresponding revised paragraph
 * from unifiedParaToElement, not use the atom's sourceParagraphElement (which is from original tree).
 *
 * CRITICAL: When the paragraph index changes, we MUST reset newLastRun to null.
 * This ensures that subsequent content is not incorrectly inserted after a run
 * from a previous paragraph. See the "Gross Asset Value" bug fix.
 */
function handleEqual(atom: ComparisonUnitAtom, ctx: ProcessingContext): HandlerResult {
  // For non-empty atoms, sourceRunElement points to revised tree - safe to use directly
  const run = getAtomRunAtBoundary(atom, 'end');
  if (run) {
    const insertionPoint = getRunInsertionAnchor(run);
    return {
      newLastRun: insertionPoint,
      newLastParagraph: atom.sourceParagraphElement ?? ctx.lastProcessedParagraph,
      newLastParagraphIndex: atom.paragraphIndex,
    };
  }

  // For empty paragraphs (no sourceRunElement), the atom comes from the ORIGINAL tree!
  // We must NOT use atom.sourceParagraphElement for position tracking in inplace mode.
  // Instead, look up the corresponding REVISED paragraph from unifiedParaToElement.
  if (atom.paragraphIndex !== undefined) {
    // Look up the revised paragraph for this unified paragraph index
    const revisedParagraph = ctx.unifiedParaToElement.get(atom.paragraphIndex);

    // IMPORTANT: When we move to a new paragraph (empty or not), we MUST reset
    // lastProcessedRun to null. Otherwise, subsequent inserts might use a stale
    // run from a previous paragraph, causing content to be inserted in the wrong place.
    // Setting newLastRun to null explicitly resets it.
    return {
      newLastRun: null, // Reset - we're in a new paragraph with no runs yet
      // Use the revised paragraph (not the original's sourceParagraphElement!)
      newLastParagraph: revisedParagraph ?? ctx.lastProcessedParagraph,
      newLastParagraphIndex: atom.paragraphIndex,
    };
  }

  return {};
}

/**
 * Strategy map for handling atoms by correlation status.
 * This pattern makes it easy to add new status types without modifying processAtoms.
 */
const ATOM_HANDLERS: Record<CorrelationStatus, AtomHandler> = {
  [CorrelationStatus.Inserted]: handleInserted,
  [CorrelationStatus.Deleted]: handleDeleted,
  [CorrelationStatus.MovedSource]: handleMovedSource,
  [CorrelationStatus.MovedDestination]: handleMovedDestination,
  [CorrelationStatus.FormatChanged]: handleFormatChanged,
  [CorrelationStatus.Equal]: handleEqual,
  [CorrelationStatus.Unknown]: handleEqual,
};

/**
 * Process atoms and apply track changes to the revised AST.
 *
 * Uses a strategy pattern with registered handlers for each correlation status,
 * making it easy to add new status types without modifying this function.
 */
function processAtoms(
  mergedAtoms: ComparisonUnitAtom[],
  _originalAtoms: ComparisonUnitAtom[],
  revisedAtoms: ComparisonUnitAtom[],
  author: string,
  dateStr: string,
  state: RevisionIdState,
  revisedRoot: WmlElement
): ProcessingContext {
  const body = findAllByTagName(revisedRoot, 'w:body')[0];
  if (!body) {
    warn('inPlaceModifier', 'Cannot process atoms: no w:body element found');
    // Return a minimal context to avoid callers having to handle undefined.
    return {
      author,
      dateStr,
      state,
      body: revisedRoot,
      lastProcessedRun: null,
      lastProcessedParagraph: null,
      lastParagraphIndex: undefined,
      unifiedParaToElement: new Map(),
      revisedParagraphToUnifiedIndex: new Map(),
      fullyInsertedParagraphIndices: new Set(),
      createdParagraphs: new Map(),
      createdParagraphLastRun: new Map(),
      createdParagraphTrailingBookmarks: new Map(),
    };
  }

  // Build map from unified paragraph index to revised paragraph element.
  // This tells us which paragraphs exist in the revised document.
  // Revised atoms have their paragraphIndex already set to unified indices
  // after assignUnifiedParagraphIndices was called.
  const unifiedParaToElement = new Map<number, WmlElement>();
  const revisedParagraphToUnifiedIndex = new Map<WmlElement, number>();
  for (const atom of revisedAtoms) {
    if (atom.paragraphIndex !== undefined && atom.sourceParagraphElement) {
      if (!unifiedParaToElement.has(atom.paragraphIndex)) {
        unifiedParaToElement.set(atom.paragraphIndex, atom.sourceParagraphElement);
      }
      if (!revisedParagraphToUnifiedIndex.has(atom.sourceParagraphElement)) {
        revisedParagraphToUnifiedIndex.set(atom.sourceParagraphElement, atom.paragraphIndex);
      }
    }
  }

  const atomsByPara = new Map<number, ComparisonUnitAtom[]>();
  for (const atom of mergedAtoms) {
    if (atom.paragraphIndex === undefined) continue;
    const existing = atomsByPara.get(atom.paragraphIndex) ?? [];
    existing.push(atom);
    atomsByPara.set(atom.paragraphIndex, existing);
  }
  const fullyInsertedParagraphIndices = new Set<number>();
  for (const [paraIdx, atoms] of atomsByPara.entries()) {
    if (isEntireParagraphAtomsWithStatus(atoms, CorrelationStatus.Inserted)) {
      fullyInsertedParagraphIndices.add(paraIdx);
    }
  }

  // Initialize processing context with position tracking
  const ctx: ProcessingContext = {
    author,
    dateStr,
    state,
    body,
    lastProcessedRun: null,
    lastProcessedParagraph: null,
    lastParagraphIndex: undefined,
    unifiedParaToElement,
    revisedParagraphToUnifiedIndex,
    fullyInsertedParagraphIndices,
    createdParagraphs: new Map(),
    createdParagraphLastRun: new Map(),
    createdParagraphTrailingBookmarks: new Map(),
  };

  for (const atom of mergedAtoms) {
    const handler = ATOM_HANDLERS[atom.correlationStatus];
    const result = handler(atom, ctx);

    // Update position tracking based on handler result
    if (result.newLastRun !== undefined) {
      ctx.lastProcessedRun = result.newLastRun;
    }
    if (result.newLastParagraph !== undefined) {
      ctx.lastProcessedParagraph = result.newLastParagraph;
    }
    if (result.newLastParagraphIndex !== undefined) {
      ctx.lastParagraphIndex = result.newLastParagraphIndex;
    }
  }

  finalizeCreatedParagraphTrailingBookmarks(ctx);
  return ctx;
}

function finalizeCreatedParagraphTrailingBookmarks(ctx: ProcessingContext): void {
  for (const [paraIdx, markers] of ctx.createdParagraphTrailingBookmarks.entries()) {
    if (markers.length === 0) continue;
    const paragraph = ctx.createdParagraphs.get(paraIdx);
    if (!paragraph) continue;

    let anchor = ctx.createdParagraphLastRun.get(paraIdx) ?? null;
    if (!anchor) {
      const pPr = paragraph.children?.find((c) => c.tagName === 'w:pPr') ?? null;
      const leadingBookmark = [...(paragraph.children ?? [])]
        .reverse()
        .find((c) => c.tagName === 'w:bookmarkStart');
      anchor = leadingBookmark ?? pPr;
    }

    if (!anchor) {
      for (const marker of markers) {
        appendChild(paragraph, marker);
      }
      continue;
    }

    let current = anchor;
    for (const marker of markers) {
      insertAfterElement(current, marker);
      current = marker;
    }
    ctx.createdParagraphLastRun.set(paraIdx, current);
  }
}

/**
 * Apply whole-paragraph revision markers (w:pPr/w:rPr) based on merged atoms.
 *
 * This intentionally runs as a post-pass so the inplace algorithm can keep its
 * fine-grained run edits while still enforcing Word/Aspose paragraph invariants.
 */
function applyWholeParagraphRevisionMarkers(
  mergedAtoms: ComparisonUnitAtom[],
  ctx: ProcessingContext
): void {
  const atomsByPara = new Map<number, ComparisonUnitAtom[]>();
  for (const atom of mergedAtoms) {
    if (atom.paragraphIndex === undefined) continue;
    const list = atomsByPara.get(atom.paragraphIndex) ?? [];
    list.push(atom);
    atomsByPara.set(atom.paragraphIndex, list);
  }

  for (const [paraIdx, atoms] of atomsByPara.entries()) {
    if (isEntireParagraphAtomsWithStatus(atoms, CorrelationStatus.Inserted)) {
      const para = ctx.unifiedParaToElement.get(paraIdx);
      if (para) {
        wrapParagraphAsInserted(para, ctx.author, ctx.dateStr, ctx.state);
      }
      continue;
    }

    if (isEntireParagraphAtomsWithStatus(atoms, CorrelationStatus.Deleted)) {
      const para = ctx.createdParagraphs.get(paraIdx) ?? ctx.unifiedParaToElement.get(paraIdx);
      if (para) {
        wrapParagraphAsDeleted(para, ctx.author, ctx.dateStr, ctx.state);
      }
    }
  }
}

/**
 * Merge adjacent sibling track-change wrappers (<w:ins>/<w:del>) to reduce
 * Word UI fragmentation (one accept/reject per word/run).
 *
 * We only merge wrappers that share the same author+date to avoid conflating
 * distinct revisions.
 */
function mergeAdjacentTrackChangeSiblings(root: WmlElement, tagName: 'w:ins' | 'w:del'): void {
  function traverse(node: WmlElement): void {
    if (node.children && node.children.length > 1) {
      for (let i = 0; i < node.children.length - 1; i++) {
        const a = node.children[i]!;
        const b = node.children[i + 1]!;

        if (a.tagName === tagName && b.tagName === tagName) {
          const aAuth = a.attributes?.['w:author'] ?? '';
          const bAuth = b.attributes?.['w:author'] ?? '';
          const aDate = a.attributes?.['w:date'] ?? '';
          const bDate = b.attributes?.['w:date'] ?? '';

          if (aAuth === bAuth && aDate === bDate) {
            if (!a.children) a.children = [];
            const bKids = b.children ?? [];
            for (const child of bKids) {
              child.parent = a;
              a.children.push(child);
            }

            // Remove b from parent.
            node.children.splice(i + 1, 1);
            b.parent = undefined;

            // Stay at i to allow merging chains (a with next sibling).
            i--;
            continue;
          }
        }
      }
    }

    if (node.children) {
      for (const child of node.children) traverse(child);
    }
  }

  traverse(root);
}

// Re-export for convenience
export { createRevisionIdState, type RevisionIdState };
