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
  | { kind: 'delete'; originalIndex: number };

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
