import { trackedParagraphViews } from './xml.js';
import type { Verdict } from './types.js';

const MAX_PARAGRAPHS = 512;
const MAX_TOKENS_PER_PARAGRAPH = 4096;
const MAX_DIAGNOSTICS = 64;

export interface MinimalityDiagnostic {
  originalParagraphIndex: number;
  revisedParagraphIndex: number;
  comparedParagraphIndex?: number;
  availableTokens: number;
  preservedTokens: number;
  lostTokens: number;
  efficiencyPercent: number;
  topology: 'identified' | 'identified_repeated' | 'unresolved_ambiguous_paragraph_topology';
}

export interface MinimalityEvidence {
  policy: 'authored-zero-loss';
  passed: boolean;
  availableTokens: number;
  preservedTokens: number;
  lostTokens: number;
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
    const commonTokens = lcsPairs(originalTokens, revisedTokens).map((match) => originalTokens[match.left]!);
    const candidates = physical.filter((paragraph) => paragraph.rejectText === pair.originalText && paragraph.acceptText === pair.revisedText);
    if (candidates.length === 0) {
      return {
        originalParagraphIndex: pair.originalIndex, revisedParagraphIndex: pair.revisedIndex,
        availableTokens: commonTokens.length, preservedTokens: 0, lostTokens: commonTokens.length,
        efficiencyPercent: percent(0, commonTokens.length), topology: 'unresolved_ambiguous_paragraph_topology',
      };
    }
    const scored = candidates.map((candidate) => ({
      candidate,
      preserved: lcsPairs(commonTokens, candidate.ordinaryTextNodes.flatMap(tokenizeExact)).length,
    })).sort((left, right) => left.preserved - right.preserved || left.candidate.index - right.candidate.index);
    // Repeated identical logical paragraphs are conservative: the least-preserving
    // matching physical paragraph controls, preventing a surgical duplicate from
    // concealing a coarse one.
    const selected = scored[0]!;
    return {
      originalParagraphIndex: pair.originalIndex, revisedParagraphIndex: pair.revisedIndex,
      comparedParagraphIndex: candidates.length === 1 ? selected.candidate.index : undefined,
      availableTokens: commonTokens.length, preservedTokens: selected.preserved,
      lostTokens: commonTokens.length - selected.preserved,
      efficiencyPercent: percent(selected.preserved, commonTokens.length),
      topology: candidates.length === 1 ? 'identified' : 'identified_repeated',
    };
  });
  const availableTokens = diagnostics.reduce((sum, item) => sum + item.availableTokens, 0);
  const preservedTokens = diagnostics.reduce((sum, item) => sum + item.preservedTokens, 0);
  const lostTokens = availableTokens - preservedTokens;
  return {
    policy: 'authored-zero-loss', passed: lostTokens === 0,
    availableTokens, preservedTokens, lostTokens,
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
