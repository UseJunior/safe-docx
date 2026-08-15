import type { ComparisonUnitAtom } from '@usejunior/docx-core';

interface ContextualAnchor {
  indices: readonly [number, number, number];
  marker: string;
  paragraph: unknown;
  bodyTokens: Set<string>;
}

const lexical = /[\p{L}\p{N}]/u;
const markerValue = /^(?:\d+|[a-z]+)$/i;

function text(atom: ComparisonUnitAtom): string {
  return atom.contentElement.tagName === 'w:t'
    ? atom.contentElement.textContent ?? ''
    : '';
}

function paragraphOf(atom: ComparisonUnitAtom): unknown {
  return atom.ancestorElements.find((ancestor) => ancestor.tagName === 'w:p');
}

function candidateTriples(atoms: ComparisonUnitAtom[]): Array<{
  indices: [number, number, number];
  marker: string;
  paragraph: unknown;
}> {
  const candidates: Array<{
    indices: [number, number, number];
    marker: string;
    paragraph: unknown;
  }> = [];
  for (let index = 0; index + 2 < atoms.length; index++) {
    const paragraph = paragraphOf(atoms[index]!);
    if (
      paragraph !== undefined &&
      paragraphOf(atoms[index + 1]!) === paragraph &&
      paragraphOf(atoms[index + 2]!) === paragraph &&
      text(atoms[index]!) === '(' &&
      markerValue.test(text(atoms[index + 1]!)) &&
      text(atoms[index + 2]!) === ')'
    ) {
      candidates.push({
        indices: [index, index + 1, index + 2],
        marker: text(atoms[index + 1]!).toLowerCase(),
        paragraph,
      });
    }
  }
  return candidates;
}

function extractAnchors(atoms: ComparisonUnitAtom[]): ContextualAnchor[] {
  const candidates = candidateTriples(atoms);
  const byParagraph = new Map<unknown, typeof candidates>();
  for (const candidate of candidates) {
    byParagraph.set(candidate.paragraph, [
      ...(byParagraph.get(candidate.paragraph) ?? []),
      candidate,
    ]);
  }

  const anchors: ContextualAnchor[] = [];
  for (const paragraphCandidates of byParagraph.values()) {
    const paragraphStart = atoms.findIndex(
      (atom) => paragraphOf(atom) === paragraphCandidates[0]!.paragraph,
    );
    const contextual = paragraphCandidates.filter(
      (candidate) =>
        paragraphCandidates.length > 1 ||
        atoms
          .slice(paragraphStart, candidate.indices[0])
          .every((atom) => !lexical.test(text(atom))),
    );
    for (let ordinal = 0; ordinal < contextual.length; ordinal++) {
      const candidate = contextual[ordinal]!;
      const next = contextual[ordinal + 1]?.indices[0] ?? atoms.length;
      const bodyTokens = new Set<string>();
      for (let index = candidate.indices[2] + 1; index < next; index++) {
        const atom = atoms[index]!;
        if (paragraphOf(atom) !== candidate.paragraph) break;
        const value = text(atom);
        if (lexical.test(value)) bodyTokens.add(value.toLowerCase());
      }
      anchors.push({ ...candidate, bodyTokens });
    }
  }
  return anchors;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection++;
  }
  return intersection / union.size;
}

/**
 * Returns atoms belonging to composite anchors whose paragraph-local item
 * contexts are incompatible. Keeping this policy outside the LCS preserves the
 * LCS algorithm and makes marker syntax/context independently testable.
 *
 * Parenthetical decimal and alphabetic markers share one policy. Roman markers
 * are alphabetic markers; there is intentionally no Roman-specific branch.
 */
export function incompatibleContextualAnchorAtoms(
  original: ComparisonUnitAtom[],
  revised: ComparisonUnitAtom[],
): {
  original: ReadonlySet<ComparisonUnitAtom>;
  revised: ReadonlySet<ComparisonUnitAtom>;
} {
  const originalAnchors = extractAnchors(original);
  const revisedAnchors = extractAnchors(revised);
  const revisedByMarker = new Map<string, ContextualAnchor[]>();
  for (const anchor of revisedAnchors) {
    revisedByMarker.set(anchor.marker, [
      ...(revisedByMarker.get(anchor.marker) ?? []),
      anchor,
    ]);
  }

  const blockedOriginal = new Set<ComparisonUnitAtom>();
  const blockedRevised = new Set<ComparisonUnitAtom>();
  const originalOrdinal = new Map<string, number>();
  for (const anchor of originalAnchors) {
    const ordinal = originalOrdinal.get(anchor.marker) ?? 0;
    originalOrdinal.set(anchor.marker, ordinal + 1);
    const counterpart = revisedByMarker.get(anchor.marker)?.[ordinal];
    if (
      counterpart &&
      anchor.bodyTokens.size >= 3 &&
      counterpart.bodyTokens.size >= 3 &&
      jaccard(anchor.bodyTokens, counterpart.bodyTokens) < 0.25
    ) {
      for (const index of anchor.indices) blockedOriginal.add(original[index]!);
      for (const index of counterpart.indices) blockedRevised.add(revised[index]!);
    }
  }
  return { original: blockedOriginal, revised: blockedRevised };
}

