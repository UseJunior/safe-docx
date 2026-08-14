import type { WmlElement } from '@usejunior/docx-core';
import { childElements } from '@usejunior/docx-core';
import {
  nextRevisionId,
  PROPERTY_SCOPE_ELEMENT,
  subtreeSignature,
  verifyMoveRelations,
  verifyTaggedTree,
  type BothNode,
  type OriginalNode,
  type PropertyDelta,
  type PropertyScope,
  type RevisedNode,
  type TaggedMoveRelation,
  type TaggedNode,
} from './taggedTree.js';

const PROPERTY_SCOPE_BY_CONTAINER: Readonly<Record<string, { child: string; scope: PropertyScope }>> = {
  r: { child: 'rPr', scope: 'run' },
  p: { child: 'pPr', scope: 'paragraph' },
  tr: { child: 'trPr', scope: 'tableRow' },
  tc: { child: 'tcPr', scope: 'tableCell' },
  sectPr: { child: 'sectPr', scope: 'section' },
};

function alignmentKey(element: WmlElement): string {
  return JSON.stringify([element.namespaceURI ?? '', element.localName ?? element.tagName, element.textContent ?? '']);
}

function propertyDelta(original: WmlElement, revised: WmlElement): PropertyDelta | undefined {
  const descriptor = PROPERTY_SCOPE_BY_CONTAINER[original.localName ?? original.tagName.replace(/^w:/, '')];
  if (!descriptor) return undefined;
  const originalProperty = childElements(original).find((child) => child.localName === descriptor.child) ?? null;
  const revisedProperty = childElements(revised).find((child) => child.localName === descriptor.child) ?? null;
  const propertySignature = (property: WmlElement | null): string => {
    if (!property) return '';
    const normalized = property.cloneNode(true) as WmlElement;
    const stripWhitespace = (element: Element): void => {
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === 1) stripWhitespace(child as Element);
        else if ((child.nodeType === 3 || child.nodeType === 4) && !(child.nodeValue ?? '').trim()) {
          element.removeChild(child);
        }
      }
    };
    stripWhitespace(normalized);
    return subtreeSignature(normalized);
  };
  if (propertySignature(originalProperty) === propertySignature(revisedProperty)) return undefined;
  return {
    scope: descriptor.scope,
    original: originalProperty,
    revised: revisedProperty,
    changedProperties: ['directProperties'],
  };
}

function lcsPairs(original: readonly WmlElement[], revised: readonly WmlElement[]): Array<[number, number]> {
  const rows = original.length + 1;
  const cols = revised.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = original.length - 1; i >= 0; i--) {
    for (let j = revised.length - 1; j >= 0; j--) {
      dp[i]![j] = alignmentKey(original[i]!) === alignmentKey(revised[j]!)
        ? 1 + dp[i + 1]![j + 1]!
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < original.length && j < revised.length) {
    if (alignmentKey(original[i]!) === alignmentKey(revised[j]!)) {
      pairs.push([i++, j++]);
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

function paragraphSimilarity(left: WmlElement, right: WmlElement): number {
  if (left.localName !== 'p' || right.localName !== 'p') return 0;
  const words = (value: string): Set<string> => new Set(value.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
  const a = words(left.textContent ?? '');
  const b = words(right.textContent ?? '');
  if (a.size === 0 || b.size === 0) return a.size === b.size ? 1 : 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

function similarParagraphPairs(
  original: readonly WmlElement[],
  revised: readonly WmlElement[],
): Array<[number, number]> {
  const dp = Array.from({ length: original.length + 1 }, () => Array<number>(revised.length + 1).fill(0));
  for (let i = original.length - 1; i >= 0; i--) {
    for (let j = revised.length - 1; j >= 0; j--) {
      const similarity = paragraphSimilarity(original[i]!, revised[j]!);
      const paired = similarity >= 0.25 ? similarity + dp[i + 1]![j + 1]! : -1;
      dp[i]![j] = Math.max(paired, dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < original.length && j < revised.length) {
    const similarity = paragraphSimilarity(original[i]!, revised[j]!);
    if (similarity >= 0.25 && Math.abs(dp[i]![j]! - (similarity + dp[i + 1]![j + 1]!)) < 1e-9) {
      pairs.push([i++, j++]);
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

function constructBoth(original: WmlElement, revised: WmlElement): BothNode {
  const originalChildren = childElements(original);
  const revisedChildren = childElements(revised);
  const pairs = lcsPairs(originalChildren, revisedChildren);
  const children: TaggedNode[] = [];
  const emitGap = (originalEnd: number, revisedEnd: number): void => {
    while (originalEnd - oi === revisedEnd - ri && oi < originalEnd && ri < revisedEnd) {
      const left = originalChildren[oi]!;
      const right = revisedChildren[ri]!;
      const sameIdentity = (left.namespaceURI ?? '') === (right.namespaceURI ?? '') &&
        (left.localName ?? left.tagName) === (right.localName ?? right.tagName) &&
        (childElements(left).length > 0 || childElements(right).length > 0) &&
        (left.localName !== 'r' || left.textContent === right.textContent);
      if (!sameIdentity) break;
      children.push(constructBoth(left, right));
      oi++;
      ri++;
    }
    const gapOriginalStart = oi;
    const gapRevisedStart = ri;
    const similarityPairs = similarParagraphPairs(
      originalChildren.slice(gapOriginalStart, originalEnd),
      revisedChildren.slice(gapRevisedStart, revisedEnd),
    );
    for (const [localOriginal, localRevised] of similarityPairs) {
      const matchedOriginal = gapOriginalStart + localOriginal;
      const matchedRevised = gapRevisedStart + localRevised;
      while (oi < matchedOriginal) children.push({ tag: 'original', node: originalChildren[oi++]!, children: [], opaque: true });
      while (ri < matchedRevised) children.push({ tag: 'revised', node: revisedChildren[ri++]!, children: [], opaque: true });
      children.push(constructBoth(originalChildren[oi++]!, revisedChildren[ri++]!));
    }
    while (oi < originalEnd) children.push({ tag: 'original', node: originalChildren[oi++]!, children: [], opaque: true });
    while (ri < revisedEnd) children.push({ tag: 'revised', node: revisedChildren[ri++]!, children: [], opaque: true });
  };
  let oi = 0;
  let ri = 0;
  for (const [matchedOriginal, matchedRevised] of pairs) {
    emitGap(matchedOriginal, matchedRevised);
    children.push(constructBoth(originalChildren[oi++]!, revisedChildren[ri++]!));
  }
  emitGap(originalChildren.length, revisedChildren.length);
  return { tag: 'both', original, revised, children, propertyDelta: propertyDelta(original, revised) };
}

function collectSideOnly(node: TaggedNode, originals: OriginalNode[], revised: RevisedNode[]): void {
  if (node.tag === 'original') originals.push(node);
  else if (node.tag === 'revised') revised.push(node);
  const propertyTag = node.tag === 'both' && node.propertyDelta
    ? PROPERTY_SCOPE_ELEMENT[node.propertyDelta.scope]
    : undefined;
  node.children.forEach((child) => {
    const element = child.tag === 'both' ? child.original : child.node;
    if (propertyTag && element.tagName === propertyTag) return;
    collectSideOnly(child, originals, revised);
  });
}

function classifyMoves(tree: TaggedNode, firstRevisionId: number): TaggedMoveRelation[] {
  const originals: OriginalNode[] = [];
  const revised: RevisedNode[] = [];
  collectSideOnly(tree, originals, revised);
  const revisedBySignature = new Map<string, RevisedNode[]>();
  for (const node of revised) {
    const signature = subtreeSignature(node.node);
    const bucket = revisedBySignature.get(signature) ?? [];
    bucket.push(node);
    revisedBySignature.set(signature, bucket);
  }
  const relations: TaggedMoveRelation[] = [];
  let id = firstRevisionId;
  for (const source of originals) {
    const destination = revisedBySignature.get(subtreeSignature(source.node))?.shift();
    if (!destination) continue;
    relations.push({
      source,
      destination,
      name: `taggedMove${relations.length + 1}`,
      sourceRangeId: id++,
      destinationRangeId: id++,
    });
  }
  return relations;
}

export interface ConstructedTaggedTree {
  tree: TaggedNode;
  moves: TaggedMoveRelation[];
}

/** Construct a complete, projection-isomorphic tagged tree directly from both DOM roots. */
export function constructTaggedTree(original: WmlElement, revised: WmlElement): ConstructedTaggedTree {
  if ((original.namespaceURI ?? '') !== (revised.namespaceURI ?? '') ||
      (original.localName ?? original.tagName) !== (revised.localName ?? revised.tagName)) {
    throw new Error('tagged-tree roots must have the same element identity and story role');
  }
  const tree = constructBoth(original, revised);
  const violations = verifyTaggedTree(original, revised, tree);
  if (violations.length > 0) throw new Error(`constructed tagged tree violates P1-P5: ${violations[0]!.detail}`);
  const moves = classifyMoves(tree, nextRevisionId(original, revised));
  const moveViolations = verifyMoveRelations(moves, tree);
  if (moveViolations.length > 0) throw new Error(`constructed move relation is invalid: ${moveViolations[0]!.detail}`);
  return { tree, moves };
}

/** Equal-content side-only pairs are valid only when explicitly bound as moves. */
export function verifyGlobalEqualContentInvariant(
  tree: TaggedNode,
  moves: readonly TaggedMoveRelation[],
): string[] {
  const originals: OriginalNode[] = [];
  const revised: RevisedNode[] = [];
  collectSideOnly(tree, originals, revised);
  const bound = new Set(moves.flatMap((move) => [move.source, move.destination]));
  const revisedSignatures = new Map(revised.map((node) => [subtreeSignature(node.node), node]));
  return originals.flatMap((node) => {
    const peer = revisedSignatures.get(subtreeSignature(node.node));
    return peer && (!bound.has(node) || !bound.has(peer))
      ? [`equal-content original/revised pair is not classified as a move: ${node.node.tagName}`]
      : [];
  });
}
