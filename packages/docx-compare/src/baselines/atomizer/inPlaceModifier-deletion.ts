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
  emitTrailingSourceBookmarkClones,
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
 * routes to `insertWholeDeletedField`, which wraps the entire field in a
 * single `<w:del>` and returns it. Callers use the return value purely as the
 * next insertion anchor.
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

  // A collapsed-field atom deletes as ONE unit: the whole field, begin through
  // end, inside a single <w:del>. See insertWholeDeletedField for why the
  // previous fragmenting shape (issue #217) was wrong.
  if (isCollapsedFieldAtom(deletedAtom)) {
    return insertWholeDeletedField(
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

  // Re-emit source markers on the side of the run they came from, so a range
  // that closed after this run's content still closes there (issue #643).
  const sourceMarkers = cloneUnemittedSourceBookmarkMarkers(sourceRun, targetParagraph, state, context);
  insertMarkersBeforeWrapper(del, sourceMarkers.before);
  emitTrailingSourceBookmarkClones(sourceRun, del, sourceMarkers.after, state);

  return del;
}

/**
 * Emit a deleted complex field as a single unit: one `<w:del>` spanning the
 * whole field, begin through end, with `w:t` renamed to `w:delText` and
 * `w:instrText` to `w:delInstrText`.
 *
 * This replaces an earlier fragmenting shape that kept `w:fldChar` runs at
 * sibling level outside the `<w:del>` (issue #217). That shape left a field
 * husk -- begin/separate/end intact, instruction deleted -- which renderers
 * display as nothing, so the deletion was invisible to readers while the
 * inserted replacement showed normally.
 *
 * The rule it enforced does not exist. The Transitional WML schema reaches
 * `w:fldChar` from `w:del` (CT_RunTrackChange -> EG_ContentRunContent -> w:r ->
 * EG_RunInnerContent), and both Microsoft Word 16.112 and Aspose.Words 25.10
 * emit whole fields inside `w:del` on the same input -- output that validates
 * against the Transitional schema. #217's claim that Word "treats violations as
 * fatal" was sourced from a research summary, not the standard, and is false.
 *
 * Returns the last sibling element inserted, which the caller uses as the
 * next insertion anchor (preserving the contract of `insertDeletedRun`).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.13
 *
 * Rule (the part that IS in Part 1): `w:delInstrText` must appear inside
 * `<w:del>`. Nothing in Part 1 bars `w:fldChar` from appearing there too.
 */
export function insertWholeDeletedField(
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

  // One <w:del> spanning the whole field, begin through end.
  const id = allocateRevisionId(state);
  const del = createEl('w:del', {
    'w:id': String(id),
    'w:author': author,
    'w:date': dateStr,
  });

  for (const fieldAtom of fieldAtoms) {
    // Each constituent field atom produces its own cloned run carrying exactly
    // one content element (fldChar / instrText / t), so a mixed-run field --
    // where several field elements share a single `<w:r>` in the source -- is
    // reassembled run-by-run rather than as one undifferentiated blob.
    const baseRun =
      fieldAtom.sourceRunElement ?? findAncestorByTag(fieldAtom, 'w:r') ?? sourceRun;
    if (!baseRun) continue;

    const clonedRun = cloneRunWithAtomContent(baseRun, fieldAtom);
    // fldChar runs carry no text; everything else renames w:t -> w:delText and
    // w:instrText -> w:delInstrText.
    if (fieldAtom.contentElement.tagName !== 'w:fldChar') {
      convertToDelText(clonedRun);
    }
    del.appendChild(clonedRun);
  }

  if (del.firstChild) place(del);

  if (firstInserted && lastInserted) {
    const sourceMarkers = cloneUnemittedSourceBookmarkMarkers(sourceRun, targetParagraph, state, context);
    insertMarkersBeforeWrapper(firstInserted, sourceMarkers.before);
    emitTrailingSourceBookmarkClones(sourceRun, lastInserted, sourceMarkers.after, state);
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
  state.generatedMoveRangeMarkers.add(rangeStart);
  state.generatedMoveRangeMarkers.add(rangeEnd);

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
  insertMarkersBeforeWrapper(moveFrom, sourceMarkers.before);
  emitTrailingSourceBookmarkClones(sourceRun, rangeEnd, sourceMarkers.after, state);

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
