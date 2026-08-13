/**
 * In-Place AST Modifier
 *
 * Modifies the revised document's AST in-place to add track changes markup.
 * This replaces the reconstruction-based approach with direct tree manipulation.
 */

import type { ComparisonUnitAtom } from '@usejunior/docx-core';
import { childElements, findChildByTagName, insertAfterElement, wrapElement } from '@usejunior/docx-core';
import {
  allocateRevisionId,
  convertToDelText,
  createEl,
  findAncestorByTag,
  getMoveRangeIds,
  parentElement,
  type RevisionIdState,
  W_NS,
} from './inPlaceModifier-shared.js';

export type TrackChangeTag = 'w:ins' | 'w:del' | 'w:moveFrom' | 'w:moveTo';

export const TRACK_CHANGE_WRAPPERS = new Set<TrackChangeTag>([
  'w:ins',
  'w:del',
  'w:moveFrom',
  'w:moveTo',
]);

export type AtomRunBoundary = 'start' | 'end';

/**
 * Resolve the run associated with an atom boundary.
 *
 * For collapsed field atoms, sourceRunElement points at the first run in the
 * field sequence. For insertion-point tracking we often need the trailing run,
 * otherwise deleted/moved fragments can be inserted inside the field sequence.
 */
export function getAtomRunAtBoundary(
  atom: ComparisonUnitAtom,
  boundary: AtomRunBoundary
): Element | undefined {
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
export function getAtomRuns(atom: ComparisonUnitAtom): Element[] {
  if (!atom.collapsedFieldAtoms || atom.collapsedFieldAtoms.length === 0) {
    const run = atom.sourceRunElement ?? findAncestorByTag(atom, 'w:r');
    return run ? [run] : [];
  }

  const runs: Element[] = [];
  const seen = new Set<Element>();
  for (const fieldAtom of atom.collapsedFieldAtoms) {
    const run = fieldAtom.sourceRunElement ?? findAncestorByTag(fieldAtom, 'w:r');
    if (!run || seen.has(run)) continue;
    seen.add(run);
    runs.push(run);
  }
  return runs;
}

/**
 * True iff `atom` represents a collapsed-field sequence (a complex field
 * captured as a single logical atom). See {@link getAtomRuns} for the
 * multi-run resolution.
 */
export function isCollapsedFieldAtom(atom: ComparisonUnitAtom): boolean {
  return !!(atom.collapsedFieldAtoms && atom.collapsedFieldAtoms.length > 0);
}

/**
 * Author/date identity of a pre-tracked `<w:ins>` wrapper carried by the
 * ORIGINAL input document.
 */
export interface InsProvenance {
  author: string;
  date: string;
}

/**
 * Resolve the ORIGINAL document's inline `<w:ins>` provenance for a merged
 * atom, or null when the original lineage was not inside a pre-tracked
 * insertion.
 *
 * Merged atoms come from two trees: Deleted/MovedSource atoms (and
 * original-sourced empty-paragraph atoms) ARE original-tree atoms and carry
 * the input wrapper on `revTrackElement` directly. Equal/FormatChanged/
 * Inserted atoms — plus the whitespace duplicates reorderChangeBlocks
 * synthesizes from them — are revised-tree atoms, where `revTrackElement`
 * describes the REVISED document's own wrapper; the original lineage is only
 * reachable through the LCS match link (`comparisonUnitAtomBefore`).
 * `sourceDocument` (assigned in createMergedAtomList) is the discriminator.
 *
 * Threading this provenance into reconstruction is what keeps the INV-RT-001
 * reject projection lawful: content the original tracked as inserted must
 * stay droppable by reject-all in the combined output.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/358
 */
export function getOriginalInsProvenance(atom: ComparisonUnitAtom): InsProvenance | null {
  const revTrack =
    atom.sourceDocument === 'original'
      ? atom.revTrackElement
      : atom.comparisonUnitAtomBefore?.revTrackElement;
  if (!revTrack || revTrack.tagName !== 'w:ins') {
    return null;
  }
  const author = revTrack.getAttribute('w:author');
  if (!author) {
    return null;
  }
  return { author, date: revTrack.getAttribute('w:date') ?? '' };
}

/**
 * Grouping key for {@link getOriginalInsProvenance} — atoms whose original
 * lineage sits in the same-authored `<w:ins>` share a key; plain atoms map to
 * null. Used to split runs/groups at provenance boundaries.
 */
export function getOriginalInsProvenanceKey(atom: ComparisonUnitAtom): string | null {
  const prov = getOriginalInsProvenance(atom);
  return prov ? `${prov.author}\u0000${prov.date}` : null;
}

/**
 * Nest an already-placed element (typically a freshly emitted `<w:del>`)
 * inside a `<w:ins>` that restores the original input's insertion provenance:
 * `<w:ins original-author><w:del Comparison>…</w:del></w:ins>`.
 *
 * Projection law: reject-all removes the outer w:ins with its whole subtree
 * (matching reject(original), which drops the pre-tracked insertion), while
 * accept-all removes the inner w:del and unwraps the then-empty w:ins
 * (matching accept(revised), which never had the text).
 *
 * The ins-outside/del-inside order mirrors the paragraph-mark analogue
 * ({@link placeParagraphMarkRevisionMarker} stacks w:ins before w:del).
 *
 * @see https://github.com/UseJunior/safe-docx/issues/358
 */
export function wrapWithOriginalInsProvenance(
  element: Element,
  prov: InsProvenance,
  state: RevisionIdState
): Element {
  const attrs: Record<string, string> = {
    'w:id': String(allocateRevisionId(state)),
    'w:author': prov.author,
  };
  if (prov.date) {
    attrs['w:date'] = prov.date;
  }
  const ins = createEl('w:ins', attrs);
  wrapElement(element, ins);
  return ins;
}

/**
 * Convert a run node to the correct insertion anchor.
 *
 * If the run is wrapped in a track-change container, the insertion anchor
 * must be the wrapper (a paragraph child), not the nested run.
 */
export function getRunInsertionAnchor(run: Element): Element {
  const parent = parentElement(run);
  if (parent && TRACK_CHANGE_WRAPPERS.has(parent.tagName as TrackChangeTag)) {
    return parent;
  }
  return run;
}

/**
 * Options for wrapping a run with track change markup.
 */
export interface WrapRunOptions {
  /** The run element to wrap */
  run: Element;
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
export function wrapRunWithTrackChange(options: WrapRunOptions): boolean {
  const { run, tagName, author, dateStr, state, convertTextToDelText: convertText = false } = options;

  // Skip if already wrapped
  if (state.wrappedRuns.has(run)) {
    return false;
  }

  // Skip if the run has no parent in the tree
  if (!run.parentNode) {
    return false;
  }

  // Convert w:t to w:delText if requested (for deleted content)
  if (convertText) {
    convertToDelText(run);
  }

  const id = allocateRevisionId(state);
  const wrapper = createEl(tagName, {
    'w:id': String(id),
    'w:author': author,
    'w:date': dateStr,
  });

  wrapElement(run, wrapper);
  state.wrappedRuns.add(run);
  return true;
}

/**
 * Ensure w:pPr/w:rPr exists and add a paragraph-mark revision marker (w:ins/w:del)
 * in the paragraph properties.
 *
 * This is the critical piece for whole-paragraph insert/delete idempotency:
 * - Reject All should remove inserted paragraphs entirely (no stub breaks)
 * - Accept All should remove deleted paragraphs entirely
 */
export function addParagraphMarkRevisionMarker(
  paragraph: Element,
  markerTag: 'w:ins' | 'w:del',
  author: string,
  dateStr: string,
  state: RevisionIdState
): void {
  // Find or create pPr.
  let pPr = findChildByTagName(paragraph, 'w:pPr');
  if (!pPr) {
    pPr = createEl('w:pPr');
    // pPr should be the first child in a paragraph.
    paragraph.insertBefore(pPr, paragraph.firstChild);
  }

  const existingMarker = findParagraphMarkRevisionMarker(pPr, markerTag);

  // Find or create rPr within pPr (paragraph mark properties).
  let rPr = findChildByTagName(pPr, 'w:rPr');
  if (!rPr) {
    rPr = createEl('w:rPr');
    // CT_PPr ordering: ... base props ..., w:rPr, w:sectPr?, w:pPrChange?
    // Insert rPr in schema-correct position (before sectPr/pPrChange).
    const sectPr = findChildByTagName(pPr, 'w:sectPr');
    const pPrChange = findChildByTagName(pPr, 'w:pPrChange');
    const insertBefore = sectPr ?? pPrChange ?? null;
    if (insertBefore) {
      pPr.insertBefore(rPr, insertBefore);
    } else {
      pPr.appendChild(rPr);
    }
  }

  // Avoid duplicating markers. A legacy/bypass path may already have put the
  // paragraph-mark marker in another w:rPr under the same pPr; keep that marker
  // and normalize its revision context instead of adding a second CT_ParaRPr child.
  if (existingMarker) {
    existingMarker.setAttribute('w:author', author);
    existingMarker.setAttribute('w:date', dateStr);
    if (!existingMarker.getAttribute('w:id')) {
      existingMarker.setAttribute('w:id', String(allocateRevisionId(state)));
    }
    // The bypass path may have left the marker mid-sequence (or in another
    // w:rPr); move it to the schema-correct slot in the canonical rPr.
    placeParagraphMarkRevisionMarker(rPr, existingMarker, markerTag);
    return;
  }

  const id = allocateRevisionId(state);
  const marker = createEl(markerTag, {
    'w:id': String(id),
    'w:author': author,
    'w:date': dateStr,
  });

  placeParagraphMarkRevisionMarker(rPr, marker, markerTag);
}

/**
 * Position a paragraph-mark revision marker in its schema-correct rPr slot.
 *
 * CT_ParaRPr ordering: the tracked-change group (w:ins, w:del, w:moveFrom,
 * w:moveTo — in that order) comes before every formatting child (w:rStyle,
 * w:rFonts, ...). So w:ins always goes first, and w:del goes right after a
 * w:ins sibling when one exists, else first.
 */
export function placeParagraphMarkRevisionMarker(
  rPr: Element,
  marker: Element,
  markerTag: 'w:ins' | 'w:del'
): void {
  const insSibling = markerTag === 'w:del' ? findChildByTagName(rPr, 'w:ins') : null;
  if (insSibling) {
    if (insSibling.nextSibling !== marker) {
      insertAfterElement(insSibling, marker);
    }
  } else if (rPr.firstChild !== marker) {
    rPr.insertBefore(marker, rPr.firstChild);
  }
}

export function findParagraphMarkRevisionMarker(
  pPr: Element,
  markerTag: 'w:ins' | 'w:del'
): Element | null {
  for (const child of childElements(pPr)) {
    if (child.tagName !== 'w:rPr') continue;
    const marker = findChildByTagName(child, markerTag);
    if (marker) return marker;
  }
  return null;
}

// Field-wrapper emission boundary.
// Traceability anchor cited by validation documentation and
// the comparison round-trip regression suite. These wrapping
// primitives (wrapAsInserted/wrapAsDeleted and the move/format variants below)
// emit whole field sequences as SINGLE track-change wrappers, which is why the
// engine currently satisfies the stronger `fieldContextNeutral ∀ ctx` property.
// When ECMA-376 field fragmentation lands (#217) this anchor marks the code the
// validation predicate-strength choice depends on. Grep this anchor, not line numbers.
export function wrapAsInserted(
  run: Element,
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
  run: Element,
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

export type MoveDirection = 'from' | 'to';

/**
 * Configuration for move wrapping based on direction.
 */
export interface MoveWrapConfig {
  wrapperTag: 'w:moveFrom' | 'w:moveTo';
  rangeStartTag: 'w:moveFromRangeStart' | 'w:moveToRangeStart';
  rangeEndTag: 'w:moveFromRangeEnd' | 'w:moveToRangeEnd';
  rangeIdKey: 'sourceRangeId' | 'destRangeId';
  convertTextToDelText: boolean;
}

export const MOVE_CONFIG: Record<MoveDirection, MoveWrapConfig> = {
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
export function wrapAsMove(
  run: Element,
  moveName: string,
  direction: MoveDirection,
  author: string,
  dateStr: string,
  state: RevisionIdState
): boolean {
  if (state.wrappedRuns.has(run)) {
    return false;
  }

  const parent = parentElement(run);
  if (!parent) {
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
  const rangeStart = createEl(config.rangeStartTag, {
    'w:id': String(rangeId),
    'w:name': moveName,
    'w:author': author,
    'w:date': dateStr,
  });

  // Create move wrapper
  const moveWrapper = createEl(config.wrapperTag, {
    'w:id': String(moveId),
    'w:author': author,
    'w:date': dateStr,
  });

  // Create range end marker
  const rangeEnd = createEl(config.rangeEndTag, {
    'w:id': String(rangeId),
  });
  state.generatedMoveRangeMarkers.add(rangeStart);
  state.generatedMoveRangeMarkers.add(rangeEnd);

  // Insert: rangeStart -> moveWrapper(run) -> rangeEnd
  run.parentNode!.insertBefore(rangeStart, run);
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
  run: Element,
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
  run: Element,
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
  run: Element,
  oldRunProperties: Element | null,
  author: string,
  dateStr: string,
  state: RevisionIdState
): void {
  // Find or create w:rPr
  let rPr = findChildByTagName(run, 'w:rPr');
  if (!rPr) {
    rPr = createEl('w:rPr');
    // Insert rPr at the beginning of run's children
    run.insertBefore(rPr, run.firstChild);
  }

  // CT_RPr permits at most one w:rPrChange. Comparison can visit multiple
  // format-changed atoms from the same split run, so keep the latest snapshot
  // instead of stacking invalid siblings.
  for (const child of childElements(rPr)) {
    if (child.namespaceURI === W_NS && child.localName === 'rPrChange') {
      rPr.removeChild(child);
    }
  }

  // Create rPrChange
  const id = allocateRevisionId(state);
  state.generatedFormatChangeIds.add(String(id));
  const rPrChange = createEl('w:rPrChange', {
    'w:id': String(id),
    'w:author': author,
    'w:date': dateStr,
  });

  // Clone old properties into a w:rPr wrapper inside rPrChange (OOXML spec requires
  // rPrChange to contain a single w:rPr child holding the previous formatting).
  if (oldRunProperties) {
    const oldRPr = createEl('w:rPr');
    for (const child of childElements(oldRunProperties)) {
      if (child.namespaceURI === W_NS && child.localName === 'rPrChange') continue;
      const cloned = child.cloneNode(true) as Element;
      oldRPr.appendChild(cloned);
    }
    rPrChange.appendChild(oldRPr);
  }

  // Add rPrChange to rPr
  rPr.appendChild(rPrChange);
}

/**
 * Add a paragraph property change element (w:pPrChange) to record the "before"
 * state of paragraph properties.  This is needed for Google Docs to display
 * inserted paragraphs as tracked changes.
 *
 * The child `<w:pPr>` inside `w:pPrChange` must conform to CT_PPrBase — it
 * MUST NOT contain w:rPr, w:sectPr, or w:pPrChange.
 *
 * @param paragraph - The w:p element
 * @param author - Author name
 * @param dateStr - Formatted date
 * @param state - Revision ID state
 * @param originalParagraphProperties - Explicit before-state snapshot. When
 * omitted, the live properties are snapshotted for inserted-paragraph callers.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.29
 * @see https://github.com/UseJunior/safe-docx/issues/679
 */
export function addParagraphPropertyChange(
  paragraph: Element,
  author: string,
  dateStr: string,
  state: RevisionIdState,
  originalParagraphProperties?: Element | null,
): void {
  let pPr = findChildByTagName(paragraph, 'w:pPr');
  if (!pPr) {
    pPr = createEl('w:pPr');
    paragraph.insertBefore(pPr, paragraph.firstChild);
  }
  // Idempotent — don't add a second pPrChange.
  if (findChildByTagName(pPr, 'w:pPrChange')) return;

  const id = allocateRevisionId(state);
  const pPrChange = createEl('w:pPrChange', {
    'w:id': String(id),
    'w:author': author,
    'w:date': dateStr,
  });

  // Clone the explicit original pPr when provided; legacy callers that mark
  // inserted paragraphs snapshot the live pPr.
  // pPrChange child pPr must be CT_PPrBase — exclude rPr, rPrChange, sectPr, pPrChange.
  const EXCLUDED = new Set(['w:rPr', 'w:rPrChange', 'w:pPrChange', 'w:sectPr']);
  const oldPPr = createEl('w:pPr');
  const snapshotSource =
    originalParagraphProperties === undefined ? pPr : originalParagraphProperties;
  if (snapshotSource) {
    for (const child of childElements(snapshotSource)) {
      if (!EXCLUDED.has(child.tagName)) oldPPr.appendChild(child.cloneNode(true) as Element);
    }
  }
  pPrChange.appendChild(oldPPr);
  pPr.appendChild(pPrChange); // pPrChange goes last in pPr per schema
}

/**
 * Tag names that represent visible content inside a w:r element.
 * A run containing at least one of these is considered substantive (non-empty).
 */
export const RUN_VISIBLE_CONTENT_TAGS: ReadonlySet<string> = new Set([
  'w:t', 'w:tab', 'w:br', 'w:cr', 'w:drawing', 'w:object', 'w:pict',
  'w:sym', 'w:fldChar', 'w:instrText',
]);

/**
 * Returns true if a w:r element contains at least one visible content child.
 * Empty runs (containing only w:rPr or nothing) return false.
 */
export function runHasVisibleContent(run: Element): boolean {
  for (let i = 0; i < run.childNodes.length; i++) {
    const child = run.childNodes[i]!;
    if (child.nodeType === 1 && RUN_VISIBLE_CONTENT_TAGS.has((child as Element).tagName)) {
      return true;
    }
  }
  return false;
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
  paragraph: Element,
  author: string,
  dateStr: string,
  state: RevisionIdState
): boolean {
  // Mark the paragraph MARK as inserted (<w:pPr><w:rPr><w:ins/>). For a genuinely
  // inserted paragraph the paragraph break itself is a tracked insertion, so this
  // marker is what makes Reject All remove the whole paragraph (mark + content) and
  // Accept All keep it. The individual runs are wrapped in <w:ins> separately; this
  // function only adds the paragraph-mark marker.
  //
  // We ALWAYS emit the marker, including for non-empty paragraphs. A prior heuristic
  // omitted it when the paragraph had substantive run content, on the (uncited) belief
  // that Google Docs hides w:ins-wrapped runs that coexist with a PPR-INS marker. That
  // is false — Google Docs renders the inserted runs identically with or without
  // PPR-INS, and rejecting WITH the marker is cleaner there (it leaves no empty
  // paragraph). Omitting the marker forced Reject All to guess via a content-based
  // "all content is inside w:ins" heuristic that over-deleted foreign paragraphs whose
  // mark is untracked (i.e. text inserted into a pre-existing paragraph, which Word and
  // LibreOffice keep as an empty paragraph on reject). Reject is now purely mark-based
  // (see rejectAllChanges / rejectChanges), which requires this marker to be present.
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
  paragraph: Element,
  author: string,
  dateStr: string,
  state: RevisionIdState
): boolean {
  // See wrapParagraphAsInserted: represent paragraph deletion via a paragraph-mark
  // revision marker in w:pPr/w:rPr so Accept/Reject All behaves correctly.
  addParagraphMarkRevisionMarker(paragraph, 'w:del', author, dateStr, state);
  return true;
}
