/**
 * Pure intra-paragraph diff for ODF comparison (issue #356).
 *
 * Token-level LCS over a single paragraph pair's visible text, returning char-offset spans.
 * Tokens are maximal runs of whitespace or non-whitespace — a partition of the string — so
 * every token boundary maps losslessly back to a character offset and the emitted spans land
 * on clean word boundaries (no ragged mid-word matches). Common token prefix/suffix are
 * trimmed before the O(N·M) DP, so the dominant case — one edited word in a long clause —
 * costs close to the edit size, not the paragraph size.
 *
 * Order convention mirrors `diffParagraphs`: at a mismatch the deletion branch wins, so a
 * replaced word surfaces as a `delete` immediately followed by an `insert` sharing `revStart`.
 * The emitter relies on that ordering when both anchor at the same offset.
 *
 * A grouping post-pass keeps multi-word replacements readable (issue #378): the LCS matches the
 * space between two replaced words as `equal`, which would otherwise split one logical
 * replacement into per-word delete/insert pairs. Change windows bridged by whitespace-only
 * equal spans collapse into a single delete+insert pair whenever both kinds are present.
 */

/**
 * One span of the intra-paragraph edit script, as half-open char offsets into the two visible
 * strings. `insert` spans have `origStart === origEnd`; `delete` spans have
 * `revStart === revEnd`; `equal` spans have the same length on both sides.
 */
export type SpanOp = {
  kind: 'equal' | 'insert' | 'delete';
  origStart: number;
  origEnd: number;
  revStart: number;
  revEnd: number;
};

/** Split into maximal whitespace / non-whitespace runs (a partition: tokens concat to the input). */
function tokenizeRuns(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

/**
 * Diff two visible-text strings into an ordered span script.
 * Adjacent same-kind spans are coalesced; zero-length spans are never emitted.
 */
export function diffInline(original: string, revised: string): SpanOp[] {
  const origTokens = tokenizeRuns(original);
  const revTokens = tokenizeRuns(revised);

  // Trim the common token prefix/suffix; the DP only sees the differing middle window.
  let prefix = 0;
  const maxPrefix = Math.min(origTokens.length, revTokens.length);
  while (prefix < maxPrefix && origTokens[prefix] === revTokens[prefix]) prefix++;
  let suffix = 0;
  const maxSuffix = Math.min(origTokens.length, revTokens.length) - prefix;
  while (
    suffix < maxSuffix &&
    origTokens[origTokens.length - 1 - suffix] === revTokens[revTokens.length - 1 - suffix]
  ) {
    suffix++;
  }

  const midOrig = origTokens.slice(prefix, origTokens.length - suffix);
  const midRev = revTokens.slice(prefix, revTokens.length - suffix);

  // dp[i][j] = LCS length of midOrig[i..] and midRev[j..] (same shape as diffParagraphs).
  const n = midOrig.length;
  const m = midRev.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        midOrig[i] === midRev[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  // Walk tokens emitting per-token kinds, tracking char cursors in both strings.
  const ops: SpanOp[] = [];
  let origPos = 0;
  let revPos = 0;
  const push = (kind: SpanOp['kind'], origLen: number, revLen: number): void => {
    if (origLen === 0 && revLen === 0) return;
    const last = ops[ops.length - 1];
    if (last && last.kind === kind) {
      last.origEnd += origLen;
      last.revEnd += revLen;
    } else {
      ops.push({
        kind,
        origStart: origPos,
        origEnd: origPos + origLen,
        revStart: revPos,
        revEnd: revPos + revLen,
      });
    }
    origPos += origLen;
    revPos += revLen;
  };

  for (let k = 0; k < prefix; k++) push('equal', origTokens[k]!.length, revTokens[k]!.length);

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midOrig[i] === midRev[j]) {
      push('equal', midOrig[i]!.length, midRev[j]!.length);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      // Prefer deletion at a tie so a replaced word surfaces as delete-then-insert.
      push('delete', midOrig[i]!.length, 0);
      i++;
    } else {
      push('insert', 0, midRev[j]!.length);
      j++;
    }
  }
  while (i < n) push('delete', midOrig[i++]!.length, 0);
  while (j < m) push('insert', 0, midRev[j++]!.length);

  for (let k = suffix; k > 0; k--) {
    push('equal', origTokens[origTokens.length - k]!.length, revTokens[revTokens.length - k]!.length);
  }

  return groupBridgedReplacements(ops, original);
}

/**
 * Collapse change windows bridged by whitespace-only `equal` spans into one delete+insert pair.
 *
 * Replacing two adjacent words ("Zephyr BioSystems" → "Acme Manufacturing") leaves the space
 * between them `equal`, splitting the replacement into interleaved per-word pairs — a redline
 * that reads `Acme ~~Zephyr~~ Manufacturing ~~BioSystems~~`. A window of change spans may absorb
 * an equal span only when it is whitespace-only AND has change spans on BOTH sides (kept words
 * never join a window). A window containing at least one delete and one insert is rewritten as a
 * single pair: the delete covers every original char in the window (bridge whitespace included),
 * the insert every revised char, preserving the delete-before-insert / shared-`revStart`
 * convention and the lockstep-offset invariant. Delete-only and insert-only windows are left
 * alone — striking a kept space just to reinsert it would be noise, not grouping.
 */
function groupBridgedReplacements(ops: SpanOp[], original: string): SpanOp[] {
  const out: SpanOp[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i]!.kind === 'equal') {
      out.push(ops[i]!);
      i++;
      continue;
    }
    let end = i + 1;
    while (end < ops.length) {
      const op = ops[end]!;
      if (op.kind !== 'equal') {
        end++;
        continue;
      }
      const next = ops[end + 1];
      const bridge = original.slice(op.origStart, op.origEnd);
      if (/^\s+$/.test(bridge) && next && next.kind !== 'equal') {
        end += 2;
        continue;
      }
      break;
    }
    const window = ops.slice(i, end);
    const hasDelete = window.some((o) => o.kind === 'delete');
    const hasInsert = window.some((o) => o.kind === 'insert');
    if (hasDelete && hasInsert) {
      const first = window[0]!;
      const last = window[window.length - 1]!;
      out.push({
        kind: 'delete',
        origStart: first.origStart,
        origEnd: last.origEnd,
        revStart: first.revStart,
        revEnd: first.revStart,
      });
      out.push({
        kind: 'insert',
        origStart: last.origEnd,
        origEnd: last.origEnd,
        revStart: first.revStart,
        revEnd: last.revEnd,
      });
    } else {
      out.push(...window);
    }
    i = end;
  }
  return out;
}
