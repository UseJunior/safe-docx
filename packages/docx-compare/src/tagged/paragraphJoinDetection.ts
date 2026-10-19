import type { WmlElement } from '@usejunior/docx-core';
import { childElements } from '@usejunior/docx-core';
import { alignComparisonSequences, tokenizeComparisonText } from '../textAlignment.js';
import { revisionProvenance, verifyTaggedTree, type BothNode } from './taggedTree.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';

/** Most paragraphs one split or merge may span. */
const MAX_JOIN_PARAGRAPHS = 8;
/** Gaps larger than this (original x revised paragraphs) are not searched. */
const MAX_GAP_PAIRS = 200_000;
/** Token-alignment cells one gap may spend on candidates before the search stops. */
const MAX_ALIGNMENT_CELLS_PER_GAP = 10_000_000;
/** Share of each side's word tokens that must align across the join. */
const MIN_ALIGNED_RATIO = 0.8;
/** Share of a candidate member's words that must occur in the single paragraph. */
const MIN_MEMBER_WORD_CONTAINMENT = 0.5;

/** Paragraph-mark and property revisions this narrow path never rewrites. */
const BLOCKED_PROPERTY_DESCENDANTS = [
  'sectPr', 'pPrChange', 'rPrChange', 'ins', 'del', 'moveFrom', 'moveTo', 'numberingChange',
];
const ZERO_WIDTH_CHILDREN = new Set(['bookmarkStart', 'bookmarkEnd', 'proofErr']);

interface Piece {
  element: WmlElement;
  start: number;
  end: number;
}

interface EligibleParagraph {
  element: WmlElement;
  properties?: WmlElement;
  pieces: Piece[];
  text: string;
  words: ReadonlySet<string>;
  tokenCount: number;
}

interface Token {
  value: string;
  start: number;
  end: number;
  part: number;
}

export interface ParagraphJoinGroup {
  kind: 'split' | 'merge';
  /** Gap-local index of the first original member. */
  originalStart: number;
  originalCount: number;
  /** Gap-local index of the first revised member. */
  revisedStart: number;
  revisedCount: number;
  parts: BothNode[];
}

function isW(element: WmlElement, localName: string): boolean {
  return element.namespaceURI === W_NS && element.localName === localName;
}

/** Text of a run on the plain path, or undefined when the run carries other content. */
function plainRunText(run: WmlElement): string | undefined {
  let text = '';
  for (const child of childElements(run)) {
    if (child.namespaceURI !== W_NS) return undefined;
    if (child.localName === 'rPr') {
      if (BLOCKED_PROPERTY_DESCENDANTS.some((name) => child.getElementsByTagNameNS(W_NS, name).length > 0)) {
        return undefined;
      }
      continue;
    }
    if (child.localName === 't') text += child.textContent ?? '';
    else if (child.localName === 'tab') text += '\t';
    else if (child.localName !== 'lastRenderedPageBreak') return undefined;
  }
  return text;
}

/**
 * The narrow scope: a plain paragraph of runs, bookmarks and proofing marks.
 * Section breaks, fields, notes, comments, drawings, hyperlinks, content
 * controls and prior tracked changes all keep today's delete/insert behavior.
 */
function eligibleParagraph(element: WmlElement): EligibleParagraph | undefined {
  if (!isW(element, 'p')) return undefined;
  if (revisionProvenance(element).length > 0) return undefined;
  let properties: WmlElement | undefined;
  const pieces: Piece[] = [];
  let text = '';
  for (const child of childElements(element)) {
    if (child.namespaceURI !== W_NS) return undefined;
    if (child.localName === 'pPr') {
      if (properties) return undefined;
      if (BLOCKED_PROPERTY_DESCENDANTS.some((name) => child.getElementsByTagNameNS(W_NS, name).length > 0)) {
        return undefined;
      }
      properties = child;
      continue;
    }
    if (child.localName === 'r') {
      const runText = plainRunText(child);
      if (runText === undefined) return undefined;
      pieces.push({ element: child, start: text.length, end: text.length + runText.length });
      text += runText;
      continue;
    }
    if (!ZERO_WIDTH_CHILDREN.has(child.localName)) return undefined;
    pieces.push({ element: child, start: text.length, end: text.length });
  }
  const words = new Set(text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
  if (words.size === 0) return undefined;
  return { element, properties, pieces, text, words, tokenCount: wordTokens(text, -1).length };
}

function wordTokens(text: string, part: number): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  for (const value of tokenizeComparisonText(text)) {
    if (!/^\s+$/u.test(value)) tokens.push({ value, start: offset, end: offset + value.length, part });
    offset += value.length;
  }
  return tokens;
}

function containment(member: EligibleParagraph, single: EligibleParagraph): number {
  let shared = 0;
  for (const word of member.words) if (single.words.has(word)) shared++;
  return shared / member.words.size;
}

/**
 * Character offsets in `single` at which each following member begins, or
 * undefined when the members are not a split/merge of `single`.
 *
 * Every member must align mostly to `single`, together they must cover it,
 * and each member must contribute matches no other member supplies, so an
 * edited paragraph next to an unrelated short one is not mistaken for a
 * split. Unaligned text between two members' aligned words goes to the
 * earlier member up to and including its last whitespace, so the joining
 * space is recorded at the end of the earlier paragraph, as Word does.
 */
function joinSeams(
  single: EligibleParagraph,
  members: readonly EligibleParagraph[],
  budget: { cells: number },
): { seams: number[]; cuts: number[] } | undefined {
  const singleTokens = wordTokens(single.text, -1);
  const memberTokens = members.flatMap((member, part) => wordTokens(member.text, part));
  // The full alignment plus one per member to prove each member contributes.
  const cost = singleTokens.length * memberTokens.length * (members.length + 1);
  if (cost > budget.cells) {
    budget.cells = 0;
    return undefined;
  }
  budget.cells -= cost;
  const align = (tokens: readonly Token[]) =>
    alignComparisonSequences(singleTokens, tokens, (left, right) => left.value === right.value).matches;
  const matches = align(memberTokens);
  if (matches.length < MIN_ALIGNED_RATIO * singleTokens.length ||
      matches.length < MIN_ALIGNED_RATIO * memberTokens.length) return undefined;
  const partOf = (revisedIndex: number): number => memberTokens[revisedIndex]!.part;
  for (let part = 0; part < members.length; part++) {
    const partTokens = memberTokens.filter((token) => token.part === part).length;
    const required = Math.max(1, Math.ceil(0.5 * partTokens));
    if (matches.filter((match) => partOf(match.revisedIndex) === part).length < required) return undefined;
    const without = align(memberTokens.filter((token) => token.part !== part)).length;
    if (matches.length - without < required) return undefined;
  }
  const seams: number[] = [];
  const cuts: number[] = [];
  for (let part = 0; part < members.length - 1; part++) {
    const before = matches.filter((match) => partOf(match.revisedIndex) <= part).at(-1)!;
    const after = matches.find((match) => partOf(match.revisedIndex) > part)!;
    const regionStart = singleTokens[before.originalIndex]!.end;
    const regionEnd = singleTokens[after.originalIndex]!.start;
    const region = single.text.slice(regionStart, regionEnd);
    let lastWhitespace = region.length - 1;
    while (lastWhitespace >= 0 && !/\s/u.test(region[lastWhitespace]!)) lastWhitespace--;
    seams.push(lastWhitespace >= 0 ? regionStart + lastWhitespace + 1 : regionEnd);
    // When the paragraph on the other side does not carry the joining text,
    // also cut where the aligned text ends, so the unchanged text is a run of
    // its own and aligns exactly instead of as a whole-run replacement.
    const joining = single.text.slice(regionStart, seams.at(-1)!);
    if (joining.length > 0 && !members[part]!.text.endsWith(joining)) cuts.push(regionStart);
  }
  return { seams, cuts };
}

function splitPlainRun(run: WmlElement, cuts: readonly number[]): WmlElement[] | undefined {
  const content = childElements(run).filter((child) => child.localName !== 'rPr');
  if (content.length !== 1 || !isW(content[0]!, 't')) return undefined;
  if (cuts.length === 0) return [run.cloneNode(true) as WmlElement];
  const runProperties = childElements(run).find((child) => child.localName === 'rPr');
  const text = content[0]!.textContent ?? '';
  const bounds = [0, ...cuts, text.length];
  const runs: WmlElement[] = [];
  for (let index = 0; index + 1 < bounds.length; index++) {
    const piece = run.cloneNode(false) as WmlElement;
    if (runProperties) piece.appendChild(runProperties.cloneNode(true));
    const t = run.ownerDocument!.createElementNS(W_NS, 'w:t') as WmlElement;
    t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    t.textContent = text.slice(bounds[index]!, bounds[index + 1]!);
    piece.appendChild(t);
    runs.push(piece);
  }
  return runs;
}

/**
 * Detached copies of `single`, one per member, each with the whole paragraph
 * properties and the content between consecutive seams. A run that straddles
 * a seam is cut only when it is a single plain text element.
 */
function partitionParagraph(
  single: EligibleParagraph,
  seams: readonly number[],
  cuts: readonly number[],
): WmlElement[] | undefined {
  const fragments = Array.from({ length: seams.length + 1 }, (_, index) => {
    const fragment = single.element.cloneNode(false) as WmlElement;
    if (index > 0) {
      // Only the first fragment keeps the paragraph's identity.
      fragment.removeAttributeNS(W14_NS, 'paraId');
      fragment.removeAttributeNS(W14_NS, 'textId');
    }
    if (single.properties) fragment.appendChild(single.properties.cloneNode(true));
    return fragment;
  });
  const bounds = [0, ...seams, single.text.length];
  const fragmentAt = (position: number, closesRange: boolean): number =>
    seams.filter((seam) => closesRange ? seam < position : seam <= position).length;
  // A range that opens at a seam belongs to the following paragraph; an end
  // marker at the seam closes the preceding one, unless its own start opened
  // at the same seam, so a range is never closed before it opens.
  const bookmarkFragments = new Map<string, number>();
  for (const piece of single.pieces) {
    if (piece.start === piece.end) {
      const element = piece.element;
      const closesRange = element.localName === 'bookmarkEnd' || (
        element.localName === 'proofErr' && /End$/u.test(element.getAttributeNS(W_NS, 'type') ?? ''));
      const id = element.getAttributeNS(W_NS, 'id') ?? '';
      let fragment = fragmentAt(piece.start, closesRange);
      if (element.localName === 'bookmarkStart') bookmarkFragments.set(id, fragment);
      if (element.localName === 'bookmarkEnd') fragment = Math.max(fragment, bookmarkFragments.get(id) ?? 0);
      fragments[fragment]!.appendChild(element.cloneNode(true));
      continue;
    }
    const inner = (points: readonly number[]): number[] =>
      points.filter((point) => point > piece.start && point < piece.end);
    const innerSeams = inner(seams);
    const points = [...new Set([...innerSeams, ...inner(cuts)])].sort((left, right) => left - right);
    // A seam inside a run that is not plain text cannot be honored; a cut is optional.
    const runs = splitPlainRun(piece.element, points.map((point) => point - piece.start)) ??
      (innerSeams.length === 0 ? [piece.element.cloneNode(true) as WmlElement] : undefined);
    if (!runs) return undefined;
    const starts = runs.length === 1 ? [piece.start] : [piece.start, ...points];
    runs.forEach((run, index) => fragments[fragmentAt(starts[index]!, false)]!.appendChild(run));
  }
  // A member must keep text of its own; zero-width markers alone are not a paragraph.
  for (let index = 0; index < fragments.length; index++) {
    if (bounds[index + 1]! <= bounds[index]!) return undefined;
  }
  return fragments;
}

/**
 * Find paragraph splits and merges among the side-only paragraphs of one
 * alignment gap. Each group is one paragraph on one side and two or more
 * consecutive paragraphs on the other; groups are monotone in both sides.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/873
 */
export function detectParagraphJoins(
  originalGap: readonly WmlElement[],
  revisedGap: readonly WmlElement[],
  buildPart: (original: WmlElement, revised: WmlElement) => BothNode,
): ParagraphJoinGroup[] {
  if (originalGap.length === 0 || revisedGap.length === 0 ||
      originalGap.length + revisedGap.length < 3 ||
      originalGap.length * revisedGap.length > MAX_GAP_PAIRS) return [];
  const originals = originalGap.map(eligibleParagraph);
  const revisions = revisedGap.map(eligibleParagraph);
  if (originals.every((paragraph) => !paragraph) || revisions.every((paragraph) => !paragraph)) return [];

  interface Candidate {
    kind: 'split' | 'merge';
    originalStart: number;
    originalCount: number;
    revisedStart: number;
    revisedCount: number;
    fragments: WmlElement[];
  }
  const candidates: Candidate[] = [];
  const budget = { cells: MAX_ALIGNMENT_CELLS_PER_GAP };
  const search = (
    kind: 'split' | 'merge',
    singles: ReadonlyArray<EligibleParagraph | undefined>,
    multiples: ReadonlyArray<EligibleParagraph | undefined>,
  ): void => {
    singles.forEach((single, singleIndex) => {
      if (!single) return;
      const singleWords = single.tokenCount;
      for (let start = 0; start + 1 < multiples.length && budget.cells > 0; start++) {
        const members: EligibleParagraph[] = [];
        let memberWords = 0;
        for (let index = start; index < multiples.length && members.length < MAX_JOIN_PARAGRAPHS; index++) {
          const member = multiples[index];
          if (!member || containment(member, single) < MIN_MEMBER_WORD_CONTAINMENT) break;
          memberWords += member.tokenCount;
          if (memberWords > 1.5 * singleWords + 2) break;
          members.push(member);
        }
        for (let count = members.length; count >= 2; count--) {
          const boundaries = joinSeams(single, members.slice(0, count), budget);
          const fragments = boundaries && partitionParagraph(single, boundaries.seams, boundaries.cuts);
          if (!fragments) continue;
          candidates.push(kind === 'split'
            ? { kind, originalStart: singleIndex, originalCount: 1, revisedStart: start, revisedCount: count, fragments }
            : { kind, originalStart: start, originalCount: count, revisedStart: singleIndex, revisedCount: 1, fragments });
          return;
        }
      }
    });
  };
  search('split', originals, revisions);
  search('merge', revisions, originals);
  candidates.sort((left, right) =>
    left.originalStart - right.originalStart || left.revisedStart - right.revisedStart);

  const groups: ParagraphJoinGroup[] = [];
  let originalFloor = 0;
  let revisedFloor = 0;
  for (const candidate of candidates) {
    if (candidate.originalStart < originalFloor || candidate.revisedStart < revisedFloor) continue;
    const parts = candidate.fragments.map((fragment, index) => candidate.kind === 'split'
      ? [fragment, revisedGap[candidate.revisedStart + index]!] as const
      : [originalGap[candidate.originalStart + index]!, fragment] as const)
      .map(([original, revised]) => ({ original, revised, part: buildPart(original, revised) }));
    if (parts.some(({ original, revised, part }) => verifyTaggedTree(original, revised, part).length > 0)) continue;
    groups.push({
      kind: candidate.kind,
      originalStart: candidate.originalStart,
      originalCount: candidate.originalCount,
      revisedStart: candidate.revisedStart,
      revisedCount: candidate.revisedCount,
      parts: parts.map(({ part }) => part),
    });
    originalFloor = candidate.originalStart + candidate.originalCount;
    revisedFloor = candidate.revisedStart + candidate.revisedCount;
  }
  return groups;
}
