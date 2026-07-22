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

import type { ComparisonUnitAtom } from '@usejunior/docx-core';
import { CorrelationStatus } from '@usejunior/docx-core';
import { childElements, findChildByTagName, insertAfterElement } from '@usejunior/docx-core';
import { enforceConsumerCompatibility } from './consumerCompatibility.js';
import { XMLSerializer } from '@xmldom/xmldom';
import { findChild } from '@usejunior/docx-core';
import { warn } from './debug.js';
import {
  attachSourceElementPointers,
  createEl,
  createRevisionIdState,
  allocateRevisionId,
  formatDate,
  paragraphHasParaInsMarker,
  type RevisionIdState,
} from './inPlaceModifier-shared.js';
import {
  ContainerResolutionError,
  findTargetContainerForAtom,
  isEntireParagraphAtomsWithStatus,
} from './inPlaceModifier-containers.js';
import {
  cloneParagraphBoundaryBookmarkMarkers,
  filterEquivalentBookmarkMarkers,
  insertLeadingMarkers,
  type BookmarkSurvivalContext,
} from './inPlaceModifier-bookmarks.js';
import {
  addFormatChange,
  getAtomRunAtBoundary,
  getAtomRuns,
  getOriginalInsProvenance,
  getRunInsertionAnchor,
  isCollapsedFieldAtom,
  wrapAsInserted,
  wrapAsMoveTo,
  wrapParagraphAsDeleted,
  wrapParagraphAsInserted,
  wrapRunWithTrackChange,
  wrapWithOriginalInsProvenance,
} from './inPlaceModifier-wrappers.js';
import { insertDeletedParagraph, insertDeletedRun, insertMoveFromRun } from './inPlaceModifier-deletion.js';
import {
  preSplitInsProvenanceRuns,
  preSplitInterleavedWordRuns,
  preSplitMixedStatusRuns,
} from './inPlaceModifier-presplit.js';
import {
  coalesceDelInsPairChains,
  coalesceMoveRangeMarkers,
  groupDeletionsBeforeInsertions,
  mergeAdjacentTrackChangeSiblings,
  mergeWhitespaceBridgedTrackChanges,
  suppressNoOpChangePairs,
} from './inPlaceModifier-postprocess.js';

export interface InPlaceModifierOptions {
  /** Author name for track changes */
  author: string;
  /** Timestamp for track changes */
  date: Date;
}

export function modifyRevisedDocument(
  revisedRoot: Element,
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
  preSplitMixedStatusRuns(mergedAtoms);
  preSplitInterleavedWordRuns(mergedAtoms);
  preSplitInsProvenanceRuns(mergedAtoms);

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

  // Suppress field-adjacent no-op del/ins pairs (issue #42, Bug 1).
  // Must run BEFORE merge — after merge, pairwise comparison is impossible.
  suppressNoOpChangePairs(ctx.body);

  // Merge adjacent <w:ins>/<w:del> siblings to reduce revision fragmentation.
  mergeAdjacentTrackChangeSiblings(ctx.body);

  // Coalesce del/ins pair chains across whitespace (issue #42, Bug 2b).
  // Merges [del:A][ins:X][ws][del:B][ins:Y] → [del:A ws B][ins:X ws Y]
  coalesceDelInsPairChains(ctx.body);

  // Merge whitespace-bridged track change siblings (issue #42, Bug 2).
  // Runs AFTER coalesce — handles ins+ws+ins and moveTo+ws+moveTo bridging.
  mergeWhitespaceBridgedTrackChanges(ctx.body);

  // Coalesce duplicate move-range markers to one Start/End pair per move group
  // per paragraph (issue #446). The moveFrom clone path emits a range pair per
  // fragmented source atom; Word (and the rebuild path) emit exactly one.
  coalesceMoveRangeMarkers(ctx.body);

  // Apply strict post-render consumer compatibility pass
  enforceConsumerCompatibility(revisedRoot, () => allocateRevisionId(state));

  // Serialize the modified tree
  return new XMLSerializer().serializeToString(revisedRoot.ownerDocument || revisedRoot);
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
  body: Element;
  /**
   * Last processed run element - used as insertion point for deleted content.
   * When we encounter deleted content, we insert it AFTER this run.
   */
  lastProcessedRun: Element | null;
  /**
   * The most recent revised run element we've encountered.
   * Used to prevent moving the lastProcessedRun backwards when processing
   * multiple atoms from the same run (word-level splitting).
   */
  lastRevisedRunAnchor: Element | null;
  /**
   * Last processed paragraph - used to know which paragraph to insert content into.
   * Also used as insertion point for deleted paragraphs.
   */
  lastProcessedParagraph: Element | null;
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
  unifiedParaToElement: Map<number, Element>;
  /**
   * Reverse lookup: revised paragraph element -> unified paragraph index.
   */
  revisedParagraphToUnifiedIndex: Map<Element, number>;
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
  createdParagraphs: Map<number, Element>;
  /**
   * Last insertion anchor within each created paragraph.
   * This can be a run wrapper (w:del/w:moveFrom) or a leading bookmark marker.
   * Used as insertion point for subsequent inserted deleted/moved fragments.
   */
  createdParagraphLastRun: Map<number, Element>;
  /**
   * Trailing bookmark markers from source paragraphs that should be appended
   * after all inserted deleted/moved fragments have been placed.
   */
  createdParagraphTrailingBookmarks: Map<number, Element[]>;
  /**
   * Last processed paragraph per DOM container (w:tc or w:body).
   * Used by findTargetContainerForAtom to find the correct insertion
   * anchor when atoms jump between table cells.
   */
  lastParaByContainer: Map<Element, Element>;
}

/**
 * Result from an atom handler, indicating how to update position tracking.
 */
interface HandlerResult {
  /** New value for lastProcessedRun (null means no change) */
  newLastRun?: Element | null;
  /** New value for lastRevisedRunAnchor (null means no change) */
  newLastRevisedRunAnchor?: Element | null;
  /** New value for lastProcessedParagraph (null means no change) */
  newLastParagraph?: Element | null;
  /** New value for lastParagraphIndex */
  newLastParagraphIndex?: number;
}

/**
 * Handler function type for processing atoms by status.
 */
type AtomHandler = (atom: ComparisonUnitAtom, ctx: ProcessingContext) => HandlerResult;

/**
 * Restore the ORIGINAL input's inline `<w:ins>` provenance on a matched
 * revised run (issue #358).
 *
 * Content whose original lineage was pre-tracked as an insertion must stay
 * inside a `w:ins` in the combined output, otherwise reject-all keeps text
 * that reject(original) drops (INV-RT-001 violation). preSplitInsProvenanceRuns
 * has already isolated the provenance-bearing fragment, so wrapping the whole
 * run is exact. Runs already sitting inside a physical track-change wrapper
 * (the revised document's own pre-tracked markup) are left alone — re-wrapping
 * them would nest revision markup incorrectly.
 */
function restoreOriginalInsProvenanceOnRun(
  atom: ComparisonUnitAtom,
  run: Element,
  ctx: ProcessingContext
): void {
  const prov = getOriginalInsProvenance(atom);
  if (!prov) return;
  if (getRunInsertionAnchor(run) !== run) return;
  wrapRunWithTrackChange({
    run,
    tagName: 'w:ins',
    author: prov.author,
    dateStr: prov.date || ctx.dateStr,
    state: ctx.state,
  });
}

function isParagraphRemovedOnRejectInContext(paragraph: Element, ctx: ProcessingContext): boolean {
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
    // ECMA-376 Part 4 permits w:fldChar inside <w:ins> (only <w:del> bars it),
    // so an inserted complete field stays wrapped as a single <w:ins>. The
    // fragmentation work for issue #217 is scoped to the <w:del> side via
    // insertDeletedRun.
    for (const run of runs) {
      wrapAsInserted(run, ctx.author, ctx.dateStr, ctx.state);
    }
    const endRun = getAtomRunAtBoundary(atom, 'end') ?? runs[runs.length - 1]!;
    const insertionPoint = getRunInsertionAnchor(endRun);

    if (insertionPoint === ctx.lastRevisedRunAnchor) {
      return {
        newLastParagraph: atom.sourceParagraphElement ?? ctx.lastProcessedParagraph,
        newLastParagraphIndex: atom.paragraphIndex,
      };
    }

    return {
      newLastRun: insertionPoint,
      newLastRevisedRunAnchor: insertionPoint,
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
    // Container-aware insertion (issue #65)
    const emptyTarget = findTargetContainerForAtom(atom, ctx);
    if (!emptyTarget) {
      throw new ContainerResolutionError('Container topology mismatch for empty deleted paragraph');
    }
    const createdPara = insertDeletedParagraph(
      atom,
      emptyTarget.insertAfter,
      emptyTarget.container,
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
    let targetParagraph: Element | undefined;
    let insertAfterRun: Element | null = null;

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
          const newPara = createEl('w:p');
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
          const srcPPr = srcP ? findChildByTagName(srcP, 'w:pPr') : null;
          if (srcPPr) {
            const clonedPPr = srcPPr.cloneNode(true) as Element;
            newPara.appendChild(clonedPPr);
          }

          // Container-aware insertion (issue #65)
          const delTarget = findTargetContainerForAtom(atom, ctx);
          if (!delTarget) {
            throw new ContainerResolutionError('Container topology mismatch for deleted paragraph');
          }
          if (delTarget.insertAfter) {
            insertAfterElement(delTarget.insertAfter, newPara);
          } else {
            const propsEl = delTarget.container.tagName === 'w:tc'
              ? findChildByTagName(delTarget.container, 'w:tcPr')
              : null;
            if (propsEl) {
              insertAfterElement(propsEl, newPara);
            } else {
              delTarget.container.insertBefore(newPara, delTarget.container.firstChild);
            }
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
        (childElements(ctx.body).find(c => c.tagName === 'w:p') as Element | undefined);
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
      // Deleted content whose original lineage was inside a pre-tracked w:ins
      // nests as <w:ins original-author><w:del Comparison>…</w:del></w:ins>,
      // so reject-all drops it (with the w:ins) and accept-all resolves the
      // deletion — both matching the input projections (issue #358).
      // Collapsed-field atoms emit multiple siblings (some outside <w:del>)
      // and are left unnested; a pre-tracked inserted field is out of scope.
      const prov = !isCollapsedFieldAtom(atom) ? getOriginalInsProvenance(atom) : null;
      const anchor = prov ? wrapWithOriginalInsProvenance(del, prov, ctx.state) : del;
      // Track last run in created paragraphs
      if (unifiedPara !== undefined && ctx.createdParagraphs.has(unifiedPara)) {
        ctx.createdParagraphLastRun.set(unifiedPara, anchor);
      }
      return {
        newLastRun: anchor,
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
    let targetParagraph: Element | undefined;
    let insertAfterRun: Element | null = null;

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
          const newPara = createEl('w:p');
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
          const srcPPr = srcP ? findChildByTagName(srcP, 'w:pPr') : null;
          if (srcPPr) {
            const clonedPPr = srcPPr.cloneNode(true) as Element;
            newPara.appendChild(clonedPPr);
          }

          // Container-aware insertion (issue #65)
          const moveTarget = findTargetContainerForAtom(atom, ctx);
          if (!moveTarget) {
            throw new ContainerResolutionError('Container topology mismatch for moved-from paragraph');
          }
          if (moveTarget.insertAfter) {
            insertAfterElement(moveTarget.insertAfter, newPara);
          } else {
            const propsEl = moveTarget.container.tagName === 'w:tc'
              ? findChildByTagName(moveTarget.container, 'w:tcPr')
              : null;
            if (propsEl) {
              insertAfterElement(propsEl, newPara);
            } else {
              moveTarget.container.insertBefore(newPara, moveTarget.container.firstChild);
            }
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
        (childElements(ctx.body).find(c => c.tagName === 'w:p') as Element | undefined);
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
    // Move destinations behave like insertions; ECMA-376 does not bar w:fldChar
    // from <w:moveTo> (only <w:del> is explicitly forbidden). Keep the existing
    // single-wrapper behavior to avoid fragmenting a moved-in field.
    for (const run of runs) {
      wrapAsMoveTo(run, atom.moveName || 'move1', ctx.author, ctx.dateStr, ctx.state);
    }
    const endRun = getAtomRunAtBoundary(atom, 'end') ?? runs[runs.length - 1]!;
    const insertionPoint = getRunInsertionAnchor(endRun);

    if (insertionPoint === ctx.lastRevisedRunAnchor) {
      return {
        newLastParagraph: atom.sourceParagraphElement ?? ctx.lastProcessedParagraph,
        newLastParagraphIndex: atom.paragraphIndex,
      };
    }

    return {
      newLastRun: insertionPoint,
      newLastRevisedRunAnchor: insertionPoint,
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
    // Equal-text/changed-format content keeps its original-side w:ins lineage
    // too (issue #358); the w:rPrChange then lives inside the wrapper.
    restoreOriginalInsProvenanceOnRun(atom, run, ctx);
    const endRun = getAtomRunAtBoundary(atom, 'end') ?? run;
    const insertionPoint = getRunInsertionAnchor(endRun);

    if (insertionPoint === ctx.lastRevisedRunAnchor) {
      return {
        newLastParagraph: atom.sourceParagraphElement ?? ctx.lastProcessedParagraph,
        newLastParagraphIndex: atom.paragraphIndex,
      };
    }

    return {
      newLastRun: insertionPoint,
      newLastRevisedRunAnchor: insertionPoint,
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
    // Matched content whose original lineage was inside a pre-tracked w:ins
    // must keep that wrapper in the combined output (issue #358).
    restoreOriginalInsProvenanceOnRun(atom, run, ctx);
    const insertionPoint = getRunInsertionAnchor(run);

    // BUG FIX: Don't move the insertion point backwards if we are still in the same run.
    // This prevents Deleted atoms inserted between words of the same run from being reversed.
    if (insertionPoint === ctx.lastRevisedRunAnchor) {
      return {
        newLastParagraph: atom.sourceParagraphElement ?? ctx.lastProcessedParagraph,
        newLastParagraphIndex: atom.paragraphIndex,
      };
    }

    return {
      newLastRun: insertionPoint,
      newLastRevisedRunAnchor: insertionPoint,
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
      newLastRevisedRunAnchor: null,
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


function processAtoms(
  mergedAtoms: ComparisonUnitAtom[],
  _originalAtoms: ComparisonUnitAtom[],
  revisedAtoms: ComparisonUnitAtom[],
  author: string,
  dateStr: string,
  state: RevisionIdState,
  revisedRoot: Element
): ProcessingContext {
  const body = findChild(revisedRoot, 'w:body');
  if (!body) {
    warn('inPlaceModifier', 'Cannot process atoms: no w:body element found');
    // Return a minimal context to avoid callers having to handle undefined.
    return {
      author,
      dateStr,
      state,
      body: revisedRoot,
      lastProcessedRun: null,
      lastRevisedRunAnchor: null,
      lastProcessedParagraph: null,
      lastParagraphIndex: undefined,
      unifiedParaToElement: new Map(),
      revisedParagraphToUnifiedIndex: new Map(),
      fullyInsertedParagraphIndices: new Set(),
      createdParagraphs: new Map(),
      createdParagraphLastRun: new Map(),
      createdParagraphTrailingBookmarks: new Map(),
      lastParaByContainer: new Map(),
    };
  }

  // Build map from unified paragraph index to revised paragraph element.
  // This tells us which paragraphs exist in the revised document.
  // Revised atoms have their paragraphIndex already set to unified indices
  // after assignUnifiedParagraphIndices was called.
  const unifiedParaToElement = new Map<number, Element>();
  const revisedParagraphToUnifiedIndex = new Map<Element, number>();
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
    lastRevisedRunAnchor: null,
    lastProcessedParagraph: null,
    lastParagraphIndex: undefined,
    unifiedParaToElement,
    revisedParagraphToUnifiedIndex,
    fullyInsertedParagraphIndices,
    createdParagraphs: new Map(),
    createdParagraphLastRun: new Map(),
    createdParagraphTrailingBookmarks: new Map(),
    lastParaByContainer: new Map(),
  };

  // Reorder atoms so consecutive deletions precede consecutive insertions.
  // This produces grouped tracked changes (all <w:del> then all <w:ins>)
  // instead of alternating word-by-word del/ins pairs.
  const reorderedAtoms = groupDeletionsBeforeInsertions(mergedAtoms);

  for (const atom of reorderedAtoms) {
    const handler = ATOM_HANDLERS[atom.correlationStatus];
    const result = handler(atom, ctx);

    // Update position tracking based on handler result
    if (result.newLastRun !== undefined) {
      ctx.lastProcessedRun = result.newLastRun;
    }
    if (result.newLastRevisedRunAnchor !== undefined) {
      ctx.lastRevisedRunAnchor = result.newLastRevisedRunAnchor;
    }
    if (result.newLastParagraph !== undefined) {
      ctx.lastProcessedParagraph = result.newLastParagraph;
      // Track per-container anchor for container-aware insertion (issue #65)
      if (result.newLastParagraph) {
        const container = result.newLastParagraph.parentNode as Element | null;
        if (container) {
          ctx.lastParaByContainer.set(container, result.newLastParagraph);
        }
      }
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

    let anchor: Element | null = ctx.createdParagraphLastRun.get(paraIdx) ?? null;
    if (!anchor) {
      const pPr = findChildByTagName(paragraph, 'w:pPr');
      const kids = childElements(paragraph);
      const leadingBookmark = [...kids]
        .reverse()
        .find((c) => c.tagName === 'w:bookmarkStart') ?? null;
      anchor = leadingBookmark ?? pPr;
    }

    if (!anchor) {
      for (const marker of markers) {
        paragraph.appendChild(marker);
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

export {
  createRevisionIdState,
  type RevisionIdState,
} from './inPlaceModifier-shared.js';
export {
  ContainerResolutionError,
  getContainerPath,
  resolveContainerInRevised,
  validateContainerTopology,
} from './inPlaceModifier-containers.js';
export {
  addFormatChange,
  addParagraphPropertyChange,
  getOriginalInsProvenance,
  getOriginalInsProvenanceKey,
  runHasVisibleContent,
  wrapAsDeleted,
  wrapAsInserted,
  wrapAsMoveFrom,
  wrapAsMoveTo,
  wrapParagraphAsDeleted,
  wrapParagraphAsInserted,
  wrapWithOriginalInsProvenance,
  type InsProvenance,
} from './inPlaceModifier-wrappers.js';
export {
  insertDeletedParagraph,
  insertDeletedRun,
  insertMoveFromRun,
} from './inPlaceModifier-deletion.js';
export {
  preSplitInsProvenanceRuns,
  preSplitInterleavedWordRuns,
  preSplitMixedStatusRuns,
} from './inPlaceModifier-presplit.js';
export {
  coalesceDelInsPairChains,
  coalesceMoveRangeMarkers,
  groupDeletionsBeforeInsertions,
  isNoOpPair,
  mergeWhitespaceBridgedTrackChanges,
  suppressNoOpChangePairs,
} from './inPlaceModifier-postprocess.js';
