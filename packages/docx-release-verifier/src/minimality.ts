import { trackedParagraphViews } from './xml.js';
import type { Verdict } from './types.js';

const MAX_PARAGRAPHS = 512;
const MAX_TOKENS_PER_PARAGRAPH = 4096;
const MAX_DIAGNOSTICS = 64;

/**
 * Loss classification for diagnostics: `lexical` covers word and number
 * tokens, `punctuation` covers single non-word visible characters,
 * `structural` covers whitespace runs containing a tab or line break, and
 * `whitespace` covers plain inter-word space runs.
 */
export type TokenClass = 'lexical' | 'punctuation' | 'structural' | 'whitespace';

export type TokenClassCounts = Record<TokenClass, number>;

export interface MinimalityDiagnostic {
  originalParagraphIndex: number;
  revisedParagraphIndex: number;
  comparedParagraphIndex?: number;
  availableTokens: number;
  preservedTokens: number;
  lostTokens: number;
  lostTokensByClass: TokenClassCounts;
  efficiencyPercent: number;
  topology: 'identified' | 'identified_repeated' | 'unresolved_ambiguous_paragraph_topology';
}

export interface MinimalityEvidence {
  policy: 'authored-zero-loss';
  passed: boolean;
  availableTokens: number;
  preservedTokens: number;
  lostTokens: number;
  lostTokensByClass: TokenClassCounts;
  efficiencyPercent: number;
  comparedParagraphs: number;
  unresolvedTopologyParagraphs: number;
  paragraphDiagnostics: MinimalityDiagnostic[];
}

type Pair = { left: number; right: number };

function lcsPairs<T>(left: readonly T[], right: readonly T[]): Pair[] {
  const width = right.length + 1;
  const table = new Uint32Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      table[i * width + j] = left[i] === right[j]
        ? 1 + table[(i + 1) * width + j + 1]!
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const result: Pair[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      result.push({ left: i++, right: j++ });
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i++;
    else j++;
  }
  return result;
}

/** Exact tokens: whitespace runs, Unicode word runs, and individual punctuation. */
export function tokenizeExact(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

function isWhitespaceToken(token: string): boolean {
  return /^\s/u.test(token);
}

export function classifyToken(token: string): TokenClass {
  if (!isWhitespaceToken(token)) return /^[\p{L}\p{N}_]/u.test(token) ? 'lexical' : 'punctuation';
  return /[\t\n\r]/u.test(token) ? 'structural' : 'whitespace';
}

function emptyTokenClassCounts(): TokenClassCounts {
  return { lexical: 0, punctuation: 0, structural: 0, whitespace: 0 };
}

function countTokenClasses(tokens: readonly string[]): TokenClassCounts {
  const counts = emptyTokenClassCounts();
  for (const token of tokens) counts[classifyToken(token)] += 1;
  return counts;
}

/**
 * A common token that the finished redline is obliged to preserve. For a
 * whitespace token the anchor flags record why its original/revised match is
 * genuine rather than a coincidence of the token alphabet: every inter-word
 * space compares equal, so an anchor names either the identical matched
 * non-whitespace neighbor (preceding or following) or the shared paragraph
 * extremity (start or end) the run is pinned to.
 */
type CommonToken = {
  token: string;
  anchoredByPrecedingMatch: boolean;
  anchoredByFollowingMatch: boolean;
  anchoredAtParagraphStart: boolean;
  anchoredAtParagraphEnd: boolean;
};

/**
 * Common tokens between the original and revised paragraph texts that count
 * as preservation obligations. Non-whitespace matches always count. A
 * whitespace match counts only when anchored: the LCS also matched the
 * immediately adjacent token on both sides (positions `i-1`/`j-1` or
 * `i+1`/`j+1`, which is necessarily non-whitespace because whitespace runs
 * are tokenized maximally), or the run sits at the shared paragraph start or
 * end in both texts. Unanchored whitespace pairs — spaces the LCS paired
 * across otherwise unrelated rewritten phrases — are excluded, so a complete
 * phrase replacement is not charged for spaces it never actually preserved.
 */
function anchoredCommonTokens(originalTokens: readonly string[], revisedTokens: readonly string[]): CommonToken[] {
  const pairs = lcsPairs(originalTokens, revisedTokens);
  const result: CommonToken[] = [];
  pairs.forEach((pair, index) => {
    const token = originalTokens[pair.left]!;
    if (!isWhitespaceToken(token)) {
      result.push({ token, anchoredByPrecedingMatch: false, anchoredByFollowingMatch: false, anchoredAtParagraphStart: false, anchoredAtParagraphEnd: false });
      return;
    }
    const preceding = pairs[index - 1];
    const following = pairs[index + 1];
    const common: CommonToken = {
      token,
      anchoredByPrecedingMatch: preceding !== undefined
        && preceding.left === pair.left - 1 && preceding.right === pair.right - 1
        && !isWhitespaceToken(originalTokens[preceding.left]!),
      anchoredByFollowingMatch: following !== undefined
        && following.left === pair.left + 1 && following.right === pair.right + 1
        && !isWhitespaceToken(originalTokens[following.left]!),
      anchoredAtParagraphStart: pair.left === 0 && pair.right === 0,
      anchoredAtParagraphEnd: pair.left === originalTokens.length - 1 && pair.right === revisedTokens.length - 1,
    };
    if (common.anchoredByPrecedingMatch || common.anchoredByFollowingMatch || common.anchoredAtParagraphStart || common.anchoredAtParagraphEnd) result.push(common);
  });
  return result;
}

/**
 * An ordinary (non-revised) token of the tracked paragraph, tagged with the
 * ordinary text segment it came from. Segment boundaries mark content-bearing
 * revision wrappers, so two tokens in different segments are separated by
 * revised content in the document even though they are adjacent in the
 * flattened list.
 */
type OrdinaryToken = { token: string; segment: number };

function ordinaryTokens(segments: readonly string[]): OrdinaryToken[] {
  return segments.flatMap((text, segment) => tokenizeExact(text).map((token) => ({ token, segment })));
}

/**
 * Indices of the common tokens the tracked paragraph genuinely preserves as
 * ordinary text. Non-whitespace tokens align by LCS over the non-whitespace
 * subsequences and count directly. A whitespace token never aligns on its
 * own: it is credited only through one of its recorded anchors, so it must
 * claim the ordinary token physically adjacent to its own matched anchor —
 * equal text, in the same ordinary text segment (a whitespace run beyond a
 * revision wrapper is a different run, not the anchored one) — or, for a
 * positional anchor, the exact first or last ordinary token. Claims are
 * injective: an ordinary token credits at most one common token, so one
 * surviving space cannot stand in for several. Driving whitespace credit
 * from the anchor's own match, rather than from a single global LCS
 * traceback, keeps an equal-looking space elsewhere in the paragraph from
 * either rescuing a rewritten space or stealing credit from a kept one.
 */
function preservedCommonTokenIndices(common: readonly CommonToken[], ordinary: readonly OrdinaryToken[]): Set<number> {
  const commonWords = common.flatMap((item, index) => (isWhitespaceToken(item.token) ? [] : [{ token: item.token, index }]));
  const ordinaryWords = ordinary.flatMap((item, position) => (isWhitespaceToken(item.token) ? [] : [{ token: item.token, position }]));
  const preserved = new Set<number>();
  const claimed = new Set<number>();
  const anchorPositionByCommonIndex = new Map<number, number>();
  for (const pair of lcsPairs(commonWords.map((word) => word.token), ordinaryWords.map((word) => word.token))) {
    const commonIndex = commonWords[pair.left]!.index;
    const position = ordinaryWords[pair.right]!.position;
    preserved.add(commonIndex);
    claimed.add(position);
    anchorPositionByCommonIndex.set(commonIndex, position);
  }
  common.forEach((item, index) => {
    if (!isWhitespaceToken(item.token)) return;
    const claimAdjacent = (anchorPosition: number | undefined, offset: 1 | -1): boolean => {
      if (anchorPosition === undefined) return false;
      const position = anchorPosition + offset;
      const candidate = ordinary[position];
      if (candidate === undefined || claimed.has(position)) return false;
      if (candidate.token !== item.token || candidate.segment !== ordinary[anchorPosition]!.segment) return false;
      claimed.add(position);
      return true;
    };
    const claimExtremity = (position: number): boolean => {
      const candidate = ordinary[position];
      if (candidate === undefined || claimed.has(position) || candidate.token !== item.token) return false;
      claimed.add(position);
      return true;
    };
    const credited = (item.anchoredByPrecedingMatch && claimAdjacent(anchorPositionByCommonIndex.get(index - 1), 1))
      || (item.anchoredByFollowingMatch && claimAdjacent(anchorPositionByCommonIndex.get(index + 1), -1))
      || (item.anchoredAtParagraphStart && index === 0 && claimExtremity(0))
      || (item.anchoredAtParagraphEnd && index === common.length - 1 && claimExtremity(ordinary.length - 1));
    if (credited) preserved.add(index);
  });
  return preserved;
}

type ParagraphPair = {
  originalIndex: number;
  revisedIndex: number;
  originalText: string;
  revisedText: string;
};

function equalSizedGap(
  original: readonly string[], revised: readonly string[],
  originalStart: number, originalEnd: number, revisedStart: number, revisedEnd: number,
): ParagraphPair[] {
  if (originalEnd - originalStart !== revisedEnd - revisedStart) return [];
  const result: ParagraphPair[] = [];
  for (let offset = 0; offset < originalEnd - originalStart; offset++) {
    result.push({
      originalIndex: originalStart + offset,
      revisedIndex: revisedStart + offset,
      originalText: original[originalStart + offset]!,
      revisedText: revised[revisedStart + offset]!,
    });
  }
  return result;
}

function alignParagraphs(original: readonly string[], revised: readonly string[]): ParagraphPair[] {
  const matches = lcsPairs(original, revised);
  const result: ParagraphPair[] = [];
  let originalStart = 0;
  let revisedStart = 0;
  for (const match of matches) {
    result.push(...equalSizedGap(original, revised, originalStart, match.left, revisedStart, match.right));
    result.push({ originalIndex: match.left, revisedIndex: match.right, originalText: original[match.left]!, revisedText: revised[match.right]! });
    originalStart = match.left + 1;
    revisedStart = match.right + 1;
  }
  result.push(...equalSizedGap(original, revised, originalStart, original.length, revisedStart, revised.length));
  return result;
}

function percent(preserved: number, available: number): number {
  return available === 0 ? 100 : Math.floor(100 * preserved / available);
}

export function emittedRedlineMinimality(
  originalParagraphs: readonly string[], revisedParagraphs: readonly string[], trackedXml: string,
): MinimalityEvidence {
  if (originalParagraphs.length > MAX_PARAGRAPHS || revisedParagraphs.length > MAX_PARAGRAPHS) {
    throw new Error(`Minimality input exceeds ${MAX_PARAGRAPHS} paragraph limit.`);
  }
  const physical = trackedParagraphViews(trackedXml);
  if (physical.length > MAX_PARAGRAPHS) throw new Error(`Tracked document exceeds ${MAX_PARAGRAPHS} paragraph limit.`);
  const diagnostics = alignParagraphs(originalParagraphs, revisedParagraphs).map((pair): MinimalityDiagnostic => {
    const originalTokens = tokenizeExact(pair.originalText).slice(0, MAX_TOKENS_PER_PARAGRAPH);
    const revisedTokens = tokenizeExact(pair.revisedText).slice(0, MAX_TOKENS_PER_PARAGRAPH);
    const commonTokens = anchoredCommonTokens(originalTokens, revisedTokens);
    const candidates = physical.filter((paragraph) => paragraph.rejectText === pair.originalText && paragraph.acceptText === pair.revisedText);
    if (candidates.length === 0) {
      return {
        originalParagraphIndex: pair.originalIndex, revisedParagraphIndex: pair.revisedIndex,
        availableTokens: commonTokens.length, preservedTokens: 0, lostTokens: commonTokens.length,
        lostTokensByClass: countTokenClasses(commonTokens.map((item) => item.token)),
        efficiencyPercent: percent(0, commonTokens.length), topology: 'unresolved_ambiguous_paragraph_topology',
      };
    }
    const scored = candidates.map((candidate) => ({
      candidate,
      preservedIndices: preservedCommonTokenIndices(commonTokens, ordinaryTokens(candidate.ordinaryTextNodes)),
    })).sort((left, right) => left.preservedIndices.size - right.preservedIndices.size || left.candidate.index - right.candidate.index);
    // Repeated identical logical paragraphs are conservative: the least-preserving
    // matching physical paragraph controls, preventing a surgical duplicate from
    // concealing a coarse one.
    const selected = scored[0]!;
    const lostTokens = commonTokens.filter((_, index) => !selected.preservedIndices.has(index)).map((item) => item.token);
    return {
      originalParagraphIndex: pair.originalIndex, revisedParagraphIndex: pair.revisedIndex,
      comparedParagraphIndex: candidates.length === 1 ? selected.candidate.index : undefined,
      availableTokens: commonTokens.length, preservedTokens: selected.preservedIndices.size,
      lostTokens: lostTokens.length,
      lostTokensByClass: countTokenClasses(lostTokens),
      efficiencyPercent: percent(selected.preservedIndices.size, commonTokens.length),
      topology: candidates.length === 1 ? 'identified' : 'identified_repeated',
    };
  });
  const availableTokens = diagnostics.reduce((sum, item) => sum + item.availableTokens, 0);
  const preservedTokens = diagnostics.reduce((sum, item) => sum + item.preservedTokens, 0);
  const lostTokens = availableTokens - preservedTokens;
  const lostTokensByClass = diagnostics.reduce((totals, item) => {
    for (const key of Object.keys(totals) as TokenClass[]) totals[key] += item.lostTokensByClass[key];
    return totals;
  }, emptyTokenClassCounts());
  return {
    policy: 'authored-zero-loss', passed: lostTokens === 0,
    availableTokens, preservedTokens, lostTokens, lostTokensByClass,
    efficiencyPercent: percent(preservedTokens, availableTokens),
    comparedParagraphs: physical.length,
    unresolvedTopologyParagraphs: diagnostics.filter((item) => item.topology === 'unresolved_ambiguous_paragraph_topology').length,
    paragraphDiagnostics: diagnostics.filter((item) => item.lostTokens > 0).slice(0, MAX_DIAGNOSTICS),
  };
}

export function minimalityVerdict(
  originalParagraphs: readonly string[], revisedParagraphs: readonly string[], trackedXml: string,
): Verdict {
  try {
    const evidence = emittedRedlineMinimality(originalParagraphs, revisedParagraphs, trackedXml);
    return evidence.passed
      ? { status: 'pass', required: true, details: { evidence } }
      : { status: 'fail', required: true, reason: 'Finished redline unnecessarily revises preservable common tokens.', details: { evidence } };
  } catch (error) {
    return { status: 'not_run', required: true, reason: `Independent minimality check could not run: ${(error as Error).message}` };
  }
}
