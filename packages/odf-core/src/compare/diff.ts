/**
 * Pure paragraph-level diff for ODF comparison (Slice 1).
 *
 * A language-agnostic O(N·M) LCS over two arrays of paragraph visible-text strings, returning a
 * structured edit script in standard diff order. No DOM — this mirrors docx-core's `atomLcs.ts`
 * (kept separate from emission so it is testable in isolation).
 *
 * Order convention: a paragraph "replaced" in place (text differs at a matched slot) surfaces as
 * a `delete` of the original immediately followed by an `insert` of the revised, because at a
 * mismatch we prefer the deletion branch. The emitter relies on this delete-before-insert order
 * when both anchor at the same position.
 */

/** One step of the edit script, in merged document order. */
export type EditOp =
  | { kind: 'equal'; originalIndex: number; revisedIndex: number }
  | { kind: 'insert'; revisedIndex: number }
  | { kind: 'delete'; originalIndex: number }
  | { kind: 'modify'; originalIndex: number; revisedIndex: number };

/**
 * Diff two paragraph-text arrays into an ordered edit script.
 * `equal` ops carry both indices; `insert` carries the revised index; `delete` the original index.
 */
export function diffParagraphs(original: string[], revised: string[]): EditOp[] {
  const n = original.length;
  const m = revised.length;

  // dp[i][j] = LCS length of original[i..] and revised[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        original[i] === revised[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const ops: EditOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (original[i] === revised[j]) {
      ops.push({ kind: 'equal', originalIndex: i, revisedIndex: j });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      // Prefer deletion at a tie so a replace surfaces as delete-then-insert.
      ops.push({ kind: 'delete', originalIndex: i });
      i++;
    } else {
      ops.push({ kind: 'insert', revisedIndex: j });
      j++;
    }
  }
  while (i < n) ops.push({ kind: 'delete', originalIndex: i++ });
  while (j < m) ops.push({ kind: 'insert', revisedIndex: j++ });
  return ops;
}

/**
 * Below this Jaccard word-overlap, an aligned delete/insert pair is a replacement, not an
 * in-place edit. Matches docx-core's `DEFAULT_PARAGRAPH_SIMILARITY_THRESHOLD` reference point.
 */
export const DEFAULT_ODF_SIMILARITY_THRESHOLD = 0.25;

/** Normalized word set for similarity: lowercase, punctuation stripped, whitespace collapsed. */
function similarityWords(text: string): Set<string> {
  return new Set(
    text
      .replace(/[^\w\s]/g, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0),
  );
}

/** Jaccard word overlap; 0 when either side has no words (empty paragraphs never pair). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/**
 * Post-pass over a `diffParagraphs` script: inside each gap (a run of deletes followed by a run
 * of inserts between two anchors — the order `diffParagraphs`'s tie-break guarantees), convert
 * similar delete/insert pairs into `modify` ops.
 *
 * Pairing is an order-constrained DP, deterministic by construction: maximize the pair count,
 * then the total Jaccard similarity; a pair is admissible only when similarity ≥
 * `similarityThreshold`. At ties, pairing beats skipping, and skipping a delete beats skipping
 * an insert (keeps the delete-first convention). Output preserves merged document order:
 * between pairs, unpaired deletes precede unpaired inserts, exactly as Slice 1 emitted them.
 */
export function pairModifications(
  ops: EditOp[],
  original: string[],
  revised: string[],
  similarityThreshold: number = DEFAULT_ODF_SIMILARITY_THRESHOLD,
): EditOp[] {
  const out: EditOp[] = [];
  let gapDeletes: number[] = [];
  let gapInserts: number[] = [];

  const flushGap = (): void => {
    if (gapDeletes.length === 0 || gapInserts.length === 0) {
      for (const d of gapDeletes) out.push({ kind: 'delete', originalIndex: d });
      for (const ins of gapInserts) out.push({ kind: 'insert', revisedIndex: ins });
      gapDeletes = [];
      gapInserts = [];
      return;
    }

    const delWords = gapDeletes.map((d) => similarityWords(original[d] ?? ''));
    const insWords = gapInserts.map((ins) => similarityWords(revised[ins] ?? ''));
    const sim = (a: number, b: number): number => jaccard(delWords[a]!, insWords[b]!);

    // dp[a][b] = best (pairCount, simSum) over gapDeletes[a..] × gapInserts[b..].
    const d = gapDeletes.length;
    const m2 = gapInserts.length;
    const count: number[][] = Array.from({ length: d + 1 }, () => new Array<number>(m2 + 1).fill(0));
    const sum: number[][] = Array.from({ length: d + 1 }, () => new Array<number>(m2 + 1).fill(0));
    for (let a = d - 1; a >= 0; a--) {
      for (let b = m2 - 1; b >= 0; b--) {
        let bestCount = count[a + 1]![b]!;
        let bestSum = sum[a + 1]![b]!;
        if (count[a]![b + 1]! > bestCount || (count[a]![b + 1]! === bestCount && sum[a]![b + 1]! > bestSum)) {
          bestCount = count[a]![b + 1]!;
          bestSum = sum[a]![b + 1]!;
        }
        const s = sim(a, b);
        if (s >= similarityThreshold) {
          const pairCount = count[a + 1]![b + 1]! + 1;
          const pairSum = sum[a + 1]![b + 1]! + s;
          if (pairCount > bestCount || (pairCount === bestCount && pairSum > bestSum)) {
            bestCount = pairCount;
            bestSum = pairSum;
          }
        }
        count[a]![b] = bestCount;
        sum[a]![b] = bestSum;
      }
    }

    // Backtrack with the stated preference order: pair > skip-delete > skip-insert. Skipped ops
    // buffer until the next pair (or the end) so each segment emits deletes-then-inserts, the
    // same per-gap order Slice 1 produced.
    let a = 0;
    let b = 0;
    let pendingDeletes: number[] = [];
    let pendingInserts: number[] = [];
    const flushPending = (): void => {
      for (const pd of pendingDeletes) out.push({ kind: 'delete', originalIndex: pd });
      for (const pi of pendingInserts) out.push({ kind: 'insert', revisedIndex: pi });
      pendingDeletes = [];
      pendingInserts = [];
    };
    while (a < d && b < m2) {
      const s = sim(a, b);
      const pairCount = s >= similarityThreshold ? count[a + 1]![b + 1]! + 1 : -1;
      const pairSum = s >= similarityThreshold ? sum[a + 1]![b + 1]! + s : 0;
      if (pairCount === count[a]![b]! && pairSum === sum[a]![b]!) {
        flushPending();
        out.push({ kind: 'modify', originalIndex: gapDeletes[a]!, revisedIndex: gapInserts[b]! });
        a++;
        b++;
      } else if (count[a + 1]![b]! === count[a]![b]! && sum[a + 1]![b]! === sum[a]![b]!) {
        pendingDeletes.push(gapDeletes[a]!);
        a++;
      } else {
        pendingInserts.push(gapInserts[b]!);
        b++;
      }
    }
    while (a < d) pendingDeletes.push(gapDeletes[a++]!);
    while (b < m2) pendingInserts.push(gapInserts[b++]!);
    flushPending();
    gapDeletes = [];
    gapInserts = [];
  };

  for (const op of ops) {
    if (op.kind === 'delete') {
      gapDeletes.push(op.originalIndex);
    } else if (op.kind === 'insert') {
      gapInserts.push(op.revisedIndex);
    } else {
      flushGap();
      out.push(op);
    }
  }
  flushGap();
  return out;
}
