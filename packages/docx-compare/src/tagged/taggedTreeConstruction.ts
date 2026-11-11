import type { WmlElement } from '@usejunior/docx-core';
import {
  buildSectPrBaseSnapshot,
  childElements,
  DEFAULT_MOVE_DETECTION_SETTINGS,
  findParagraphByBookmarkId,
  getParagraphRuns,
} from '@usejunior/docx-core';
import type { RevisionAttributionRange } from '../compare-types.js';
import { getChangedPropertyNames } from '../propertyNaming.js';
import { alignComparisonSequences, tokenizeComparisonText } from '../textAlignment.js';
import {
  countWords,
  jaccardWordSetSimilarity,
  normalizedWordSet,
  wordSetContainmentSimilarity,
} from '../textSimilarity.js';
import { computeNumberingIdentities, numberingListMembership } from './numberingIntegration.js';
import { detectParagraphJoins } from './paragraphJoinDetection.js';
import { rowShape } from './tableTopologyGuard.js';
import {
  nextRevisionId,
  usedRevisionIds,
  PROPERTY_SCOPE_ELEMENT,
  revisionProvenance,
  subtreeSignature,
  verifyMoveRelations,
  verifyTaggedTree,
  type BothNode,
  type OriginalNode,
  type ParagraphJoin,
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
  // `xml:space="preserve"` only matters when the text has leading or trailing
  // whitespace; elsewhere it is a serialization choice that differs between
  // producers and must not make identical text unalignable (#743).
  const insignificantSpace = ['t', 'delText', 'instrText', 'delInstrText'].includes(element.localName ?? '') &&
    !/^\s|\s$/u.test(element.textContent ?? '');
  return JSON.stringify(Array.from(element.attributes)
    .filter((attribute) => {
      if (attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/') return false;
      if (insignificantSpace && attribute.namespaceURI === 'http://www.w3.org/XML/1998/namespace' &&
          attribute.localName === 'space') return false;
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
    // The list and level a paragraph is numbered in, not its rendered label:
    // inserting or deleting a numbered clause renumbers every later sibling,
    // and a renumbered paragraph is still the same paragraph. On the NVCA and
    // ILPA fixtures, keying on Word's labels turned renumbered paragraphs into
    // delete-plus-insert pairs (#1253).
    numberingListMembership(numberingIdentities.get(element)),
  ]);
}

function runNonTextContentSignature(run: WmlElement): string {
  return childElements(run)
    .filter((child) => !(
      child.namespaceURI === run.namespaceURI &&
      ['rPr', 't', 'delText', 'lastRenderedPageBreak'].includes(child.localName)
    ))
    .map((child) => subtreeSignature(child))
    .join('|');
}

/**
 * Keep side-only run content at the run boundary so revision wrappers remain
 * legal children of the surrounding paragraph or other run container.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @see https://github.com/UseJunior/safe-docx/issues/945
 */
function canRecursivelyAlignContent(original: WmlElement, revised: WmlElement): boolean {
  return original.localName !== 'r' ||
    runNonTextContentSignature(original) === runNonTextContentSignature(revised);
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
    // A section delta is recorded as a `CT_SectPrBase` snapshot, which never
    // carries header/footer references (#944). Compare what that snapshot
    // would hold, so sections that differ only in their story references
    // produce no delta: there would be nothing for `w:sectPrChange` to
    // record and nothing for `stats.formatChanges` to count (#1100). The
    // reference difference is disclosed through `unrepresentedChanges`.
    const normalized = descriptor.scope === 'section'
      ? buildSectPrBaseSnapshot(property, property.ownerDocument!) as WmlElement
      : property.cloneNode(true) as WmlElement;
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

/**
 * Restrict text-run anchors to pairs that the container's text alignment also
 * pairs. Run alignment keys compare whole run text, so when the two inputs
 * split identical text into different runs, a short run such as `" "` or a
 * repeated word can match an unrelated run elsewhere in the paragraph. That
 * stray anchor forces the text between it and its true counterpart into a
 * delete-plus-insert, and carries a format revision whenever the two runs'
 * properties differ. An anchor is rejected when the segmentation-independent
 * token alignment of the container text places any of its characters
 * somewhere other than the partner run's matching character.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/743
 */
const MAX_RUN_ANCHOR_ALIGNMENT_CELLS = 4_000_000;

/**
 * A run of one text element (and optional rPr): the only run the serializer's
 * gap refinement can re-align once its anchor is rejected. A run with several
 * text elements, a tab, break, field code, or other content falls back to a
 * whole-run delete-plus-insert, so its anchor is kept.
 */
function isPlainTextRun(element: WmlElement): boolean {
  if (element.localName !== 'r' || (element.textContent ?? '').length === 0) return false;
  const content = childElements(element).filter((child) => child.localName !== 'rPr');
  return content.length === 1 && content[0]!.localName === 't';
}

/** Content that gap refinement can step over or re-align (#1022, #743). */
const REFINABLE_GAP_MARKERS = new Set([
  'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd',
]);
function isRefinableGapContent(element: WmlElement): boolean {
  return isPlainTextRun(element) || REFINABLE_GAP_MARKERS.has(element.localName ?? '');
}

/**
 * Longest common subsequence of child indices under an anchor predicate,
 * taking the first anchor in document order on ties.
 */
function anchorPairs(
  originalLength: number,
  revisedLength: number,
  anchors: (i: number, j: number) => boolean,
  preferred?: (i: number, j: number) => boolean,
): Array<[number, number]> {
  if (preferred) return preferredAnchorPairs(originalLength, revisedLength, anchors, preferred);
  const dp = Array.from({ length: originalLength + 1 }, () => Array<number>(revisedLength + 1).fill(0));
  for (let i = originalLength - 1; i >= 0; i--) {
    for (let j = revisedLength - 1; j >= 0; j--) {
      dp[i]![j] = anchors(i, j)
        ? 1 + dp[i + 1]![j + 1]!
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < originalLength && j < revisedLength) {
    if (anchors(i, j)) {
      pairs.push([i++, j++]);
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

/**
 * The longest anchor alignment, as {@link anchorPairs}, that among the
 * alignments of that length keeps the most `preferred` pairs. With no
 * preferred pair it is the alignment `anchorPairs` returns.
 */
function preferredAnchorPairs(
  originalLength: number,
  revisedLength: number,
  anchors: (i: number, j: number) => boolean,
  preferred: (i: number, j: number) => boolean,
): Array<[number, number]> {
  // A pair outweighs every preference: score = pairs * scale + preferred pairs.
  const scale = Math.min(originalLength, revisedLength) + 1;
  const dp = Array.from({ length: originalLength + 1 }, () => Array<number>(revisedLength + 1).fill(0));
  const take = (i: number, j: number): number =>
    anchors(i, j) ? scale + (preferred(i, j) ? 1 : 0) + dp[i + 1]![j + 1]! : -1;
  for (let i = originalLength - 1; i >= 0; i--) {
    for (let j = revisedLength - 1; j >= 0; j--) {
      dp[i]![j] = Math.max(take(i, j), dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < originalLength && j < revisedLength) {
    if (take(i, j) === dp[i]![j]!) {
      pairs.push([i++, j++]);
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

/**
 * Gaps (original start/end, revised start/end) between consecutive pairs.
 */
function pairGaps(
  pairs: ReadonlyArray<[number, number]>,
  originalLength: number,
  revisedLength: number,
): Array<[number, number, number, number]> {
  const gaps: Array<[number, number, number, number]> = [];
  let originalStart = 0;
  let revisedStart = 0;
  for (const [originalIndex, revisedIndex] of [...pairs, [originalLength, revisedLength] as [number, number]]) {
    if (originalIndex > originalStart || revisedIndex > revisedStart) {
      gaps.push([originalStart, originalIndex, revisedStart, revisedIndex]);
    }
    originalStart = originalIndex + 1;
    revisedStart = revisedIndex + 1;
  }
  return gaps;
}

function textConsistentRunAnchors(
  original: readonly WmlElement[],
  revised: readonly WmlElement[],
): (originalIndex: number, revisedIndex: number) => boolean {
  if (!original.some(isPlainTextRun) || !revised.some(isPlainTextRun)) return () => true;
  const formatting = (element: WmlElement): string => {
    if (element.localName !== 'r') return element.localName ?? element.tagName;
    const properties = childElements(element).find((child) => child.localName === 'rPr');
    return properties ? subtreeSignature(properties) : '';
  };
  const offsets = (elements: readonly WmlElement[]): { text: string; starts: number[] } => {
    const starts: number[] = [];
    let text = '';
    for (const element of elements) {
      starts.push(text.length);
      text += element.textContent ?? '';
    }
    return { text, starts };
  };
  const left = offsets(original);
  const right = offsets(revised);
  interface Token { value: string; start: number; formatting: string }
  const tokens = (
    elements: readonly WmlElement[],
    side: { text: string; starts: number[] },
  ): Token[] => {
    let start = 0;
    let owner = 0;
    return tokenizeComparisonText(side.text).map((value) => {
      while (owner + 1 < elements.length && side.starts[owner + 1]! <= start) owner++;
      const token = { value, start, formatting: formatting(elements[owner]!) };
      start += value.length;
      return token;
    });
  };
  const leftTokens = tokens(original, left);
  const rightTokens = tokens(revised, right);
  const identical = (a: Token, b: Token): boolean => a.value === b.value && a.formatting === b.formatting;
  // Aligned character offsets, in both directions.
  const forward = new Map<number, number>();
  const backward = new Map<number, number>();
  const mapToken = (leftIndex: number, rightIndex: number): void => {
    const leftToken = leftTokens[leftIndex]!;
    const rightToken = rightTokens[rightIndex]!;
    for (let offset = 0; offset < leftToken.value.length; offset++) {
      forward.set(leftToken.start + offset, rightToken.start + offset);
      backward.set(rightToken.start + offset, leftToken.start + offset);
    }
  };
  let prefix = 0;
  while (prefix < leftTokens.length && prefix < rightTokens.length &&
      identical(leftTokens[prefix]!, rightTokens[prefix]!)) {
    mapToken(prefix, prefix);
    prefix++;
  }
  let suffix = 0;
  while (suffix < leftTokens.length - prefix && suffix < rightTokens.length - prefix &&
      identical(leftTokens[leftTokens.length - 1 - suffix]!, rightTokens[rightTokens.length - 1 - suffix]!)) {
    mapToken(leftTokens.length - 1 - suffix, rightTokens.length - 1 - suffix);
    suffix++;
  }
  // The quadratic token alignment is bounded; past the bound, run anchors
  // keep their text-only identity.
  if ((leftTokens.length - prefix - suffix) * (rightTokens.length - prefix - suffix) >
      MAX_RUN_ANCHOR_ALIGNMENT_CELLS) return () => true;
  // Text decides the alignment; formatting only chooses among equally long
  // alignments, so an inserted space beside a bold word is not taken for the
  // unformatted space that was already there.
  const middle = alignComparisonSequences(
    leftTokens.slice(prefix, leftTokens.length - suffix),
    rightTokens.slice(prefix, rightTokens.length - suffix),
    (a, b) => a.value === b.value,
    identical,
  );
  for (const match of middle.matches) mapToken(prefix + match.originalIndex, prefix + match.revisedIndex);
  return (originalIndex, revisedIndex) => {
    const originalElement = original[originalIndex]!;
    if (!isPlainTextRun(originalElement) || !isPlainTextRun(revised[revisedIndex]!)) return true;
    const text = originalElement.textContent ?? '';
    const originalStart = left.starts[originalIndex]!;
    const revisedStart = right.starts[revisedIndex]!;
    // Characters inside changed tokens align with nothing and do not decide;
    // a character the text alignment places anywhere else rejects the pair.
    // Whitespace tokens merge across run boundaries, so where a space falls in
    // one is arbitrary: whitespace decides only for a whitespace-only run.
    const whitespaceOnly = text.trim() === '';
    for (let offset = 0; offset < text.length; offset++) {
      if (!whitespaceOnly && /\s/u.test(text[offset]!)) continue;
      const revisedOffset = forward.get(originalStart + offset);
      if (revisedOffset !== undefined && revisedOffset !== revisedStart + offset) return false;
      const originalOffset = backward.get(revisedStart + offset);
      if (originalOffset !== undefined && originalOffset !== originalStart + offset) return false;
    }
    return true;
  };
}

function lcsPairs(
  original: readonly WmlElement[],
  revised: readonly WmlElement[],
  originalNumberingIdentities: ReadonlyMap<WmlElement, string>,
  revisedNumberingIdentities: ReadonlyMap<WmlElement, string>,
  cellKeys?: { original: ReadonlyMap<WmlElement, string>; revised: ReadonlyMap<WmlElement, string> },
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
  const originalKeys = original.map((element, index) => cellKeys?.original.get(element) ??
    key(element, originalFields.get(index), originalNumberingIdentities));
  const revisedKeys = revised.map((element, index) => cellKeys?.revised.get(element) ??
    key(element, revisedFields.get(index), revisedNumberingIdentities));
  const keyed = (i: number, j: number): boolean => originalKeys[i] === revisedKeys[j];
  // Keys hold only a paragraph's list and level. Among equally long
  // alignments, prefer pairing paragraphs that show the same list label, so
  // duplicate clauses ("[Reserved]") pair by number (#1253).
  const preferred = originalNumberingIdentities.size > 0 && revisedNumberingIdentities.size > 0
    ? (i: number, j: number): boolean => {
      const identity = originalNumberingIdentities.get(original[i]!);
      return identity !== undefined && identity === revisedNumberingIdentities.get(revised[j]!);
    }
    : undefined;
  const textOnly = anchorPairs(original.length, revised.length, keyed, preferred);
  const consistentAnchor = textConsistentRunAnchors(original, revised);
  const consistent = anchorPairs(
    original.length,
    revised.length,
    (i, j) => keyed(i, j) && consistentAnchor(i, j),
    preferred,
  );
  // Use the text-consistent anchors only when every gap they change can be
  // re-aligned by gap refinement; otherwise a rejected anchor would turn
  // unchanged structural content into a delete-plus-insert.
  const unchanged = new Set(pairGaps(textOnly, original.length, revised.length)
    .map((gap) => gap.join(',')));
  const refinable = pairGaps(consistent, original.length, revised.length)
    .filter((gap) => !unchanged.has(gap.join(',')))
    .every(([originalStart, originalEnd, revisedStart, revisedEnd]) =>
      original.slice(originalStart, originalEnd).every(isRefinableGapContent) &&
      revised.slice(revisedStart, revisedEnd).every(isRefinableGapContent));
  return refinable ? consistent : textOnly;
}

/**
 * Content-control property elements (`w:sdtPr`, `w:sdtEndPr`) admit no
 * revision markup: `CT_SdtPr` has no `w:ins`/`w:del` particle, so a property
 * difference between aligned controls cannot be tracked in place. Aligned
 * property elements are carried as one opaque `both` node, which publishes the
 * revised properties whole; the pipeline discloses the difference through
 * `unrepresentedChanges` (see `collectContentControlPropertyChanges`).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.38
 * @see https://github.com/UseJunior/safe-docx/issues/1095
 */
/**
 * Section properties are revised as one `w:sectPrChange` unit; their children
 * are never aligned or revised individually.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.32
 * @see https://github.com/UseJunior/safe-docx/issues/1100
 */
function isSectionProperties(element: WmlElement): boolean {
  return element.namespaceURI === 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' &&
    element.localName === 'sectPr';
}

export function isContentControlProperties(element: WmlElement): boolean {
  return element.namespaceURI === 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' &&
    ['sdtPr', 'sdtEndPr'].includes(element.localName);
}

/**
 * Pair one block-level content control across a boundary move so paragraphs
 * entering or leaving it are tracked at paragraph level inside and outside the
 * control, rather than wrapping the whole control in a run-level revision.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.29
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @see https://github.com/UseJunior/safe-docx/issues/1028
 */
function sameBlockContentControl(left: WmlElement, right: WmlElement): boolean {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const isBlock = (sdt: WmlElement): boolean => childElements(sdt)
    .filter((child) => child.namespaceURI === W && child.localName === 'sdtContent')
    .flatMap((content) => childElements(content))
    .some((child) => child.namespaceURI === W && ['p', 'tbl'].includes(child.localName));
  const properties = (sdt: WmlElement): string => childElements(sdt)
    .filter((child) => child.namespaceURI === W && ['sdtPr', 'sdtEndPr'].includes(child.localName))
    .map((child) => subtreeSignature(child))
    .join('|');
  return left.namespaceURI === W && right.namespaceURI === W &&
    left.localName === 'sdt' && right.localName === 'sdt' &&
    isBlock(left) && isBlock(right) &&
    semanticAttributeSignature(left) === semanticAttributeSignature(right) &&
    properties(left) === properties(right);
}

/** Minimum similarity for pairing two side-only siblings in a gap. */
const GAP_PAIRING_SIMILARITY = 0.25;

function similarityWords(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
}

function wordJaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return a.size === b.size ? 1 : 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

const CELL_WRAPPERS = new Set(['sdt', 'sdtContent', 'customXml']);

/** A row's cells in grid order, looking through cell-level content wrappers. */
function rowCells(row: WmlElement): WmlElement[] {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const cells: WmlElement[] = [];
  const visit = (parent: WmlElement): void => {
    for (const child of childElements(parent)) {
      if (child.namespaceURI !== W) continue;
      if (child.localName === 'tc') cells.push(child);
      else if (CELL_WRAPPERS.has(child.localName)) visit(child);
    }
  };
  visit(row);
  return cells;
}

/**
 * Word set of block content, read paragraph by paragraph: adjacent cells and
 * paragraphs have no separator in `textContent`, so reading it whole would
 * fuse their last and first words.
 */
function blockWords(element: WmlElement): Set<string> {
  const words = new Set<string>();
  for (const paragraph of Array.from(element.getElementsByTagNameNS(
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'p',
  ))) {
    for (const word of similarityWords(paragraph.textContent ?? '')) words.add(word);
  }
  return words;
}

/** Character bigrams of block content, read paragraph by paragraph. */
function blockBigrams(element: WmlElement): Set<string> {
  const bigrams = new Set<string>();
  for (const paragraph of Array.from(element.getElementsByTagNameNS(
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'p',
  ))) {
    const text = (paragraph.textContent ?? '').toLowerCase().replace(/\s+/gu, ' ').trim();
    for (let index = 0; index + 1 < text.length; index++) bigrams.add(text.slice(index, index + 2));
  }
  return bigrams;
}

function bigramDice(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const bigram of a) if (b.has(bigram)) intersection++;
  return (2 * intersection) / (a.size + b.size);
}

interface CellProfile { words: Set<string>; bigrams: Set<string> }
interface RowProfile {
  shape: string;
  words: Set<string>;
  cells: CellProfile[];
  /** Cells sit inside a cell-level `w:sdt`/`w:customXml`, out of reach of grid-interval keys. */
  wrappedCells: boolean;
  /** `w:trPr` already carries a row insertion or deletion. */
  rowRevision: boolean;
}
/** Reset per construction, so a DOM reused after mutation is profiled afresh. */
let rowProfiles = new WeakMap<WmlElement, RowProfile>();
function rowProfile(row: WmlElement): RowProfile {
  let profile = rowProfiles.get(row);
  if (!profile) {
    profile = {
      shape: rowShape(row),
      words: blockWords(row),
      cells: rowCells(row).map((cell) => ({ words: blockWords(cell), bigrams: blockBigrams(cell) })),
      wrappedCells: childElements(row).some((child) =>
        child.namespaceURI === row.namespaceURI && ['sdt', 'customXml'].includes(child.localName)),
      rowRevision: childElements(row)
        .filter((child) => child.namespaceURI === row.namespaceURI && child.localName === 'trPr')
        .some((trPr) => childElements(trPr).some((child) =>
          child.namespaceURI === row.namespaceURI && ['ins', 'del'].includes(child.localName))),
    };
    rowProfiles.set(row, profile);
  }
  return profile;
}

/**
 * Cell-text similarity of two table rows. Rows with different skeletons
 * (grid offsets, cell spans or merge states) cannot be compared cell by
 * cell, so their similarity is the word-set similarity of the whole row.
 * Rows with the same skeleton score the mean similarity of the cells that
 * share a grid interval, each the better of word-set similarity and
 * character-bigram similarity (so a short label edited within one word,
 * such as `Top` to `Topped`, still agrees). Two empty cells agree, but a
 * row pair agrees only when at least one pair of non-empty cells shares
 * text, so rows that merely share blank cells are not taken for an edit of
 * one another.
 */
function rowSimilarity(left: WmlElement, right: WmlElement): number {
  const a = rowProfile(left);
  const b = rowProfile(right);
  if (a.words.size === 0 || b.words.size === 0) return a.words.size === b.words.size ? 1 : 0;
  if (a.shape !== b.shape) return wordJaccard(a.words, b.words);
  if (a.cells.length === 0 || a.cells.length !== b.cells.length) return 0;
  let total = 0;
  let sharedText = false;
  for (let index = 0; index < a.cells.length; index++) {
    const leftCell = a.cells[index]!;
    const rightCell = b.cells[index]!;
    const score = Math.max(
      wordJaccard(leftCell.words, rightCell.words),
      bigramDice(leftCell.bigrams, rightCell.bigrams),
    );
    if (leftCell.words.size > 0 && rightCell.words.size > 0 && score > 0) sharedText = true;
    total += score;
  }
  return sharedText ? total / a.cells.length : 0;
}

/**
 * Whether two rows in a gap are one edited row. Rows pair by cell-text
 * similarity, never by position alone: a deleted row beside an unrelated
 * inserted row is a whole-row deletion plus a whole-row insertion, not
 * in-row edits that carry no row marker. Only rows with the same skeleton
 * pair across positions; a skeleton change at the same position still
 * pairs, and is then replaced by a deleted and an inserted row
 * (`replaceSkeletonChangedRows`, #1396) or refused by the table-topology
 * guard.
 *
 * Two kinds of row keep the earlier same-position pairing and never pair
 * across positions: a row whose cells sit in a cell-level content wrapper,
 * whose cells grid-interval keys cannot reach, and a row whose `w:trPr`
 * already carries a row revision, which a whole-row revision would
 * duplicate.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @see https://github.com/UseJunior/safe-docx/issues/1227
 */
function isLegacyRow(row: WmlElement): boolean {
  const profile = rowProfile(row);
  return profile.wrappedCells || profile.rowRevision;
}

function similarRows(left: WmlElement, right: WmlElement, samePosition: boolean): boolean {
  if (isLegacyRow(left) || isLegacyRow(right)) return samePosition;
  const a = rowProfile(left);
  const b = rowProfile(right);
  if (!samePosition && a.shape !== b.shape) return false;
  return rowSimilarity(left, right) >= GAP_PAIRING_SIMILARITY;
}

function isTableRow(element: WmlElement): boolean {
  return element.namespaceURI === 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' &&
    element.localName === 'tr';
}

/**
 * Alignment keys that pair a row's direct cells by grid interval, for two
 * rows with the same skeleton and no cell-level content wrappers. Text keys would anchor a cell to an equal-text
 * cell in another column and leave the cells between them side-only, which
 * no `w:tc` revision can express; by interval every cell pairs with the cell
 * in its own columns and is diffed in place.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.17
 * @see https://github.com/UseJunior/safe-docx/issues/1227
 */
function cellGridIntervalKeys(row: WmlElement): Map<WmlElement, string> {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const gridNumber = (element: WmlElement | undefined, fallback: number, minimum: number): number => {
    const parsed = Number(element?.getAttributeNS(W, 'val') ?? NaN);
    return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : fallback;
  };
  const direct = (parent: WmlElement | undefined, name: string): WmlElement | undefined => parent
    ? childElements(parent).find((child) => child.namespaceURI === W && child.localName === name)
    : undefined;
  let column = gridNumber(direct(direct(row, 'trPr'), 'gridBefore'), 0, 0);
  const keys = new Map<WmlElement, string>();
  const visit = (parent: WmlElement, isRow: boolean): void => {
    for (const child of childElements(parent)) {
      if (child.namespaceURI !== W) continue;
      if (child.localName === 'tc') {
        const start = column;
        column += gridNumber(direct(direct(child, 'tcPr'), 'gridSpan'), 1, 1);
        if (isRow) keys.set(child, JSON.stringify(['tc-grid-interval', start, column]));
      } else if (CELL_WRAPPERS.has(child.localName)) {
        visit(child, false);
      }
    }
  };
  visit(row, true);
  return keys;
}

function paragraphSimilarity(
  left: WmlElement,
  right: WmlElement,
  originalNumberingIdentities: ReadonlyMap<WmlElement, string>,
  revisedNumberingIdentities: ReadonlyMap<WmlElement, string>,
): number {
  if (sameBlockContentControl(left, right)) return 1;
  if (isTableRow(left) && isTableRow(right)) {
    return similarRows(left, right, false) ? rowSimilarity(left, right) : 0;
  }
  if (left.localName !== right.localName || !['p', 'r'].includes(left.localName)) return 0;
  if (semanticAttributeSignature(left) !== semanticAttributeSignature(right)) return 0;
  // List and level, not the rendered label, as in `alignmentKey` (#1253).
  if (numberingListMembership(originalNumberingIdentities.get(left)) !==
      numberingListMembership(revisedNumberingIdentities.get(right))) return 0;
  return wordJaccard(similarityWords(left.textContent ?? ''), similarityWords(right.textContent ?? ''));
}

/**
 * Order-preserving pairing of a gap's side-only siblings that maximizes the
 * summed pair weight, among pairs at least `GAP_PAIRING_SIMILARITY` alike.
 * A paragraph pair weighs its similarity; a table-row pair weighs its
 * similarity squared, so one confident row edit outweighs two mediocre pairs
 * of rows that share only boilerplate text (#1419).
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1419
 */
function similarParagraphPairs(
  original: readonly WmlElement[],
  revised: readonly WmlElement[],
  originalNumberingIdentities: ReadonlyMap<WmlElement, string>,
  revisedNumberingIdentities: ReadonlyMap<WmlElement, string>,
): Array<[number, number]> {
  const weights = original.map((left) => revised.map((right) => {
    const similarity = paragraphSimilarity(left, right, originalNumberingIdentities, revisedNumberingIdentities);
    if (similarity < GAP_PAIRING_SIMILARITY) return -1;
    return isTableRow(left) && isTableRow(right) ? similarity * similarity : similarity;
  }));
  const dp = Array.from({ length: original.length + 1 }, () => Array<number>(revised.length + 1).fill(0));
  for (let i = original.length - 1; i >= 0; i--) {
    for (let j = revised.length - 1; j >= 0; j--) {
      const weight = weights[i]![j]!;
      const paired = weight >= 0 ? weight + dp[i + 1]![j + 1]! : -1;
      dp[i]![j] = Math.max(paired, dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < original.length && j < revised.length) {
    const weight = weights[i]![j]!;
    if (weight >= 0 && Math.abs(dp[i]![j]! - (weight + dp[i + 1]![j + 1]!)) < 1e-9) {
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
  /** Original package styles, for numbering paragraphs inherit from their style (virtual alignment identity only). */
  originalStylesXml?: string;
  /** Revised package styles, for numbering paragraphs inherit from their style (virtual alignment identity only). */
  revisedStylesXml?: string;
  /** @internal Markdoc operation ranges to retain as tagged-node provenance. */
  revisionAttributionRanges?: readonly RevisionAttributionRange[];
  /** @internal First package-wide ID available to generated comparison revisions. */
  minimumRevisionId?: number;
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
  if (isSectionProperties(original)) {
    // Never descend: section properties are revised as one unit through
    // `w:sectPrChange`, and a child-level diff would wrap a header/footer
    // reference in w:ins/w:del inside w:sectPr. The revised properties are
    // published whole (#1100).
    return {
      tag: 'both',
      original,
      revised,
      children: [],
      opaque: true,
      propertyDelta: options.detectFormatChanges ? propertyDelta(original, revised) : undefined,
    };
  }
  const originalChildren = childElements(original);
  const revisedChildren = childElements(revised);
  const cellKeys = isTableRow(original) && isTableRow(revised) &&
      !rowProfile(original).wrappedCells && !rowProfile(revised).wrappedCells &&
      rowProfile(original).shape === rowProfile(revised).shape
    ? { original: cellGridIntervalKeys(original), revised: cellGridIntervalKeys(revised) }
    : undefined;
  const pairs = lcsPairs(
    originalChildren,
    revisedChildren,
    originalNumberingIdentities,
    revisedNumberingIdentities,
    cellKeys,
  );
  const children: TaggedNode[] = [];
  const emitAlignedPair = (left: WmlElement, right: WmlElement): void => {
    if (!canRecursivelyAlignContent(left, right)) {
      children.push({ tag: 'original', node: left, children: [], opaque: true });
      children.push({ tag: 'revised', node: right, children: [], opaque: true });
      return;
    }
    if (isContentControlProperties(left)) {
      // Never descend: a child-level diff would emit w:ins/w:del inside w:sdtPr.
      children.push({ tag: 'both', original: left, revised: right, children: [], opaque: true });
      return;
    }
    children.push(constructBoth(
      left,
      right,
      options,
      originalNumberingIdentities,
      revisedNumberingIdentities,
    ));
  };
  const emitPlainGap = (originalEnd: number, revisedEnd: number): void => {
    // Content-control property elements are singletons under w:sdt, so pair
    // them by name whatever the gap lengths: an added w:sdtEndPr must not turn
    // a changed w:sdtPr into a delete plus insert.
    while (oi < originalEnd && ri < revisedEnd) {
      const left = originalChildren[oi]!;
      const right = revisedChildren[ri]!;
      if (!isContentControlProperties(left) || left.localName !== right.localName ||
          left.namespaceURI !== right.namespaceURI) break;
      emitAlignedPair(left, right);
      oi++;
      ri++;
    }
    // A gap holding a row that must keep same-position pairing (see
    // `similarRows`) pairs all its rows by position, as before: refusing an
    // earlier pair would end this loop before that row is reached.
    const legacyRowGap = originalEnd - oi === revisedEnd - ri && [
      ...originalChildren.slice(oi, originalEnd),
      ...revisedChildren.slice(ri, revisedEnd),
    ].some((element) => isTableRow(element) && isLegacyRow(element));
    const samePositionIdentity = (left: WmlElement, right: WmlElement): boolean =>
      (left.namespaceURI ?? '') === (right.namespaceURI ?? '') &&
      (left.localName ?? left.tagName) === (right.localName ?? right.tagName) &&
      semanticAttributeSignature(left) === semanticAttributeSignature(right) &&
      (childElements(left).length > 0 || childElements(right).length > 0) &&
      canRecursivelyAlignContent(left, right) &&
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
    // Rows with the same skeleton never pair by position alone: in an
    // equal-count gap they pair through the gap's similarity pairing, so one
    // confident edit beside an inserted row is not split into two mediocre
    // position pairs (#1419). The elements that do pair by position (rows
    // whose skeleton differs, for row replacement or the table-topology guard, and row-level
    // content controls) anchor that pairing: the rows between two anchors
    // are paired among themselves, and refusing one row pair never strands
    // a later anchor.
    const count = originalEnd - oi;
    const rowSegmentedGap = !legacyRowGap && count === revisedEnd - ri &&
      originalChildren.slice(oi, originalEnd).some((left, index) => {
        const right = revisedChildren[ri + index]!;
        return isTableRow(left) && isTableRow(right) && rowProfile(left).shape === rowProfile(right).shape;
      });
    if (rowSegmentedGap) {
      const positionStart = oi;
      const positionRevisedStart = ri;
      const anchors = Array.from({ length: count }, (_, index) => {
        const left = originalChildren[positionStart + index]!;
        const right = revisedChildren[positionRevisedStart + index]!;
        if (!samePositionIdentity(left, right)) return false;
        if (!isTableRow(left)) return true;
        return rowProfile(left).shape !== rowProfile(right).shape && similarRows(left, right, true);
      });
      for (let index = 0; index < count;) {
        if (anchors[index]) {
          emitAlignedPair(originalChildren[oi++]!, revisedChildren[ri++]!);
          index++;
          continue;
        }
        let segmentEnd = index;
        while (segmentEnd < count && !anchors[segmentEnd]) segmentEnd++;
        emitSimilarityGap(positionStart + segmentEnd, positionRevisedStart + segmentEnd);
        index = segmentEnd;
      }
      return;
    }
    while (originalEnd - oi === revisedEnd - ri && oi < originalEnd && ri < revisedEnd) {
      const left = originalChildren[oi]!;
      const right = revisedChildren[ri]!;
      if (!samePositionIdentity(left, right) ||
          (isTableRow(left) && !legacyRowGap && !similarRows(left, right, true))) break;
      emitAlignedPair(left, right);
      oi++;
      ri++;
    }
    emitSimilarityGap(originalEnd, revisedEnd);
  };
  /** Pairs the side-only siblings before the given ends by similarity. */
  const emitSimilarityGap = (originalEnd: number, revisedEnd: number): void => {
    const gapOriginalStart = oi;
    const gapRevisedStart = ri;
    const originalGap = originalChildren.slice(gapOriginalStart, originalEnd);
    const revisedGap = revisedChildren.slice(gapRevisedStart, revisedEnd);
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    // A table row whose fields all begin and end inside it is diffed cell by
    // cell, so pairing it cannot split a field complex.
    const fieldsCompleteWithin = (row: WmlElement): boolean => {
      let depth = 0;
      for (const fieldChar of Array.from(row.getElementsByTagNameNS(W, 'fldChar'))) {
        const type = fieldChar.getAttributeNS(W, 'fldCharType');
        if (type === 'begin') depth++;
        else if (type === 'end' && --depth < 0) return false;
      }
      return depth === 0;
    };
    const containsFieldControl = (elements: readonly WmlElement[]): boolean => elements.some((element) =>
      isTableRow(element)
        ? !fieldsCompleteWithin(element)
        : element.getElementsByTagNameNS(W, 'fldChar').length > 0 ||
          element.getElementsByTagNameNS(W, 'instrText').length > 0);
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
  const emitGap = (originalEnd: number, revisedEnd: number): void => {
    // A split or merge pairs one paragraph with several. Record it as a
    // relation over the side-only members (#873); markdoc attribution ranges
    // keep the plain path because their provenance is node-based.
    const joins = options.revisionAttributionRanges.length > 0
      ? []
      : detectParagraphJoins(
        originalChildren.slice(oi, originalEnd),
        revisedChildren.slice(ri, revisedEnd),
        (left, right) => constructBoth(left, right, options, originalNumberingIdentities, revisedNumberingIdentities),
      );
    const gapOriginalStart = oi;
    const gapRevisedStart = ri;
    for (const group of joins) {
      emitPlainGap(gapOriginalStart + group.originalStart, gapRevisedStart + group.revisedStart);
      const members: Array<OriginalNode | RevisedNode> = [];
      for (let count = 0; count < group.originalCount; count++) {
        members.push({ tag: 'original', node: originalChildren[oi++]!, children: [], opaque: true });
      }
      for (let count = 0; count < group.revisedCount; count++) {
        members.push({ tag: 'revised', node: revisedChildren[ri++]!, children: [], opaque: true });
      }
      const join: ParagraphJoin = { kind: group.kind, members, parts: group.parts };
      for (const member of members) member.paragraphJoin = join;
      children.push(...members);
    }
    emitPlainGap(originalEnd, revisedEnd);
  };
  let oi = 0;
  let ri = 0;
  for (const [matchedOriginal, matchedRevised] of pairs) {
    emitGap(matchedOriginal, matchedRevised);
    emitAlignedPair(originalChildren[oi++]!, revisedChildren[ri++]!);
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
    if (segmentStart < 0 || segmentEnd > paragraphLength || segmentStart > segmentEnd) {
      throw new Error(`operation ${range.operationId} has an empty or invalid attribution range`);
    }
    if (segmentStart === segmentEnd) {
      if (paragraphIndex === startIndex || paragraphIndex === endIndex) {
        throw new Error(`operation ${range.operationId} has an empty or invalid attribution range`);
      }
      continue;
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
  // Split/merge members are already related to their counterparts (#873).
  if (node.tag !== 'both' && node.paragraphJoin) return;
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
    // Note-bearing moves need independent note definitions and the paragraph
    // break behavior of the deletion/insertion path in desktop readers.
    'footnoteReference',
    'endnoteReference',
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
    const paragraphOwner = owners.get(node);
    // A run split by a format-only edit still belongs to its text-identical
    // paragraph. Global exact/fuzzy matching must not steal it for a repeated
    // phrase in a neighbor before the serializer refines the local run gap.
    // Whole-paragraph relocations have no paired paragraph owner.
    if (isPlainTextRun(node.node) && paragraphOwner &&
        paragraphOwner.original.textContent === paragraphOwner.revised.textContent) return;
    if (candidates.some((candidate) => candidate.node.node.contains(node.node))) return;
    candidates.push({
      node,
      text: node.node.textContent ?? '',
      order,
      paragraphOwner,
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
  const originalColumnCount = scores[0]?.length ?? 0;
  // A row or column with no eligible score always takes a zero-cost dummy
  // column, so dropping it leaves the optimum unchanged and keeps the solver
  // proportional to the candidates that can actually pair.
  const activeRows = scores.flatMap((row, index) =>
    row.some((score) => score !== undefined) ? [index] : []);
  const activeColumns = Array.from({ length: originalColumnCount }, (_, index) => index)
    .filter((column) => scores.some((row) => row[column] !== undefined));
  const rowCount = activeRows.length;
  const realColumnCount = activeColumns.length;
  if (rowCount === 0 || realColumnCount === 0) return [];
  const columnCount = realColumnCount + rowCount;
  const u = Array<number>(rowCount + 1).fill(0);
  const v = Array<number>(columnCount + 1).fill(0);
  const matchedRow = Array<number>(columnCount + 1).fill(0);
  const previousColumn = Array<number>(columnCount + 1).fill(0);
  const cost = (row: number, column: number): number => {
    if (column > realColumnCount) return 0;
    const originalRow = activeRows[row - 1]!;
    const originalColumn = activeColumns[column - 1]!;
    const score = scores[originalRow]?.[originalColumn];
    if (score === undefined) return 1;
    const tieRank = originalRow * originalColumnCount + originalColumn;
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
  return matchedRow.flatMap((row, column) => {
    if (row === 0 || column === 0 || column > realColumnCount) return [];
    const pair: [number, number] = [activeRows[row - 1]!, activeColumns[column - 1]!];
    return scores[pair[0]]?.[pair[1]] !== undefined ? [pair] : [];
  })
    .sort(([left], [right]) => left - right);
}

function classifyMoves(
  tree: TaggedNode,
  allocateRangeId: () => number,
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
      sourceRangeId: allocateRangeId(),
      destinationRangeId: allocateRangeId(),
    });
    bound.add(source.node);
    bound.add(destination.node);
  }
  const residualOriginals = originalCandidates.filter((candidate) =>
    !bound.has(candidate.node) && countWords(candidate.text) >= settings.moveMinimumWordCount);
  const residualRevised = revisedCandidates.filter((candidate) =>
    !bound.has(candidate.node) && countWords(candidate.text) >= settings.moveMinimumWordCount);
  const originalWords = residualOriginals.map((candidate) =>
    normalizedWordSet(candidate.text, settings.caseInsensitiveMove));
  const revisedWords = residualRevised.map((candidate) =>
    normalizedWordSet(candidate.text, settings.caseInsensitiveMove));
  const scores = residualOriginals.map((source, sourceIndex) => residualRevised.map((destination, destinationIndex) => {
    if (source.paragraphOwner && source.paragraphOwner === destination.paragraphOwner) return undefined;
    const score = Math.max(
      jaccardWordSetSimilarity(originalWords[sourceIndex]!, revisedWords[destinationIndex]!),
      wordSetContainmentSimilarity(originalWords[sourceIndex]!, revisedWords[destinationIndex]!),
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
      sourceRangeId: allocateRangeId(),
      destinationRangeId: allocateRangeId(),
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
  rowProfiles = new WeakMap();
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
    { numberingXml: options.originalNumberingXml, stylesXml: options.originalStylesXml },
    { enabled: numberingEnabled },
  );
  const revisedNumberingIdentities = computeNumberingIdentities(
    revised,
    { numberingXml: options.revisedNumberingXml, stylesXml: options.revisedStylesXml },
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
  // Move range IDs share the annotation ID space with every input `w:id`, so
  // skip IDs already present instead of counting up blindly from the first
  // gap: sparse input IDs would otherwise yield duplicate range IDs.
  const usedIds = usedRevisionIds(original, revised);
  let nextRangeId = Math.max(nextRevisionId(original, revised), options.minimumRevisionId ?? 0);
  const allocateRangeId = (): number => {
    while (usedIds.has(String(nextRangeId))) nextRangeId++;
    return nextRangeId++;
  };
  const moves = settings.detectMoves
    ? classifyMoves(tree, allocateRangeId, settings)
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
