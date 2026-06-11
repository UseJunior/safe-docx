/**
 * Document Reconstructor
 *
 * Rebuilds document.xml from marked atoms with track changes.
 * Generates w:ins, w:del, w:moveFrom, w:moveTo elements as appropriate.
 */

import { XMLSerializer } from '@xmldom/xmldom';
import { parseXml } from '../../primitives/xml.js';
import type { ComparisonUnitAtom } from '../../core-types.js';
import { CorrelationStatus } from '../../core-types.js';
import { getLeafText, childElements, findChildByTagName } from '../../primitives/index.js';
import {
  type RevisionIdState,
  allocateRevisionId,
  buildPPrChangeElement,
  convertSerializedDeletionContent,
  createRevisionContext,
  createRevisionIdState,
  escapeXmlAttr,
  formatDate,
  wrapSerializedContentWithDel,
  wrapSerializedContentWithIns,
} from '../../primitives/track-changes-emitter.js';
import { serializeToXml, cloneElement } from './xmlToWmlElement.js';
import { EMPTY_PARAGRAPH_TAG, isParagraphLevelLeaf, nearestHyperlinkAncestor } from '../../atomizer.js';
import { enforceConsumerCompatibility } from './consumerCompatibility.js';
import { areRunPropertiesEqual } from '../../format-detection.js';
import { debug } from './debug.js';

const SYNTHETIC_DOC = parseXml('<root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>');
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function createEl(tag: string, attrs?: Record<string, string>): Element {
  const el = SYNTHETIC_DOC.createElementNS(W_NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/**
 * Options for document reconstruction.
 */
export interface ReconstructorOptions {
  /** Author name for track changes */
  author: string;
  /** Timestamp for track changes */
  date: Date;
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
 * Reconstruct document.xml from merged atoms with track changes.
 *
 * @param mergedAtoms - Atoms with correlation status set
 * @param originalXml - Original document.xml for structure preservation
 * @param options - Reconstruction options
 * @returns New document.xml with track changes
 */
export function reconstructDocument(
  mergedAtoms: ComparisonUnitAtom[],
  originalXml: string,
  options: ReconstructorOptions
): string {
  const { author, date } = options;
  const dateStr = formatDate(date);
  const revState = createRevisionIdState();

  // Group atoms by paragraph
  const rawParagraphGroups = groupAtomsByParagraph(mergedAtoms);

  // Consolidate adjacent same-status changes for better readability
  const paragraphGroups = consolidateAdjacentChanges(rawParagraphGroups);

  // Reset debug counters
  resetDebugCounters();
  resetEmptyParagraphCounters();

  debug('reconstructor', `${mergedAtoms.length} atoms -> ${paragraphGroups.length} paragraphs`);

  // Build track changes XML for each paragraph
  const paragraphXmls: string[] = [];

  for (const group of paragraphGroups) {
    const paragraphXml = buildParagraphXml(group, author, dateStr, revState);
    paragraphXmls.push(paragraphXml);
  }

  const counters = getDebugCounters();
  debug('reconstructor', `buildRunContent processed: ${counters.atoms} atoms, ${counters.wt} w:t elements`);

  const emptyCounters = getEmptyParagraphCounters();
  debug('reconstructor', `Empty paragraphs: inserted=${emptyCounters.inserted}, deleted=${emptyCounters.deleted}, equal=${emptyCounters.equal}, other=${emptyCounters.other}`);

  // Reconstruct the document, preserving original body structure (tables, SDTs, etc.)
  return buildDocumentPreservingStructure(
    originalXml,
    paragraphXmls,
    paragraphGroups,
    () => allocateRevisionId(revState)
  );
}

/**
 * Group of atoms belonging to the same paragraph.
 */
interface ParagraphGroup {
  /** Paragraph properties (w:pPr) if available */
  pPr: Element | null;
  /** Atoms in this paragraph, grouped by run and status */
  runGroups: RunGroup[];
}

/**
 * Group of atoms that should be in the same run.
 */
interface RunGroup {
  /** Correlation status for this group */
  status: CorrelationStatus;
  /** Atoms in this run group */
  atoms: ComparisonUnitAtom[];
  /** Run properties if available */
  rPr: Element | null;
  /** Move name if this is a moved group */
  moveName?: string;
}

/**
 * Group atoms by paragraph based on their ancestor chain.
 *
 * First sorts atoms by paragraphIndex to ensure all atoms belonging to the same
 * paragraph are contiguous, then groups them sequentially.
 */
function groupAtomsByParagraph(atoms: ComparisonUnitAtom[]): ParagraphGroup[] {
  const groups: ParagraphGroup[] = [];
  let currentGroup: ParagraphGroup | null = null;
  let currentRunGroup: RunGroup | null = null;

  const uniqueIndices = new Set(atoms.map(a => a.paragraphIndex));
  debug('reconstructor', `groupAtomsByParagraph: ${atoms.length} atoms, ${uniqueIndices.size} unique paragraphIndices`);

  // Sort atoms by paragraphIndex to ensure all atoms with the same index are contiguous.
  // Use stable sort to preserve relative order within the same paragraph (deleted before inserted).
  const sortedAtoms = [...atoms].sort((a, b) => {
    const aIdx = a.paragraphIndex ?? Number.MAX_SAFE_INTEGER;
    const bIdx = b.paragraphIndex ?? Number.MAX_SAFE_INTEGER;
    return aIdx - bIdx;
  });

  for (const atom of sortedAtoms) {
    // Find paragraph ancestor
    const pAncestor = findAncestorByTag(atom, 'w:p');
    const rAncestor = findAncestorByTag(atom, 'w:r');

    // Check if we need a new paragraph
    const pPr = pAncestor ? findChildByTag(pAncestor, 'w:pPr') : null;

    // Pass currentRunGroup and current atom to check if we should start a new paragraph
    // Uses paragraphIndex for comparison instead of object references
    if (!currentGroup || shouldStartNewParagraph(currentGroup, currentRunGroup, atom)) {
      if (currentRunGroup && currentGroup) {
        currentGroup.runGroups.push(currentRunGroup);
      }
      currentRunGroup = null;
      currentGroup = {
        pPr: pPr ? cloneElement(pPr) : null,
        runGroups: [],
      };
      groups.push(currentGroup);
    }

    // Check if we need a new run group
    // Use the first-class rPr field from the atom when available,
    // falling back to ancestor walk for atoms created before rPr was populated.
    const atomRPr = getEffectiveAtomRPr(atom);
    const rPr = atomRPr ?? (rAncestor ? findChildByTag(rAncestor, 'w:rPr') : null);

    if (!currentRunGroup || shouldStartNewRunGroup(currentRunGroup, atom)) {
      if (currentRunGroup) {
        currentGroup.runGroups.push(currentRunGroup);
      }
      currentRunGroup = {
        status: atom.correlationStatus,
        atoms: [atom],
        rPr: rPr ? cloneElement(rPr) : null,
        moveName: atom.moveName,
      };
    } else {
      currentRunGroup.atoms.push(atom);
    }
  }

  // Don't forget the last groups
  if (currentRunGroup && currentGroup) {
    currentGroup.runGroups.push(currentRunGroup);
  }

  return groups;
}

/**
 * Check if a RunGroup contains only whitespace.
 */
function isWhitespaceOnlyGroup(group: RunGroup): boolean {
  return group.atoms.every(atom => {
    const text = getLeafText(atom.contentElement) ?? '';
    return text.trim() === '';
  });
}

/**
 * Reorder atoms within change blocks.
 *
 * Identifies "change blocks" (contiguous regions with Del/Ins) and reorders
 * to put all deletions first, then all insertions.
 * Whitespace between changes is duplicated into both groups to preserve it
 * regardless of accept/reject.
 */
function reorderChangeBlocks(groups: ParagraphGroup[]): ParagraphGroup[] {
  for (const paraGroup of groups) {
    const runGroups = paraGroup.runGroups;
    const result: RunGroup[] = [];
    let i = 0;

    while (i < runGroups.length) {
      const current = runGroups[i]!;

      // Check if we're entering a change block
      const isChange = current.status === CorrelationStatus.Deleted ||
                       current.status === CorrelationStatus.Inserted;

      if (!isChange) {
        result.push(current);
        i++;
        continue;
      }

      // Collect the entire change block
      const deletions: ComparisonUnitAtom[] = [];
      const insertions: ComparisonUnitAtom[] = [];

      while (i < runGroups.length) {
        const group = runGroups[i]!;

        if (group.status === CorrelationStatus.Deleted) {
          deletions.push(...group.atoms);
          i++;
        } else if (group.status === CorrelationStatus.Inserted) {
          insertions.push(...group.atoms);
          i++;
        } else if (group.status === CorrelationStatus.Equal && isWhitespaceOnlyGroup(group)) {
          // Duplicate whitespace into both deletions and insertions
          // so it's preserved regardless of accept/reject
          for (const atom of group.atoms) {
            // Clone for deletions (mark as deleted)
            const delAtom: ComparisonUnitAtom = {
              ...atom,
              correlationStatus: CorrelationStatus.Deleted,
            };
            deletions.push(delAtom);

            // Clone for insertions (mark as inserted)
            const insAtom: ComparisonUnitAtom = {
              ...atom,
              correlationStatus: CorrelationStatus.Inserted,
            };
            insertions.push(insAtom);
          }
          i++;
        } else {
          // Non-whitespace Equal or other status - end of block
          break;
        }
      }

      // Output reordered: all deletions first, then all insertions
      // rPr is set to null — buildRunContent will sub-group atoms by rPr
      if (deletions.length > 0) {
        result.push({
          status: CorrelationStatus.Deleted,
          atoms: deletions,
          rPr: null,
        });
      }
      if (insertions.length > 0) {
        result.push({
          status: CorrelationStatus.Inserted,
          atoms: insertions,
          rPr: null,
        });
      }
    }

    paraGroup.runGroups = result;
  }

  return groups;
}

/**
 * Consolidate adjacent RunGroups with the same status within each paragraph.
 *
 * This makes change tracking more readable by grouping consecutive deletions
 * together and consecutive insertions together, rather than interleaving them
 * at the word level.
 *
 * For example, instead of:
 *   <del>word1</del><ins>word2</ins> <del>word3</del><ins>word4</ins>
 *
 * We get:
 *   <del>word1 word3</del><ins>word2 word4</ins>
 */
function consolidateAdjacentChanges(groups: ParagraphGroup[]): ParagraphGroup[] {
  return reorderChangeBlocks(groups);
}

/**
 * Find an ancestor element by tag name.
 */
function findAncestorByTag(
  atom: ComparisonUnitAtom,
  tagName: string
): Element | null {
  for (let i = atom.ancestorElements.length - 1; i >= 0; i--) {
    if (atom.ancestorElements[i]!.tagName === tagName) {
      return atom.ancestorElements[i]!;
    }
  }
  return null;
}

/**
 * Find a child element by tag name.
 */
function findChildByTag(
  element: Element,
  tagName: string
): Element | null {
  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes[i]!;
    if (child.nodeType === 1 && (child as Element).tagName === tagName) {
      return child as Element;
    }
  }
  return null;
}

/**
 * Determine if we should start a new paragraph.
 *
 * Uses paragraphIndex for comparison instead of object references, because
 * atoms from original and revised documents have different tree objects.
 *
 * @param currentGroup - The current paragraph group being built
 * @param currentRunGroup - The current run group (may not be pushed to currentGroup yet)
 * @param currentAtom - The current atom being processed
 */
function shouldStartNewParagraph(
  currentGroup: ParagraphGroup,
  currentRunGroup: RunGroup | null,
  currentAtom: ComparisonUnitAtom
): boolean {
  const currentParagraphIndex = currentAtom.paragraphIndex;

  // If no paragraph index, fall back to false (stay in current paragraph)
  if (currentParagraphIndex === undefined) return false;

  // First check currentRunGroup (which may not be pushed to runGroups yet)
  if (currentRunGroup && currentRunGroup.atoms.length > 0) {
    const lastAtom = currentRunGroup.atoms[currentRunGroup.atoms.length - 1]!;
    const lastParagraphIndex = lastAtom.paragraphIndex;

    // Same paragraph index means same paragraph, even if from different trees
    if (lastParagraphIndex !== undefined) {
      return currentParagraphIndex !== lastParagraphIndex;
    }
  }

  // Fall back to checking runGroups
  if (currentGroup.runGroups.length === 0) {
    return false;
  }

  // Check last atom's paragraph index
  const lastRunGroup = currentGroup.runGroups[currentGroup.runGroups.length - 1];
  if (!lastRunGroup || lastRunGroup.atoms.length === 0) {
    return false;
  }

  const lastAtom = lastRunGroup.atoms[lastRunGroup.atoms.length - 1]!;
  const lastParagraphIndex = lastAtom.paragraphIndex;

  if (lastParagraphIndex !== undefined) {
    return currentParagraphIndex !== lastParagraphIndex;
  }

  // No paragraph indices available, stay in current paragraph
  return false;
}

/**
 * Get the effective rPr for an atom — uses the first-class `rPr` field
 * when available, otherwise returns null.
 */
function getEffectiveAtomRPr(atom: ComparisonUnitAtom): Element | null {
  return atom.rPr ?? null;
}

/**
 * Determine if we should start a new run group.
 */
function shouldStartNewRunGroup(
  currentGroup: RunGroup,
  atom: ComparisonUnitAtom
): boolean {
  // Different status = new group
  if (currentGroup.status !== atom.correlationStatus) {
    return true;
  }

  // Different move name = new group
  if (currentGroup.moveName !== atom.moveName) {
    return true;
  }

  // Skip rPr splitting for MovedSource/MovedDestination: every moved run
  // group is wrapped by wrapWithMoveFrom/wrapWithMoveTo, so splitting one
  // move into several groups would emit moveFromRangeStart/End (resp.
  // moveToRangeStart/End) once per slice with the same w:name and range ids.
  // This stays required now that explicit move-range markers atomize: the
  // synthetic-range suppression keyed off those markers is per paragraph, so
  // a detected move in a marker-free paragraph still synthesizes one range
  // pair per moved run group.
  if (currentGroup.status === CorrelationStatus.MovedSource ||
      currentGroup.status === CorrelationStatus.MovedDestination) {
    return false;
  }

  // Different rPr = new group (prevents formatting bleed between runs)
  const currentRPr = getEffectiveAtomRPr(
    currentGroup.atoms[currentGroup.atoms.length - 1]!
  );
  const newRPr = getEffectiveAtomRPr(atom);

  // Fast path: reference equality or both null
  if (currentRPr === newRPr) return false;
  if (currentRPr === null && newRPr === null) return false;

  return !areRunPropertiesEqual(currentRPr, newRPr);
}

/**
 * Check if a paragraph group represents an empty paragraph with a specific status.
 *
 * @param group - The paragraph group to check
 * @param status - The correlation status to check for
 * @returns True if all atoms are empty paragraph markers with the given status
 */
function isEmptyParagraphWithStatus(
  group: ParagraphGroup,
  status: CorrelationStatus
): boolean {
  // Check if all run groups contain only empty paragraph atoms with the given status
  for (const runGroup of group.runGroups) {
    // If any atom is not an empty paragraph marker, this is not an empty paragraph
    const hasNonEmptyAtom = runGroup.atoms.some(
      (atom) => atom.contentElement.tagName !== EMPTY_PARAGRAPH_TAG
    );
    if (hasNonEmptyAtom) {
      return false;
    }

    // If any atom doesn't have the expected status, return false
    const hasWrongStatus = runGroup.atoms.some(
      (atom) => atom.correlationStatus !== status
    );
    if (hasWrongStatus) {
      return false;
    }
  }

  // All atoms are empty paragraph markers with the expected status
  return group.runGroups.length > 0;
}

// Debug counters for empty paragraphs
let debugEmptyParaInserted = 0;
let debugEmptyParaDeleted = 0;
let debugEmptyParaEqual = 0;
let debugEmptyParaOther = 0;

/**
 * Reset empty paragraph debug counters.
 */
export function resetEmptyParagraphCounters(): void {
  debugEmptyParaInserted = 0;
  debugEmptyParaDeleted = 0;
  debugEmptyParaEqual = 0;
  debugEmptyParaOther = 0;
}

/**
 * Get empty paragraph debug counters.
 */
export function getEmptyParagraphCounters(): {
  inserted: number;
  deleted: number;
  equal: number;
  other: number;
} {
  return {
    inserted: debugEmptyParaInserted,
    deleted: debugEmptyParaDeleted,
    equal: debugEmptyParaEqual,
    other: debugEmptyParaOther,
  };
}

/**
 * Check if a paragraph group contains only empty paragraph atoms.
 */
function isEmptyParagraphGroup(group: ParagraphGroup): boolean {
  for (const runGroup of group.runGroups) {
    const hasNonEmptyAtom = runGroup.atoms.some(
      (atom) => atom.contentElement.tagName !== EMPTY_PARAGRAPH_TAG
    );
    if (hasNonEmptyAtom) {
      return false;
    }
  }
  return group.runGroups.length > 0;
}

/**
 * Which explicit move-range marker kinds a paragraph's atom stream already
 * carries. Computed once per paragraph and threaded into buildRunGroupXml so
 * wrapWithMoveFrom / wrapWithMoveTo suppress their synthetic
 * moveFromRangeStart/End (resp. moveToRangeStart/End) emission instead of
 * doubling the explicit markers that buildRunContentWithParagraphMarkers
 * re-emits from the atom stream.
 *
 * Granularity is the paragraph, keyed by marker kind. Explicit markers carry
 * their own w:name from the source document while detected moves get
 * synthetic names ("move1", ...), so pairing an explicit marker pair with a
 * specific moved run group is not possible. A paragraph that mixes an
 * explicit-marker move with a second, independently detected move of the same
 * kind keeps the explicit pair and loses the synthetic one.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/110
 */
interface ExplicitMoveMarkers {
  moveFrom: boolean;
  moveTo: boolean;
}

const NO_EXPLICIT_MOVE_MARKERS: ExplicitMoveMarkers = { moveFrom: false, moveTo: false };

function collectExplicitMoveMarkers(group: ParagraphGroup): ExplicitMoveMarkers {
  let moveFrom = false;
  let moveTo = false;
  for (const runGroup of group.runGroups) {
    for (const atom of runGroup.atoms) {
      const tag = atom.contentElement.tagName;
      if (tag === 'w:moveFromRangeStart' || tag === 'w:moveFromRangeEnd') {
        moveFrom = true;
      } else if (tag === 'w:moveToRangeStart' || tag === 'w:moveToRangeEnd') {
        moveTo = true;
      }
    }
  }
  return { moveFrom, moveTo };
}

/**
 * Build XML for a single paragraph with track changes.
 */
function buildParagraphXml(
  group: ParagraphGroup,
  author: string,
  dateStr: string,
  revState: RevisionIdState
): string {
  const revisionCtx = createRevisionContext({ author, date: dateStr, idState: revState });

  // Track empty paragraph statuses for debugging
  if (isEmptyParagraphGroup(group)) {
    const status = group.runGroups[0]?.atoms[0]?.correlationStatus;
    if (status === CorrelationStatus.Inserted) {
      debugEmptyParaInserted++;
    } else if (status === CorrelationStatus.Deleted) {
      debugEmptyParaDeleted++;
    } else if (status === CorrelationStatus.Equal) {
      debugEmptyParaEqual++;
    } else {
      debugEmptyParaOther++;
    }

    // Debug: log the first few empty paragraphs for investigation
    const debugLimit = 5;
    const totalEmpty = debugEmptyParaInserted + debugEmptyParaDeleted + debugEmptyParaEqual + debugEmptyParaOther;
    if (totalEmpty <= debugLimit) {
      const atoms = group.runGroups.flatMap(rg => rg.atoms);
      const statuses = atoms.map(a => a.correlationStatus).join(', ');
      debug('reconstructor', `Empty paragraph #${totalEmpty}: status=${status}, atomCount=${atoms.length}, atomStatuses=[${statuses}]`);
    }
  }

  // Whole-paragraph insert/delete encoding must match Word/Aspose behavior.
  //
  // IMPORTANT: <w:ins> is not a container for <w:p> in WordprocessingML.
  // Aspose encodes a paragraph insertion like:
  //   <w:p>
  //     <w:pPr><w:rPr><w:ins .../></w:rPr></w:pPr>
  //     <w:ins ...><w:r>...</w:r></w:ins>
  //   </w:p>
  //
  // That structure both renders in Word and allows Reject All to remove the paragraph
  // entirely (instead of leaving behind a stub <w:p> break).
  if (isEntireParagraphWithStatus(group, CorrelationStatus.Inserted)) {
    const paraId = allocateRevisionId(revState);
    const insertedRunXml = paragraphHasHyperlinkAtoms(group)
      ? buildWholeParagraphRevisionContent(group, (runs) =>
          wrapSerializedContentWithIns(runs, revisionCtx))
      : wrapSerializedContentWithIns(
          group.runGroups.map((runGroup) => buildRunContentAsPlainRun(runGroup)).join(''),
          revisionCtx,
        );
    const pPrChangeEl = buildPPrChangeElement(group.pPr, revisionCtx);
    const parts: string[] = [];
    parts.push('<w:p>');
    parts.push(serializePPrWithParaRevisionMarker(
      group.pPr, 'w:ins', paraId, author, dateStr, pPrChangeEl
    ));
    parts.push(insertedRunXml);
    parts.push('</w:p>');
    return parts.join('');
  }

  if (isEntireParagraphWithStatus(group, CorrelationStatus.Deleted)) {
    const paraId = allocateRevisionId(revState);
    const parts: string[] = [];
    parts.push('<w:p>');
    parts.push(serializePPrWithParaRevisionMarker(
      group.pPr, 'w:del', paraId, author, dateStr
    ));
    parts.push(
      paragraphHasHyperlinkAtoms(group)
        ? buildWholeParagraphRevisionContent(group, (runs) =>
            wrapSerializedContentWithDel(runs, revisionCtx))
        : wrapSerializedContentWithDel(
            group.runGroups.map((runGroup) => buildRunContentAsPlainRun(runGroup)).join(''),
            revisionCtx,
          )
    );
    parts.push('</w:p>');
    return parts.join('');
  }

  // Empty inserted paragraphs — use paragraph-mark revision marker (same as whole-paragraph).
  // In OOXML, <w:ins> is NOT a valid container for <w:p>. The correct encoding places the
  // marker inside w:pPr > w:rPr.
  if (isEmptyParagraphWithStatus(group, CorrelationStatus.Inserted)) {
    const paraId = allocateRevisionId(revState);
    const pPrChangeEl = buildPPrChangeElement(group.pPr, revisionCtx);
    const pPrXml = serializePPrWithParaRevisionMarker(
      group.pPr, 'w:ins', paraId, author, dateStr, pPrChangeEl
    );
    return `<w:p>${pPrXml}</w:p>`;
  }

  // Empty deleted paragraphs — use paragraph-mark revision marker.
  if (isEmptyParagraphWithStatus(group, CorrelationStatus.Deleted)) {
    const paraId = allocateRevisionId(revState);
    const pPrXml = serializePPrWithParaRevisionMarker(
      group.pPr, 'w:del', paraId, author, dateStr
    );
    return `<w:p>${pPrXml}</w:p>`;
  }

  const parts: string[] = [];

  parts.push('<w:p>');

  // Add paragraph properties
  if (group.pPr) {
    parts.push(serializeToXml(group.pPr));
  }

  // Add run groups with track changes, restoring w:hyperlink wrappers when
  // the paragraph contains hyperlink atoms (issue #368). Hyperlink-free
  // paragraphs keep the legacy per-group emission byte-identical.
  const explicitMoveMarkers = collectExplicitMoveMarkers(group);
  if (paragraphHasHyperlinkAtoms(group)) {
    parts.push(buildRunGroupsWithHyperlinks(group.runGroups, author, dateStr, revState, explicitMoveMarkers));
  } else {
    for (const runGroup of group.runGroups) {
      const runXml = buildRunGroupXml(runGroup, author, dateStr, revState, explicitMoveMarkers);
      parts.push(runXml);
    }
  }

  parts.push('</w:p>');

  return parts.join('');
}

/**
 * Serialize paragraph properties with a paragraph-level revision marker (w:ins or w:del)
 * placed inside w:pPr > w:rPr, per OOXML spec.
 *
 * DOM-based implementation — replaces the former regex-based approach.
 */
function serializePPrWithParaRevisionMarker(
  pPr: Element | null,
  markerTag: 'w:ins' | 'w:del',
  id: number,
  author: string,
  dateStr: string,
  pPrChangeEl?: Element | null
): string {
  // Clone pPr or synthesize empty one.
  const effectivePPr = pPr ? cloneElement(pPr) : createEl('w:pPr');

  // Find or create w:rPr at schema-correct position.
  let rPr = findChildByTagName(effectivePPr, 'w:rPr');
  if (!rPr) {
    rPr = createEl('w:rPr');
    const sectPr = findChildByTagName(effectivePPr, 'w:sectPr');
    const existingPPrChange = findChildByTagName(effectivePPr, 'w:pPrChange');
    const insertBefore = sectPr ?? existingPPrChange ?? null;
    if (insertBefore) {
      effectivePPr.insertBefore(rPr, insertBefore);
    } else {
      effectivePPr.appendChild(rPr);
    }
  }

  // Insert revision marker at start of rPr.
  const marker = createEl(markerTag, {
    'w:id': String(id),
    'w:author': author,
    'w:date': dateStr,
  });
  rPr.insertBefore(marker, rPr.firstChild);

  // Append pPrChange at end if provided.
  if (pPrChangeEl) {
    effectivePPr.appendChild(pPrChangeEl);
  }

  return serializeToXml(effectivePPr);
}

/**
 * Returns true if every atom in the paragraph is of the specified status
 * (ignoring EMPTY_PARAGRAPH_TAG markers).
 */
function isEntireParagraphWithStatus(
  group: ParagraphGroup,
  status: CorrelationStatus
): boolean {
  let sawAnyContent = false;
  let sawTargetStatus = false;

  for (const runGroup of group.runGroups) {
    for (const atom of runGroup.atoms) {
      const el = atom.contentElement;
      if (el.tagName === EMPTY_PARAGRAPH_TAG) continue;

      sawAnyContent = true;

      // A whole-paragraph wrap should still apply even if there are "noise" atoms
      // (pure whitespace runs, tabs, breaks) marked Equal due to normalization or
      // LCS alignment. Those atoms would otherwise prevent wrapping and Word would
      // leave an empty <w:p> stub on Reject All.
      const isWhitespaceOnlyText =
        el.tagName === 'w:t' && ((getLeafText(el) ?? '').trim() === '');
      const isWhitespaceAtom =
        isWhitespaceOnlyText || el.tagName === 'w:tab' || el.tagName === 'w:br' || el.tagName === 'w:cr';

      if (atom.correlationStatus === status) {
        sawTargetStatus = true;
        continue;
      }

      if (isWhitespaceAtom) {
        continue; // ignore for whole-paragraph classification
      }

      return false;
    }
  }

  // If there's no content at all, let the empty-paragraph handlers deal with it.
  // Also require at least one atom with the target status so we don't wrap equal-only paragraphs.
  return sawAnyContent && sawTargetStatus;
}

/**
 * Build a <w:r> without track-change wrappers. Used when the whole paragraph is already
 * wrapped (paragraph-level <w:ins>/<w:del>).
 *
 * When group.rPr is null, sub-groups atoms by per-atom rPr to prevent formatting bleed.
 */
function buildRunContentAsPlainRun(group: RunGroup): string {
  const contentAtoms = group.atoms.filter(
    (atom) => atom.contentElement.tagName !== EMPTY_PARAGRAPH_TAG
  );
  if (contentAtoms.length === 0) return '';

  // Paragraph-level markers must sit outside <w:r>; route through the
  // marker-aware helper which buffers run atoms and flushes on each marker.
  if (groupHasParagraphLevelAtoms(group)) {
    return buildRunContentWithParagraphMarkers(group);
  }

  // If group has explicit rPr, emit a single run
  if (group.rPr !== null) {
    return buildSingleRun(group.atoms, group.rPr);
  }

  // No group-level rPr — sub-group by per-atom rPr
  const subGroups = subGroupByRPr(contentAtoms);
  return subGroups.map(sg => buildSingleRun(sg.atoms, sg.rPr)).join('');
}

/**
 * Build XML for a run group with appropriate track changes wrapper.
 *
 * `explicitMoveMarkers` reports whether the surrounding paragraph's atom
 * stream already carries explicit moveFromRange / moveToRange markers; moved
 * groups then skip synthetic range emission (see ExplicitMoveMarkers).
 */
function buildRunGroupXml(
  group: RunGroup,
  author: string,
  dateStr: string,
  revState: RevisionIdState,
  explicitMoveMarkers: ExplicitMoveMarkers = NO_EXPLICIT_MOVE_MARKERS
): string {
  const runContent = buildRunContent(group);

  // If run content is empty (e.g., only empty paragraph atoms), return empty string
  // This avoids generating empty track changes wrappers
  if (!runContent) {
    return '';
  }

  switch (group.status) {
    case CorrelationStatus.Equal:
    case CorrelationStatus.Unknown:
      return runContent;

    case CorrelationStatus.Inserted:
      return wrapWithIns(runContent, author, dateStr, revState);

    case CorrelationStatus.Deleted:
      return wrapWithDel(runContent, author, dateStr, revState);

    case CorrelationStatus.MovedSource:
      return wrapWithMoveFrom(
        runContent,
        author,
        dateStr,
        group.moveName || 'move1',
        revState,
        explicitMoveMarkers.moveFrom
      );

    case CorrelationStatus.MovedDestination:
      return wrapWithMoveTo(
        runContent,
        author,
        dateStr,
        group.moveName || 'move1',
        revState,
        explicitMoveMarkers.moveTo
      );

    case CorrelationStatus.FormatChanged:
      // For format changes, we include the run with rPrChange
      return buildFormatChangeRun(group, author, dateStr, revState);

    default:
      return runContent;
  }
}

// Debug counter for atoms processed
let debugAtomCounter = 0;
let debugWtCounter = 0;

/**
 * Reset debug counters (for testing).
 */
export function resetDebugCounters(): void {
  debugAtomCounter = 0;
  debugWtCounter = 0;
}

/**
 * Get debug counters (for testing).
 */
export function getDebugCounters(): { atoms: number; wt: number } {
  return { atoms: debugAtomCounter, wt: debugWtCounter };
}

/**
 * Sub-group atoms by contiguous rPr — atoms with the same effective rPr
 * stay in one sub-group, a change in rPr starts a new sub-group.
 */
function subGroupByRPr(atoms: ComparisonUnitAtom[]): { rPr: Element | null; atoms: ComparisonUnitAtom[] }[] {
  if (atoms.length === 0) return [];

  const result: { rPr: Element | null; atoms: ComparisonUnitAtom[] }[] = [];
  let currentRPr = getEffectiveAtomRPr(atoms[0]!);
  let currentAtoms: ComparisonUnitAtom[] = [atoms[0]!];

  for (let i = 1; i < atoms.length; i++) {
    const atomRPr = getEffectiveAtomRPr(atoms[i]!);

    // Fast path: reference equality or both null
    let same = currentRPr === atomRPr;
    if (!same && currentRPr === null && atomRPr === null) {
      same = true;
    }
    if (!same) {
      same = areRunPropertiesEqual(currentRPr, atomRPr);
    }

    if (same) {
      currentAtoms.push(atoms[i]!);
    } else {
      result.push({ rPr: currentRPr, atoms: currentAtoms });
      currentRPr = atomRPr;
      currentAtoms = [atoms[i]!];
    }
  }

  result.push({ rPr: currentRPr, atoms: currentAtoms });
  return result;
}

// =============================================================================
// Hyperlink Wrapper Re-emission
// =============================================================================

/**
 * A resolved hyperlink wrapper for a contiguous segment of atoms.
 *
 * `element` is the w:hyperlink whose attributes get re-emitted. `fromOriginal`
 * records whether that element comes from the original document tree — the
 * rebuild output package is cloned from the original archive, so only
 * original-tree `r:id` values are guaranteed to resolve against the shipped
 * relationships part.
 */
interface ResolvedHyperlink {
  element: Element;
  key: string;
  fromOriginal: boolean;
}

/**
 * Attribute fingerprint of a w:hyperlink element, used to recognize "the
 * same" hyperlink across the original and revised trees (equal/deleted atoms
 * reference the original tree's element, inserted atoms the revised tree's).
 */
function hyperlinkKey(el: Element): string {
  const parts: string[] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes.item(i)!;
    if (attr.name.startsWith('xmlns')) continue;
    parts.push(`${attr.name}=${attr.value}`);
  }
  return parts.sort().join('\u0000');
}

/**
 * Resolve the hyperlink wrapper an atom belongs to, preferring the
 * original-tree element so the re-emitted r:id resolves against the
 * original-based rebuild package: deleted atoms carry original ancestry
 * directly; equal atoms (revised tree) reach it via comparisonUnitAtomBefore.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.22
 * @see https://github.com/UseJunior/safe-docx/issues/368
 */
function resolveHyperlinkForAtom(atom: ComparisonUnitAtom): ResolvedHyperlink | null {
  const own = nearestHyperlinkAncestor(atom);
  if (!own) return null;
  if (atom.sourceDocument === 'original') {
    return { element: own, key: hyperlinkKey(own), fromOriginal: true };
  }
  const before = atom.comparisonUnitAtomBefore;
  const beforeHyperlink = before ? nearestHyperlinkAncestor(before) : null;
  // Attribute to the original wrapper only when both trees agree on the
  // hyperlink's attributes. When they differ (e.g. the revision retargeted
  // the link to a new r:id), emitting the original wrapper would pin the
  // still-equal link text to the STALE target in the accepted document —
  // worse than dropping the wrapper. Such atoms fall through to the
  // revised-only policy below instead.
  // TODO(#376): the faithful tracked representation of a retargeted link
  // is delete-old-link + insert-new-link (what Word emits), which needs the
  // hyperlink fingerprint in atom identity so the LCS stops matching text
  // across different link targets.
  if (beforeHyperlink && hyperlinkKey(beforeHyperlink) === hyperlinkKey(own)) {
    return { element: beforeHyperlink, key: hyperlinkKey(beforeHyperlink), fromOriginal: true };
  }
  // Revised-only attribution (purely inserted hyperlink). Emitting its r:id
  // would dangle against the original-based package, so the caller only
  // wraps when the hyperlink carries no relationship reference (anchor-only).
  return { element: own, key: hyperlinkKey(own), fromOriginal: false };
}

/**
 * Whether a resolved hyperlink is safe to re-emit. Original-attributed
 * wrappers always are; revised-only wrappers are safe only without an r:id
 * (internal anchor links), because the rebuild package ships the ORIGINAL
 * document.xml.rels and a revised-only r:id would be a dangling reference
 * (Word treats those as a corrupt package). Revised-only r:id hyperlinks
 * keep today's behavior — content emitted unwrapped.
 */
function isEmittableHyperlink(resolved: ResolvedHyperlink): boolean {
  return resolved.fromOriginal || resolved.element.getAttribute('r:id') === null;
}

/**
 * True when any atom in the paragraph sits inside a w:hyperlink. Gates the
 * hyperlink-aware emission paths so hyperlink-free paragraphs keep the
 * byte-identical legacy output.
 */
function paragraphHasHyperlinkAtoms(group: ParagraphGroup): boolean {
  return group.runGroups.some((rg) =>
    rg.atoms.some((atom) => nearestHyperlinkAncestor(atom) !== null)
  );
}

/**
 * A hyperlink-pure slice of a RunGroup: every atom resolves to the same
 * emittable hyperlink wrapper (or to none).
 */
interface HyperlinkSegment {
  group: RunGroup;
  hyperlink: ResolvedHyperlink | null;
}

/**
 * Split a RunGroup into contiguous hyperlink-pure sub-groups.
 *
 * Moved groups are returned whole: splitting them would emit
 * moveFromRangeStart/End once per slice, corrupting the move ranges. A move
 * spanning a hyperlink keeps today's unwrapped emission.
 */
function splitRunGroupByHyperlink(group: RunGroup): HyperlinkSegment[] {
  if (
    group.status === CorrelationStatus.MovedSource ||
    group.status === CorrelationStatus.MovedDestination
  ) {
    return [{ group, hyperlink: null }];
  }

  const segments: HyperlinkSegment[] = [];
  let current: HyperlinkSegment | null = null;

  for (const atom of group.atoms) {
    // Emit-ability is decided per merged bucket, not per atom: an inserted
    // atom inside an otherwise-original hyperlink folds into the adjacent
    // original-attributed bucket via the shared key.
    const resolved = resolveHyperlinkForAtom(atom);
    const key = resolved?.key ?? null;

    if (current && (current.hyperlink?.key ?? null) === key) {
      current.group.atoms.push(atom);
      // Prefer an original-attributed representative within the segment.
      if (resolved?.fromOriginal && current.hyperlink && !current.hyperlink.fromOriginal) {
        current.hyperlink = resolved;
      }
    } else {
      current = {
        group: { ...group, atoms: [atom] },
        hyperlink: resolved,
      };
      segments.push(current);
    }
  }

  return segments;
}

/**
 * Serialize the opening tag of a re-emitted w:hyperlink wrapper, copying the
 * source element's attributes verbatim (r:id, w:anchor, w:history, ...).
 */
function serializeHyperlinkOpenTag(el: Element): string {
  const attrs: string[] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes.item(i)!;
    if (attr.name.startsWith('xmlns')) continue;
    attrs.push(` ${attr.name}="${escapeXmlAttr(attr.value)}"`);
  }
  return `<w:hyperlink${attrs.join('')}>`;
}

/**
 * Merge adjacent segments that resolve to the same hyperlink fingerprint, so
 * an equal/deleted/inserted sequence inside one link shares one wrapper.
 */
function mergeAdjacentHyperlinkSegments(
  segments: HyperlinkSegment[]
): Array<{ hyperlink: ResolvedHyperlink | null; groups: RunGroup[] }> {
  const buckets: Array<{ hyperlink: ResolvedHyperlink | null; groups: RunGroup[] }> = [];
  for (const segment of segments) {
    const last = buckets[buckets.length - 1];
    if (last && (last.hyperlink?.key ?? null) === (segment.hyperlink?.key ?? null)) {
      last.groups.push(segment.group);
      if (segment.hyperlink?.fromOriginal && last.hyperlink && !last.hyperlink.fromOriginal) {
        last.hyperlink = segment.hyperlink;
      }
    } else {
      buckets.push({ hyperlink: segment.hyperlink, groups: [segment.group] });
    }
  }
  return buckets;
}

/**
 * Emit a paragraph's run groups with w:hyperlink wrappers restored around the
 * runs whose atoms came from inside a hyperlink. Track-change wrappers nest
 * INSIDE the hyperlink (`<w:hyperlink><w:ins>…`): CT_Hyperlink admits
 * EG_RunLevelElts (w:ins / w:del / range markers), while CT_RunTrackChange
 * does not admit w:hyperlink.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.22
 * @see https://github.com/UseJunior/safe-docx/issues/368
 */
function buildRunGroupsWithHyperlinks(
  runGroups: RunGroup[],
  author: string,
  dateStr: string,
  revState: RevisionIdState,
  explicitMoveMarkers: ExplicitMoveMarkers = NO_EXPLICIT_MOVE_MARKERS
): string {
  const buckets = mergeAdjacentHyperlinkSegments(
    runGroups.flatMap(splitRunGroupByHyperlink)
  );

  const parts: string[] = [];
  for (const bucket of buckets) {
    const content = bucket.groups
      .map((g) => buildRunGroupXml(g, author, dateStr, revState, explicitMoveMarkers))
      .join('');
    if (!content) continue;
    parts.push(
      bucket.hyperlink && isEmittableHyperlink(bucket.hyperlink)
        ? `${serializeHyperlinkOpenTag(bucket.hyperlink.element)}${content}</w:hyperlink>`
        : content
    );
  }
  return parts.join('');
}

/**
 * Whole-paragraph insert/delete emission with hyperlink wrappers restored.
 * Each bucket gets its own revision wrapper so the hyperlink can stay
 * OUTSIDE the w:ins / w:del (see buildRunGroupsWithHyperlinks).
 */
function buildWholeParagraphRevisionContent(
  group: ParagraphGroup,
  wrap: (content: string) => string
): string {
  const buckets = mergeAdjacentHyperlinkSegments(
    group.runGroups.flatMap(splitRunGroupByHyperlink)
  );

  const parts: string[] = [];
  for (const bucket of buckets) {
    const runs = bucket.groups.map((g) => buildRunContentAsPlainRun(g)).join('');
    if (!runs) continue;
    const wrapped = wrap(runs);
    parts.push(
      bucket.hyperlink && isEmittableHyperlink(bucket.hyperlink)
        ? `${serializeHyperlinkOpenTag(bucket.hyperlink.element)}${wrapped}</w:hyperlink>`
        : wrapped
    );
  }
  return parts.join('');
}

/**
 * Returns true when any atom in the group is a paragraph-level marker
 * (commentRange / bookmark / moveFromRange / moveToRange) that must be
 * emitted outside <w:r>.
 */
function groupHasParagraphLevelAtoms(group: RunGroup): boolean {
  for (const atom of group.atoms) {
    if (isParagraphLevelLeaf(atom.contentElement)) return true;
  }
  return false;
}

/**
 * Marker-aware emission for run groups containing paragraph-level atoms.
 *
 * Walks atoms left-to-right. Run-level atoms accumulate in a buffer; on
 * encountering a paragraph-level atom (or end of group) the buffer is flushed
 * via subGroupByRPr + buildSingleRun (one <w:r> per contiguous rPr) and the
 * marker is emitted as a bare element.
 *
 * group.rPr is intentionally ignored here — RunGroup.rPr is captured from the
 * first atom in groupAtomsByParagraph(), and for moved groups
 * shouldStartNewRunGroup() suppresses rPr-based splitting. Always re-deriving
 * rPr per atom prevents formatting bleed and bogus rPr inheritance from
 * illegally nested markers.
 */
function buildRunContentWithParagraphMarkers(group: RunGroup): string {
  const parts: string[] = [];
  let runBuffer: ComparisonUnitAtom[] = [];

  const flush = () => {
    if (runBuffer.length === 0) return;
    for (const sg of subGroupByRPr(runBuffer)) {
      const run = buildSingleRun(sg.atoms, sg.rPr);
      if (run) parts.push(run);
    }
    runBuffer = [];
  };

  for (const atom of group.atoms) {
    if (atom.contentElement.tagName === EMPTY_PARAGRAPH_TAG) continue;
    if (isParagraphLevelLeaf(atom.contentElement)) {
      flush();
      parts.push(serializeAtomElement(atom.contentElement));
    } else {
      runBuffer.push(atom);
    }
  }
  flush();
  return parts.join('');
}

/**
 * Build a single <w:r> element from a set of atoms with the given rPr.
 * Preserves pendingText coalescing, collapsedFieldAtoms expansion,
 * and debug counter increments.
 */
function buildSingleRun(atoms: ComparisonUnitAtom[], rPr: Element | null): string {
  const contentAtoms = atoms.filter(
    (atom) => atom.contentElement.tagName !== EMPTY_PARAGRAPH_TAG
  );
  if (contentAtoms.length === 0) return '';

  const parts: string[] = [];
  parts.push('<w:r>');
  if (rPr) parts.push(serializeToXml(rPr));

  let pendingText = '';
  const flushPendingText = () => {
    if (!pendingText) return;
    const escaped = escapeXmlText(pendingText);
    const needsPreserve =
      pendingText.startsWith(' ') ||
      pendingText.endsWith(' ') ||
      pendingText.includes('  ');
    parts.push(
      needsPreserve
        ? `<w:t xml:space="preserve">${escaped}</w:t>`
        : `<w:t>${escaped}</w:t>`
    );
    pendingText = '';
  };

  for (const atom of contentAtoms) {
    debugAtomCounter++;

    if (atom.collapsedFieldAtoms && atom.collapsedFieldAtoms.length > 0) {
      flushPendingText();
      for (const fieldAtom of atom.collapsedFieldAtoms) {
        parts.push(serializeAtomElement(fieldAtom.contentElement));
      }
      continue;
    }

    const el = atom.contentElement;
    if (el.tagName === 'w:t') {
      pendingText += getLeafText(el) ?? '';
      continue;
    }

    flushPendingText();
    parts.push(serializeAtomElement(el));
  }
  flushPendingText();

  parts.push('</w:r>');
  return parts.join('');
}

/**
 * Serialize an atom's content element to XML string.
 */
function serializeAtomElement(element: Element): string {
  if (element.tagName === 'w:t') {
    debugWtCounter++;
    // Text element - preserve xml:space if needed
    const text = escapeXmlText(getLeafText(element) ?? '');
    if (text.startsWith(' ') || text.endsWith(' ') || text.includes('  ')) {
      return `<w:t xml:space="preserve">${text}</w:t>`;
    } else {
      return `<w:t>${text}</w:t>`;
    }
  } else if (element.tagName === 'w:br') {
    return '<w:br/>';
  } else if (element.tagName === 'w:tab') {
    return '<w:tab/>';
  } else if (element.tagName === 'w:cr') {
    return '<w:cr/>';
  } else {
    // Other elements (including field chars, instrText) - serialize as-is
    return serializeToXml(element);
  }
}

/**
 * Build the content of a run from atoms.
 *
 * Returns empty string if all atoms are empty paragraph markers,
 * which ensures no empty <w:r> elements are generated.
 *
 * When group.rPr is non-null, emits a single <w:r> with that rPr.
 * When group.rPr is null (e.g., after reorderChangeBlocks merges atoms
 * from multiple original RunGroups), sub-groups atoms by their per-atom
 * rPr and emits one <w:r> per sub-group to prevent formatting bleed.
 */
function buildRunContent(group: RunGroup): string {
  // Check if this run group contains only empty paragraph atoms
  const contentAtoms = group.atoms.filter(
    (atom) => atom.contentElement.tagName !== EMPTY_PARAGRAPH_TAG
  );

  // If no content atoms, return empty string (don't generate empty run)
  if (contentAtoms.length === 0) {
    return '';
  }

  // Paragraph-level markers must sit outside <w:r>; route through the
  // marker-aware helper which buffers run atoms and flushes on each marker.
  if (groupHasParagraphLevelAtoms(group)) {
    return buildRunContentWithParagraphMarkers(group);
  }

  // If group has explicit rPr, emit a single run
  if (group.rPr !== null) {
    return buildSingleRun(group.atoms, group.rPr);
  }

  // No group-level rPr — sub-group by per-atom rPr
  const subGroups = subGroupByRPr(contentAtoms);
  return subGroups.map(sg => buildSingleRun(sg.atoms, sg.rPr)).join('');
}

/**
 * Wrap content with w:ins element.
 */
function wrapWithIns(
  content: string,
  author: string,
  dateStr: string,
  revState: RevisionIdState
): string {
  return wrapSerializedContentWithIns(
    content,
    createRevisionContext({ author, date: dateStr, idState: revState }),
  );
}

/**
 * Wrap content with w:del element.
 */
function wrapWithDel(
  content: string,
  author: string,
  dateStr: string,
  revState: RevisionIdState
): string {
  return wrapSerializedContentWithDel(
    content,
    createRevisionContext({ author, date: dateStr, idState: revState }),
  );
}

/**
 * Wrap content with w:moveFrom elements.
 *
 * When `suppressRangeMarkers` is true the paragraph's atom stream already
 * carries explicit w:moveFromRangeStart/End markers (re-emitted by
 * buildRunContentWithParagraphMarkers), so only the w:moveFrom wrapper is
 * synthesized — emitting a second range pair would corrupt the move ranges.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/110
 */
function wrapWithMoveFrom(
  content: string,
  author: string,
  dateStr: string,
  moveName: string,
  revState: RevisionIdState,
  suppressRangeMarkers = false
): string {
  if (suppressRangeMarkers) {
    const moveId = allocateRevisionId(revState);
    const delContent = convertSerializedDeletionContent(content);
    return `<w:moveFrom w:id="${moveId}" w:author="${escapeXmlAttr(author)}" w:date="${dateStr}">${delContent}</w:moveFrom>`;
  }

  const ids = getMoveRangeIds(revState, moveName);
  const moveId = allocateRevisionId(revState);

  const delContent = convertSerializedDeletionContent(content);

  return (
    `<w:moveFromRangeStart w:id="${ids.sourceRangeId}" w:name="${moveName}" w:author="${escapeXmlAttr(author)}" w:date="${dateStr}"/>` +
    `<w:moveFrom w:id="${moveId}" w:author="${escapeXmlAttr(author)}" w:date="${dateStr}">${delContent}</w:moveFrom>` +
    `<w:moveFromRangeEnd w:id="${ids.sourceRangeId}"/>`
  );
}

/**
 * Wrap content with w:moveTo elements.
 *
 * When `suppressRangeMarkers` is true the paragraph's atom stream already
 * carries explicit w:moveToRangeStart/End markers, so only the w:moveTo
 * wrapper is synthesized (see wrapWithMoveFrom).
 */
function wrapWithMoveTo(
  content: string,
  author: string,
  dateStr: string,
  moveName: string,
  revState: RevisionIdState,
  suppressRangeMarkers = false
): string {
  if (suppressRangeMarkers) {
    const moveId = allocateRevisionId(revState);
    return `<w:moveTo w:id="${moveId}" w:author="${escapeXmlAttr(author)}" w:date="${dateStr}">${content}</w:moveTo>`;
  }

  const ids = getMoveRangeIds(revState, moveName);
  const moveId = allocateRevisionId(revState);

  return (
    `<w:moveToRangeStart w:id="${ids.destRangeId}" w:name="${moveName}" w:author="${escapeXmlAttr(author)}" w:date="${dateStr}"/>` +
    `<w:moveTo w:id="${moveId}" w:author="${escapeXmlAttr(author)}" w:date="${dateStr}">${content}</w:moveTo>` +
    `<w:moveToRangeEnd w:id="${ids.destRangeId}"/>`
  );
}

/**
 * Build run with format change tracking (w:rPrChange).
 */
function buildFormatChangeRun(
  group: RunGroup,
  author: string,
  dateStr: string,
  revState: RevisionIdState
): string {
  const parts: string[] = [];

  parts.push('<w:r>');

  // Build rPr with rPrChange
  const effectiveRPr = group.rPr ?? group.atoms[0]?.rPr ?? null;
  if (effectiveRPr || group.atoms[0]?.formatChange) {
    parts.push('<w:rPr>');

    // Current properties
    if (effectiveRPr) {
      for (const child of childElements(effectiveRPr)) {
        if (child.tagName !== 'w:rPrChange') {
          parts.push(serializeToXml(child));
        }
      }
    }

    // Add rPrChange with old properties (wrapped in w:rPr per OOXML spec).
    // Kept as the original per-child serialization (NOT delegated to
    // buildRPrChangeElement) to preserve byte-identical output: xmldom emits
    // inline `xmlns:w="..."` declarations when serializing detached children,
    // and downstream consumers may pin on that exact serialized form. The
    // DOM-aware buildRPrChangeElement helper exists for new primitive code
    // paths (#136 onward).
    const formatChange = group.atoms[0]?.formatChange;
    if (formatChange?.oldRunProperties) {
      const id = allocateRevisionId(revState);
      parts.push(
        `<w:rPrChange w:id="${id}" w:author="${escapeXmlAttr(author)}" w:date="${dateStr}">`
      );
      parts.push('<w:rPr>');
      for (const child of childElements(formatChange.oldRunProperties)) {
        parts.push(serializeToXml(child));
      }
      parts.push('</w:rPr>');
      parts.push('</w:rPrChange>');
    }

    parts.push('</w:rPr>');
  }

  // Add atom content
  for (const atom of group.atoms) {
    const element = atom.contentElement;
    if (element.tagName === 'w:t') {
      const text = escapeXmlText(getLeafText(element) ?? '');
      if (text.startsWith(' ') || text.endsWith(' ') || text.includes('  ')) {
        parts.push(`<w:t xml:space="preserve">${text}</w:t>`);
      } else {
        parts.push(`<w:t>${text}</w:t>`);
      }
    } else {
      parts.push(serializeToXml(element));
    }
  }

  parts.push('</w:r>');

  return parts.join('');
}

// =============================================================================
// Structure-Preserving Document Building
// =============================================================================

/**
 * A paragraph slot in the original body — represents one <w:p> in document order.
 */
interface ParagraphSlot {
  /** Sequential index among all <w:p> in original body */
  index: number;
  /** The <w:p> DOM element in the original tree */
  element: Element;
  /** The immediate parent node (for replaceChild / insertBefore) */
  parent: Node;
}

/**
 * Parse the original document body into a structural map.
 *
 * Recursively finds ALL <w:p> elements in document order, regardless of
 * wrapper (tables, SDTs, customXml, nested tables, etc.). This matches
 * the atomizer's recursive tree walk in atomizer.ts.
 */
function parseOriginalBodyStructure(originalXml: string): {
  doc: Document;
  body: Element;
  slots: ParagraphSlot[];
} {
  const doc = parseXml(originalXml);
  const bodies = doc.getElementsByTagName('w:body');
  if (!bodies.length) {
    throw new Error('Could not find w:body in document');
  }
  const body = bodies[0]!;

  // getElementsByTagName returns ALL descendants in document order —
  // this naturally recurses through tables, SDTs, customXml, nested tables, etc.
  const paragraphs = body.getElementsByTagName('w:p');
  const slots: ParagraphSlot[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const el = paragraphs[i]!;
    slots.push({ index: i, element: el, parent: el.parentNode! });
  }

  return { doc, body, slots };
}

/**
 * Determine if a ParagraphGroup is "rooted" (maps to an original paragraph slot)
 * or "purely inserted" (new content with no original counterpart).
 *
 * A group is rooted if ANY run group has a status other than Inserted or
 * MovedDestination — i.e., it contains content from the original document.
 * This correctly handles Equal, Deleted, MovedSource, and FormatChanged.
 */
function isRootedGroup(group: ParagraphGroup): boolean {
  return group.runGroups.some(
    (rg) =>
      rg.status !== CorrelationStatus.Inserted &&
      rg.status !== CorrelationStatus.MovedDestination
  );
}

/**
 * Build the final document preserving original body structure.
 *
 * Instead of replacing <w:body> content with flat paragraphs, this uses the
 * original body DOM as a scaffold: rooted paragraphs replace their corresponding
 * <w:p> slots, inserted paragraphs are placed adjacent to their context, and
 * all structural wrappers (tables, SDTs, etc.) are preserved.
 */
function buildDocumentPreservingStructure(
  originalXml: string,
  paragraphXmls: string[],
  paragraphGroups: ParagraphGroup[],
  allocateRevisionId: () => number
): string {
  const { doc, body, slots } = parseOriginalBodyStructure(originalXml);

  let slotCursor = 0;
  let lastEmittedNode: Node | null = null;

  // Find body-level <w:sectPr> (must stay as last child of body)
  const bodyChildren = childElements(body);
  const finalSectPr = bodyChildren.length > 0 &&
    bodyChildren[bodyChildren.length - 1]!.tagName === 'w:sectPr'
    ? bodyChildren[bodyChildren.length - 1]!
    : null;

  for (let i = 0; i < paragraphGroups.length; i++) {
    const group = paragraphGroups[i]!;
    const paraXml = paragraphXmls[i]!;

    // Parse the reconstructed paragraph XML into a DOM node
    const fragDoc = parseXml(
      `<__wrap xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">${paraXml}</__wrap>`,
    );
    const newNode = doc.importNode(fragDoc.documentElement.firstChild!, true);

    if (isRootedGroup(group)) {
      // Replace the corresponding original <w:p> slot
      if (slotCursor < slots.length) {
        const slot = slots[slotCursor]!;
        slot.parent.replaceChild(newNode, slot.element);
        lastEmittedNode = newNode;
        slotCursor++;
      } else {
        // More rooted paragraphs than slots — append to body (before sectPr)
        if (finalSectPr) {
          body.insertBefore(newNode, finalSectPr);
        } else {
          body.appendChild(newNode);
        }
        lastEmittedNode = newNode;
      }
    } else {
      // Inserted paragraph — place in context
      if (lastEmittedNode) {
        // Insert after the previous paragraph in the same parent
        const parent = lastEmittedNode.parentNode!;
        const nextSibling = lastEmittedNode.nextSibling;

        // Guard: never insert after body-level <w:sectPr>
        if (nextSibling === finalSectPr && parent === body) {
          parent.insertBefore(newNode, finalSectPr);
        } else {
          parent.insertBefore(newNode, nextSibling);
        }
        lastEmittedNode = newNode;
      } else if (slotCursor < slots.length) {
        // No previous node — insert before the next rooted slot
        const nextSlot = slots[slotCursor]!;
        nextSlot.parent.insertBefore(newNode, nextSlot.element);
        lastEmittedNode = newNode;
      } else {
        // No context — append to body (before sectPr)
        if (finalSectPr) {
          body.insertBefore(newNode, finalSectPr);
        } else {
          body.appendChild(newNode);
        }
        lastEmittedNode = newNode;
      }
    }
  }

  // Remove any leftover original <w:p> slots that weren't consumed
  // (this happens when the original has more paragraphs than the merged result)
  for (let i = slotCursor; i < slots.length; i++) {
    const slot = slots[i]!;
    slot.parent.removeChild(slot.element);
  }

  // Strip inter-paragraph bookmark/comment/move-range markers from the
  // scaffold. These are bookmarkStart/End, commentRangeStart/End, and
  // moveFromRange*/moveToRange* elements that were siblings of <w:p> in the
  // original body. The paragraph rebuilder handles its own bookmark logic, so
  // keeping these orphaned markers causes unmatched bookmark IDs. Body-level
  // move-range markers are likewise scaffold remnants: in-paragraph markers
  // travel through the atom stream, and detected moves synthesize fresh range
  // pairs inside the reconstructed paragraphs, so a leftover body-level pair
  // would either dangle or double an emitted range.
  //
  // Comment range markers are treated differently: a sibling-level
  // commentRangeStart/End is the legitimate shape for a comment range that
  // spans whole paragraphs, and such markers never enter the atom stream
  // (see isParagraphLevelLeaf in atomizer.ts), so nothing re-emits them.
  // Stripping them unconditionally destroys multi-paragraph comment ranges
  // (issue #103). Instead, strip a sibling-level comment range marker only
  // when its counterpart (same w:id) is absent from the rebuilt body —
  // i.e., it is a genuinely orphaned scaffold remnant.
  const SCAFFOLD_STRIP_TAGS = new Set([
    'w:bookmarkStart', 'w:bookmarkEnd',
    'w:commentRangeStart', 'w:commentRangeEnd',
    'w:moveFromRangeStart', 'w:moveFromRangeEnd',
    'w:moveToRangeStart', 'w:moveToRangeEnd',
  ]);
  const COMMENT_RANGE_TAGS = new Set(['w:commentRangeStart', 'w:commentRangeEnd']);
  const commentRangeStartIds = new Set<string>();
  const commentRangeEndIds = new Set<string>();
  for (const el of Array.from(body.getElementsByTagName('*'))) {
    const id = (el as Element).getAttribute('w:id');
    if (id == null) continue;
    if (el.tagName === 'w:commentRangeStart') commentRangeStartIds.add(id);
    else if (el.tagName === 'w:commentRangeEnd') commentRangeEndIds.add(id);
  }
  const toRemove: Element[] = [];
  for (const el of Array.from(body.getElementsByTagName('*'))) {
    if (SCAFFOLD_STRIP_TAGS.has(el.tagName) && el.parentNode) {
      // Only strip if NOT inside a reconstructed <w:p> (i.e., it's a scaffold remnant)
      let insideParagraph = false;
      let ancestor: Node | null = el.parentNode;
      while (ancestor && ancestor !== body) {
        if ((ancestor as Element).tagName === 'w:p') {
          insideParagraph = true;
          break;
        }
        ancestor = ancestor.parentNode;
      }
      if (insideParagraph) continue;
      if (COMMENT_RANGE_TAGS.has(el.tagName)) {
        const id = (el as Element).getAttribute('w:id');
        const counterpartIds = el.tagName === 'w:commentRangeStart'
          ? commentRangeEndIds
          : commentRangeStartIds;
        if (id != null && counterpartIds.has(id)) continue;
      }
      toRemove.push(el as Element);
    }
  }
  for (const el of toRemove) {
    el.parentNode!.removeChild(el);
  }

  // Balance bookmarks and enforce consumer-compatibility invariants on the
  // rebuilt body. This dedupes bookmark Names/IDs, hoists bookmarkStart/End
  // out of <w:ins>/<w:del> wrappers (so they survive accept/reject), and
  // synthesizes recovery markers for orphaned starts/ends. Mirrors the
  // post-processing applied in inplace mode (inPlaceModifier.ts).
  enforceConsumerCompatibility(body, allocateRevisionId);

  // Serialize modified body and splice back into original envelope
  const serializer = new XMLSerializer();
  let newBodyXml = serializer.serializeToString(body);

  // Strip redundant xmlns:w declarations from inner elements.
  // XMLSerializer adds xmlns:w="..." on imported paragraph/rPr nodes because
  // they were parsed in a separate fragment document. These redundant
  // redeclarations are valid XML but confuse some OOXML consumers (Pages,
  // Google Docs) and prevent them from rendering tracked changes.
  // The w: namespace is already declared on the document root element.
  const W_NS_DECL = ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  // Keep the first declaration (on <w:body>) but remove all others
  let firstFound = false;
  newBodyXml = newBodyXml.replace(
    new RegExp(W_NS_DECL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    (match) => {
      if (!firstFound) { firstFound = true; return match; }
      return '';
    }
  );

  // Replace original body in the full document string
  const bodyRegex = /<w:body[^>]*>[\s\S]*?<\/w:body>/;
  return originalXml.replace(bodyRegex, newBodyXml);
}

/**
 * Build the final document by replacing body content (legacy flat mode).
 *
 * Note: sectPr elements are NOT extracted and appended separately because:
 * 1. Section properties inside pPr elements are already preserved in the reconstructed paragraphs
 * 2. The regex to extract "final sectPr" was incorrectly matching sectPr inside pPr elements
 *    and capturing large amounts of body content, causing duplicate text.
 *
 * @deprecated Use buildDocumentPreservingStructure instead. Retained as fallback.
 */
export function buildDocument(originalXml: string, paragraphXmls: string[]): string {
  // Extract document structure
  const bodyMatch = originalXml.match(/(<w:body[^>]*>)([\s\S]*?)(<\/w:body>)/);

  if (!bodyMatch) {
    throw new Error('Could not find w:body in document');
  }

  const beforeBody = originalXml.slice(0, originalXml.indexOf(bodyMatch[0]));
  const bodyOpenTag = bodyMatch[1];
  const bodyCloseTag = bodyMatch[3];
  const afterBody = originalXml.slice(
    originalXml.indexOf(bodyMatch[0]) + bodyMatch[0].length
  );

  // Build new body (no separate sectPr extraction - it's in the paragraphs' pPr)
  const newBodyContent = paragraphXmls.join('\n');

  return beforeBody + bodyOpenTag + '\n' + newBodyContent + '\n' + bodyCloseTag + afterBody;
}

/**
 * Escape XML text content.
 */
function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Statistics from reconstruction.
 */
export interface ReconstructionStats {
  paragraphs: number;
  insertions: number;
  deletions: number;
  moves: number;
  formatChanges: number;
}

/**
 * Count statistics from merged atoms.
 */
export function computeReconstructionStats(
  mergedAtoms: ComparisonUnitAtom[]
): ReconstructionStats {
  let insertions = 0;
  let deletions = 0;
  let moves = 0;
  let formatChanges = 0;
  const paragraphs = new Set<Element>();

  for (const atom of mergedAtoms) {
    // Count paragraph
    const pAncestor = findAncestorByTag(atom, 'w:p');
    if (pAncestor) {
      paragraphs.add(pAncestor);
    }

    // Count by status
    switch (atom.correlationStatus) {
      case CorrelationStatus.Inserted:
        insertions++;
        break;
      case CorrelationStatus.Deleted:
        deletions++;
        break;
      case CorrelationStatus.MovedSource:
      case CorrelationStatus.MovedDestination:
        moves++;
        break;
      case CorrelationStatus.FormatChanged:
        formatChanges++;
        break;
    }
  }

  return {
    paragraphs: paragraphs.size,
    insertions,
    deletions,
    moves: Math.floor(moves / 2), // Source and destination counted separately
    formatChanges,
  };
}
