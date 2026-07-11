/**
 * In-Place AST Modifier
 *
 * Modifies the revised document's AST in-place to add track changes markup.
 * This replaces the reconstruction-based approach with direct tree manipulation.
 */

import type { ComparisonUnitAtom } from '@usejunior/docx-core';
import { childElements, findChildByTagName, insertAfterElement, WML } from '@usejunior/docx-core';
import {
  allocateRevisionId,
  convertToDelText,
  createEl,
  findAncestorByTag,
  getMoveRangeIds,
  type RevisionIdState,
} from './inPlaceModifier-shared.js';
import {
  cloneUnemittedSourceBookmarkMarkers,
  insertMarkersBeforeWrapper,
  type BookmarkSurvivalContext,
} from './inPlaceModifier-bookmarks.js';
import { getAtomRuns, isCollapsedFieldAtom, wrapAsDeleted } from './inPlaceModifier-wrappers.js';

export function getInsertableAtomContentElements(
  atom: ComparisonUnitAtom,
  filterRun?: Element
): Element[] {
  if (atom.collapsedFieldAtoms && atom.collapsedFieldAtoms.length > 0) {
    if (filterRun) {
      return atom.collapsedFieldAtoms
        .filter((fieldAtom) => {
          const run = fieldAtom.sourceRunElement ?? findAncestorByTag(fieldAtom, 'w:r');
          return run === filterRun;
        })
        .map((fieldAtom) => fieldAtom.contentElement);
    }
    return atom.collapsedFieldAtoms.map((fieldAtom) => fieldAtom.contentElement);
  }
  return [atom.contentElement];
}

/**
 * Clone a source run and replace its non-rPr children with atom content.
 *
 * This keeps run-level formatting while allowing atom-level fragment insertion.
 *
 * @param filterRun - When provided, only include content elements belonging
 *   to this source run (for multi-run collapsed field replay).
 */
export function cloneRunWithAtomContent(
  sourceRun: Element,
  atom: ComparisonUnitAtom,
  filterRun?: Element
): Element {
  const clonedRun = sourceRun.cloneNode(true) as Element;

  const retainedChildren: Element[] = [];
  for (const child of childElements(clonedRun)) {
    if (child.tagName === 'w:rPr') {
      retainedChildren.push(child);
    }
  }

  // Remove all current children from clonedRun
  while (clonedRun.firstChild) clonedRun.removeChild(clonedRun.firstChild);

  // Re-append retained rPr children
  for (const child of retainedChildren) {
    clonedRun.appendChild(child);
  }

  for (const contentElement of getInsertableAtomContentElements(atom, filterRun)) {
    const fragment = contentElement.cloneNode(true) as Element;
    clonedRun.appendChild(fragment);
  }

  return clonedRun;
}

/**
 * Clone a deleted run from the original document and insert it into the revised document.
 *
 * For a single-content atom this wraps one cloned run in `<w:del>` and returns
 * the `<w:del>` element. For a collapsed-field atom (issue #217), control
 * routes to `insertFragmentedDeletedField` which emits multiple sibling
 * elements — `w:fldChar` runs at sibling level (unwrapped) and individual
 * `<w:del>` wrappers around each payload run — and returns the LAST inserted
 * sibling (which may be a `<w:r>` carrying the end fldChar, not a `<w:del>`).
 * Callers use the return value purely as the next insertion anchor.
 *
 * @param deletedAtom - Atom with the deleted content
 * @param insertAfterRun - The run to insert after (null to insert at beginning of paragraph)
 * @param targetParagraph - The paragraph to insert into
 * @param author - Author name
 * @param dateStr - Formatted date
 * @param state - Revision ID state
 * @returns The last inserted sibling element (a `<w:del>` for non-collapsed-field
 *   atoms; possibly a `<w:r>` for fragmented collapsed-field atoms), or null
 *   if insertion failed.
 */
export function insertDeletedRun(
  deletedAtom: ComparisonUnitAtom,
  insertAfterRun: Element | null,
  targetParagraph: Element,
  author: string,
  dateStr: string,
  state: RevisionIdState,
  context?: BookmarkSurvivalContext
): Element | null {
  // Get the source run element from the deleted atom
  const sourceRun = deletedAtom.sourceRunElement;
  if (!sourceRun) {
    return null;
  }

  const runs = getAtomRuns(deletedAtom);

  // ECMA-376 Part 4 fragmentation (issue #217): for a collapsed-field atom,
  // emit w:fldChar runs at sibling level (unwrapped) and wrap only the
  // payload runs (w:instrText, w:t, etc.) in <w:del>. w:fldChar inside
  // <w:del> is non-conformant and Word treats it as fatal. Iterates the
  // constituent collapsedFieldAtoms (not the deduped source runs) so a
  // mixed-run field — where multiple field elements share one source `<w:r>` —
  // is correctly split into one cloned run per field element.
  if (isCollapsedFieldAtom(deletedAtom)) {
    return insertFragmentedDeletedField(
      deletedAtom,
      sourceRun,
      insertAfterRun,
      targetParagraph,
      author,
      dateStr,
      state,
      context,
    );
  }
  // Avoid an unused variable when the collapsed-field branch above is not taken.
  void runs;

  // Single-run path: wrap the cloned run in one <w:del>.
  const id = allocateRevisionId(state);
  const del = createEl('w:del', {
    'w:id': String(id),
    'w:author': author,
    'w:date': dateStr,
  });
  const clonedRun = cloneRunWithAtomContent(sourceRun, deletedAtom);
  convertToDelText(clonedRun);
  del.appendChild(clonedRun);

  // Insert at correct position
  if (insertAfterRun) {
    insertAfterElement(insertAfterRun, del);
  } else {
    // Insert at the beginning of the paragraph (after pPr if present)
    const pPr = findChildByTagName(targetParagraph, 'w:pPr');
    if (pPr) {
      insertAfterElement(pPr, del);
    } else {
      targetParagraph.insertBefore(del, targetParagraph.firstChild);
    }
  }

  const sourceMarkers = cloneUnemittedSourceBookmarkMarkers(sourceRun, targetParagraph, state, context);
  if (sourceMarkers.length > 0) insertMarkersBeforeWrapper(del, sourceMarkers);

  return del;
}

/**
 * Emit a fragmented deletion of a collapsed-field atom: walks the constituent
 * source runs in document order, cloning each into the target paragraph as
 * either a sibling-level unwrapped run (for `w:fldChar`) or a `<w:del>`-wrapped
 * run (for payload runs whose text is renamed to `w:delText` / `w:delInstrText`).
 *
 * Returns the last sibling element inserted, which the caller uses as the
 * next insertion anchor (preserving the contract of `insertDeletedRun`).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.13
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 *
 * Rule: `w:delInstrText` MUST appear inside `<w:del>`;
 * the Part 1 complex-field syntax keeps `w:fldChar` runs at sibling level.
 */
export function insertFragmentedDeletedField(
  deletedAtom: ComparisonUnitAtom,
  sourceRun: Element,
  insertAfterRun: Element | null,
  targetParagraph: Element,
  author: string,
  dateStr: string,
  state: RevisionIdState,
  context?: BookmarkSurvivalContext,
): Element | null {
  const fieldAtoms = deletedAtom.collapsedFieldAtoms;
  if (!fieldAtoms || fieldAtoms.length === 0) return null;

  let anchor: Element | null = insertAfterRun;
  let firstInserted: Element | null = null;
  let lastInserted: Element | null = null;
  const pPr = findChildByTagName(targetParagraph, 'w:pPr');

  const place = (el: Element): void => {
    if (anchor) {
      insertAfterElement(anchor, el);
    } else if (pPr) {
      insertAfterElement(pPr, el);
    } else {
      targetParagraph.insertBefore(el, targetParagraph.firstChild);
    }
    if (firstInserted === null) firstInserted = el;
    lastInserted = el;
    anchor = el;
  };

  for (const fieldAtom of fieldAtoms) {
    // Each constituent field atom produces its own cloned run carrying exactly
    // one content element (fldChar / instrText / t). This is critical for
    // mixed-run fields where multiple field elements share a single `<w:r>` in
    // the source — we MUST emit them as separate runs so we can fragment
    // fldChars out of the `<w:del>` wrapper.
    const baseRun =
      fieldAtom.sourceRunElement ?? findAncestorByTag(fieldAtom, 'w:r') ?? sourceRun;
    if (!baseRun) continue;

    const clonedRun = cloneRunWithAtomContent(baseRun, fieldAtom);
    const contentTag = fieldAtom.contentElement.tagName;

    if (contentTag === 'w:fldChar') {
      // Sibling level — unwrapped.
      place(clonedRun);
      continue;
    }

    // Payload — wrap in <w:del> and rename w:t→w:delText / w:instrText→w:delInstrText.
    convertToDelText(clonedRun);
    const id = allocateRevisionId(state);
    const del = createEl('w:del', {
      'w:id': String(id),
      'w:author': author,
      'w:date': dateStr,
    });
    del.appendChild(clonedRun);
    place(del);
  }

  if (firstInserted) {
    const sourceMarkers = cloneUnemittedSourceBookmarkMarkers(sourceRun, targetParagraph, state, context);
    if (sourceMarkers.length > 0) insertMarkersBeforeWrapper(firstInserted, sourceMarkers);
  }

  return lastInserted;
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
  insertAfterRun: Element | null,
  targetParagraph: Element,
  author: string,
  dateStr: string,
  state: RevisionIdState,
  context?: BookmarkSurvivalContext
): Element | null {
  // Get the source run element from the atom (in original tree)
  const sourceRun = atom.sourceRunElement;
  if (!sourceRun) {
    return null;
  }

  // For collapsed field atoms, replay one cloned run per original source run.
  const runs = getAtomRuns(atom);
  const clonedRuns: Element[] = [];
  if (runs.length > 1) {
    for (const run of runs) {
      const clonedRun = cloneRunWithAtomContent(run, atom, run);
      convertToDelText(clonedRun);
      clonedRuns.push(clonedRun);
    }
  } else {
    const clonedRun = cloneRunWithAtomContent(sourceRun, atom);
    convertToDelText(clonedRun);
    clonedRuns.push(clonedRun);
  }

  // Get or allocate move range IDs
  const ids = getMoveRangeIds(state, moveName);
  const moveId = allocateRevisionId(state);

  // Create range start marker
  const rangeStart = createEl('w:moveFromRangeStart', {
    'w:id': String(ids.sourceRangeId),
    'w:name': moveName,
    'w:author': author,
    'w:date': dateStr,
  });

  // Create moveFrom wrapper
  const moveFrom = createEl('w:moveFrom', {
    'w:id': String(moveId),
    'w:author': author,
    'w:date': dateStr,
  });

  // Create range end marker
  const rangeEnd = createEl('w:moveFromRangeEnd', {
    'w:id': String(ids.sourceRangeId),
  });

  // Add cloned run(s) as children of moveFrom
  for (const clonedRun of clonedRuns) {
    moveFrom.appendChild(clonedRun);
  }

  // Insert at correct position: rangeStart -> moveFrom(run) -> rangeEnd
  if (insertAfterRun) {
    insertAfterElement(insertAfterRun, rangeStart);
    insertAfterElement(rangeStart, moveFrom);
    insertAfterElement(moveFrom, rangeEnd);
  } else {
    // Insert at the beginning of the paragraph (after pPr if present)
    const pPr = findChildByTagName(targetParagraph, 'w:pPr');
    if (pPr) {
      insertAfterElement(pPr, rangeStart);
      insertAfterElement(rangeStart, moveFrom);
      insertAfterElement(moveFrom, rangeEnd);
    } else {
      targetParagraph.insertBefore(rangeEnd, targetParagraph.firstChild);
      targetParagraph.insertBefore(moveFrom, rangeEnd);
      targetParagraph.insertBefore(rangeStart, moveFrom);
    }
  }

  const sourceMarkers = cloneUnemittedSourceBookmarkMarkers(sourceRun, targetParagraph, state, context);
  if (sourceMarkers.length > 0) insertMarkersBeforeWrapper(moveFrom, sourceMarkers);

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
  insertAfterParagraph: Element | null,
  targetContainer: Element,
  author: string,
  dateStr: string,
  state: RevisionIdState
): Element | null {
  // Get the source paragraph from the deleted atom
  const sourceParagraph = deletedAtom.sourceParagraphElement;
  if (!sourceParagraph) {
    return null;
  }

  // Clone the paragraph
  const clonedParagraph = sourceParagraph.cloneNode(true) as Element;

  // Wrap runs with w:del (wrapAsDeleted handles w:t -> w:delText conversion internally)
  const runs = Array.from(clonedParagraph.getElementsByTagName('w:r')) as Element[];
  for (const run of runs) {
    wrapAsDeleted(run, author, dateStr, state);
  }

  // Insert at correct position, preserving w:tcPr as first child when target is a table cell
  if (insertAfterParagraph) {
    insertAfterElement(insertAfterParagraph, clonedParagraph);
  } else {
    const tcPr = targetContainer.tagName === 'w:tc'
      ? findChildByTagName(targetContainer, 'w:tcPr')
      : null;
    if (tcPr) {
      insertAfterElement(tcPr, clonedParagraph);
    } else {
      targetContainer.insertBefore(clonedParagraph, targetContainer.firstChild);
    }
  }

  return clonedParagraph;
}

/**
 * Field-code marker and payload elements that require field-aware splitting.
 * The semantic subset is maintained here; its raw QNames are schema-generated.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.13
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @ooxmlSpec ooxml.ecma376.5ed.part1.fields.deleted-field-code
 */
export const FIELD_CHAR_TAG_NAMES: ReadonlySet<string> = new Set([
  WML.FLD_CHAR.qname,
  WML.INSTR_TEXT.qname,
  WML.DEL_INSTR_TEXT.qname,
]);
