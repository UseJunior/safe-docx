import { createHash } from 'node:crypto';
import { XMLSerializer } from '@xmldom/xmldom';
import {
  CorrelationStatus,
  DEFAULT_MOVE_DETECTION_SETTINGS,
  parseXml,
} from '@usejunior/docx-core';
import type { OpcPart } from '@usejunior/docx-core';
import {
  assignIdentityIds,
  assignParagraphIndices,
  atomizeTree,
  IdentityInterner,
} from '../../atomizer.js';
import { alignComparisonSequences } from '../../textAlignment.js';
import { compareSourceProjectedFormattingFidelity } from './formattingFidelity.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { extractRoundTripComparisonText } from '../../fieldComparisonSemantics.js';
import { constructTaggedTree, verifyGlobalEqualContentInvariant } from './taggedTreeConstruction.js';
import {
  COMPARISON_REVISION_ATTRIBUTE,
  createPreservePlan,
  serializeTaggedTree,
  verifySerializedMoveRanges,
} from './taggedTreeSerializer.js';
import { formatDate } from './inPlaceModifier-shared.js';
import type { CompareStats, RevisionAttributionRange } from '../../compare-types.js';
import { representative, type TaggedNode } from './taggedTree.js';
import {
  hierarchicalCompare,
  markHierarchicalCorrelationStatus,
} from './hierarchicalLcs.js';
import {
  collectPreservedMoveNames,
  detectMovesInAtomList,
} from '../../move-detection.js';
import {
  DEFAULT_NUMBERING_OPTIONS,
  virtualizeNumberingLabels,
} from './numberingIntegration.js';
import { premergeAdjacentRuns } from './premergeRuns.js';

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
  /** @internal Keep private markers through downstream publication transforms. */
  retainStatisticsMarkers?: boolean;
  /** @internal Pre-canonicalization source used only for legacy-weighted metrics. */
  statisticsOriginalXml?: string;
  /** @internal Pre-canonicalization source used only for legacy-weighted metrics. */
  statisticsRevisedXml?: string;
}

const WORDPROCESSINGML_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Empty `w:ins`/`w:del` elements are semantic markers when they occur in the
 * property containers for a paragraph mark or table row. They are not empty
 * content wrappers and must survive tagged-tree publication.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.16
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.19
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 */
function isEmptyRevisionMarker(wrapper: Element): boolean {
  if (wrapper.namespaceURI !== WORDPROCESSINGML_NAMESPACE) return false;
  if (!['ins', 'del'].includes(wrapper.localName)) return false;
  const parent = wrapper.parentNode as Element | null;
  return parent?.namespaceURI === WORDPROCESSINGML_NAMESPACE
    && ['rPr', 'trPr'].includes(parent.localName);
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
}

const TAGGED_STATS_PART: OpcPart = {
  uri: 'word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

/**
 * Preserve the public word/control atom weighting without consulting the
 * legacy merged-atom result. Each maximal tagged change subtree is atomized
 * independently with the documented word-split settings.
 */
function taggedAtomWeight(node: TaggedNode, side: 'original' | 'revised'): number {
  const element = representative(node, side);
  if (!element) return 0;
  return atomizeTree(element.cloneNode(true) as typeof element, [], TAGGED_STATS_PART, {
    cloneLeafNodes: true,
    mergeAcrossRuns: false,
    mergePunctuationAcrossRuns: false,
    splitTextIntoWords: true,
  }).atoms.length;
}

function taggedAtomKeys(nodes: readonly TaggedNode[], side: 'original' | 'revised'): string[] {
  return nodes.flatMap((node) => {
    const element = representative(node, side);
    if (!element) return [];
    return atomizeTree(element.cloneNode(true) as typeof element, [], TAGGED_STATS_PART, {
      cloneLeafNodes: true,
      mergeAcrossRuns: false,
      mergePunctuationAcrossRuns: false,
      splitTextIntoWords: true,
    }).atoms.map((atom) => {
      const localName = atom.contentElement.localName;
      const normalizedLocalName = localName === 'delText' ? 't' : localName;
      return `${normalizedLocalName}\0${atom.contentElement.textContent ?? ''}`;
    });
  });
}

/**
 * Preserve the established atom metric independently of publication.
 *
 * The tagged tree intentionally uses a different structural alignment, so
 * summing atoms under tagged change nodes does not preserve the historical
 * meaning of `insertedAtoms`/`deletedAtoms`. Run the compatibility atom
 * projection over the two source trees, including the same word split,
 * hierarchical alignment, numbering identity, and move exclusion. No legacy
 * reconstruction or package assembly participates.
 */
function deriveCompatibilityAtomCounts(
  original: Element,
  revised: Element,
  input: Omit<TaggedTreeShadowInput, 'legacyXml'>,
): Pick<CompareStats, 'insertedAtoms' | 'deletedAtoms'> {
  const originalBody = original.getElementsByTagNameNS(
    WORDPROCESSINGML_NAMESPACE,
    'body',
  )[0];
  const revisedBody = revised.getElementsByTagNameNS(
    WORDPROCESSINGML_NAMESPACE,
    'body',
  )[0];
  if (!originalBody || !revisedBody) {
    return { insertedAtoms: 0, deletedAtoms: 0 };
  }
  // The compatibility metric retains the established default premerge pass,
  // even though premerge no longer controls tagged publication.
  premergeAdjacentRuns(originalBody);
  premergeAdjacentRuns(revisedBody);
  const atomizeOptions = {
    cloneLeafNodes: true,
    mergeAcrossRuns: false,
    mergePunctuationAcrossRuns: false,
    splitTextIntoWords: true,
  } as const;
  const originalAtoms = atomizeTree(
    originalBody,
    [],
    TAGGED_STATS_PART,
    atomizeOptions,
  ).atoms;
  const revisedAtoms = atomizeTree(
    revisedBody,
    [],
    TAGGED_STATS_PART,
    atomizeOptions,
  ).atoms;
  assignParagraphIndices(originalAtoms);
  assignParagraphIndices(revisedAtoms);
  const numbering = {
    ...DEFAULT_NUMBERING_OPTIONS,
    enabled: input.numberingEnabled ?? DEFAULT_NUMBERING_OPTIONS.enabled,
  };
  if (numbering.enabled) {
    virtualizeNumberingLabels(originalAtoms, input.originalNumberingXml, numbering);
    virtualizeNumberingLabels(revisedAtoms, input.revisedNumberingXml, numbering);
  }
  const interner = new IdentityInterner();
  assignIdentityIds(originalAtoms, interner);
  assignIdentityIds(revisedAtoms, interner);
  const alignment = hierarchicalCompare(originalAtoms, revisedAtoms);
  markHierarchicalCorrelationStatus(originalAtoms, revisedAtoms, alignment);

  const moveSettings = {
    ...DEFAULT_MOVE_DETECTION_SETTINGS,
    detectMoves: input.detectMoves ?? DEFAULT_MOVE_DETECTION_SETTINGS.detectMoves,
    moveSimilarityThreshold:
      input.moveSimilarityThreshold ??
      DEFAULT_MOVE_DETECTION_SETTINGS.moveSimilarityThreshold,
    moveMinimumWordCount:
      input.moveMinimumWordCount ?? DEFAULT_MOVE_DETECTION_SETTINGS.moveMinimumWordCount,
    caseInsensitiveMove:
      input.caseInsensitiveMove ?? DEFAULT_MOVE_DETECTION_SETTINGS.caseInsensitiveMove,
  };
  if (moveSettings.detectMoves) {
    const alignedParagraphPairs = new Set<string>();
    for (const match of alignment.matches) {
      const originalParagraph = originalAtoms[match.originalIndex]?.paragraphIndex;
      const revisedParagraph = revisedAtoms[match.revisedIndex]?.paragraphIndex;
      if (originalParagraph !== undefined && revisedParagraph !== undefined) {
        alignedParagraphPairs.add(`${originalParagraph}:${revisedParagraph}`);
      }
    }
    detectMovesInAtomList(
      [...originalAtoms, ...revisedAtoms],
      moveSettings,
      collectPreservedMoveNames([original, revised]),
      (deleted, inserted) => {
        if (deleted.text === inserted.text) return true;
        return !deleted.atoms.some((originalAtom) =>
          inserted.atoms.some((revisedAtom) =>
            originalAtom.paragraphIndex !== undefined &&
            revisedAtom.paragraphIndex !== undefined &&
            alignedParagraphPairs.has(
              `${originalAtom.paragraphIndex}:${revisedAtom.paragraphIndex}`,
            ),
          ),
        );
      },
    );
  }

  return {
    insertedAtoms: revisedAtoms.filter(
      (atom) => atom.correlationStatus === CorrelationStatus.Inserted,
    ).length,
    deletedAtoms: originalAtoms.filter(
      (atom) => atom.correlationStatus === CorrelationStatus.Deleted,
    ).length,
  };
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
        const before = taggedAtomKeys([node], 'original');
        const after = taggedAtomKeys([node], 'revised');
        const alignment = alignComparisonSequences(before, after, (left, right) => left === right);
        let paragraphDeleted = alignment.deletedIndices.length;
        let paragraphInserted = alignment.insertedIndices.length;
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
    element.removeAttribute(COMPARISON_REVISION_ATTRIBUTE);
    if (element.localName === 'ins') stats.insertedRanges++;
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
  const serializedRangeStats = consumeSerializedRangeStats(document);
  const stats: CompareStats = {
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
  };
  return { xml: new XMLSerializer().serializeToString(document), stats, serializedRangeStats };
}

/** Build the canonical story and its statistics from one tagged construction. */
export function buildTaggedTreePublication(
  input: Omit<TaggedTreeShadowInput, 'legacyXml'>,
): TaggedTreePublication {
  const original = parseXml(input.originalXml).documentElement;
  const revised = parseXml(input.revisedXml).documentElement;
  // Construction/serialization retain and rearrange representatives. Capture
  // the source-level compatibility metric before either can mutate the DOMs.
  const compatibilityAtomCounts = deriveCompatibilityAtomCounts(
    parseXml(input.statisticsOriginalXml ?? input.originalXml).documentElement,
    parseXml(input.statisticsRevisedXml ?? input.revisedXml).documentElement,
    input,
  );
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
  });
  const serialized = serializeTaggedTree(
    constructed.tree,
    createPreservePlan(original, revised, constructed.tree, {
      author: input.author,
      date: formatDate(input.date),
    }),
    { moves: constructed.moves, retainComparisonRevisionMarkers: true },
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
    ...compatibilityAtomCounts,
  };
  const markedXml = new XMLSerializer().serializeToString(document);
  const consumed = consumeTaggedPublicationStatistics(markedXml, treeStats);
  return {
    xml: input.retainStatisticsMarkers ? markedXml : consumed.xml,
    stats: consumed.stats,
    serializedRangeStats: consumed.serializedRangeStats,
    moves: constructed.moves,
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
