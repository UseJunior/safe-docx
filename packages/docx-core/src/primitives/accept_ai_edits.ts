/**
 * accept_ai_edits — selective accept/reject of tracked changes by revision id or
 * author (#123).
 *
 * The strongest argument for tracked-changes-as-canonical (#118/#120) is that
 * acceptance can target only the AI actor's revisions, leaving any pre-existing
 * third-party tracked changes byte-untouched. This module resolves a target set
 * of revision ids (directly, or from an author string), refuses ambiguous
 * overlaps by default, and drives the existing (whole-document) accept/reject
 * engines through a revision-id filter so only the targeted revisions are
 * resolved.
 *
 * Ambiguity: OOXML permits — but Word does not define behavior for — a revision
 * of one actor structurally containing a revision of another (nested
 * `w:ins`/`w:del`/`w:moveFrom`/`w:moveTo`). Selective accept/reject is defined
 * only on a normalized, non-overlapping revision graph; the ambiguous case
 * hard-errors with a structured list of the offending pairs unless the caller
 * opts into `normalizeFirst` (best-effort, no byte-identical promise).
 */

import { OOXML } from './namespaces.js';
import { TRACKED_CHANGE_ELEMENT_NAME_SET } from './revision-vocabulary.js';
import {
  acceptChanges,
  revisionElementId,
  type AcceptChangesResult,
  type RevisionFilter,
} from './accept_changes.js';
import { rejectChanges, type RejectChangesResult } from './reject_changes.js';

const W_NS = OOXML.W_NS;

/**
 * Content-wrapper revisions whose cross-actor nesting is the ambiguous case the
 * spec calls out ("Word doesn't support nested ins/del/move"). Property-change
 * and cell-topology revisions are excluded: a `w:rPrChange` legitimately sits
 * inside an inserted run without making acceptance ambiguous.
 */
const OVERLAP_CONTAINER_LOCALS = new Set(['ins', 'del', 'moveFrom', 'moveTo']);

/** Selector for a selective accept/reject operation. */
export interface AiEditSelector {
  /** Explicit `w:id` values to target (strings or numbers). Primary signature. */
  revisionIds?: Array<string | number>;
  /** Convenience: resolve every revision authored by this `w:author` to its id. */
  author?: string;
  /**
   * Opt in to best-effort operation on an ambiguous (overlapping) graph instead
   * of hard-erroring. Foreign revisions are still left in place, but byte-identical
   * preservation is not promised in ambiguous cases.
   */
  normalizeFirst?: boolean;
}

/** One offending pair where a targeted revision overlaps a non-targeted one. */
export interface AiRevisionOverlap {
  outerId: string | null;
  outerLocalName: string;
  outerAuthor: string | null;
  innerId: string | null;
  innerLocalName: string;
  innerAuthor: string | null;
}

/** Thrown when selective accept/reject would touch an ambiguous revision graph. */
export class AmbiguousRevisionOverlapError extends Error {
  readonly code = 'AMBIGUOUS_REVISION_OVERLAP';
  readonly overlaps: AiRevisionOverlap[];
  constructor(overlaps: AiRevisionOverlap[]) {
    super(
      `Selective accept/reject is ambiguous: ${overlaps.length} revision overlap(s) where a ` +
        `targeted revision structurally contains, or is contained by, a non-targeted revision. ` +
        `Pass normalizeFirst to attempt best-effort resolution.`,
    );
    this.name = 'AmbiguousRevisionOverlapError';
    this.overlaps = overlaps;
  }
}

export interface SelectiveAcceptResult {
  result: AcceptChangesResult;
  selectedIds: string[];
  overlaps: AiRevisionOverlap[];
}

export interface SelectiveRejectResult {
  result: RejectChangesResult;
  selectedIds: string[];
  overlaps: AiRevisionOverlap[];
}

function storyRoot(doc: Document): Element | null {
  return doc.getElementsByTagNameNS(W_NS, 'body').item(0) ?? doc.documentElement ?? null;
}

function revisionAuthor(el: Element): string | null {
  return el.getAttributeNS(W_NS, 'author') ?? el.getAttribute('w:author');
}

/** Every tracked-change element under `root` (any revision type). */
export function collectRevisionElements(root: Element | Document): Element[] {
  const out: Element[] = [];
  const all = root.getElementsByTagNameNS(W_NS, '*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i]!;
    if (TRACKED_CHANGE_ELEMENT_NAME_SET.has(el.localName)) out.push(el);
  }
  return out;
}

/**
 * Resolve the target revision-id set from a selector, given the revision
 * elements available across all stories. `revisionIds` wins when provided;
 * otherwise `author` resolves to the ids of every revision it authored.
 */
export function resolveSelectedIds(revisionElements: Element[], selector: AiEditSelector): Set<string> {
  const ids = new Set<string>();
  if (selector.revisionIds && selector.revisionIds.length > 0) {
    for (const id of selector.revisionIds) ids.add(String(id));
    return ids;
  }
  if (selector.author != null) {
    for (const el of revisionElements) {
      if (revisionAuthor(el) === selector.author) {
        const id = revisionElementId(el);
        if (id != null) ids.add(id);
      }
    }
    return ids;
  }
  throw new Error('AiEditSelector requires either revisionIds or author.');
}

/**
 * Find ambiguous overlaps within a single story: a targeted content-wrapper
 * revision that structurally contains — or is contained by — a non-targeted
 * content-wrapper revision.
 */
export function detectAmbiguousOverlaps(root: Element | Document, selectedIds: Set<string>): AiRevisionOverlap[] {
  const overlaps: AiRevisionOverlap[] = [];
  const seen = new Set<string>();
  const record = (outer: Element, inner: Element): void => {
    const oid = revisionElementId(outer);
    const iid = revisionElementId(inner);
    const key = `${oid}|${iid}|${outer.localName}|${inner.localName}`;
    if (seen.has(key)) return;
    seen.add(key);
    overlaps.push({
      outerId: oid,
      outerLocalName: outer.localName,
      outerAuthor: revisionAuthor(outer),
      innerId: iid,
      innerLocalName: inner.localName,
      innerAuthor: revisionAuthor(inner),
    });
  };

  const isSelectedContainer = (el: Element): boolean => {
    if (!OVERLAP_CONTAINER_LOCALS.has(el.localName)) return false;
    const id = revisionElementId(el);
    return id != null && selectedIds.has(id);
  };

  const all = root.getElementsByTagNameNS(W_NS, '*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i]!;
    if (!isSelectedContainer(el)) continue;

    // Foreign container revision nested INSIDE the selected one.
    const descendants = el.getElementsByTagNameNS(W_NS, '*');
    for (let j = 0; j < descendants.length; j++) {
      const d = descendants[j]!;
      if (!OVERLAP_CONTAINER_LOCALS.has(d.localName)) continue;
      const did = revisionElementId(d);
      if (did == null || !selectedIds.has(did)) record(el, d);
    }

    // Selected revision nested INSIDE a foreign container revision.
    let anc: Node | null = el.parentNode;
    while (anc) {
      if (anc.nodeType === 1) {
        const a = anc as Element;
        if (a.namespaceURI === W_NS && OVERLAP_CONTAINER_LOCALS.has(a.localName)) {
          const aid = revisionElementId(a);
          if (aid == null || !selectedIds.has(aid)) record(a, el);
        }
      }
      anc = anc.parentNode;
    }
  }
  return overlaps;
}

/** Build a revision filter that matches exactly the selected ids. */
export function selectedIdFilter(selectedIds: Set<string>): RevisionFilter {
  return (el: Element) => {
    const id = revisionElementId(el);
    return id != null && selectedIds.has(id);
  };
}

/**
 * Accept only the targeted revisions in a single story `doc`, leaving all other
 * revisions byte-untouched. Hard-errors on an ambiguous overlap unless
 * `normalizeFirst` is set. Mutates `doc` in place.
 */
export function acceptAIEdits(doc: Document, selector: AiEditSelector): SelectiveAcceptResult {
  const root = storyRoot(doc);
  if (!root) return { result: emptyAccept(), selectedIds: [], overlaps: [] };
  const selectedIds = resolveSelectedIds(collectRevisionElements(root), selector);
  const overlaps = selector.normalizeFirst ? [] : detectAmbiguousOverlaps(root, selectedIds);
  if (overlaps.length > 0) throw new AmbiguousRevisionOverlapError(overlaps);
  const result = acceptChanges(doc, { filter: selectedIdFilter(selectedIds) });
  return { result, selectedIds: [...selectedIds], overlaps };
}

/**
 * Reject only the targeted revisions in a single story `doc`, leaving all other
 * revisions byte-untouched. Symmetric to {@link acceptAIEdits}.
 */
export function rejectAIEdits(doc: Document, selector: AiEditSelector): SelectiveRejectResult {
  const root = storyRoot(doc);
  if (!root) return { result: emptyReject(), selectedIds: [], overlaps: [] };
  const selectedIds = resolveSelectedIds(collectRevisionElements(root), selector);
  const overlaps = selector.normalizeFirst ? [] : detectAmbiguousOverlaps(root, selectedIds);
  if (overlaps.length > 0) throw new AmbiguousRevisionOverlapError(overlaps);
  const result = rejectChanges(doc, { filter: selectedIdFilter(selectedIds) });
  return { result, selectedIds: [...selectedIds], overlaps };
}

function emptyAccept(): AcceptChangesResult {
  return { insertionsAccepted: 0, deletionsAccepted: 0, movesResolved: 0, propertyChangesResolved: 0 };
}
function emptyReject(): RejectChangesResult {
  return { insertionsRemoved: 0, deletionsRestored: 0, movesReverted: 0, propertyChangesReverted: 0 };
}
