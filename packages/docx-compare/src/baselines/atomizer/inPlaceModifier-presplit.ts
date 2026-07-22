/**
 * In-Place AST Modifier
 *
 * Modifies the revised document's AST in-place to add track changes markup.
 * This replaces the reconstruction-based approach with direct tree manipulation.
 */

import type { ComparisonUnitAtom } from '@usejunior/docx-core';
import { CorrelationStatus } from '@usejunior/docx-core';
import { getDirectContentElements, splitRunAtVisibleOffset, visibleLengthForEl } from '@usejunior/docx-core';
import { warn } from './debug.js';
import { FIELD_CHAR_TAG_NAMES } from './inPlaceModifier-deletion.js';
import { getOriginalInsProvenanceKey, getRunInsertionAnchor } from './inPlaceModifier-wrappers.js';

export function atomContentVisibleLength(el: Element): number {
  const tag = el.tagName;
  if (tag === 'w:t') return (el.textContent ?? '').length;
  if (tag === 'w:tab' || tag === 'w:br') return 1;
  // w:cr is treated as zero-length (consistent with visibleLengthForEl which also returns 0).
  return 0;
}

/**
 * Pre-split revised-tree runs that contain atoms with mixed correlation statuses.
 *
 * Without this, `handleInserted` wraps the entire run with `<w:ins>`, destroying
 * Equal content in the same run. After splitting, each fragment is a separate
 * `<w:r>` and existing per-status handlers work without modification.
 *
 * Safety: wrapped in try/catch per run group. If any DOM operation fails, the
 * run is skipped and the existing fallback-to-rebuild architecture handles it.
 */
export function preSplitMixedStatusRuns(mergedAtoms: ComparisonUnitAtom[]): void {
  // Group atoms by their sourceRunElement (revised-tree runs only).
  const runGroups = new Map<Element, ComparisonUnitAtom[]>();

  for (const atom of mergedAtoms) {
    if (!atom.sourceRunElement) continue;

    // Skip original-tree atoms — Deleted/MovedSource runs are cloned, not wrapped.
    if (
      atom.correlationStatus === CorrelationStatus.Deleted ||
      atom.correlationStatus === CorrelationStatus.MovedSource
    ) continue;

    // Skip collapsed field atoms (multi-run field sequences).
    if (atom.collapsedFieldAtoms && atom.collapsedFieldAtoms.length > 0) continue;

    // Skip field character elements — semantically fragile.
    if (FIELD_CHAR_TAG_NAMES.has(atom.contentElement.tagName)) continue;

    const group = runGroups.get(atom.sourceRunElement);
    if (group) {
      group.push(atom);
    } else {
      runGroups.set(atom.sourceRunElement, [atom]);
    }
  }

  for (const [run, atoms] of runGroups) {
    // Early check: skip single-status runs before any DOM work.
    const statuses = new Set(atoms.map((a) => a.correlationStatus));
    if (statuses.size <= 1) continue;

    // Guard: skip runs already detached from the tree.
    if (!run.parentNode) continue;

    try {
      // Compute the run's actual visible length via DOM traversal.
      const contentEls = getDirectContentElements(run);
      let runVisibleLength = 0;
      for (const cel of contentEls) {
        runVisibleLength += visibleLengthForEl(cel);
      }

      // Cross-run safety: if sum of atom lengths exceeds run visible length,
      // this group contains a cross-run merged atom (passes 3/4). Skip it.
      let sumAtomLengths = 0;
      for (const atom of atoms) {
        sumAtomLengths += atomContentVisibleLength(atom.contentElement);
      }
      if (sumAtomLengths > runVisibleLength) continue;

      // Compute contiguous status spans with character offsets.
      interface StatusSpan {
        status: CorrelationStatus;
        startOffset: number;
        length: number;
        atoms: ComparisonUnitAtom[];
      }

      const spans: StatusSpan[] = [];
      let offset = 0;
      for (const atom of atoms) {
        const len = atomContentVisibleLength(atom.contentElement);
        const lastSpan = spans[spans.length - 1];
        if (lastSpan && lastSpan.status === atom.correlationStatus) {
          lastSpan.length += len;
          lastSpan.atoms.push(atom);
        } else {
          spans.push({
            status: atom.correlationStatus,
            startOffset: offset,
            length: len,
            atoms: [atom],
          });
        }
        offset += len;
      }

      // If only one span after grouping, no split needed.
      if (spans.length <= 1) continue;

      // Collect split points: startOffset of each span after the first.
      const splitPoints: number[] = [];
      for (let i = 1; i < spans.length; i++) {
        const pt = spans[i]!.startOffset;
        // Filter out degenerate split points at boundaries.
        if (pt > 0 && pt < runVisibleLength) {
          splitPoints.push(pt);
        }
      }

      if (splitPoints.length === 0) continue;

      // Split DOM run right-to-left to keep earlier offsets valid.
      const rightFragments: Element[] = [];
      for (let i = splitPoints.length - 1; i >= 0; i--) {
        const { right } = splitRunAtVisibleOffset(run, splitPoints[i]!);
        rightFragments.push(right);
      }

      // Map fragments: [originalRun (leftmost), ...reverse(rightFragments)]
      // After R-to-L splits, rightFragments are in reverse document order.
      const fragments = [run, ...rightFragments.reverse()];

      // Update atom sourceRunElement pointers to the correct fragment.
      // Each span maps to one fragment in order.
      for (let i = 0; i < spans.length; i++) {
        const fragment = fragments[i];
        if (!fragment) continue;
        for (const atom of spans[i]!.atoms) {
          atom.sourceRunElement = fragment;
        }
      }
    } catch (_err) {
      // DOM operation failed — skip this run. The existing fallback-to-rebuild
      // architecture will handle it if the overall safety check fails.
      warn('preSplitMixedStatusRuns', `Skipping run split due to error: ${_err}`);
    }
  }
}

/**
 * Pre-split revised-tree runs whose atoms carry different ORIGINAL-side inline
 * `<w:ins>` provenance (issue #358).
 *
 * When the original input pre-tracked part of a paragraph as an insertion and
 * the revised text matches it, the matched (Equal) atoms land in one revised
 * run together with plain-lineage atoms — e.g. revised run "Alpha beta" where
 * only " beta" descends from the original's `<w:ins>`. `handleEqual` wraps at
 * run granularity, so the run must first be split at provenance boundaries;
 * afterwards each fragment is uniformly plain or uniformly provenance-bearing
 * and the per-status handlers wrap the right fragment only.
 *
 * Mirrors the span/split machinery of {@link preSplitMixedStatusRuns}; runs
 * after it (and after {@link preSplitInterleavedWordRuns}), so it operates on
 * the already status-homogeneous fragments those passes produced.
 *
 * Safety: wrapped in try/catch per run group. If any DOM operation fails, the
 * run is skipped and the existing fallback-to-rebuild architecture handles it.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/358
 */
export function preSplitInsProvenanceRuns(mergedAtoms: ComparisonUnitAtom[]): void {
  // Group atoms by their sourceRunElement (revised-tree runs only).
  const runGroups = new Map<Element, ComparisonUnitAtom[]>();

  for (const atom of mergedAtoms) {
    if (!atom.sourceRunElement) continue;

    // Skip original-tree atoms — Deleted/MovedSource runs are cloned, not wrapped.
    if (
      atom.correlationStatus === CorrelationStatus.Deleted ||
      atom.correlationStatus === CorrelationStatus.MovedSource
    ) continue;

    // Skip collapsed field atoms (multi-run field sequences).
    if (atom.collapsedFieldAtoms && atom.collapsedFieldAtoms.length > 0) continue;

    // Skip field character elements — semantically fragile.
    if (FIELD_CHAR_TAG_NAMES.has(atom.contentElement.tagName)) continue;

    const group = runGroups.get(atom.sourceRunElement);
    if (group) {
      group.push(atom);
    } else {
      runGroups.set(atom.sourceRunElement, [atom]);
    }
  }

  for (const [run, atoms] of runGroups) {
    // Early check: skip runs whose atoms all share one provenance key.
    const keys = new Set(atoms.map((a) => getOriginalInsProvenanceKey(a)));
    if (keys.size <= 1) continue;

    // Guard: skip runs already detached from the tree.
    if (!run.parentNode) continue;

    // Skip runs already inside a physical track-change wrapper: the revised
    // document's own pre-tracked wrapper governs the whole run, and wrapping
    // fragments of it again would nest revision markup incorrectly.
    if (getRunInsertionAnchor(run) !== run) continue;

    try {
      // Compute the run's actual visible length via DOM traversal.
      const contentEls = getDirectContentElements(run);
      let runVisibleLength = 0;
      for (const cel of contentEls) {
        runVisibleLength += visibleLengthForEl(cel);
      }

      // Cross-run safety: if sum of atom lengths exceeds run visible length,
      // this group contains a cross-run merged atom (passes 3/4). Skip it.
      let sumAtomLengths = 0;
      for (const atom of atoms) {
        sumAtomLengths += atomContentVisibleLength(atom.contentElement);
      }
      if (sumAtomLengths > runVisibleLength) continue;

      // Compute contiguous provenance spans with character offsets.
      interface ProvenanceSpan {
        key: string | null;
        startOffset: number;
        length: number;
        atoms: ComparisonUnitAtom[];
      }

      const spans: ProvenanceSpan[] = [];
      let offset = 0;
      for (const atom of atoms) {
        const len = atomContentVisibleLength(atom.contentElement);
        const key = getOriginalInsProvenanceKey(atom);
        const lastSpan = spans[spans.length - 1];
        if (lastSpan && lastSpan.key === key) {
          lastSpan.length += len;
          lastSpan.atoms.push(atom);
        } else {
          spans.push({
            key,
            startOffset: offset,
            length: len,
            atoms: [atom],
          });
        }
        offset += len;
      }

      // If only one span after grouping, no split needed.
      if (spans.length <= 1) continue;

      // Collect split points: startOffset of each span after the first.
      const splitPoints: number[] = [];
      for (let i = 1; i < spans.length; i++) {
        const pt = spans[i]!.startOffset;
        // Filter out degenerate split points at boundaries.
        if (pt > 0 && pt < runVisibleLength) {
          splitPoints.push(pt);
        }
      }

      if (splitPoints.length === 0) continue;

      // Split DOM run right-to-left to keep earlier offsets valid.
      const rightFragments: Element[] = [];
      for (let i = splitPoints.length - 1; i >= 0; i--) {
        const { right } = splitRunAtVisibleOffset(run, splitPoints[i]!);
        rightFragments.push(right);
      }

      // Map fragments: [originalRun (leftmost), ...reverse(rightFragments)]
      // After R-to-L splits, rightFragments are in reverse document order.
      const fragments = [run, ...rightFragments.reverse()];

      // Update atom sourceRunElement pointers to the correct fragment.
      // Each span maps to one fragment in order.
      for (let i = 0; i < spans.length; i++) {
        const fragment = fragments[i];
        if (!fragment) continue;
        for (const atom of spans[i]!.atoms) {
          atom.sourceRunElement = fragment;
        }
      }
    } catch (_err) {
      // DOM operation failed — skip this run. The existing fallback-to-rebuild
      // architecture will handle it if the overall safety check fails.
      warn('preSplitInsProvenanceRuns', `Skipping run split due to error: ${_err}`);
    }
  }
}

/**
 * Pre-split revised-tree runs where word-split Equal atoms from the same run
 * are interleaved with Deleted/MovedSource atoms in the merged atom list.
 *
 * `preSplitMixedStatusRuns` handles the case where a single run contains atoms
 * with DIFFERENT statuses (e.g., some Equal and some Inserted). But it cannot
 * handle the case where ALL atoms from a run are Equal yet Deleted atoms (from
 * the original tree) are interspersed between them in the merged list.
 *
 * Without this split, `handleEqual` sees all Equal atoms pointing to the same
 * run and skips position advancement (the `lastRevisedRunAnchor` optimization).
 * Subsequent `handleDeleted` calls then insert deleted content at the wrong
 * position because the cursor never advanced past the shared run.
 *
 * This function detects interleaved sequences and splits the DOM run so each
 * contiguous group of Equal atoms gets its own run fragment. The handlers then
 * advance the cursor correctly across fragments.
 */
export function preSplitInterleavedWordRuns(mergedAtoms: ComparisonUnitAtom[]): void {
  // Build a map from each revised run to the groups of contiguous atoms from
  // that run as they appear in the merged atom list. Each group also tracks
  // the cumulative visible offset within the run.
  //
  // A "group" is a contiguous subsequence of merged atoms that all share the
  // same sourceRunElement and are NOT Deleted/MovedSource (i.e., they come
  // from the revised tree).
  interface AtomGroup {
    /** Start offset (in visible characters) of this group within the run */
    startOffset: number;
    /** Total visible length of atoms in this group */
    length: number;
    /** Atoms in this group */
    atoms: ComparisonUnitAtom[];
  }

  const runToGroups = new Map<Element, AtomGroup[]>();
  // Track cumulative offset per run (sums visible lengths of atoms seen so far)
  const runToOffset = new Map<Element, number>();

  let lastRevisedRun: Element | null = null;

  for (const atom of mergedAtoms) {
    // Skip atoms from the original tree (Deleted/MovedSource have runs in the
    // original tree, not the revised tree).
    if (
      atom.correlationStatus === CorrelationStatus.Deleted ||
      atom.correlationStatus === CorrelationStatus.MovedSource
    ) {
      // A Deleted/MovedSource atom between Equal atoms from the same run
      // creates an interleaving gap. Mark this by clearing lastRevisedRun
      // so the next Equal atom from the same run starts a new group.
      lastRevisedRun = null;
      continue;
    }

    const run = atom.sourceRunElement;
    if (!run) continue;

    // Skip collapsed field atoms — multi-run field sequences.
    if (atom.collapsedFieldAtoms && atom.collapsedFieldAtoms.length > 0) continue;

    // Skip field character elements — semantically fragile.
    if (FIELD_CHAR_TAG_NAMES.has(atom.contentElement.tagName)) continue;

    const atomLen = atomContentVisibleLength(atom.contentElement);
    const currentOffset = runToOffset.get(run) ?? 0;
    runToOffset.set(run, currentOffset + atomLen);

    const groups = runToGroups.get(run);
    if (!groups) {
      // First time seeing this run — create initial group.
      runToGroups.set(run, [{
        startOffset: currentOffset,
        length: atomLen,
        atoms: [atom],
      }]);
      lastRevisedRun = run;
      continue;
    }

    if (lastRevisedRun === run) {
      // Contiguous with the previous atom from the same run — extend group.
      const lastGroup = groups[groups.length - 1]!;
      lastGroup.length += atomLen;
      lastGroup.atoms.push(atom);
    } else {
      // Gap detected (a Deleted/MovedSource atom intervened). Start new group.
      groups.push({
        startOffset: currentOffset,
        length: atomLen,
        atoms: [atom],
      });
    }

    lastRevisedRun = run;
  }

  // Now split runs that have more than one group.
  for (const [run, groups] of runToGroups) {
    if (groups.length <= 1) continue;

    // Guard: skip runs already detached from the tree.
    if (!run.parentNode) continue;

    try {
      // Compute actual visible length of the DOM run.
      const contentEls = getDirectContentElements(run);
      let runVisibleLength = 0;
      for (const cel of contentEls) {
        runVisibleLength += visibleLengthForEl(cel);
      }

      // Safety: if the sum of atom lengths exceeds run visible length,
      // something is off (cross-run atoms, etc.). Skip.
      let sumAtomLengths = 0;
      for (const group of groups) {
        sumAtomLengths += group.length;
      }
      if (sumAtomLengths > runVisibleLength) continue;

      // Collect split points: the startOffset of each group after the first.
      const splitPoints: number[] = [];
      for (let i = 1; i < groups.length; i++) {
        const pt = groups[i]!.startOffset;
        if (pt > 0 && pt < runVisibleLength) {
          splitPoints.push(pt);
        }
      }

      if (splitPoints.length === 0) continue;

      // Split DOM run right-to-left to keep earlier offsets valid.
      const rightFragments: Element[] = [];
      for (let i = splitPoints.length - 1; i >= 0; i--) {
        const { right } = splitRunAtVisibleOffset(run, splitPoints[i]!);
        rightFragments.push(right);
      }

      // Map fragments: [originalRun (leftmost), ...reverse(rightFragments)]
      const fragments = [run, ...rightFragments.reverse()];

      // Update atom sourceRunElement pointers to the correct fragment.
      for (let i = 0; i < groups.length; i++) {
        const fragment = fragments[i];
        if (!fragment) continue;
        for (const atom of groups[i]!.atoms) {
          atom.sourceRunElement = fragment;
        }
      }
    } catch (_err) {
      warn('preSplitInterleavedWordRuns', `Skipping run split due to error: ${_err}`);
    }
  }
}
