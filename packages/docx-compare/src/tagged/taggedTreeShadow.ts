import { createHash } from 'node:crypto';
import { XMLSerializer } from '@xmldom/xmldom';
import {
  childElements,
  parseXml,
} from '@usejunior/docx-core';
import { tokenizeComparisonText } from '../textAlignment.js';
import { compareSourceProjectedFormattingFidelity } from './formattingFidelity.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';
import { constructTaggedTree, verifyGlobalEqualContentInvariant } from './taggedTreeConstruction.js';
import {
  COMPARISON_REVISION_ATTRIBUTE,
  createPreservePlan,
  serializeTaggedTree,
  verifySerializedMoveRanges,
} from './taggedTreeSerializer.js';
import { formatDate, isParagraphMoveMarker } from './revisionMarkup.js';
import type {
  CompareStats,
  RevisionAttributionRange,
  RevisionGroupingPolicy,
  UnrepresentedChange,
} from '../compare-types.js';
import { representative, type TaggedNode } from './taggedTree.js';
import { guardBodyTableTopology } from './tableTopologyGuard.js';
import { collectContentControlPropertyChanges } from './unrepresentedChanges.js';

export type TaggedTreeDivergenceClass = 'projection-inequivalent' | 'projection-equivalent';

export interface TaggedTreeShadowReport {
  fixtureIdentity: string;
  classification: TaggedTreeDivergenceClass;
  divergingProjections: Array<'accept' | 'reject' | 'formatting'>;
  fidelityScore: number;
  legacyOutputUnchanged: true;
  diagnostics: string[];
}

export interface TaggedTreeShadowInput {
  originalXml: string;
  revisedXml: string;
  legacyXml: string;
  author: string;
  date: Date;
  fixtureIdentity?: string;
  detectFormatChanges?: boolean;
  detectMoves?: boolean;
  moveSimilarityThreshold?: number;
  moveMinimumWordCount?: number;
  caseInsensitiveMove?: boolean;
  numberingEnabled?: boolean;
  originalNumberingXml?: string;
  revisedNumberingXml?: string;
  /** @internal Operation ranges whose emitted revisions require exact attribution. */
  revisionAttributionRanges?: readonly RevisionAttributionRange[];
  /** @internal Markdoc readability policy for simple replacement gaps. */
  revisionGrouping?: RevisionGroupingPolicy;
  /** @internal Keep private markers through downstream publication transforms. */
  retainStatisticsMarkers?: boolean;
  /** @internal First package-wide ID available to generated comparison revisions. */
  minimumRevisionId?: number;
  /** @internal Main-body only; selected side stories keep their unrepresented contract. */
  guardTableTopology?: boolean;
}

const WORDPROCESSINGML_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Empty revision elements are semantic markers when they occur in the
 * property containers for a paragraph mark or table row. They are not empty
 * content wrappers and must survive tagged-tree publication.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.21
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.26
 * @see https://github.com/UseJunior/safe-docx/issues/941
 */
function isEmptyRevisionMarker(wrapper: Element): boolean {
  if (wrapper.namespaceURI !== WORDPROCESSINGML_NAMESPACE) return false;
  if (['moveFrom', 'moveTo'].includes(wrapper.localName)) return isParagraphMoveMarker(wrapper);
  if (!['ins', 'del', 'moveFrom', 'moveTo'].includes(wrapper.localName)) return false;
  const parent = wrapper.parentNode as Element | null;
  return parent?.namespaceURI === WORDPROCESSINGML_NAMESPACE
    && (parent.localName === 'rPr' ||
      (parent.localName === 'trPr' && ['ins', 'del'].includes(wrapper.localName)));
}

export interface TaggedTreePublication {
  xml: string;
  stats: CompareStats;
  serializedRangeStats: {
    insertedRanges: number;
    deletedRanges: number;
    moveFromRanges: number;
    moveToRanges: number;
  };
  moves: ReturnType<typeof constructTaggedTree>['moves'];
  /** Differences the story carries without revision markup (content-control properties, #1095). */
  unrepresentedChanges: UnrepresentedChange[];
}

const COMPARISON_LEAF_NAMES = new Set([
  't', 'br', 'cr', 'tab', 'sym', 'softHyphen', 'noBreakHyphen', 'fldChar',
  'instrText', 'delText', 'delInstrText', 'dayShort', 'dayLong', 'monthShort',
  'monthLong', 'yearShort', 'yearLong', 'annotationRef', 'footnoteRef',
  'endnoteRef', 'footnoteReference', 'endnoteReference', 'commentReference',
  'separator', 'continuationSeparator', 'pgNum', 'drawing', 'pict', 'object',
  'AlternateContent',
]);

/**
 * Paragraph alignment keys; `isolated[i]` marks keys inside an isolated
 * (moved) subtree.
 */
interface ParagraphAtomStream {
  keys: string[];
  isolated: boolean[];
}

/**
 * Adjacent `w:t` leaves are tokenized as one text stream within a paragraph,
 * so a word or punctuation token does not depend on how identical text is
 * split into runs (#1142). A whitespace token is still split where a `w:t`
 * boundary falls inside it, so the spaces on either side of a removed or
 * moved run (`a ` + `b` + ` c` without `b`) stay two tokens rather than
 * merging into a different one. Any other leaf, every paragraph boundary,
 * and the start and end of every `isolated` subtree end the stream, so an
 * isolated subtree (moved content) is weighed exactly as it is on its own.
 */
function comparisonAtomKeys(
  element: Element,
  isolated: ReadonlySet<Element> = new Set(),
  stream?: ParagraphAtomStream,
): string[] {
  const keys = stream?.keys ?? [];
  let text = '';
  const textBoundaries: number[] = [];
  let isolatedDepth = 0;
  const push = (key: string): void => {
    keys.push(key);
    stream?.isolated.push(isolatedDepth > 0);
  };
  const flushText = (): void => {
    let offset = 0;
    for (const token of tokenizeComparisonText(text)) {
      const end = offset + token.length;
      if (/^\s+$/u.test(token)) {
        let start = offset;
        for (const boundary of textBoundaries) {
          if (boundary <= start || boundary >= end) continue;
          push(`t\0${text.slice(start, boundary)}`);
          start = boundary;
        }
        push(`t\0${text.slice(start, end)}`);
      } else {
        push(`t\0${token}`);
      }
      offset = end;
    }
    text = '';
    textBoundaries.length = 0;
  };
  const visit = (current: Element): void => {
    if (isolated.has(current)) {
      flushText();
      isolatedDepth++;
      visitContent(current);
      flushText();
      isolatedDepth--;
      return;
    }
    visitContent(current);
  };
  const visitContent = (current: Element): void => {
    if (COMPARISON_LEAF_NAMES.has(current.localName)) {
      if (current.localName === 't') {
        if (text) textBoundaries.push(text.length);
        text += current.textContent ?? '';
        return;
      }
      flushText();
      const localName = current.localName === 'delText' ? 't' : current.localName;
      push(`${localName}\0${current.textContent ?? ''}`);
      return;
    }
    const children = childElements(current);
    if (current.localName !== 'p') {
      children.forEach(visit);
      return;
    }
    flushText();
    if (children.every((child) => child.localName === 'pPr')) push('__emptyParagraph__\0');
    else children.forEach(visit);
    flushText();
  };
  visit(element);
  flushText();
  return keys;
}

/**
 * Derive the versioned `tagged-token-v1` word/control weighting without
 * consulting the deleted flattened-atom engine. Each maximal tagged change
 * subtree is tokenized independently under the tagged metric contract.
 */
function taggedAtomWeight(node: TaggedNode, side: 'original' | 'revised'): number {
  const element = representative(node, side);
  if (!element) return 0;
  return comparisonAtomKeys(element).length;
}

function paragraphAtomStream(
  node: TaggedNode,
  side: 'original' | 'revised',
  isolated: ReadonlySet<Element>,
): ParagraphAtomStream {
  const stream: ParagraphAtomStream = { keys: [], isolated: [] };
  const element = representative(node, side);
  if (element) comparisonAtomKeys(element, isolated, stream);
  return stream;
}

/**
 * Count the unaligned atoms of a paragraph's two sides. A match involving
 * moved (isolated) content weighs half an unmoved one, so moved keys stay
 * unaligned, and are later subtracted at their standalone weight, whenever
 * unmoved content can take the same match.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1142
 */
function unalignedParagraphAtoms(
  before: ParagraphAtomStream,
  after: ParagraphAtomStream,
): { deleted: number; inserted: number } {
  const n = before.keys.length;
  const m = after.keys.length;
  const weight = (i: number, j: number): number => (before.isolated[i] || after.isolated[j] ? 1 : 2);
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      let best = Math.max(score[i + 1]![j]!, score[i]![j + 1]!);
      if (before.keys[i] === after.keys[j]) best = Math.max(best, score[i + 1]![j + 1]! + weight(i, j));
      score[i]![j] = best;
    }
  }
  let deleted = 0;
  let inserted = 0;
  const gap = { deleted: [] as number[], inserted: [] as number[] };
  // A gap whose deleted and inserted keys spell the same unmoved text is a
  // whitespace token split differently by run boundaries, not a change.
  const closeGap = (): void => {
    const text = (stream: ParagraphAtomStream, indices: readonly number[]): string | undefined =>
      indices.every((index) => stream.keys[index]!.startsWith('t\0') && !stream.isolated[index])
        ? indices.map((index) => stream.keys[index]!.slice(2)).join('')
        : undefined;
    const deletedText = text(before, gap.deleted);
    const unchanged = gap.deleted.length > 0 && gap.inserted.length > 0
      && deletedText !== undefined && deletedText === text(after, gap.inserted);
    if (!unchanged) {
      deleted += gap.deleted.length;
      inserted += gap.inserted.length;
    }
    gap.deleted.length = 0;
    gap.inserted.length = 0;
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && before.keys[i] === after.keys[j]
        && score[i]![j] === score[i + 1]![j + 1]! + weight(i, j)) {
      closeGap();
      i++; j++;
    } else if (j >= m || (i < n && score[i + 1]![j]! >= score[i]![j + 1]!)) {
      gap.deleted.push(i++);
    } else {
      gap.inserted.push(j++);
    }
  }
  closeGap();
  return { deleted, inserted };
}

function deriveTaggedTreeStats(tree: TaggedNode, movedNodes: ReadonlySet<TaggedNode>): Pick<
  CompareStats,
  'insertedAtoms' | 'deletedAtoms' | 'modifiedParagraphs' | 'formatChanges' | 'formatChangeAtoms'
> {
  let insertedAtoms = 0;
  let deletedAtoms = 0;
  let formatChanges = 0;
  let formatChangeAtoms = 0;
  let modifiedParagraphs = 0;

  const atomCounts = (node: TaggedNode, insideMove = false): void => {
    const moved = insideMove || movedNodes.has(node);
    const localName = representative(node, node.tag === 'revised' ? 'revised' : 'original')?.localName;
    if (localName === 'p') {
      if (moved) return;
      if (node.tag === 'original') {
        deletedAtoms += taggedAtomWeight(node, 'original');
      } else if (node.tag === 'revised') {
        insertedAtoms += taggedAtomWeight(node, 'revised');
      } else {
        // Moved content keeps its own token boundaries in the paragraph
        // streams, so subtracting its standalone weight removes exactly the
        // atoms it contributed.
        const movedElements = { original: new Set<Element>(), revised: new Set<Element>() };
        const collectMoves = (descendant: TaggedNode): void => {
          if (movedNodes.has(descendant)) {
            if (descendant.tag === 'original' || descendant.tag === 'revised') {
              movedElements[descendant.tag].add(descendant.node);
            }
            return;
          }
          descendant.children.forEach(collectMoves);
        };
        node.children.forEach(collectMoves);
        const unaligned = unalignedParagraphAtoms(
          paragraphAtomStream(node, 'original', movedElements.original),
          paragraphAtomStream(node, 'revised', movedElements.revised),
        );
        let paragraphDeleted = unaligned.deleted;
        let paragraphInserted = unaligned.inserted;
        const subtractMoves = (descendant: TaggedNode): void => {
          if (movedNodes.has(descendant)) {
            if (descendant.tag === 'original') {
              paragraphDeleted = Math.max(0, paragraphDeleted - taggedAtomWeight(descendant, 'original'));
            } else if (descendant.tag === 'revised') {
              paragraphInserted = Math.max(0, paragraphInserted - taggedAtomWeight(descendant, 'revised'));
            }
            return;
          }
          descendant.children.forEach(subtractMoves);
        };
        node.children.forEach(subtractMoves);
        deletedAtoms += paragraphDeleted;
        insertedAtoms += paragraphInserted;
      }
      return;
    }
    if (!moved && node.tag !== 'both' && node.children.length === 0) {
      const element = representative(node, node.tag === 'original' ? 'original' : 'revised');
      if (element && element.getElementsByTagNameNS(WORDPROCESSINGML_NAMESPACE, 'p').length > 0) {
        if (node.tag === 'original') deletedAtoms += taggedAtomWeight(node, 'original');
        else insertedAtoms += taggedAtomWeight(node, 'revised');
        return;
      }
    }
    node.children.forEach((child) => atomCounts(child, moved));
  };
  atomCounts(tree);

  const visit = (node: TaggedNode): void => {
    if (node.tag === 'both' && node.propertyDelta) {
      formatChanges++;
      formatChangeAtoms += node.propertyDelta.scope === 'run'
        ? Math.max(1, taggedAtomWeight(node, 'revised'))
        : 1;
    }
    if (node.tag === 'both' && node.revised.localName === 'p') {
      let hasOriginal = false;
      let hasRevised = false;
      const scanParagraph = (descendant: TaggedNode): void => {
        if (movedNodes.has(descendant)) return;
        if (descendant !== node && descendant.tag === 'both' && descendant.revised.localName === 'p') return;
        if (descendant.tag === 'original' && !movedNodes.has(descendant)) hasOriginal = true;
        if (descendant.tag === 'revised' && !movedNodes.has(descendant)) hasRevised = true;
        descendant.children.forEach(scanParagraph);
      };
      node.children.forEach(scanParagraph);
      if (hasOriginal && hasRevised) modifiedParagraphs++;
    }
    node.children.forEach(visit);
  };
  visit(tree);
  return { insertedAtoms, deletedAtoms, modifiedParagraphs, formatChanges, formatChangeAtoms };
}

function consumeSerializedRangeStats(document: Document): TaggedTreePublication['serializedRangeStats'] {
  const stats = { insertedRanges: 0, deletedRanges: 0, moveFromRanges: 0, moveToRanges: 0 };
  for (const element of [document.documentElement, ...Array.from(document.getElementsByTagName('*'))]) {
    if (!element.hasAttribute(COMPARISON_REVISION_ATTRIBUTE)) continue;
    const classification = element.getAttribute(COMPARISON_REVISION_ATTRIBUTE);
    element.removeAttribute(COMPARISON_REVISION_ATTRIBUTE);
    if (classification === 'moveFrom') stats.moveFromRanges++;
    else if (classification === 'moveTo') stats.moveToRanges++;
    else if (element.localName === 'ins') stats.insertedRanges++;
    else if (element.localName === 'del') stats.deletedRanges++;
    else if (element.localName === 'moveFrom') stats.moveFromRanges++;
    else if (element.localName === 'moveTo') stats.moveToRanges++;
  }
  return stats;
}

export function consumeTaggedPublicationStatistics(
  xml: string,
  treeStats: Pick<
    CompareStats,
    'insertedAtoms' | 'deletedAtoms' | 'modifiedParagraphs' | 'formatChanges' | 'formatChangeAtoms'
  >,
): { xml: string; stats: CompareStats; serializedRangeStats: TaggedTreePublication['serializedRangeStats'] } {
  const document = parseXml(xml);
  let insertedTableRows = 0;
  let deletedTableRows = 0;
  for (const row of Array.from(document.getElementsByTagNameNS(WORDPROCESSINGML_NAMESPACE, 'tr'))) {
    const properties = childElements(row).find((child) =>
      child.namespaceURI === WORDPROCESSINGML_NAMESPACE && child.localName === 'trPr');
    if (!properties) continue;
    for (const marker of childElements(properties)) {
      if (!marker.hasAttribute(COMPARISON_REVISION_ATTRIBUTE)) continue;
      if (marker.namespaceURI !== WORDPROCESSINGML_NAMESPACE) continue;
      if (marker.localName === 'ins') insertedTableRows++;
      else if (marker.localName === 'del') deletedTableRows++;
    }
  }
  const serializedRangeStats = consumeSerializedRangeStats(document);
  const stats: CompareStats = {
    atomMetricVersion: 'tagged-token-v1',
    insertions: serializedRangeStats.insertedRanges,
    deletions: serializedRangeStats.deletedRanges,
    modifications: treeStats.modifiedParagraphs,
    insertedRanges: serializedRangeStats.insertedRanges,
    deletedRanges: serializedRangeStats.deletedRanges,
    insertedAtoms: treeStats.insertedAtoms,
    deletedAtoms: treeStats.deletedAtoms,
    modifiedParagraphs: treeStats.modifiedParagraphs,
    formatChanges: treeStats.formatChanges,
    formatChangeAtoms: treeStats.formatChangeAtoms,
    insertedTableRows,
    deletedTableRows,
  };
  return { xml: new XMLSerializer().serializeToString(document), stats, serializedRangeStats };
}

/** Build the canonical story and its statistics from one tagged construction. */
export function buildTaggedTreePublication(
  input: Omit<TaggedTreeShadowInput, 'legacyXml'>,
): TaggedTreePublication {
  const original = parseXml(input.originalXml).documentElement;
  const revised = parseXml(input.revisedXml).documentElement;
  const constructed = constructTaggedTree(original, revised, {
    detectFormatChanges: input.detectFormatChanges,
    detectMoves: input.detectMoves,
    moveSimilarityThreshold: input.moveSimilarityThreshold,
    moveMinimumWordCount: input.moveMinimumWordCount,
    caseInsensitiveMove: input.caseInsensitiveMove,
    numberingEnabled: input.numberingEnabled,
    originalNumberingXml: input.originalNumberingXml,
    revisedNumberingXml: input.revisedNumberingXml,
    revisionAttributionRanges: input.revisionAttributionRanges,
    minimumRevisionId: input.minimumRevisionId,
  });
  if (input.guardTableTopology) guardBodyTableTopology(constructed.tree);
  const serialized = serializeTaggedTree(
    constructed.tree,
    createPreservePlan(original, revised, constructed.tree, {
      author: input.author,
      date: formatDate(input.date),
    }, input.minimumRevisionId),
    { moves: constructed.moves, retainComparisonRevisionMarkers: true, revisionGrouping: input.revisionGrouping },
  );
  const document = parseXml(serialized);
  for (const wrapper of Array.from(document.getElementsByTagName('*'))) {
    if (!['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo'].includes(wrapper.tagName)) continue;
    if (wrapper.childNodes.length === 0 && !isEmptyRevisionMarker(wrapper)) {
      wrapper.parentNode?.removeChild(wrapper);
    }
  }
  const movedNodes = new Set<TaggedNode>(constructed.moves.flatMap((move) => [move.source, move.destination]));
  const treeStats = {
    ...deriveTaggedTreeStats(constructed.tree, movedNodes),
  };
  const markedXml = new XMLSerializer().serializeToString(document);
  const consumed = consumeTaggedPublicationStatistics(markedXml, treeStats);
  return {
    xml: input.retainStatisticsMarkers ? markedXml : consumed.xml,
    stats: consumed.stats,
    serializedRangeStats: consumed.serializedRangeStats,
    moves: constructed.moves,
    unrepresentedChanges: collectContentControlPropertyChanges(constructed.tree),
  };
}

export function buildTaggedTreeShadowXml(input: Omit<TaggedTreeShadowInput, 'legacyXml'>): string {
  return buildTaggedTreePublication(input).xml;
}

function text(xml: string): string {
  // Use the same field/cache-aware observable as the authoritative safety gate.
  return extractRoundTripComparisonText(xml);
}

function textMismatch(label: string, expected: string, actual: string): string {
  let index = 0;
  while (index < expected.length && index < actual.length && expected[index] === actual[index]) index++;
  return `${label} text differs at ${index} (expected length ${expected.length}, actual length ${actual.length})`;
}

function identity(input: TaggedTreeShadowInput): string {
  return input.fixtureIdentity ?? createHash('sha256')
    .update(input.originalXml)
    .update('\0')
    .update(input.revisedXml)
    .digest('hex')
    .slice(0, 24);
}

/** Evaluate tagged construction offline against a caller-supplied legacy candidate. */
export function runTaggedTreeShadow(input: TaggedTreeShadowInput): TaggedTreeShadowReport {
  const original = parseXml(input.originalXml).documentElement;
  const revised = parseXml(input.revisedXml).documentElement;
  const constructed = constructTaggedTree(original, revised, {
    detectFormatChanges: input.detectFormatChanges,
    detectMoves: input.detectMoves,
    moveSimilarityThreshold: input.moveSimilarityThreshold,
    moveMinimumWordCount: input.moveMinimumWordCount,
    caseInsensitiveMove: input.caseInsensitiveMove,
    numberingEnabled: input.numberingEnabled,
    originalNumberingXml: input.originalNumberingXml,
    revisedNumberingXml: input.revisedNumberingXml,
  });
  const diagnostics = verifyGlobalEqualContentInvariant(constructed.tree, constructed.moves);
  const shadowXml = buildTaggedTreeShadowXml(input);
  diagnostics.push(...verifySerializedMoveRanges(shadowXml, constructed.moves));

  const expectedAccept = text(acceptAllChanges(input.revisedXml));
  const expectedReject = text(rejectAllChanges(input.originalXml));
  const shadowAccept = text(acceptAllChanges(shadowXml));
  const shadowReject = text(rejectAllChanges(shadowXml));
  const divergingProjections: TaggedTreeShadowReport['divergingProjections'] = [];
  if (shadowAccept !== expectedAccept) {
    divergingProjections.push('accept');
    diagnostics.push(textMismatch('accept', expectedAccept, shadowAccept));
  }
  if (shadowReject !== expectedReject) {
    divergingProjections.push('reject');
    diagnostics.push(textMismatch('reject', expectedReject, shadowReject));
  }

  const fidelity = compareSourceProjectedFormattingFidelity(input.originalXml, input.revisedXml, shadowXml);
  if (fidelity.score !== 1) {
    divergingProjections.push('formatting');
    for (const [projection, report] of [['accept', fidelity.accept], ['reject', fidelity.reject]] as const) {
      for (const divergence of report.divergences.slice(0, 10)) {
        diagnostics.push(
          `${projection} formatting ${divergence.scope}/${divergence.property}/${divergence.kind} at paragraph ${divergence.paragraphIndex}`,
        );
      }
    }
  }
  return {
    fixtureIdentity: identity(input),
    classification: diagnostics.length > 0 || divergingProjections.length > 0
      ? 'projection-inequivalent'
      : 'projection-equivalent',
    divergingProjections,
    fidelityScore: fidelity.score,
    legacyOutputUnchanged: true,
    diagnostics,
  };
}
