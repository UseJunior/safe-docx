import type { WmlElement } from '@usejunior/docx-core';
import {
  childElements,
  DEFAULT_MOVE_DETECTION_SETTINGS,
  findParagraphByBookmarkId,
  getParagraphRuns,
} from '@usejunior/docx-core';
import type { RevisionAttributionRange } from '../compare-types.js';
import { getChangedPropertyNames } from '../propertyNaming.js';
import {
  countWords,
  jaccardWordSimilarity,
  wordContainmentSimilarity,
} from '../textSimilarity.js';
import { computeNumberingIdentities } from './numberingIntegration.js';
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
const bookmarkStartsByDocument = new WeakMap<Document, Map<string, WmlElement>>();
function bookmarkStartFor(element: WmlElement): WmlElement | undefined {
  if (element.localName === 'bookmarkStart') return element;
  const owner = element.ownerDocument!;
  let starts = bookmarkStartsByDocument.get(owner);
  if (!starts) {
    starts = new Map();
    for (const start of Array.from(owner.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'bookmarkStart',
    ))) {
      const id = start.getAttributeNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'id',
      );
      if (id && !starts.has(id)) starts.set(id, start as WmlElement);
    }
    bookmarkStartsByDocument.set(owner, starts);
  }
  const id = element.getAttributeNS(
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'id',
  );
  return id ? starts.get(id) : undefined;
}
function semanticAttributeSignature(element: WmlElement): string {
  return JSON.stringify(Array.from(element.attributes)
    .filter((attribute) => {
      if (attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/') return false;
      if (attribute.namespaceURI === 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' &&
          (attribute.localName ?? '').startsWith('rsid')) return false;
      if (attribute.namespaceURI === 'http://schemas.microsoft.com/office/word/2010/wordml' &&
          ['paraId', 'textId'].includes(attribute.localName ?? '')) return false;
      return true;
    })
    .map((attribute) => [attribute.namespaceURI ?? '', attribute.localName ?? attribute.name, attribute.value])
    .sort(([leftNamespace, leftName], [rightNamespace, rightName]) =>
      `${leftNamespace}:${leftName}`.localeCompare(`${rightNamespace}:${rightName}`)));
}
function alignmentKey(
  element: WmlElement,
  numberingIdentities: ReadonlyMap<WmlElement, string>,
): string {
  const text = element.textContent ?? '';
  if (element.localName === 'bookmarkStart' || element.localName === 'bookmarkEnd') {
    const start = bookmarkStartFor(element);
    return JSON.stringify([
      'bookmark-boundary',
      element.localName,
      JSON.parse(semanticAttributeSignature(element)).filter(
        ([namespace, name]: [string, string]) => !(
          namespace === 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' && name === 'id'
        ),
      ),
      start
        ? JSON.parse(semanticAttributeSignature(start)).filter(
          ([namespace, name]: [string, string]) => !(
            namespace === 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' && name === 'id'
          ),
        )
        : [],
      revisionProvenance(element).map(({ kind, id: revisionId, author, date }) => [kind, revisionId, author, date]),
    ]);
  }
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
    semanticAttributeSignature(element),
    numberingIdentities.get(element) ?? '',
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
    const stripPriorRevisionsAndWhitespace = (element: Element): void => {
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === 1) {
          const childElement = child as Element;
          if (childElement.localName.endsWith('PrChange')) {
            element.removeChild(childElement);
          } else {
            stripPriorRevisionsAndWhitespace(childElement);
          }
        }
        else if ((child.nodeType === 3 || child.nodeType === 4) && !(child.nodeValue ?? '').trim()) {
          element.removeChild(child);
        }
      }
    };
    stripPriorRevisionsAndWhitespace(normalized);
    return subtreeSignature(normalized);
  };
  if (propertySignature(originalProperty) === propertySignature(revisedProperty)) return undefined;
  return {
    scope: descriptor.scope,
    original: originalProperty,
    revised: revisedProperty,
    changedProperties: getChangedPropertyNames(originalProperty, revisedProperty),
  };
}

function lcsPairs(
  original: readonly WmlElement[],
  revised: readonly WmlElement[],
  originalNumberingIdentities: ReadonlyMap<WmlElement, string>,
  revisedNumberingIdentities: ReadonlyMap<WmlElement, string>,
): Array<[number, number]> {
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
  const key = (
    element: WmlElement,
    field: string | undefined,
    numberingIdentities: ReadonlyMap<WmlElement, string>,
  ): string => JSON.stringify([field ?? null, alignmentKey(element, numberingIdentities)]);
  const rows = original.length + 1;
  const cols = revised.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = original.length - 1; i >= 0; i--) {
    for (let j = revised.length - 1; j >= 0; j--) {
      dp[i]![j] = key(original[i]!, originalFields.get(i), originalNumberingIdentities) ===
        key(revised[j]!, revisedFields.get(j), revisedNumberingIdentities)
        ? 1 + dp[i + 1]![j + 1]!
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < original.length && j < revised.length) {
    if (key(original[i]!, originalFields.get(i), originalNumberingIdentities) ===
        key(revised[j]!, revisedFields.get(j), revisedNumberingIdentities)) {
      pairs.push([i++, j++]);
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

function paragraphSimilarity(
  left: WmlElement,
  right: WmlElement,
  originalNumberingIdentities: ReadonlyMap<WmlElement, string>,
  revisedNumberingIdentities: ReadonlyMap<WmlElement, string>,
): number {
  if (left.localName !== right.localName || !['p', 'r'].includes(left.localName)) return 0;
  if (semanticAttributeSignature(left) !== semanticAttributeSignature(right)) return 0;
  if ((originalNumberingIdentities.get(left) ?? '') !==
      (revisedNumberingIdentities.get(right) ?? '')) return 0;
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
  originalNumberingIdentities: ReadonlyMap<WmlElement, string>,
  revisedNumberingIdentities: ReadonlyMap<WmlElement, string>,
): Array<[number, number]> {
  const dp = Array.from({ length: original.length + 1 }, () => Array<number>(revised.length + 1).fill(0));
  for (let i = original.length - 1; i >= 0; i--) {
    for (let j = revised.length - 1; j >= 0; j--) {
      const similarity = paragraphSimilarity(
        original[i]!, revised[j]!, originalNumberingIdentities, revisedNumberingIdentities,
      );
      const paired = similarity >= 0.25 ? similarity + dp[i + 1]![j + 1]! : -1;
      dp[i]![j] = Math.max(paired, dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < original.length && j < revised.length) {
    const similarity = paragraphSimilarity(
      original[i]!, revised[j]!, originalNumberingIdentities, revisedNumberingIdentities,
    );
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
  /** Minimum fuzzy word-set score. Default: 0.8. */
  moveSimilarityThreshold?: number;
  /** Minimum words on both fuzzy candidates. Default: 5. */
  moveMinimumWordCount?: number;
  /** Fold case while scoring fuzzy candidates. Default: true. */
  caseInsensitiveMove?: boolean;
  /** Enable rendered numbering identities during tagged alignment. Default: true. */
  numberingEnabled?: boolean;
  /** Original package numbering definitions used only for virtual alignment identity. */
  originalNumberingXml?: string;
  /** Revised package numbering definitions used only for virtual alignment identity. */
  revisedNumberingXml?: string;
  /** @internal Markdoc operation ranges to retain as tagged-node provenance. */
  revisionAttributionRanges?: readonly RevisionAttributionRange[];
}

type ResolvedTaggedTreeConstructionOptions = Required<Pick<
  TaggedTreeConstructionOptions,
  | 'detectFormatChanges'
  | 'detectMoves'
  | 'moveSimilarityThreshold'
  | 'moveMinimumWordCount'
  | 'caseInsensitiveMove'
  | 'revisionAttributionRanges'
>>;

function constructBoth(
  original: WmlElement,
  revised: WmlElement,
  options: ResolvedTaggedTreeConstructionOptions,
  originalNumberingIdentities: ReadonlyMap<WmlElement, string>,
  revisedNumberingIdentities: ReadonlyMap<WmlElement, string>,
): BothNode {
  const originalChildren = childElements(original);
  const revisedChildren = childElements(revised);
  const pairs = lcsPairs(
    originalChildren,
    revisedChildren,
    originalNumberingIdentities,
    revisedNumberingIdentities,
  );
  const children: TaggedNode[] = [];
  const emitGap = (originalEnd: number, revisedEnd: number): void => {
    while (originalEnd - oi === revisedEnd - ri && oi < originalEnd && ri < revisedEnd) {
      const left = originalChildren[oi]!;
      const right = revisedChildren[ri]!;
      const sameIdentity = (left.namespaceURI ?? '') === (right.namespaceURI ?? '') &&
        (left.localName ?? left.tagName) === (right.localName ?? right.tagName) &&
        semanticAttributeSignature(left) === semanticAttributeSignature(right) &&
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
      children.push(constructBoth(
        left,
        right,
        options,
        originalNumberingIdentities,
        revisedNumberingIdentities,
      ));
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
      : similarParagraphPairs(
        originalGap,
        revisedGap,
        originalNumberingIdentities,
        revisedNumberingIdentities,
      );
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
        children.push(constructBoth(
          left,
          right,
          options,
          originalNumberingIdentities,
          revisedNumberingIdentities,
        ));
      }
    }
    while (oi < originalEnd) children.push({ tag: 'original', node: originalChildren[oi++]!, children: [], opaque: true });
    while (ri < revisedEnd) children.push({ tag: 'revised', node: revisedChildren[ri++]!, children: [], opaque: true });
  };
  let oi = 0;
  let ri = 0;
  for (const [matchedOriginal, matchedRevised] of pairs) {
    emitGap(matchedOriginal, matchedRevised);
    children.push(constructBoth(
      originalChildren[oi++]!,
      revisedChildren[ri++]!,
      options,
      originalNumberingIdentities,
      revisedNumberingIdentities,
    ));
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

function paragraphsIn(root: WmlElement): WmlElement[] {
  const paragraphs = Array.from(root.getElementsByTagNameNS(
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'p',
  )) as WmlElement[];
  if (root.localName === 'p') paragraphs.unshift(root);
  return paragraphs;
}

function runsOverlappingRange(
  root: WmlElement,
  range: RevisionAttributionRange,
): Set<WmlElement> {
  const document = root.ownerDocument!;
  const startParagraph = findParagraphByBookmarkId(document, range.startParagraphId) as WmlElement | null;
  const endParagraph = findParagraphByBookmarkId(document, range.endParagraphId) as WmlElement | null;
  if (!startParagraph || !endParagraph) {
    throw new Error(`operation ${range.operationId} names an unavailable paragraph attribution anchor`);
  }
  const paragraphs = paragraphsIn(root);
  const startIndex = paragraphs.indexOf(startParagraph);
  const endIndex = paragraphs.indexOf(endParagraph);
  if (startIndex < 0 || endIndex < startIndex) {
    throw new Error(`operation ${range.operationId} has a reversed or out-of-story attribution range`);
  }
  const marked = new Set<WmlElement>();
  for (let paragraphIndex = startIndex; paragraphIndex <= endIndex; paragraphIndex++) {
    const paragraph = paragraphs[paragraphIndex]!;
    const runs = getParagraphRuns(paragraph);
    const paragraphLength = runs.reduce((length, run) => length + run.text.length, 0);
    const segmentStart = paragraphIndex === startIndex ? range.start : 0;
    const segmentEnd = paragraphIndex === endIndex ? range.end : paragraphLength;
    if (segmentStart < 0 || segmentEnd > paragraphLength || segmentStart >= segmentEnd) {
      throw new Error(`operation ${range.operationId} has an empty or invalid attribution range`);
    }
    let offset = 0;
    for (const run of runs) {
      const runStart = offset;
      const runEnd = offset + run.text.length;
      if (runEnd > segmentStart && runStart < segmentEnd) marked.add(run.r as WmlElement);
      offset = runEnd;
    }
  }
  if (marked.size === 0) {
    throw new Error(`operation ${range.operationId} has no attributable text runs`);
  }
  return marked;
}

function carryOperationProvenance(
  tree: TaggedNode,
  original: WmlElement,
  revised: WmlElement,
  ranges: readonly RevisionAttributionRange[],
): void {
  for (const range of ranges) {
    const markedRuns = runsOverlappingRange(range.side === 'original' ? original : revised, range);
    let attributedNodes = 0;
    const intersectsMarkedRun = (element: WmlElement): boolean => [...markedRuns].some((run) =>
      element === run || element.contains(run) || run.contains(element));
    const visit = (node: TaggedNode): void => {
      if (node.tag === range.side && intersectsMarkedRun(node.node)) {
        const existing = node.operationProvenance ?? [];
        if (existing.some((operationId) => operationId !== range.operationId)) {
          throw new Error(`operation ${range.operationId} overlaps another attributed tagged node`);
        }
        node.operationProvenance = [...new Set([...existing, range.operationId])];
        attributedNodes++;
        return;
      }
      node.children.forEach(visit);
    };
    visit(tree);
    if (attributedNodes === 0) {
      throw new Error(`operation ${range.operationId} does not intersect a generated ${range.side} revision`);
    }
  }
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

interface TaggedMoveCandidate<T extends OriginalNode | RevisedNode> {
  node: T;
  text: string;
  order: number;
  paragraphOwner?: BothNode;
}

function moveCandidateIsSafe(node: OriginalNode | RevisedNode): boolean {
  const blockedAncestors = new Set(['tbl', 'txbxContent', 'footnote', 'endnote']);
  for (let current: Element | null = node.node; current; current = current.parentElement) {
    if (blockedAncestors.has(current.localName)) return false;
  }
  for (const localName of blockedAncestors) {
    if (node.node.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      localName,
    ).length > 0) return false;
  }
  if (revisionProvenance(node.node).length > 0) return false;
  for (const localName of [
    'fldChar',
    'instrText',
    'moveFrom',
    'moveTo',
    'moveFromRangeStart',
    'moveFromRangeEnd',
    'moveToRangeStart',
    'moveToRangeEnd',
  ]) {
    if (node.node.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      localName,
    ).length > 0) return false;
  }
  return true;
}

function moveCandidates<T extends OriginalNode | RevisedNode>(
  nodes: readonly T[],
  owners: ReadonlyMap<TaggedNode, BothNode>,
): TaggedMoveCandidate<T>[] {
  const candidates: TaggedMoveCandidate<T>[] = [];
  nodes.forEach((node, order) => {
    if (!moveCandidateIsSafe(node)) return;
    if (candidates.some((candidate) => candidate.node.node.contains(node.node))) return;
    candidates.push({
      node,
      text: node.node.textContent ?? '',
      order,
      paragraphOwner: owners.get(node),
    });
  });
  return candidates;
}

function collectMoveCandidates(tree: TaggedNode): {
  originals: TaggedMoveCandidate<OriginalNode>[];
  revised: TaggedMoveCandidate<RevisedNode>[];
} {
  const originals: OriginalNode[] = [];
  const revised: RevisedNode[] = [];
  collectSideOnly(tree, originals, revised);
  const owners = new Map<TaggedNode, BothNode>();
  const indexOwners = (node: TaggedNode, owner?: BothNode): void => {
    const nextOwner = node.tag === 'both' && node.original.localName === 'p' ? node : owner;
    if (node.tag !== 'both' && nextOwner) owners.set(node, nextOwner);
    node.children.forEach((child) => indexOwners(child, nextOwner));
  };
  indexOwners(tree);
  return {
    originals: moveCandidates(originals, owners),
    revised: moveCandidates(revised, owners),
  };
}

/** Maximum-weight bipartite assignment with deterministic document-order ties. */
/** @internal Deterministic maximum-weight matcher used by tagged fuzzy moves. */
export function globallyPairCandidates(
  scores: ReadonlyArray<ReadonlyArray<number | undefined>>,
): Array<[number, number]> {
  const rowCount = scores.length;
  const realColumnCount = scores[0]?.length ?? 0;
  if (rowCount === 0 || realColumnCount === 0) return [];
  const columnCount = realColumnCount + rowCount;
  const u = Array<number>(rowCount + 1).fill(0);
  const v = Array<number>(columnCount + 1).fill(0);
  const matchedRow = Array<number>(columnCount + 1).fill(0);
  const previousColumn = Array<number>(columnCount + 1).fill(0);
  const cost = (row: number, column: number): number => {
    if (column > realColumnCount) return 0;
    const score = scores[row - 1]?.[column - 1];
    if (score === undefined) return 1;
    const tieRank = (row - 1) * realColumnCount + column - 1;
    return -score - 1e-7 + tieRank * 1e-12;
  };
  for (let row = 1; row <= rowCount; row++) {
    matchedRow[0] = row;
    let column0 = 0;
    const minimum = Array<number>(columnCount + 1).fill(Number.POSITIVE_INFINITY);
    const used = Array<boolean>(columnCount + 1).fill(false);
    do {
      used[column0] = true;
      const activeRow = matchedRow[column0]!;
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let column = 1; column <= columnCount; column++) {
        if (used[column]) continue;
        const current = cost(activeRow, column) - u[activeRow]! - v[column]!;
        if (current < minimum[column]!) {
          minimum[column] = current;
          previousColumn[column] = column0;
        }
        if (minimum[column]! < delta) {
          delta = minimum[column]!;
          column1 = column;
        }
      }
      for (let column = 0; column <= columnCount; column++) {
        if (used[column]) {
          const assignedRow = matchedRow[column]!;
          u[assignedRow] = u[assignedRow]! + delta;
          v[column] = v[column]! - delta;
        } else minimum[column] = minimum[column]! - delta;
      }
      column0 = column1;
    } while (matchedRow[column0] !== 0);
    do {
      const column1 = previousColumn[column0]!;
      matchedRow[column0] = matchedRow[column1]!;
      column0 = column1;
    } while (column0 !== 0);
  }
  return matchedRow.flatMap((row, column) =>
    row > 0 && column > 0 && column <= realColumnCount && scores[row - 1]?.[column - 1] !== undefined
      ? [[row - 1, column - 1] as [number, number]]
      : [])
    .sort(([left], [right]) => left - right);
}

function classifyMoves(
  tree: TaggedNode,
  firstRevisionId: number,
  settings: Required<Pick<
    TaggedTreeConstructionOptions,
    'moveSimilarityThreshold' | 'moveMinimumWordCount' | 'caseInsensitiveMove'
  >>,
): TaggedMoveRelation[] {
  const { originals: originalCandidates, revised: revisedCandidates } =
    collectMoveCandidates(tree);
  const revisedBySignature = new Map<string, Array<TaggedMoveCandidate<RevisedNode>>>();
  for (const candidate of revisedCandidates) {
    const signature = subtreeSignature(candidate.node.node);
    const bucket = revisedBySignature.get(signature) ?? [];
    bucket.push(candidate);
    revisedBySignature.set(signature, bucket);
  }
  const relations: TaggedMoveRelation[] = [];
  const bound = new Set<TaggedNode>();
  let id = firstRevisionId;
  for (const source of originalCandidates) {
    const bucket = revisedBySignature.get(subtreeSignature(source.node.node));
    const destinationIndex = bucket?.findIndex((candidate) =>
      !source.paragraphOwner || candidate.paragraphOwner !== source.paragraphOwner);
    const destination = destinationIndex === undefined || destinationIndex < 0
      ? undefined
      : bucket?.splice(destinationIndex, 1)[0];
    if (!destination) continue;
    relations.push({
      source: source.node,
      destination: destination.node,
      name: `taggedMove${relations.length + 1}`,
      sourceRangeId: id++,
      destinationRangeId: id++,
    });
    bound.add(source.node);
    bound.add(destination.node);
  }
  const residualOriginals = originalCandidates.filter((candidate) =>
    !bound.has(candidate.node) && countWords(candidate.text) >= settings.moveMinimumWordCount);
  const residualRevised = revisedCandidates.filter((candidate) =>
    !bound.has(candidate.node) && countWords(candidate.text) >= settings.moveMinimumWordCount);
  const scores = residualOriginals.map((source) => residualRevised.map((destination) => {
    if (source.paragraphOwner && source.paragraphOwner === destination.paragraphOwner) return undefined;
    const score = Math.max(
      jaccardWordSimilarity(source.text, destination.text, settings.caseInsensitiveMove),
      wordContainmentSimilarity(source.text, destination.text, settings.caseInsensitiveMove),
    );
    return score >= settings.moveSimilarityThreshold ? score : undefined;
  }));
  for (const [sourceIndex, destinationIndex] of globallyPairCandidates(scores)
    .sort(([left], [right]) => left - right)) {
    const source = residualOriginals[sourceIndex]!;
    const destination = residualRevised[destinationIndex]!;
    relations.push({
      source: source.node,
      destination: destination.node,
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
  const settings: ResolvedTaggedTreeConstructionOptions = {
    detectFormatChanges: options.detectFormatChanges ?? true,
    detectMoves: options.detectMoves ?? true,
    moveSimilarityThreshold:
      options.moveSimilarityThreshold ?? DEFAULT_MOVE_DETECTION_SETTINGS.moveSimilarityThreshold,
    moveMinimumWordCount:
      options.moveMinimumWordCount ?? DEFAULT_MOVE_DETECTION_SETTINGS.moveMinimumWordCount,
    caseInsensitiveMove:
      options.caseInsensitiveMove ?? DEFAULT_MOVE_DETECTION_SETTINGS.caseInsensitiveMove,
    revisionAttributionRanges: options.revisionAttributionRanges ?? [],
  };
  const numberingEnabled = options.numberingEnabled ?? true;
  const originalNumberingIdentities = computeNumberingIdentities(
    original,
    options.originalNumberingXml,
    { enabled: numberingEnabled },
  );
  const revisedNumberingIdentities = computeNumberingIdentities(
    revised,
    options.revisedNumberingXml,
    { enabled: numberingEnabled },
  );
  const tree = constructBoth(
    original,
    revised,
    settings,
    originalNumberingIdentities,
    revisedNumberingIdentities,
  );
  const violations = verifyTaggedTree(original, revised, tree);
  if (violations.length > 0) throw new Error(`constructed tagged tree violates P1-P5: ${violations[0]!.detail}`);
  carryOperationProvenance(tree, original, revised, settings.revisionAttributionRanges);
  const moves = settings.detectMoves
    ? classifyMoves(tree, nextRevisionId(original, revised), settings)
    : [];
  const moveViolations = verifyMoveRelations(moves, tree);
  if (moveViolations.length > 0) throw new Error(`constructed move relation is invalid: ${moveViolations[0]!.detail}`);
  return { tree, moves };
}

/** Equal-content side-only pairs are valid only when explicitly bound as moves. */
export function verifyGlobalEqualContentInvariant(
  tree: TaggedNode,
  moves: readonly TaggedMoveRelation[],
): string[] {
  const { originals, revised } = collectMoveCandidates(tree);
  const bound = new Set(moves.flatMap((move) => [move.source, move.destination]));
  const revisedBySignature = new Map<string, Array<TaggedMoveCandidate<RevisedNode>>>();
  for (const candidate of revised) {
    const signature = subtreeSignature(candidate.node.node);
    revisedBySignature.set(signature, [...(revisedBySignature.get(signature) ?? []), candidate]);
  }
  return originals.flatMap((candidate) => {
    const peers = revisedBySignature.get(subtreeSignature(candidate.node.node));
    const peerIndex = peers?.findIndex((peer) =>
      !candidate.paragraphOwner || peer.paragraphOwner !== candidate.paragraphOwner);
    if (peerIndex === undefined || peerIndex < 0) return [];
    const peer = peers!.splice(peerIndex, 1)[0]!;
    return !bound.has(candidate.node) || !bound.has(peer.node)
      ? [`equal-content original/revised pair is not classified as a move: ${candidate.node.node.tagName}`]
      : [];
  });
}
