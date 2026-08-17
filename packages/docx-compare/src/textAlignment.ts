export interface SequenceMatch {
  originalIndex: number;
  revisedIndex: number;
}

export interface SequenceAlignment {
  matches: SequenceMatch[];
  deletedIndices: number[];
  insertedIndices: number[];
}

const LEADING_EDGE_PUNCTUATION = new Set(["'", '"', '(', '[', '{', '<']);
const TRAILING_EDGE_PUNCTUATION = new Set([',', '.', ':', ';', '!', '?', "'", '"', ')', ']', '}', '>']);

function splitTokenAtPunctuationEdges(token: string): string[] {
  let coreStart = 0;
  while (coreStart < token.length && LEADING_EDGE_PUNCTUATION.has(token[coreStart]!)) coreStart++;
  let coreEnd = token.length;
  while (coreEnd > coreStart && TRAILING_EDGE_PUNCTUATION.has(token[coreEnd - 1]!)) coreEnd--;
  const parts: string[] = [];
  if (coreStart > 0) parts.push(token.slice(0, coreStart));
  if (coreEnd > coreStart) parts.push(token.slice(coreStart, coreEnd));
  if (coreEnd < token.length) parts.push(token.slice(coreEnd));
  return parts.length > 0 ? parts : [token];
}

/** Canonical comparison tokenization, independent of Word run boundaries. */
export function tokenizeComparisonText(text: string): string[] {
  const parts: string[] = [];
  for (const token of text.split(/(\s+)/u).filter(Boolean)) {
    if (/^\s+$/u.test(token)) {
      parts.push(token);
      continue;
    }
    parts.push(...splitTokenAtPunctuationEdges(token));
  }
  return parts;
}

/** Hardened forward LCS shared by atom and tagged-tree comparison. */
export function alignComparisonSequences<T>(
  original: readonly T[],
  revised: readonly T[],
  equal: (original: T, revised: T) => boolean,
): SequenceAlignment {
  const dp = Array.from({ length: original.length + 1 }, () =>
    Array<number>(revised.length + 1).fill(0));
  for (let i = original.length - 1; i >= 0; i--) {
    for (let j = revised.length - 1; j >= 0; j--) {
      dp[i]![j] = equal(original[i]!, revised[j]!)
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const matches: SequenceMatch[] = [];
  let i = 0;
  let j = 0;
  while (i < original.length && j < revised.length) {
    if (equal(original[i]!, revised[j]!)) matches.push({ originalIndex: i++, revisedIndex: j++ });
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  const matchedOriginal = new Set(matches.map((match) => match.originalIndex));
  const matchedRevised = new Set(matches.map((match) => match.revisedIndex));
  return {
    matches,
    deletedIndices: original.map((_, index) => index).filter((index) => !matchedOriginal.has(index)),
    insertedIndices: revised.map((_, index) => index).filter((index) => !matchedRevised.has(index)),
  };
}
