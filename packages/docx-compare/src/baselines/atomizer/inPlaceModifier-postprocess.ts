/**
 * In-Place AST Modifier
 *
 * Modifies the revised document's AST in-place to add track changes markup.
 * This replaces the reconstruction-based approach with direct tree manipulation.
 */

import { CorrelationStatus, type ComparisonUnitAtom } from '@usejunior/docx-core';
import { areRunPropertiesEqual } from '../../format-detection.js';
import { childElements, findChildByTagName, unwrapElement } from '@usejunior/docx-core';
import { createEl } from './inPlaceModifier-shared.js';
import { TRACK_CHANGE_WRAPPERS, type TrackChangeTag } from './inPlaceModifier-wrappers.js';

export const DELETION_LIKE_STATUSES: ReadonlySet<CorrelationStatus> = new Set([
  CorrelationStatus.Deleted,
  CorrelationStatus.MovedSource,
]);

export const INSERTION_LIKE_STATUSES: ReadonlySet<CorrelationStatus> = new Set([
  CorrelationStatus.Inserted,
  CorrelationStatus.MovedDestination,
]);

/**
 * Reorder merged atoms so that within each contiguous block of non-equal atoms,
 * all deletion-like atoms come before all insertion-like atoms.
 *
 * This produces grouped tracked changes ("<del>old words</del><ins>new words</ins>")
 * instead of alternating word-by-word pairs ("<del>old1</del><ins>new1</ins><del>old2</del>...").
 */
export function groupDeletionsBeforeInsertions(atoms: ComparisonUnitAtom[]): ComparisonUnitAtom[] {
  const result: ComparisonUnitAtom[] = [];
  let i = 0;

  while (i < atoms.length) {
    const atom = atoms[i]!;
    const status = atom.correlationStatus;

    // Pass through equal/format-changed/unknown atoms unchanged
    if (!DELETION_LIKE_STATUSES.has(status) && !INSERTION_LIKE_STATUSES.has(status)) {
      result.push(atom);
      i++;
      continue;
    }

    // Collect a contiguous block of change atoms (deletions + insertions)
    const deletions: ComparisonUnitAtom[] = [];
    const insertions: ComparisonUnitAtom[] = [];
    while (i < atoms.length) {
      const s = atoms[i]!.correlationStatus;
      if (DELETION_LIKE_STATUSES.has(s)) {
        deletions.push(atoms[i]!);
      } else if (INSERTION_LIKE_STATUSES.has(s)) {
        insertions.push(atoms[i]!);
      } else {
        break;
      }
      i++;
    }

    // Emit all deletions first, then all insertions
    result.push(...deletions, ...insertions);
  }

  return result;
}


export function mergeAdjacentTrackChangeSiblings(root: Element): void {
  function traverse(node: Element): void {
    const children = childElements(node);
    if (children.length < 2) {
      // Still recurse into children
      for (const child of childElements(node)) traverse(child);
      return;
    }

    for (let i = 0; i < children.length - 1; ) {
      const a = children[i]!;
      const b = children[i + 1]!;

      if (a.tagName === b.tagName && TRACK_CHANGE_WRAPPERS.has(a.tagName as TrackChangeTag) &&
          a.getAttribute('w:author') === b.getAttribute('w:author') &&
          a.getAttribute('w:date') === b.getAttribute('w:date')) {
        // Absorb b's children into a
        while (b.firstChild) a.appendChild(b.firstChild);
        node.removeChild(b);
        // Remove b from our local children snapshot and don't increment i —
        // recheck a with its new next sibling.
        children.splice(i + 1, 1);
        continue;
      }
      i++;
    }

    // Recurse into current children (re-query after mutations)
    for (const child of childElements(node)) {
      traverse(child);
    }
  }

  traverse(root);
}

// =============================================================================
// Bug 1: Suppress field-adjacent false no-op del/ins pairs (issue #42)
// =============================================================================

/**
 * Build a normalized content signature for a run's non-rPr children.
 * On the del side, maps w:delText → w:t and w:delInstrText → w:instrText
 * so that content from del wrappers can be compared to ins wrappers.
 */
export function normalizeRunContentSignature(run: Element, isDelSide: boolean): string {
  const parts: string[] = [];
  for (let i = 0; i < run.childNodes.length; i++) {
    const child = run.childNodes[i]!;
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.tagName === 'w:rPr') continue;

    let tag = el.tagName;
    if (isDelSide) {
      if (tag === 'w:delText') tag = 'w:t';
      else if (tag === 'w:delInstrText') tag = 'w:instrText';
    }

    const text = el.textContent ?? '';
    parts.push(`<${tag}>${text}</${tag}>`);
  }
  return parts.join('');
}

/**
 * Check if an adjacent w:del + w:ins pair is a no-op (identical text and formatting).
 * Both wrappers must contain the same number of runs with matching rPr and content.
 */
export function isNoOpPair(del: Element, ins: Element): boolean {
  const delRuns = childElements(del).filter(c => c.tagName === 'w:r');
  const insRuns = childElements(ins).filter(c => c.tagName === 'w:r');

  if (delRuns.length !== insRuns.length) return false;
  if (delRuns.length === 0) return false;

  for (let i = 0; i < delRuns.length; i++) {
    const delRun = delRuns[i]!;
    const insRun = insRuns[i]!;

    // Compare formatting via canonical rPr comparison
    const delRPr = findChildByTagName(delRun, 'w:rPr');
    const insRPr = findChildByTagName(insRun, 'w:rPr');
    if (!areRunPropertiesEqual(delRPr ?? null, insRPr ?? null)) return false;

    // Compare content structure (text, tabs, breaks, field chars, etc.)
    const delSig = normalizeRunContentSignature(delRun, true);
    const insSig = normalizeRunContentSignature(insRun, false);
    if (delSig !== insSig) return false;
  }

  return true;
}

/**
 * Suppress no-op del/ins pairs — adjacent w:del + w:ins wrappers where the
 * content and formatting are identical. These arise from field-adjacent atoms
 * that are false-positive changes.
 *
 * When a no-op is detected, both wrappers are unwrapped, leaving the ins-side
 * runs as plain (non-tracked) children. The del-side runs are removed.
 */
export function suppressNoOpChangePairs(root: Element): void {
  function traverse(node: Element): void {
    const children = childElements(node);

    for (let i = 0; i < children.length - 1; ) {
      const a = children[i]!;
      const b = children[i + 1]!;

      if (a.tagName === 'w:del' && b.tagName === 'w:ins' && isNoOpPair(a, b)) {
        // Remove the del wrapper and its content entirely
        node.removeChild(a);
        // Unwrap the ins wrapper — promote its children to the parent
        unwrapElement(b);
        // Re-snapshot children after mutation
        children.splice(i, 2, ...childElements(node).slice(i));
        // Don't increment — recheck from same position
        continue;
      }

      i++;
    }

    // Recurse into current children (re-query after mutations)
    for (const child of childElements(node)) {
      traverse(child);
    }
  }

  traverse(root);
}

// =============================================================================
// Bug 2: Merge whitespace-bridged track change siblings (issue #42)
// =============================================================================

/**
 * Narrow whitespace predicate for bridging: returns true only if a w:r element's
 * visible children are exclusively w:t elements with whitespace-only text content.
 * Excludes w:tab, w:br, w:cr which have layout significance.
 */
export function isInlineWhitespaceOnlyRun(run: Element): boolean {
  if (run.tagName !== 'w:r') return false;

  let hasVisibleChild = false;
  for (let i = 0; i < run.childNodes.length; i++) {
    const child = run.childNodes[i]!;
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.tagName === 'w:rPr') continue;

    // Only w:t with whitespace-only text is allowed
    if (el.tagName === 'w:t') {
      const text = el.textContent ?? '';
      if (text.length === 0 || !/^\s+$/.test(text)) return false;
      hasVisibleChild = true;
      continue;
    }

    // Any other visible element (w:tab, w:br, w:cr, w:fldChar, etc.) disqualifies
    return false;
  }

  return hasVisibleChild;
}


/**
 * Merge track-change wrappers (w:del or w:ins) that are separated by a
 * whitespace-only run. This groups "word-by-word" tracked changes into
 * contiguous blocks for cleaner presentation.
 *
 * For w:del: clones the whitespace run, converts w:t→w:delText, and absorbs
 * both the whitespace and the second wrapper's children into the first wrapper.
 *
 * For w:ins: moves the whitespace run into the first wrapper, then absorbs
 * the second wrapper's children.
 *
 * Both projections (Accept All, Reject All) remain correct because each
 * wrapper independently contains the whitespace it needs.
 */
export function mergeWhitespaceBridgedTrackChanges(root: Element): void {
  function traverse(node: Element): void {
    const children = childElements(node);

    for (let i = 0; i < children.length - 2; ) {
      const a = children[i]!;
      const mid = children[i + 1]!;
      const b = children[i + 2]!;

      // Check: same track-change tag, same author/date, with whitespace-only run between.
      // Only bridge w:ins and w:moveTo — bridging w:del is unsafe because the
      // intervening whitespace is Equal content needed by the accept projection.
      const bridgeableTags = new Set(['w:ins', 'w:moveTo']);
      if (a.tagName === b.tagName &&
          bridgeableTags.has(a.tagName) &&
          a.getAttribute('w:author') === b.getAttribute('w:author') &&
          a.getAttribute('w:date') === b.getAttribute('w:date') &&
          isInlineWhitespaceOnlyRun(mid)) {

        // Move the whitespace run into the first wrapper, then absorb second's children
        a.appendChild(mid);
        while (b.firstChild) a.appendChild(b.firstChild);
        node.removeChild(b);

        // mid was moved into a, b removed from parent — splice both from snapshot
        children.splice(i + 1, 2);

        // Don't increment — recheck a with new next sibling
        continue;
      }

      i++;
    }

    // Recurse into current children (re-query after mutations)
    for (const child of childElements(node)) {
      traverse(child);
    }
  }

  traverse(root);
}

// =============================================================================
// Bug: Coalesce duplicate move-range markers to one pair per move group (issue #446)
// =============================================================================

/**
 * The paired range-marker tags for each move direction. A move side is
 * bracketed by a single Start...End pair sharing the same `w:name` and `w:id`.
 */
const MOVE_RANGE_MARKER_TAGS = [
  { start: 'w:moveFromRangeStart', end: 'w:moveFromRangeEnd' },
  { start: 'w:moveToRangeStart', end: 'w:moveToRangeEnd' },
] as const;

/**
 * Collapse duplicate move-range markers so each move group is bracketed by
 * exactly ONE range Start and ONE range End per parent element.
 *
 * The in-place moveFrom path clones one `<w:moveFrom>` wrapper per source atom
 * (word-level atomization fragments a moved paragraph into many atoms), and
 * each clone re-emits its own `<w:moveFromRangeStart>`/`<w:moveFromRangeEnd>`
 * reusing the cached range id. A moved paragraph that fragments into N runs
 * therefore emits N identical-id range pairs, where Word (and the rebuild
 * reconstructor, which coalesces moved run-groups via shouldStartNewRunGroup)
 * emits exactly one: a single Start before the first wrapper and a single End
 * after the last, with per-run `<w:moveFrom>` wrappers in between.
 *
 * For each parent element and each move `w:name`, this keeps the FIRST range
 * Start and the LAST range End (in document order) and removes every
 * intermediate duplicate. Coalescing is scoped per-parent so a move spanning
 * multiple paragraphs keeps one bracketing pair per paragraph, matching how the
 * rebuild path brackets multi-paragraph moves.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/446
 */
export function coalesceMoveRangeMarkers(root: Element): void {
  function coalesceInParent(parent: Element): void {
    for (const { start: startTag, end: endTag } of MOVE_RANGE_MARKER_TAGS) {
      // Group markers by move name (w:name lives on the Start; the paired End
      // reuses the Start's w:id, so match ends back to a name via that id).
      const startsByName = new Map<string, Element[]>();
      const idToName = new Map<string, string>();
      const endsByName = new Map<string, Element[]>();

      for (const child of childElements(parent)) {
        if (child.tagName === startTag) {
          const name = child.getAttribute('w:name');
          if (!name) continue;
          (startsByName.get(name) ?? startsByName.set(name, []).get(name)!).push(child);
          const id = child.getAttribute('w:id');
          if (id) idToName.set(id, name);
        } else if (child.tagName === endTag) {
          const id = child.getAttribute('w:id');
          const name = id ? idToName.get(id) : undefined;
          if (!name) continue;
          (endsByName.get(name) ?? endsByName.set(name, []).get(name)!).push(child);
        }
      }

      // Keep only the first Start and the last End for each move name.
      for (const [, starts] of startsByName) {
        for (let i = 1; i < starts.length; i++) parent.removeChild(starts[i]!);
      }
      for (const [, ends] of endsByName) {
        for (let i = 0; i < ends.length - 1; i++) parent.removeChild(ends[i]!);
      }
    }
  }

  function traverse(node: Element): void {
    coalesceInParent(node);
    for (const child of childElements(node)) traverse(child);
  }

  traverse(root);
}

// =============================================================================
// Bug 2b: Coalesce del/ins pair chains across whitespace (issue #42)
// =============================================================================

/**
 * Convert w:t → w:delText and w:instrText → w:delInstrText within a run,
 * preserving xml:space attributes. Used for cloning whitespace runs into
 * w:del wrappers during pair-chain coalescing.
 */
export function convertRunTextToDelText(run: Element): void {
  for (let i = 0; i < run.childNodes.length; i++) {
    const child = run.childNodes[i]!;
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.tagName === 'w:t' || el.tagName === 'w:instrText') {
      const newTag = el.tagName === 'w:t' ? 'w:delText' : 'w:delInstrText';
      const newEl = createEl(newTag);
      // Copy text content
      while (el.firstChild) newEl.appendChild(el.firstChild);
      // Copy attributes (including xml:space="preserve")
      for (let j = 0; j < el.attributes.length; j++) {
        const attr = el.attributes[j]!;
        newEl.setAttribute(attr.name, attr.value);
      }
      run.replaceChild(newEl, el);
    }
  }
}

/**
 * Coalesce alternating del/ins pair chains separated by whitespace-only runs
 * into single grouped del + ins wrappers.
 *
 * Pattern: [w:del, w:ins, ws-segment..., w:del, w:ins, ws-segment..., w:del, w:ins]
 *
 * For each whitespace segment between consecutive [del, ins] pairs:
 * 1. Clone each ws-run → convert to delText → append to first del
 * 2. Clone each ws-run → keep as w:t → append to first ins
 * 3. Move nextDel's children into first del
 * 4. Move nextIns's children into first ins
 * 5. Remove original ws-runs, empty nextDel, empty nextIns from parent
 *
 * Safety invariants:
 * - Only bridges when both del AND ins absorb the whitespace (both projections correct)
 * - Incomplete tail [del, ins, ws, del] (no trailing ins) → stop chain, don't bridge
 * - All wrappers in chain must share same w:author and w:date
 */
export function coalesceDelInsPairChains(root: Element): void {
  function traverse(node: Element): void {
    const children = childElements(node);

    for (let i = 0; i < children.length - 1; ) {
      const firstDel = children[i]!;
      const firstIns = children[i + 1]!;

      // Must start with a [del, ins] pair
      if (firstDel.tagName !== 'w:del' || firstIns.tagName !== 'w:ins') {
        i++;
        continue;
      }

      const author = firstDel.getAttribute('w:author');
      const date = firstDel.getAttribute('w:date');

      // All four must match author/date
      if (firstIns.getAttribute('w:author') !== author ||
          firstIns.getAttribute('w:date') !== date) {
        i++;
        continue;
      }

      // Try to extend the chain by absorbing subsequent [ws..., del, ins] triples
      let cursor = i + 2; // position after firstIns
      let chainExtended = false;

      while (cursor < children.length) {
        // Collect whitespace segment (1..N consecutive whitespace-only runs)
        const wsStart = cursor;
        while (cursor < children.length && isInlineWhitespaceOnlyRun(children[cursor]!)) {
          cursor++;
        }
        const wsEnd = cursor;
        const wsCount = wsEnd - wsStart;

        if (wsCount === 0) break; // No whitespace → end of chain

        // Must have a complete [del, ins] pair after the whitespace
        if (cursor + 1 >= children.length) break; // Not enough elements
        const nextDel = children[cursor]!;
        const nextIns = children[cursor + 1]!;

        if (nextDel.tagName !== 'w:del' || nextIns.tagName !== 'w:ins') break;

        // Author/date must match
        if (nextDel.getAttribute('w:author') !== author ||
            nextDel.getAttribute('w:date') !== date ||
            nextIns.getAttribute('w:author') !== author ||
            nextIns.getAttribute('w:date') !== date) break;

        // All conditions met — absorb this [ws..., del, ins] into the first pair

        // 1. Clone whitespace runs into del (as delText) and ins (as w:t)
        for (let w = wsStart; w < wsEnd; w++) {
          const wsRun = children[w]!;

          const delClone = wsRun.cloneNode(true) as Element;
          convertRunTextToDelText(delClone);
          firstDel.appendChild(delClone);

          const insClone = wsRun.cloneNode(true) as Element;
          firstIns.appendChild(insClone);
        }

        // 2. Move nextDel's children into firstDel
        while (nextDel.firstChild) firstDel.appendChild(nextDel.firstChild);

        // 3. Move nextIns's children into firstIns
        while (nextIns.firstChild) firstIns.appendChild(nextIns.firstChild);

        // 4. Remove ws-runs, nextDel, nextIns from parent
        for (let w = wsStart; w < wsEnd; w++) {
          node.removeChild(children[w]!);
        }
        node.removeChild(nextDel);
        node.removeChild(nextIns);

        // 5. Splice removed elements from children snapshot
        // Remove wsCount + 2 elements starting at wsStart
        children.splice(wsStart, wsCount + 2);

        // Reset cursor to continue checking after firstIns
        cursor = wsStart;
        chainExtended = true;
      }

      // Advance past the (possibly extended) [del, ins] pair
      i += chainExtended ? 2 : 1;
      // If no chain was formed, we only skip the del (i++ already happened above
      // for the non-chain case), but if it was a chain we skip both del+ins.
      // Actually: if chain wasn't extended, we need to check if firstDel+firstIns
      // alone should advance by 2 or by 1. Since they ARE a del+ins pair but
      // no chain formed, skip both.
      if (!chainExtended) {
        i++; // skip the ins too (total i += 2 from the earlier i++)
      }
    }

    // Recurse into current children (re-query after mutations)
    for (const child of childElements(node)) {
      traverse(child);
    }
  }

  traverse(root);
}
