/**
 * Hierarchical LCS Comparison
 *
 * Implements two-level comparison like WmlComparer:
 * 1. First pass: LCS on paragraph GROUPS (coarse alignment)
 * 2. Second pass: LCS on atoms WITHIN matched groups (fine alignment)
 *
 * This prevents atoms from one paragraph matching random fragments
 * in other paragraphs.
 *
 * Additionally, large paragraphs (like definition sections) are split
 * on soft breaks (w:br) to prevent cross-definition contamination.
 */

import type { ComparisonUnitAtom } from '../../core-types.js';
import { CorrelationStatus } from '../../core-types.js';
import { sha1, EMPTY_PARAGRAPH_TAG } from '../../atomizer.js';
import { computeAtomLcs, type LcsResult } from './atomLcs.js';
import { debug } from './debug.js';

/**
 * Maximum atoms in a group before we split on w:br boundaries.
 * This handles mega-paragraphs like definition sections.
 */
const MAX_ATOMS_BEFORE_SPLIT = 50;

/**
 * Default paragraph-level similarity threshold used for group matching.
 *
 * Lower values favor treating modified paragraphs as aligned pairs (so atom-level
 * comparison can run), while higher values favor whole-paragraph replacement.
 */
export const DEFAULT_PARAGRAPH_SIMILARITY_THRESHOLD = 0.25;

/**
 * A group of atoms belonging to the same paragraph.
 * Used for paragraph-level comparison.
 */
export interface ComparisonUnitGroup {
  /** Paragraph index from atom.paragraphIndex */
  paragraphIndex: number;
  /** Atoms in this paragraph */
  atoms: ComparisonUnitAtom[];
  /** Hash of concatenated text content for paragraph-level matching */
  textHash: string;
  /** Hash of normalized text used only for matching heuristics */
  normalizedTextHash: string;
  /** Concatenated text content for similarity calculation */
  textContent: string;
}

/**
 * Options for hierarchical comparison.
 */
export interface HierarchicalCompareOptions {
  /** Minimum similarity (0-1) to consider groups as matching. Default: 0.25 */
  similarityThreshold?: number;
}

/**
 * Result of paragraph-level LCS comparison.
 */
export interface GroupLcsResult {
  /** Matched paragraph pairs */
  matchedGroups: Array<{ originalIndex: number; revisedIndex: number; containerMatch?: boolean }>;
  /** Indices of paragraphs only in original (deleted) */
  deletedGroupIndices: number[];
  /** Indices of paragraphs only in revised (inserted) */
  insertedGroupIndices: number[];
}

/**
 * Group atoms by paragraph index.
 *
 * @param atoms - Atoms with paragraphIndex set
 * @returns Array of paragraph groups in document order
 */
export function groupAtomsByParagraphIndex(
  atoms: ComparisonUnitAtom[]
): ComparisonUnitGroup[] {
  const groups = new Map<number, ComparisonUnitAtom[]>();

  for (const atom of atoms) {
    const idx = atom.paragraphIndex ?? -1;
    if (!groups.has(idx)) {
      groups.set(idx, []);
    }
    groups.get(idx)!.push(atom);
  }

  // Convert to array sorted by paragraph index
  const result: ComparisonUnitGroup[] = [];
  const sortedIndices = [...groups.keys()].sort((a, b) => a - b);

  for (const idx of sortedIndices) {
    const atoms = groups.get(idx)!;
    const textContent = extractGroupTextContent(atoms);

    // For empty paragraph groups, use the atom's sha1Hash (which has context)
    // instead of the empty text hash. This prevents all empty paragraphs from
    // matching each other regardless of position.
    const isEmptyParagraphGroup = atoms.length === 1 &&
      atoms[0]!.contentElement.tagName === EMPTY_PARAGRAPH_TAG;

    const textHash = isEmptyParagraphGroup
      ? atoms[0]!.sha1Hash  // Use context-aware atom hash
      : sha1(textContent);
    const normalizedTextHash = isEmptyParagraphGroup
      ? textHash
      : sha1(normalizeText(textContent));

    result.push({
      paragraphIndex: idx,
      atoms,
      textHash,
      normalizedTextHash,
      textContent,
    });
  }

  return result;
}

/**
 * Create a ComparisonUnitGroup from a list of atoms.
 */
function createGroup(
  atoms: ComparisonUnitAtom[],
  groupIndex: number
): ComparisonUnitGroup {
  const textContent = extractGroupTextContent(atoms);

  // For empty paragraph groups, use the atom's sha1Hash (which has context)
  const isEmptyGroup = atoms.length === 1 &&
    atoms[0]!.contentElement.tagName === EMPTY_PARAGRAPH_TAG;

  const textHash = isEmptyGroup
    ? atoms[0]!.sha1Hash
    : sha1(textContent);
  const normalizedTextHash = isEmptyGroup
    ? textHash
    : sha1(normalizeText(textContent));

  return {
    paragraphIndex: groupIndex,
    atoms,
    textHash,
    normalizedTextHash,
    textContent,
  };
}

/**
 * Group atoms by paragraph, then split large paragraphs on soft breaks (w:br).
 *
 * This handles mega-paragraphs like definition sections where many definitions
 * are in a single paragraph separated by soft breaks. Without this split,
 * the atom-level LCS can match fragments across definition boundaries.
 *
 * @param atoms - Atoms with paragraphIndex set
 * @returns Array of groups, potentially more than the number of paragraphs
 */
export function groupAtomsByParagraphAndBreaks(
  atoms: ComparisonUnitAtom[]
): ComparisonUnitGroup[] {
  // First, group by paragraph index
  const paragraphMap = new Map<number, ComparisonUnitAtom[]>();

  for (const atom of atoms) {
    const idx = atom.paragraphIndex ?? -1;
    if (!paragraphMap.has(idx)) {
      paragraphMap.set(idx, []);
    }
    paragraphMap.get(idx)!.push(atom);
  }

  // Convert to array sorted by paragraph index
  const sortedIndices = [...paragraphMap.keys()].sort((a, b) => a - b);

  // Now process each paragraph, splitting large ones on w:br
  const result: ComparisonUnitGroup[] = [];
  let groupIndex = 0;

  for (const paraIdx of sortedIndices) {
    const paraAtoms = paragraphMap.get(paraIdx)!;

    // Small paragraph - keep as-is
    if (paraAtoms.length <= MAX_ATOMS_BEFORE_SPLIT) {
      result.push(createGroup(paraAtoms, groupIndex++));
      continue;
    }

    // Large paragraph - split on w:br boundaries
    let currentAtoms: ComparisonUnitAtom[] = [];

    for (const atom of paraAtoms) {
      currentAtoms.push(atom);

      // Split AFTER w:br (keep the break with the preceding content)
      if (atom.contentElement.tagName === 'w:br') {
        if (currentAtoms.length > 0) {
          result.push(createGroup(currentAtoms, groupIndex++));
          currentAtoms = [];
        }
      }
    }

    // Don't forget trailing atoms after last break
    if (currentAtoms.length > 0) {
      result.push(createGroup(currentAtoms, groupIndex++));
    }
  }

  return result;
}

/**
 * Extract concatenated text content from a group of atoms.
 * Used for paragraph-level comparison and similarity calculation.
 */
function extractGroupTextContent(atoms: ComparisonUnitAtom[]): string {
  const textParts: string[] = [];

  for (const atom of atoms) {
    // Treat run separators as visible token boundaries for similarity purposes.
    if (
      atom.contentElement.tagName === 'w:br' ||
      atom.contentElement.tagName === 'w:cr' ||
      atom.contentElement.tagName === 'w:tab'
    ) {
      textParts.push(' ');
      continue;
    }

    const text = atom.contentElement.textContent;
    if (text) {
      textParts.push(text);
    }
  }

  return textParts.join('');
}

/**
 * Normalize text for similarity comparison.
 * - Trim whitespace
 * - Collapse multiple spaces
 * - Lowercase for case-insensitive comparison
 *
 * NOTE: Do NOT strip punctuation here — this function feeds normalizedTextHash
 * which is used for Pass 1 anchoring. Changing it would alter which paragraphs
 * are considered coarsely equal. Punctuation stripping is in tokenize() only.
 */
function normalizeText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// =============================================================================
// TF-IDF Similarity
// =============================================================================

/** Precomputed TF-IDF vector for a paragraph group. */
interface TfidfVector {
  /** Sparse vector: word → TF-IDF weight */
  vector: Map<string, number>;
  /** Precomputed magnitude for O(1) cosine similarity */
  magnitude: number;
}

/**
 * Build an IDF (inverse document frequency) map from all paragraph groups.
 *
 * IDF(word) = log(totalGroups / groupsContainingWord)
 *
 * Words appearing in many paragraphs (legal boilerplate like "holders",
 * "Corporation", "Preferred Stock") get low weight. Distinctive words
 * ("Liquidation", "Dividends") get high weight.
 */
function buildIdfMap(groups: ComparisonUnitGroup[]): Map<string, number> {
  const docFreq = new Map<string, number>();
  const totalGroups = groups.length;

  for (const group of groups) {
    if (isEmptyParagraphGroup(group)) continue;
    const words = new Set(tokenize(group.textContent));
    for (const word of words) {
      docFreq.set(word, (docFreq.get(word) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [word, freq] of docFreq) {
    idf.set(word, Math.log(totalGroups / freq));
  }
  return idf;
}

/**
 * Build a precomputed TF-IDF vector for a paragraph group.
 *
 * TF(word) = count(word in paragraph) / totalWords
 * TF-IDF(word) = TF(word) * IDF(word)
 */
function buildTfidfVector(group: ComparisonUnitGroup, idf: Map<string, number>): TfidfVector {
  const words = tokenize(group.textContent);
  if (words.length === 0) {
    return { vector: new Map(), magnitude: 0 };
  }

  // Count term frequencies
  const tf = new Map<string, number>();
  for (const word of words) {
    tf.set(word, (tf.get(word) ?? 0) + 1);
  }

  // Build TF-IDF vector
  const vector = new Map<string, number>();
  let sumSquares = 0;
  for (const [word, count] of tf) {
    const tfidf = (count / words.length) * (idf.get(word) ?? 0);
    if (tfidf > 0) {
      vector.set(word, tfidf);
      sumSquares += tfidf * tfidf;
    }
  }

  return { vector, magnitude: Math.sqrt(sumSquares) };
}

/**
 * Compute cosine similarity between two precomputed TF-IDF vectors.
 */
function computeTfidfCosineSimilarity(a: TfidfVector, b: TfidfVector): number {
  if (a.magnitude === 0 || b.magnitude === 0) return 0;

  // Iterate over the smaller vector for efficiency
  const [smaller, larger] = a.vector.size <= b.vector.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [word, weight] of smaller.vector) {
    const otherWeight = larger.vector.get(word);
    if (otherWeight !== undefined) {
      dot += weight * otherWeight;
    }
  }

  return dot / (a.magnitude * b.magnitude);
}

/**
 * Tokenize text into words for TF-IDF.
 * Strips punctuation (unlike normalizeText) so that "Corporation," and
 * "Corporation" produce the same token.
 */
function tokenize(text: string): string[] {
  return text
    .trim()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
    .split(' ')
    .filter(w => w.length > 0);
}

/**
 * Check if a group contains only empty paragraph atoms.
 */
function isEmptyParagraphGroup(group: ComparisonUnitGroup): boolean {
  return group.atoms.length === 1 &&
    group.atoms[0]!.contentElement.tagName === EMPTY_PARAGRAPH_TAG;
}

/**
 * Paragraph groups are considered coarse-equal if:
 * 1) Their raw text hash matches exactly, or
 * 2) Their normalized-text hash matches (heuristic assist only).
 *
 * Empty paragraphs intentionally require strict hash equality.
 */
function groupsCoarselyEqual(a: ComparisonUnitGroup, b: ComparisonUnitGroup): boolean {
  if (a.textHash === b.textHash) {
    return true;
  }
  if (isEmptyParagraphGroup(a) || isEmptyParagraphGroup(b)) {
    return false;
  }
  return a.normalizedTextHash === b.normalizedTextHash;
}

/**
 * Compute similarity between two groups using Jaccard index on words.
 *
 * @returns Value between 0 (completely different) and 1 (identical)
 */
function computeGroupSimilarity(a: ComparisonUnitGroup, b: ComparisonUnitGroup): number {
  // For empty paragraph groups, only consider them similar if their
  // context-aware hashes match. This prevents empty paragraphs from
  // matching each other regardless of position.
  if (isEmptyParagraphGroup(a) || isEmptyParagraphGroup(b)) {
    // If one is empty and the other isn't, they're not similar
    if (isEmptyParagraphGroup(a) !== isEmptyParagraphGroup(b)) {
      return 0;
    }
    // Both are empty paragraph groups - compare their context-aware hashes
    // They must match exactly (return 1) or not at all (return 0)
    return a.textHash === b.textHash ? 1 : 0;
  }

  const textA = normalizeText(a.textContent);
  const textB = normalizeText(b.textContent);

  const wordsA = new Set(textA.split(' ').filter(w => w.length > 0));
  const wordsB = new Set(textB.split(' ').filter(w => w.length > 0));

  if (wordsA.size === 0 && wordsB.size === 0) {
    return 1; // Both empty
  }
  if (wordsA.size === 0 || wordsB.size === 0) {
    return 0; // One empty
  }

  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

// =============================================================================
// Order-Constrained Gap Matching
// =============================================================================

/** A gap between two consecutive Pass 1 anchors. */
interface Gap {
  origIndices: number[];
  revIndices: number[];
}

/**
 * Build ordered gaps between consecutive Pass 1 anchors.
 *
 * Anchors divide both documents into regions. Similarity matching is scoped
 * to each gap — a source paragraph can only match a revised paragraph if both
 * fall within the same gap.
 */
function buildGaps(
  anchors: Array<{ originalIndex: number; revisedIndex: number }>,
  unmatchedOriginal: number[],
  unmatchedRevised: number[],
  n: number,
  m: number
): Gap[] {
  const gaps: Gap[] = [];

  // Sentinel boundaries: before first anchor and after last anchor
  const boundaries: Array<{ origBound: number; revBound: number }> = [
    { origBound: -1, revBound: -1 },
    ...anchors.map(a => ({ origBound: a.originalIndex, revBound: a.revisedIndex })),
    { origBound: n, revBound: m },
  ];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const lo = boundaries[i]!;
    const hi = boundaries[i + 1]!;

    const origInGap = unmatchedOriginal.filter(
      idx => idx > lo.origBound && idx < hi.origBound
    );
    const revInGap = unmatchedRevised.filter(
      idx => idx > lo.revBound && idx < hi.revBound
    );

    if (origInGap.length > 0 || revInGap.length > 0) {
      gaps.push({ origIndices: origInGap, revIndices: revInGap });
    }
  }

  return gaps;
}

/**
 * Run LCS within a gap using TF-IDF cosine similarity as the equality criterion.
 *
 * Two groups are "equal" (matchable) if their TF-IDF cosine similarity
 * exceeds the threshold. Standard DP LCS with backtracking.
 */
function similarityLcs(
  origIndices: number[],
  revIndices: number[],
  originalGroups: ComparisonUnitGroup[],
  revisedGroups: ComparisonUnitGroup[],
  tfidfVectors: Map<ComparisonUnitGroup, TfidfVector>,
  threshold: number
): Array<{ originalIndex: number; revisedIndex: number }> {
  const ni = origIndices.length;
  const nj = revIndices.length;

  // Similarity predicate for LCS equality check
  const similar = (oi: number, ri: number): boolean => {
    const origGroup = originalGroups[origIndices[oi]!]!;
    const revGroup = revisedGroups[revIndices[ri]!]!;
    const vecA = tfidfVectors.get(origGroup);
    const vecB = tfidfVectors.get(revGroup);
    if (!vecA || !vecB) return false;
    return computeTfidfCosineSimilarity(vecA, vecB) >= threshold;
  };

  // Standard DP LCS
  const dp: number[][] = Array(ni + 1)
    .fill(null)
    .map(() => Array(nj + 1).fill(0));

  for (let i = 1; i <= ni; i++) {
    for (let j = 1; j <= nj; j++) {
      if (similar(i - 1, j - 1)) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack
  const matches: Array<{ originalIndex: number; revisedIndex: number }> = [];
  let ci = ni;
  let cj = nj;
  while (ci > 0 && cj > 0) {
    if (similar(ci - 1, cj - 1)) {
      matches.unshift({
        originalIndex: origIndices[ci - 1]!,
        revisedIndex: revIndices[cj - 1]!,
      });
      ci--;
      cj--;
    } else if (dp[ci - 1]![cj]! > dp[ci]![cj - 1]!) {
      ci--;
    } else {
      cj--;
    }
  }

  return matches;
}

/**
 * Compute a container key for a paragraph group based on its first atom's ancestor chain.
 * Returns "" for body-level paragraphs, or a path like "w:tbl:0/w:tr:2/w:tc:1" for table cells.
 */
function getGroupContainerKey(group: ComparisonUnitGroup): string {
  const atom = group.atoms[0];
  if (!atom) return '';
  const parts: string[] = [];
  for (const el of atom.ancestorElements) {
    if (el.tagName === 'w:tc' || el.tagName === 'w:tr' || el.tagName === 'w:tbl') {
      let index = 0;
      let sibling = el.previousSibling;
      while (sibling) {
        if (sibling.nodeType === 1 && (sibling as Element).tagName === el.tagName) {
          index++;
        }
        sibling = sibling.previousSibling;
      }
      parts.push(`${el.tagName}:${index}`);
    }
  }
  return parts.join('/');
}

/**
 * Compute LCS on paragraph groups with order-constrained similarity fallback.
 *
 * Two passes:
 * 1. LCS with exact text hash matching (fast path)
 * 2. Order-constrained similarity matching: gap-scoped mini-LCS with TF-IDF
 *
 * @param originalGroups - Groups from original document
 * @param revisedGroups - Groups from revised document
 * @param similarityThreshold - Minimum TF-IDF cosine similarity for a match (default: 0.25)
 * @param tfidfVectors - Precomputed TF-IDF vectors for all groups
 */
export function computeGroupLcs(
  originalGroups: ComparisonUnitGroup[],
  revisedGroups: ComparisonUnitGroup[],
  similarityThreshold = DEFAULT_PARAGRAPH_SIMILARITY_THRESHOLD,
  tfidfVectors?: Map<ComparisonUnitGroup, TfidfVector>
): GroupLcsResult {
  const n = originalGroups.length;
  const m = revisedGroups.length;

  // === Pass 1: LCS with exact hash and normalized-hash matching ===
  const dp: number[][] = Array(n + 1)
    .fill(null)
    .map(() => Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (groupsCoarselyEqual(originalGroups[i - 1]!, revisedGroups[j - 1]!)) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to find matched groups
  const matchedGroups: Array<{ originalIndex: number; revisedIndex: number }> = [];
  let i = n;
  let j = m;

  while (i > 0 && j > 0) {
    if (groupsCoarselyEqual(originalGroups[i - 1]!, revisedGroups[j - 1]!)) {
      matchedGroups.unshift({ originalIndex: i - 1, revisedIndex: j - 1 });
      i--;
      j--;
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  // Find initially unmatched indices
  const matchedOriginal = new Set(matchedGroups.map((m) => m.originalIndex));
  const matchedRevised = new Set(matchedGroups.map((m) => m.revisedIndex));

  let unmatchedOriginal: number[] = [];
  for (let idx = 0; idx < n; idx++) {
    if (!matchedOriginal.has(idx)) {
      unmatchedOriginal.push(idx);
    }
  }

  let unmatchedRevised: number[] = [];
  for (let idx = 0; idx < m; idx++) {
    if (!matchedRevised.has(idx)) {
      unmatchedRevised.push(idx);
    }
  }

  // === Pass 2: Order-constrained similarity matching via gap-scoped LCS ===
  //
  // Pass 1 anchors divide both documents into "gaps" — regions between consecutive
  // exact matches. Similarity matching is scoped to each gap: a source paragraph can
  // only match a revised paragraph within the same gap. Within each gap, a mini-LCS
  // using TF-IDF cosine similarity preserves document order.
  //
  // This prevents two classes of bugs:
  // 1. Cross-anchor matches: Source[45] stealing Revised[20] across an anchor boundary
  // 2. Non-monotonic matches within a gap: greedy best-match could reorder paragraphs
  //
  // TF-IDF (instead of Jaccard) down-weights legal boilerplate words ("holders",
  // "Preferred Stock", "Corporation") that appear in many paragraphs, preventing
  // false matches on shared vocabulary.
  const similarityMatches: Array<{ originalIndex: number; revisedIndex: number }> = [];

  // Build gaps between consecutive Pass 1 anchors
  const gaps = buildGaps(matchedGroups, unmatchedOriginal, unmatchedRevised, n, m);

  // Run mini-LCS within each gap using TF-IDF similarity (if vectors available),
  // then fall back to Jaccard for any groups TF-IDF left unmatched.
  // TF-IDF degenerates when document frequency is very low (e.g. 1-2 paragraphs):
  // common words get IDF=0, making cosine similarity ≈ 0 even for paragraphs that
  // share most of their content. Jaccard word overlap handles this correctly. (#78)
  const tfidfMatchedOrig = new Set<number>();
  const tfidfMatchedRev = new Set<number>();

  if (tfidfVectors) {
    for (const gap of gaps) {
      if (gap.origIndices.length === 0 || gap.revIndices.length === 0) continue;

      const gapMatches = similarityLcs(
        gap.origIndices,
        gap.revIndices,
        originalGroups,
        revisedGroups,
        tfidfVectors,
        similarityThreshold
      );
      for (const m of gapMatches) {
        tfidfMatchedOrig.add(m.originalIndex);
        tfidfMatchedRev.add(m.revisedIndex);
      }
      similarityMatches.push(...gapMatches);
    }
  }

  // Jaccard fallback: match any groups that TF-IDF left unmatched (gap-scoped)
  for (const gap of gaps) {
    if (gap.origIndices.length === 0 || gap.revIndices.length === 0) continue;

    const candidates: Array<{ originalIndex: number; revisedIndex: number; similarity: number }> = [];
    for (const origIdx of gap.origIndices) {
      if (matchedOriginal.has(origIdx) || tfidfMatchedOrig.has(origIdx)) continue;
      for (const revIdx of gap.revIndices) {
        if (matchedRevised.has(revIdx) || tfidfMatchedRev.has(revIdx)) continue;
        const similarity = computeGroupSimilarity(originalGroups[origIdx]!, revisedGroups[revIdx]!);
        if (similarity >= similarityThreshold) {
          candidates.push({ originalIndex: origIdx, revisedIndex: revIdx, similarity });
        }
      }
    }
    candidates.sort((a, b) => b.similarity - a.similarity);
    const assigned = new Set<number>();
    const assignedRev = new Set<number>();
    for (const c of candidates) {
      if (assigned.has(c.originalIndex) || assignedRev.has(c.revisedIndex)) continue;
      similarityMatches.push({ originalIndex: c.originalIndex, revisedIndex: c.revisedIndex });
      assigned.add(c.originalIndex);
      assignedRev.add(c.revisedIndex);
    }
  }

  // Combine exact matches and similarity matches
  const allMatches: Array<{ originalIndex: number; revisedIndex: number; containerMatch?: boolean }> = [...matchedGroups, ...similarityMatches];

  // Update matched sets
  for (const match of similarityMatches) {
    matchedOriginal.add(match.originalIndex);
    matchedRevised.add(match.revisedIndex);
  }

  // === Pass 3 (issue #65): Container-position fallback ===
  //
  // After TF-IDF gap matching, some paragraphs remain unmatched because their
  // cosine similarity is below the threshold. This happens when the only differing
  // content is high-IDF words (e.g., company names in template fills).
  //
  // For unmatched paragraphs that are in the same structural container position
  // (same table cell by table/row/cell index), force a match. This preserves
  // paragraph alignment within table cells when the content is a template fill.
  unmatchedOriginal = [];
  for (let idx = 0; idx < n; idx++) {
    if (!matchedOriginal.has(idx)) unmatchedOriginal.push(idx);
  }
  unmatchedRevised = [];
  for (let idx = 0; idx < m; idx++) {
    if (!matchedRevised.has(idx)) unmatchedRevised.push(idx);
  }

  if (unmatchedOriginal.length > 0 && unmatchedRevised.length > 0) {
    // Build container keys for unmatched groups
    const origContainerKeys = new Map<number, string>();
    for (const idx of unmatchedOriginal) {
      const group = originalGroups[idx]!;
      if (group.atoms.length > 0) {
        origContainerKeys.set(idx, getGroupContainerKey(group));
      }
    }
    const revContainerKeys = new Map<number, string>();
    for (const idx of unmatchedRevised) {
      const group = revisedGroups[idx]!;
      if (group.atoms.length > 0) {
        revContainerKeys.set(idx, getGroupContainerKey(group));
      }
    }

    // For each unmatched original in a table cell, find an unmatched revised
    // in the same cell. Match greedily in document order.
    const usedRevised = new Set<number>();
    for (const origIdx of unmatchedOriginal) {
      const origKey = origContainerKeys.get(origIdx);
      if (!origKey) continue; // Not in a table cell

      for (const revIdx of unmatchedRevised) {
        if (usedRevised.has(revIdx)) continue;
        const revKey = revContainerKeys.get(revIdx);
        if (revKey === origKey) {
          allMatches.push({ originalIndex: origIdx, revisedIndex: revIdx, containerMatch: true });
          matchedOriginal.add(origIdx);
          matchedRevised.add(revIdx);
          usedRevised.add(revIdx);
          break;
        }
      }
    }
  }

  // Final deleted and inserted indices
  const deletedGroupIndices: number[] = [];
  for (let idx = 0; idx < n; idx++) {
    if (!matchedOriginal.has(idx)) {
      deletedGroupIndices.push(idx);
    }
  }

  const insertedGroupIndices: number[] = [];
  for (let idx = 0; idx < m; idx++) {
    if (!matchedRevised.has(idx)) {
      insertedGroupIndices.push(idx);
    }
  }

  return { matchedGroups: allMatches, deletedGroupIndices, insertedGroupIndices };
}

/**
 * Perform hierarchical LCS comparison.
 *
 * Pipeline:
 * 1. Group atoms by paragraph
 * 2. LCS on paragraph groups (coarse alignment) with similarity fallback
 * 3. For matched groups: LCS on atoms within them
 * 4. For unmatched groups: mark all atoms as deleted/inserted
 *
 * @param originalAtoms - Atoms from original document
 * @param revisedAtoms - Atoms from revised document
 * @param options - Comparison options including similarity threshold
 * @returns Combined atom-level LCS result
 */
export function hierarchicalCompare(
  originalAtoms: ComparisonUnitAtom[],
  revisedAtoms: ComparisonUnitAtom[],
  options: HierarchicalCompareOptions = {}
): LcsResult {
  const { similarityThreshold = DEFAULT_PARAGRAPH_SIMILARITY_THRESHOLD } = options;

  // Step 1: Group atoms by paragraph, splitting large paragraphs on w:br
  const originalGroups = groupAtomsByParagraphAndBreaks(originalAtoms);
  const revisedGroups = groupAtomsByParagraphAndBreaks(revisedAtoms);

  // Count empty paragraph groups
  const origEmptyGroups = originalGroups.filter(g => isEmptyParagraphGroup(g));
  const revEmptyGroups = revisedGroups.filter(g => isEmptyParagraphGroup(g));

  debug(
    'hierarchicalLcs',
    `${originalGroups.length} original groups (${origEmptyGroups.length} empty), ${revisedGroups.length} revised groups (${revEmptyGroups.length} empty)`
  );

  // Step 1b: Build TF-IDF vectors for all groups (computed once, used by Pass 2 + inline check)
  const allGroups = [...originalGroups, ...revisedGroups];
  const idfMap = buildIdfMap(allGroups);
  const tfidfVectors = new Map<ComparisonUnitGroup, TfidfVector>();
  for (const group of allGroups) {
    tfidfVectors.set(group, buildTfidfVector(group, idfMap));
  }

  // Step 2: LCS on paragraph groups with order-constrained similarity fallback
  const groupLcs = computeGroupLcs(originalGroups, revisedGroups, similarityThreshold, tfidfVectors);

  // Count empty paragraphs in each category
  const matchedEmptyCount = groupLcs.matchedGroups.filter(m =>
    isEmptyParagraphGroup(originalGroups[m.originalIndex]!)
  ).length;
  const deletedEmptyCount = groupLcs.deletedGroupIndices.filter(i =>
    isEmptyParagraphGroup(originalGroups[i]!)
  ).length;
  const insertedEmptyCount = groupLcs.insertedGroupIndices.filter(i =>
    isEmptyParagraphGroup(revisedGroups[i]!)
  ).length;

  debug(
    'hierarchicalLcs',
    `Group LCS: ${groupLcs.matchedGroups.length} matched (${matchedEmptyCount} empty), ${groupLcs.deletedGroupIndices.length} deleted (${deletedEmptyCount} empty), ${groupLcs.insertedGroupIndices.length} inserted (${insertedEmptyCount} empty)`
  );

  // Step 3: Build combined atom-level result
  const allMatches: Array<{ originalIndex: number; revisedIndex: number; containerMatch?: boolean }> = [];
  const deletedIndices: number[] = [];
  const insertedIndices: number[] = [];

  // Build atom index maps for quick lookup
  const origAtomToIndex = new Map<ComparisonUnitAtom, number>();
  for (let i = 0; i < originalAtoms.length; i++) {
    origAtomToIndex.set(originalAtoms[i]!, i);
  }

  const revAtomToIndex = new Map<ComparisonUnitAtom, number>();
  for (let i = 0; i < revisedAtoms.length; i++) {
    revAtomToIndex.set(revisedAtoms[i]!, i);
  }

  // For matched groups: always run atom-level LCS within them.
  // Group matching already determined these paragraphs correspond; the atom
  // LCS determines which words within them changed. Skipping it based on a
  // redundant TF-IDF similarity recheck was overly conservative and caused
  // entire paragraphs to show as deleted+inserted instead of inline changes
  // (see issue #78).
  for (const match of groupLcs.matchedGroups) {
    const origGroup = originalGroups[match.originalIndex]!;
    const revGroup = revisedGroups[match.revisedIndex]!;

    const withinLcs = computeAtomLcs(origGroup.atoms, revGroup.atoms);

    for (const atomMatch of withinLcs.matches) {
      const origAtom = origGroup.atoms[atomMatch.originalIndex]!;
      const revAtom = revGroup.atoms[atomMatch.revisedIndex]!;
      allMatches.push({
        originalIndex: origAtomToIndex.get(origAtom)!,
        revisedIndex: revAtomToIndex.get(revAtom)!,
      });
    }

    for (const localIdx of withinLcs.deletedIndices) {
      const origAtom = origGroup.atoms[localIdx]!;
      deletedIndices.push(origAtomToIndex.get(origAtom)!);
    }

    for (const localIdx of withinLcs.insertedIndices) {
      const revAtom = revGroup.atoms[localIdx]!;
      insertedIndices.push(revAtomToIndex.get(revAtom)!);
    }
  }

  // For deleted groups: mark all atoms as deleted
  for (const groupIdx of groupLcs.deletedGroupIndices) {
    const group = originalGroups[groupIdx]!;
    for (const atom of group.atoms) {
      deletedIndices.push(origAtomToIndex.get(atom)!);
    }
  }

  // For inserted groups: mark all atoms as inserted
  for (const groupIdx of groupLcs.insertedGroupIndices) {
    const group = revisedGroups[groupIdx]!;
    for (const atom of group.atoms) {
      insertedIndices.push(revAtomToIndex.get(atom)!);
    }
  }

  debug(
    'hierarchicalLcs',
    `Hierarchical result: ${allMatches.length} matches, ${deletedIndices.length} deleted, ${insertedIndices.length} inserted`
  );

  return {
    matches: allMatches,
    deletedIndices,
    insertedIndices,
  };
}

/**
 * Mark correlation status using hierarchical comparison result.
 *
 * Same as regular markCorrelationStatus but uses hierarchical LCS result.
 */
export function markHierarchicalCorrelationStatus(
  original: ComparisonUnitAtom[],
  revised: ComparisonUnitAtom[],
  lcsResult: LcsResult
): void {
  // Mark matched atoms as Equal and link them
  for (const match of lcsResult.matches) {
    const origAtom = original[match.originalIndex]!;
    const revAtom = revised[match.revisedIndex]!;

    origAtom.correlationStatus = CorrelationStatus.Equal;
    revAtom.correlationStatus = CorrelationStatus.Equal;

    // Link revised atom to original for format change detection
    revAtom.comparisonUnitAtomBefore = origAtom;
  }

  // Mark deleted atoms
  for (const idx of lcsResult.deletedIndices) {
    original[idx]!.correlationStatus = CorrelationStatus.Deleted;
  }

  // Mark inserted atoms
  for (const idx of lcsResult.insertedIndices) {
    revised[idx]!.correlationStatus = CorrelationStatus.Inserted;
  }
}
