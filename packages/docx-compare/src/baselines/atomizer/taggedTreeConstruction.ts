import type { WmlElement } from '@usejunior/docx-core';
import { childElements } from '@usejunior/docx-core';
import {
  nextRevisionId,
  PROPERTY_SCOPE_ELEMENT,
  revisionProvenance,
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
const RANGE_BOUNDARY_LOCALS = new Set([
  'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd',
  'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd',
]);
function alignmentKey(element: WmlElement): string {
  const text = element.textContent ?? '';
  let runControlSignature = '';
  if (element.localName === 'r') {
    const fieldCharacters = Array.from(element.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'fldChar',
    ));
    if (fieldCharacters.length === 1) {
      return JSON.stringify(['field-character', fieldCharacters[0]!.getAttributeNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        'fldCharType',
      ) ?? '']);
    }
    const instructions = Array.from(element.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'instrText',
    ));
    if (instructions.length === 1) {
      return JSON.stringify(['field-instruction', (instructions[0]!.textContent ?? '').trim().replace(/\s+/gu, ' ')]);
    }
    runControlSignature = childElements(element)
      .filter((child) => !['rPr', 't', 'delText'].includes(child.localName))
      .map((child) => subtreeSignature(child))
      .join('|');
  }
  const formattingOnlyEmptyParagraph = element.localName === 'p' &&
    text.length === 0 &&
    childElements(element).every((child) => child.localName === 'pPr');
  const provenanceSensitive = new Set([
    'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd',
    'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd',
  ]).has(element.localName);
  // Empty structural records (bookmark/range boundaries, field characters,
  // proofing markers, etc.) derive their identity from attributes and child
  // topology. Treating them as interchangeable aligns unrelated IDs as a
  // `both` node and leaks the revised marker into Reject All.
  return JSON.stringify([
    element.namespaceURI ?? '',
    element.localName ?? element.tagName,
    text,
    text.length === 0 && element.localName !== 'sectPr' && !formattingOnlyEmptyParagraph
      ? subtreeSignature(element)
      : '',
    provenanceSensitive
      ? revisionProvenance(element).map(({ kind, id, author, date }) => [kind, id, author, date])
      : [],
    runControlSignature,
  ]);
}

function propertyDelta(original: WmlElement, revised: WmlElement): PropertyDelta | undefined {
  const descriptor = PROPERTY_SCOPE_BY_CONTAINER[original.localName ?? original.tagName.replace(/^w:/, '')];
  if (!descriptor) return undefined;
  const originalProperty = descriptor.scope === 'section'
    ? original
    : childElements(original).find((child) => child.localName === descriptor.child) ?? null;
  const revisedProperty = descriptor.scope === 'section'
    ? revised
    : childElements(revised).find((child) => child.localName === descriptor.child) ?? null;
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
  const fieldContexts = (elements: readonly WmlElement[]): Map<number, string> => {
    const contexts = new Map<number, string>();
    const stack: Array<{ start: number; instruction: string[]; separated: boolean }> = [];
    for (let index = 0; index < elements.length; index++) {
      const element = elements[index]!;
      for (const instruction of Array.from(element.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'instrText',
      ))) {
        const active = stack[stack.length - 1];
        if (active && !active.separated) active.instruction.push(instruction.textContent ?? '');
      }
      for (const field of Array.from(element.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'fldChar',
      ))) {
        const type = field.getAttributeNS(
          'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'fldCharType',
        );
        if (type === 'begin') stack.push({ start: index, instruction: [], separated: false });
        else if (type === 'separate' && stack.length > 0) stack[stack.length - 1]!.separated = true;
        else if (type === 'end' && stack.length > 0) {
          const completed = stack.pop()!;
          const identity = completed.instruction.join('').trim().replace(/\s+/gu, ' ');
          if (identity) for (let member = completed.start; member <= index; member++) {
            contexts.set(member, identity);
          }
        }
      }
    }
    return contexts;
  };
  const originalFields = fieldContexts(original);
  const revisedFields = fieldContexts(revised);
  const key = (element: WmlElement, field: string | undefined): string =>
    JSON.stringify([field ?? null, alignmentKey(element)]);
  const rows = original.length + 1;
  const cols = revised.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = original.length - 1; i >= 0; i--) {
    for (let j = revised.length - 1; j >= 0; j--) {
      dp[i]![j] = key(original[i]!, originalFields.get(i)) === key(revised[j]!, revisedFields.get(j))
        ? 1 + dp[i + 1]![j + 1]!
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < original.length && j < revised.length) {
    if (key(original[i]!, originalFields.get(i)) === key(revised[j]!, revisedFields.get(j))) {
      pairs.push([i++, j++]);
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

function paragraphSimilarity(left: WmlElement, right: WmlElement): number {
  if (left.localName !== right.localName || !['p', 'r'].includes(left.localName)) return 0;
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

export interface TaggedTreeConstructionOptions {
  /** Emit direct-formatting revisions. Default: true. */
  detectFormatChanges?: boolean;
  /** Classify equal-content side-only nodes as moves. Default: true. */
  detectMoves?: boolean;
}

function constructBoth(
  original: WmlElement,
  revised: WmlElement,
  options: Required<TaggedTreeConstructionOptions>,
): BothNode {
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
        (left.localName !== 'r' || (
          left.textContent === right.textContent &&
          left.getElementsByTagNameNS(
            'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'fldChar',
          ).length === 0 &&
          right.getElementsByTagNameNS(
            'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'fldChar',
          ).length === 0 &&
          left.getElementsByTagNameNS(
            'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'instrText',
          ).length === 0 &&
          right.getElementsByTagNameNS(
            'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'instrText',
          ).length === 0
        ));
      if (!sameIdentity) break;
      children.push(constructBoth(left, right, options));
      oi++;
      ri++;
    }
    const gapOriginalStart = oi;
    const gapRevisedStart = ri;
    const originalGap = originalChildren.slice(gapOriginalStart, originalEnd);
    const revisedGap = revisedChildren.slice(gapRevisedStart, revisedEnd);
    const containsFieldControl = (elements: readonly WmlElement[]): boolean => elements.some((element) =>
      element.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'fldChar',
      ).length > 0 || element.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'instrText',
      ).length > 0);
    // Field-context keys deliberately keep different complete fields out of
    // the LCS. Do not re-pair their individual runs through the generic fuzzy
    // gap matcher: that interleaves one source field with multiple revised
    // fields and produces projection-invalid partial complexes.
    const similarityPairs = containsFieldControl(originalGap) || containsFieldControl(revisedGap)
      ? []
      : similarParagraphPairs(originalGap, revisedGap);
    for (const [localOriginal, localRevised] of similarityPairs) {
      const matchedOriginal = gapOriginalStart + localOriginal;
      const matchedRevised = gapRevisedStart + localRevised;
      while (oi < matchedOriginal) children.push({ tag: 'original', node: originalChildren[oi++]!, children: [], opaque: true });
      while (ri < matchedRevised) children.push({ tag: 'revised', node: revisedChildren[ri++]!, children: [], opaque: true });
      const left = originalChildren[oi++]!;
      const right = revisedChildren[ri++]!;
      if (left.localName === 'r') {
        children.push({ tag: 'original', node: left, children: [], opaque: true });
        children.push({ tag: 'revised', node: right, children: [], opaque: true });
      } else {
        children.push(constructBoth(left, right, options));
      }
    }
    while (oi < originalEnd) children.push({ tag: 'original', node: originalChildren[oi++]!, children: [], opaque: true });
    while (ri < revisedEnd) children.push({ tag: 'revised', node: revisedChildren[ri++]!, children: [], opaque: true });
  };
  let oi = 0;
  let ri = 0;
  for (const [matchedOriginal, matchedRevised] of pairs) {
    emitGap(matchedOriginal, matchedRevised);
    children.push(constructBoth(originalChildren[oi++]!, revisedChildren[ri++]!, options));
  }
  emitGap(originalChildren.length, revisedChildren.length);
  return {
    tag: 'both',
    original,
    revised,
    children,
    propertyDelta: options.detectFormatChanges ? propertyDelta(original, revised) : undefined,
  };
}

function collectSideOnly(
  node: TaggedNode,
  originals: OriginalNode[],
  revised: RevisedNode[],
  insideComplexField = false,
): void {
  const ownElement = node.tag === 'both' ? node.original : node.node;
  // Range boundaries describe their enclosing content; moving an individual
  // zero-width marker creates a second range vocabulary around the marker and
  // duplicates IDs after projection. Only content-bearing nodes are moves.
  const fieldControlRun = ownElement.localName === 'r' && (
    ownElement.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'fldChar',
    ).length > 0 ||
    ownElement.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'instrText',
    ).length > 0
  );
  if (node.tag === 'original' && !insideComplexField && !RANGE_BOUNDARY_LOCALS.has(ownElement.localName) && !fieldControlRun) originals.push(node);
  else if (node.tag === 'revised' && !insideComplexField && !RANGE_BOUNDARY_LOCALS.has(ownElement.localName) && !fieldControlRun) revised.push(node);
  const propertyTag = node.tag === 'both' && node.propertyDelta
    ? PROPERTY_SCOPE_ELEMENT[node.propertyDelta.scope]
    : undefined;
  let fieldDepth = 0;
  node.children.forEach((child) => {
    const element = child.tag === 'both' ? child.original : child.node;
    if (propertyTag && element.tagName === propertyTag) return;
    const fieldCharacters = Array.from(element.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'fldChar',
    ));
    const begins = fieldCharacters.filter((field) =>
      field.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'fldCharType') === 'begin',
    ).length;
    const ends = fieldCharacters.filter((field) =>
      field.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'fldCharType') === 'end',
    ).length;
    collectSideOnly(child, originals, revised, insideComplexField || fieldDepth > 0);
    fieldDepth = Math.max(0, fieldDepth + begins - ends);
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
export function constructTaggedTree(
  original: WmlElement,
  revised: WmlElement,
  options: TaggedTreeConstructionOptions = {},
): ConstructedTaggedTree {
  if ((original.namespaceURI ?? '') !== (revised.namespaceURI ?? '') ||
      (original.localName ?? original.tagName) !== (revised.localName ?? revised.tagName)) {
    throw new Error('tagged-tree roots must have the same element identity and story role');
  }
  const settings: Required<TaggedTreeConstructionOptions> = {
    detectFormatChanges: options.detectFormatChanges ?? true,
    detectMoves: options.detectMoves ?? true,
  };
  const tree = constructBoth(original, revised, settings);
  const violations = verifyTaggedTree(original, revised, tree);
  if (violations.length > 0) throw new Error(`constructed tagged tree violates P1-P5: ${violations[0]!.detail}`);
  const moves = settings.detectMoves ? classifyMoves(tree, nextRevisionId(original, revised)) : [];
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
