import { XMLSerializer } from '@xmldom/xmldom';
import {
  CorrelationStatus,
  DEFAULT_FORMAT_DETECTION_SETTINGS,
  DEFAULT_MOVE_DETECTION_SETTINGS,
  type ComparisonUnitAtom,
  type FormatDetectionSettings,
  type OpcPart,
} from '@usejunior/docx-core';
import {
  assignIdentityIds,
  assignParagraphIndices,
  atomizeTree,
  IdentityInterner,
} from '../../atomizer.js';
import { detectFormatChangesInAtomList } from '../../format-detection.js';
import { detectParagraphStyleChanges } from '../../paragraph-style-detection.js';
import { extractRoundTripComparisonText } from '../../fieldComparisonSemantics.js';
import { assignUnifiedParagraphIndices, createMergedAtomList } from './atomLcs.js';
import {
  hierarchicalCompare,
  markHierarchicalCorrelationStatus,
} from './hierarchicalLcs.js';
import { modifyRevisedDocument } from './inPlaceModifier.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { premergeAdjacentRuns } from './premergeRuns.js';
import { refineFuzzyRunsWithinAlignedParagraphs } from './selectiveWordRefinement.js';
import {
  backfillParentReferences,
  findBody,
  parseDocumentXml,
} from './xmlToWmlElement.js';

const serializer = new XMLSerializer();
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STORY_PART: OpcPart = {
  uri: 'word/footnotes.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
};

export interface NoteDefinitionComparisonOptions {
  author: string;
  date: Date;
  formatDetection?: FormatDetectionSettings;
  premergeRuns?: boolean;
  maxWordRefinementChangeRanges?: number;
  preservedRoots?: readonly Element[];
}

function namespaceAttributes(entry: Element): string {
  const declarations = new Map<string, string>();
  let current: Element | null = entry;
  while (current) {
    for (let i = 0; i < current.attributes.length; i++) {
      const attr = current.attributes.item(i)!;
      if (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) {
        if (!declarations.has(attr.name)) declarations.set(attr.name, attr.value);
      }
    }
    current = current.parentNode?.nodeType === 1 ? current.parentNode as Element : null;
  }
  if (!declarations.has('xmlns:w')) declarations.set('xmlns:w', W_NS);
  return [...declarations]
    .map(([name, value]) => ` ${name}="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`)
    .join('');
}

function wrapDefinition(entry: Element): string {
  let content = '';
  for (let child = entry.firstChild; child; child = child.nextSibling) {
    content += serializer.serializeToString(child);
  }
  return `<w:document${namespaceAttributes(entry)}><w:body>${content}</w:body></w:document>`;
}

/**
 * Compare one corresponding footnote definition as an independent Word story.
 * The regular atomizer and in-place revision emitter are reused so paragraphs,
 * runs, fields, and formatting receive the same structural treatment as the
 * main story while matches cannot leak across definition boundaries.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @see https://github.com/UseJunior/safe-docx/issues/763
 */
export function compareFootnoteDefinitions(
  originalEntry: Element,
  revisedEntry: Element,
  options: NoteDefinitionComparisonOptions,
): Element[] {
  const originalTree = parseDocumentXml(wrapDefinition(originalEntry));
  const revisedTree = parseDocumentXml(wrapDefinition(revisedEntry));
  backfillParentReferences(originalTree);
  backfillParentReferences(revisedTree);
  const originalBody = findBody(originalTree);
  const revisedBody = findBody(revisedTree);
  if (!originalBody || !revisedBody) throw new Error('Could not create footnote comparison story');

  if (options.premergeRuns !== false) {
    premergeAdjacentRuns(originalBody);
    premergeAdjacentRuns(revisedBody);
  }

  const atomizeOptions = {
    cloneLeafNodes: true,
    mergeAcrossRuns: false,
    mergePunctuationAcrossRuns: false,
    splitTextIntoWords: true,
  } as const;
  let { atoms: originalAtoms } = atomizeTree(originalBody, [], STORY_PART, atomizeOptions);
  let { atoms: revisedAtoms } = atomizeTree(revisedBody, [], STORY_PART, atomizeOptions);
  assignParagraphIndices(originalAtoms);
  assignParagraphIndices(revisedAtoms);

  const identityInterner = new IdentityInterner();
  assignIdentityIds(originalAtoms, identityInterner);
  assignIdentityIds(revisedAtoms, identityInterner);
  let lcsResult = hierarchicalCompare(originalAtoms, revisedAtoms);
  const refined = refineFuzzyRunsWithinAlignedParagraphs(
    originalAtoms,
    revisedAtoms,
    lcsResult,
    { ...DEFAULT_MOVE_DETECTION_SETTINGS, detectMoves: false },
    identityInterner,
    options.maxWordRefinementChangeRanges,
  );
  originalAtoms = refined.originalAtoms;
  revisedAtoms = refined.revisedAtoms;
  lcsResult = refined.lcsResult;
  markHierarchicalCorrelationStatus(originalAtoms, revisedAtoms, lcsResult);

  const formatSettings = options.formatDetection ?? DEFAULT_FORMAT_DETECTION_SETTINGS;
  detectParagraphStyleChanges(originalAtoms, revisedAtoms, formatSettings.detectFormatChanges);
  if (formatSettings.detectFormatChanges) detectFormatChangesInAtomList(revisedAtoms, formatSettings);

  const mergedAtoms = createMergedAtomList(originalAtoms, revisedAtoms, lcsResult);
  assignUnifiedParagraphIndices(originalAtoms, revisedAtoms, mergedAtoms, lcsResult);
  const comparedXml = modifyRevisedDocument(
    revisedTree,
    originalAtoms,
    revisedAtoms,
    mergedAtoms,
    {
      author: options.author,
      date: options.date,
      preservedRoots: [originalTree, ...(options.preservedRoots ?? [])],
    },
  );
  const expectedAccepted = extractRoundTripComparisonText(
    acceptAllChanges(wrapDefinition(revisedEntry)),
  );
  const expectedRejected = extractRoundTripComparisonText(
    rejectAllChanges(wrapDefinition(originalEntry)),
  );
  const actualAccepted = extractRoundTripComparisonText(acceptAllChanges(comparedXml));
  const actualRejected = extractRoundTripComparisonText(rejectAllChanges(comparedXml));
  if (actualAccepted !== expectedAccepted || actualRejected !== expectedRejected) {
    throw new Error('Footnote definition comparison failed accept/reject projection safety');
  }
  const comparedBody = findBody(parseDocumentXml(comparedXml));
  if (!comparedBody) throw new Error('Footnote comparison emitted no story body');
  return Array.from(comparedBody.childNodes)
    .filter((node): node is Element => node.nodeType === 1);
}

export interface CorrespondingFootnotePair {
  originalId: string;
  revisedId: string;
}

function referenceId(atom: ComparisonUnitAtom): string | null {
  return atom.contentElement.tagName === 'w:footnoteReference'
    ? atom.contentElement.getAttribute('w:id')
    : null;
}

/**
 * Reconcile only collision-renumbered references that the main-story LCS puts
 * in the same aligned paragraph as a delete/insert pair. This keeps arbitrary
 * same-ID definitions from independently authored documents collision-safe.
 */
export function findCorrespondingFootnotePairs(
  mergedAtoms: readonly ComparisonUnitAtom[],
  renumberings: readonly { label: string; fromId: string; toId: string }[],
): CorrespondingFootnotePair[] {
  const candidates: Array<CorrespondingFootnotePair & { paragraphIndex: number }> = [];
  for (const { label, fromId, toId } of renumberings) {
    if (label !== 'footnote') continue;
    const deleted = mergedAtoms.filter((atom) =>
      atom.correlationStatus === CorrelationStatus.Deleted && referenceId(atom) === fromId);
    const inserted = mergedAtoms.filter((atom) =>
      atom.correlationStatus === CorrelationStatus.Inserted && referenceId(atom) === toId);
    if (deleted.length !== 1 || inserted.length !== 1) continue;
    if (deleted[0]!.paragraphIndex !== inserted[0]!.paragraphIndex) continue;
    if (deleted[0]!.paragraphIndex === undefined) continue;
    candidates.push({
      originalId: fromId,
      revisedId: toId,
      paragraphIndex: deleted[0]!.paragraphIndex,
    });
  }
  const countByParagraph = new Map<number, number>();
  for (const candidate of candidates) {
    countByParagraph.set(
      candidate.paragraphIndex,
      (countByParagraph.get(candidate.paragraphIndex) ?? 0) + 1,
    );
  }
  return candidates
    .filter((candidate) => {
      if (countByParagraph.get(candidate.paragraphIndex) !== 1) return false;
      const referencesInParagraph = mergedAtoms.filter((atom) =>
        atom.paragraphIndex === candidate.paragraphIndex && referenceId(atom) !== null);
      return referencesInParagraph.length === 2;
    })
    .map(({ originalId, revisedId }) => ({ originalId, revisedId }));
}
