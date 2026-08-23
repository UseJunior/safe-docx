/** Revised-base tagged comparison package pipeline. */

import { XMLSerializer } from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { normalizeOpcRelationshipTarget, parseXml } from '@usejunior/docx-core';
import { DocxArchive } from '@usejunior/docx-core';
import type {
  CompareResult,
  CompareStats,
  AncillaryFieldEvidence,
  ReconstructionBookmarkMismatchDetails,
  ReconstructionBookmarkMismatchSummary,
  ReconstructionIdDelta,
  ReconstructionIdDeltaSummary,
  ReconstructionSafetyFailureSummary,
  ReconstructionSafetyFailureDetails,
  ReconstructionSafetyCheckName,
  ReconstructionSafetyChecks,
  ReconstructionTextMismatchSummary,
  ReconstructionTextMismatchDetails,
  TaggedPublicationSafetyCheckName,
  TaggedPublicationSafetyChecks,
  RevisionAttribution,
  UnrepresentedChange,
} from '../compare-types.js';
import type {
  MoveDetectionSettings,
  FormatDetectionSettings,
} from '@usejunior/docx-core';
import {
  DEFAULT_MOVE_DETECTION_SETTINGS,
  DEFAULT_FORMAT_DETECTION_SETTINGS,
} from '@usejunior/docx-core';
import {
  parseDocumentXml,
  findBody,
} from './xmlToWmlElement.js';
import { childElements, findAllByTagName } from '@usejunior/docx-core';
import {
  acceptAllChanges,
  rejectAllChanges,
  compareTexts,
} from './trackChangesAcceptorAst.js';
import { detectUnrepresentedChanges } from './unrepresentedChanges.js';
import {
  type NumberingIntegrationOptions,
  DEFAULT_NUMBERING_OPTIONS,
} from './numberingIntegration.js';
export {
  validateFieldStructure,
  type FieldStory,
} from '@usejunior/docx-core';
import {
  validateFieldStructure,
  type FieldStory,
} from '@usejunior/docx-core';
import {
  AUXILIARY_PARTS,
  parseEntries,
  renumberCollidingAuxiliaryIds,
  restampCollidingCommentParaIds,
  type AuxiliaryPartDescriptor,
} from './auxiliaryIdCollision.js';
import {
  importReferencedRelationships,
  renumberCollidingRelationshipIds,
} from './relationshipIdCollision.js';
import {
  AncillaryStorySafetyError,
  evaluateAncillaryFieldSafety,
} from './ancillaryFieldSafety.js';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';
import { suppressVolatileTocPagerefCacheRevisions } from './tocPagerefCache.js';
import {
  buildTaggedTreePublication,
  consumeTaggedPublicationStatistics,
} from './taggedTreeShadow.js';
import {
  compareSourceProjectedFormattingFidelity,
  type ProjectedFormattingFidelity,
} from './formattingFidelity.js';
import { resolveTaggedRevisionAttributions } from './taggedTreeSerializer.js';
import { enforceConsumerCompatibility } from './consumerCompatibility.js';
import {
  collectBookmarkReferenceNamesInXml,
  collectWordPartBookmarkNames,
  createOriginalBookmarkRenameMap,
  disambiguateOriginalBookmarkIds,
  renameOriginalBookmarkTargetsAcrossWordParts,
} from './bookmarkProjectionCompatibility.js';
import {
  allocateRevisionId,
  createRevisionIdState,
} from './revisionMarkup.js';
import {
  assembleTextBoxStoryComparison,
  assertAncillaryTextBoxStoryProjection,
  markInsertedAncillaryStoryParagraphs,
  prepareTextBoxStoryComparison,
  rejectedSelectedAncillaryStoryPaths,
  UnsupportedTextBoxRevisionError,
} from './textBoxRevisionSafety.js';
import {
  compareFootnoteDefinitions,
  findCorrespondingFootnotePairs,
} from './ancillaryNoteComparison.js';

const OFFICE_RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function debugTaggedComparison(message: string, data?: unknown): void {
  const setting = process.env.DOCX_COMPARISON_DEBUG;
  if (!setting) return;
  const enabled = ['1', 'true', '*'].includes(setting) || setting
    .split(',')
    .map((entry) => entry.trim())
    .some((entry) => ['tagged', 'pipeline', 'atomizer'].includes(entry));
  if (!enabled) return;
  const formatted = `[${new Date().toISOString()}] [DEBUG] [tagged] ${message}`;
  if (data === undefined) console.error(formatted);
  else console.error(formatted, data);
}

export interface StandaloneTaggedPackageOptions {
  author: string;
  date: Date;
  moveDetection: MoveDetectionSettings;
  formatDetection: FormatDetectionSettings;
  numbering: NumberingIntegrationOptions;
  revisionAttributionRanges?: readonly import('../compare-types.js').RevisionAttributionRange[];
  /** @internal Test seam for the final structural publication gate. */
  publicationSafetyEvaluator?: typeof evaluateSafetyChecks;
  /** @internal Test seam for the final source-formatting publication gate. */
  formattingFidelityEvaluator?: typeof compareSourceProjectedFormattingFidelity;
  /** @internal Comparison-wide generated bookmark-name reservations. */
  bookmarkNameReservations?: Set<string>;
}

export interface StandaloneTaggedPackageResult {
  document: Buffer;
  documentXml: string;
  stats: CompareStats;
  ancillaryFieldEvidence: AncillaryFieldEvidence;
  formattingFidelity: ProjectedFormattingFidelity;
  revisionAttributions?: RevisionAttribution[];
  unrepresentedChanges?: UnrepresentedChange[];
}

/**
 * A revised-base tagged package failed a final projection, field, bookmark, or
 * formatting gate. Structured evidence remains available to callers without
 * parsing the error message.
 */
export class TaggedPublicationSafetyError extends Error {
  readonly checks: TaggedPublicationSafetyChecks;
  readonly failedChecks: TaggedPublicationSafetyCheckName[];
  readonly failureDetails?: ReconstructionSafetyFailureDetails;
  readonly firstDiffSummary?: ReconstructionSafetyFailureSummary;
  readonly formattingFidelity: ProjectedFormattingFidelity;

  constructor(options: {
    checks: TaggedPublicationSafetyChecks;
    failedChecks: TaggedPublicationSafetyCheckName[];
    failureDetails?: ReconstructionSafetyFailureDetails;
    firstDiffSummary?: ReconstructionSafetyFailureSummary;
    formattingFidelity: ProjectedFormattingFidelity;
  }) {
    super(`Tagged publication failed safety checks: ${options.failedChecks.join(', ')}`);
    this.name = 'TaggedPublicationSafetyError';
    this.checks = options.checks;
    this.failedChecks = options.failedChecks;
    this.failureDetails = options.failureDetails;
    this.firstDiffSummary = options.firstDiffSummary;
    this.formattingFidelity = options.formattingFidelity;
  }
}

/**
 * Reconcile a collision-renumbered footnote reference with its independently
 * tagged definition while retaining the reference identifier semantics.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.14
 */
async function reconcileTaggedFootnotes(options: {
  originalArchive: DocxArchive;
  revisedArchive: DocxArchive;
  resultArchive: DocxArchive;
  documentXml: string;
  author: string;
  date: Date;
  formatDetection: FormatDetectionSettings;
  auxiliaryIdRenumberings: readonly { label: string; fromId: string; toId: string }[];
  baseSide?: 'original' | 'revised';
  baseFootnotesArchive?: DocxArchive;
}): Promise<string> {
  const pairs = findCorrespondingFootnotePairs(
    options.documentXml,
    options.auxiliaryIdRenumberings,
  );
  if (pairs.length === 0) return options.documentXml;

  const [originalXml, revisedXml, resultXml, originalDocumentXml, revisedDocumentXml] =
    await Promise.all([
      options.originalArchive.getFile('word/footnotes.xml'),
      options.revisedArchive.getFile('word/footnotes.xml'),
      (options.baseFootnotesArchive ?? options.resultArchive).getFile('word/footnotes.xml'),
      options.originalArchive.getDocumentXml(),
      options.revisedArchive.getDocumentXml(),
    ]);
  if (!originalXml || !revisedXml || !resultXml) return options.documentXml;
  const original = parseEntries(originalXml, 'w:footnote');
  const revised = parseEntries(revisedXml, 'w:footnote');
  const result = parseEntries(resultXml, 'w:footnote');
  const document = parseXml(options.documentXml);
  const originalDocument = parseXml(originalDocumentXml);
  const revisedDocument = parseXml(revisedDocumentXml);
  let changed = false;
  for (const pair of pairs) {
    const originalEntry = original.entries.get(pair.originalId);
    const revisedEntry = revised.entries.get(pair.revisedId);
    const targetId = options.baseSide === 'original' ? pair.originalId : pair.revisedId;
    const discardedId = targetId === pair.originalId ? pair.revisedId : pair.originalId;
    const resultEntry = result.entries.get(targetId);
    if (!originalEntry || !revisedEntry || !resultEntry) continue;
    if (
      footnoteDefinitionPairRequiresCollisionSafeFallback(originalEntry, revisedEntry) ||
      !isOnlyFootnoteAnchorInSourceParagraph(originalDocument, pair.originalId) ||
      !isOnlyFootnoteAnchorInSourceParagraph(revisedDocument, pair.revisedId) ||
      !hasSafeEmittedFootnoteReferenceShape(
        document,
        pair.originalId,
        pair.revisedId,
        () => ({
          accepted: parseXml(acceptAllChanges(options.documentXml)),
          rejected: parseXml(rejectAllChanges(options.documentXml)),
        }),
      )
    ) continue;
    const comparedChildren = compareFootnoteDefinitions(originalEntry, revisedEntry, {
      author: options.author,
      date: options.date,
      formatDetection: options.formatDetection,
    });
    while (resultEntry.firstChild) resultEntry.removeChild(resultEntry.firstChild);
    for (const child of comparedChildren) {
      resultEntry.appendChild(result.doc.importNode(child, true));
    }
    for (const reference of Array.from(document.getElementsByTagName('w:footnoteReference'))) {
      if (reference.getAttribute('w:id') === discardedId) {
        reference.setAttribute('w:id', targetId);
      }
    }
    changed = true;
  }
  if (changed) {
    options.resultArchive.setFile('word/footnotes.xml', serializer.serializeToString(result.doc));
    return serializer.serializeToString(document);
  }
  return options.documentXml;
}

function relationshipPartPath(ownerPart: string, target: string): string {
  return normalizeOpcRelationshipTarget({ ownerPart, target }).target;
}

function relationshipPartRelsPath(partPath: string): string {
  const directory = posix.dirname(partPath);
  return `${directory === '.' ? '' : `${directory}/`}_rels/${posix.basename(partPath)}.rels`;
}

/**
 * Apply consumer-facing repairs to the complete tagged main story before its
 * bytes enter the publication gates. Bookmark identifiers and revision
 * identifiers are distinct OOXML spaces, but every surviving numeric `w:id`
 * is conservatively reserved so a split wrapper cannot collide with either.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 */
function finalizeTaggedDocumentXml(documentXml: string): string {
  const document = parseXml(documentXml);
  const root = document.documentElement;
  const revisionIds = createRevisionIdState([root]);
  enforceConsumerCompatibility(
    root,
    () => allocateRevisionId(revisionIds),
    { repairBookmarkInventory: false },
  );
  const serialized = new XMLSerializer().serializeToString(document);
  return suppressVolatileTocPagerefCacheRevisions(
    serialized.startsWith('<?xml') ? serialized : XML_DECLARATION + serialized,
  );
}

/**
 * Assemble a revised-base tagged result without a legacy result buffer, atom
 * list, or reconstruction-mode decision. Source archives are reopened so the
 * standalone relationship/auxiliary collision plan cannot inherit mutations
 * selected for legacy assembly.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.14
 */
export async function buildStandaloneTaggedPackage(
  original: Buffer,
  revised: Buffer,
  options: StandaloneTaggedPackageOptions,
): Promise<StandaloneTaggedPackageResult> {
  const originalArchive = await DocxArchive.load(original);
  const revisedArchive = await DocxArchive.load(revised);
  const unrepresentedChanges = await detectUnrepresentedChanges(
    originalArchive,
    revisedArchive,
  );
  const auxiliaryIdRenumberings = await renumberCollidingAuxiliaryIds(
    originalArchive,
    revisedArchive,
  );
  await restampCollidingCommentParaIds(originalArchive, revisedArchive);
  await renumberCollidingRelationshipIds(originalArchive, revisedArchive);

  let [originalXml, revisedXml, originalNumberingXml, revisedNumberingXml] = await Promise.all([
    originalArchive.getDocumentXml(),
    revisedArchive.getDocumentXml(),
    originalArchive.getNumberingXml(),
    revisedArchive.getNumberingXml(),
  ]);
  const disambiguatedBookmarks = disambiguateOriginalBookmarkIds(originalXml, revisedXml);
  if (disambiguatedBookmarks.remappedRanges > 0) {
    originalXml = disambiguatedBookmarks.xml;
    originalArchive.setDocumentXml(originalXml);
  }
  if (
    !findBody(parseDocumentXml(originalXml)) ||
    !findBody(parseDocumentXml(revisedXml))
  ) {
    throw new Error('Could not find w:body in one or both documents');
  }
  const publish = async (): Promise<{
    taggedOriginalXml: string;
    taggedRevisedXml: string;
    finalizedPublication: ReturnType<typeof consumeTaggedPublicationStatistics>;
  }> => {
    // Canonicalization needs one relationship table containing both sides, but
    // that temporary clone is discarded so unused original parts never leak
    // into the published revised-base package.
    const canonicalArchive = await revisedArchive.clone();
    await importReferencedRelationships(originalArchive, canonicalArchive, originalXml);
    const [taggedOriginalXml, taggedRevisedXml] = await Promise.all([
      canonicalizeRelationshipReferences(originalXml, originalArchive, canonicalArchive),
      canonicalizeRelationshipReferences(revisedXml, revisedArchive, canonicalArchive),
    ]);
    const taggedPublication = buildTaggedTreePublication({
      originalXml: taggedOriginalXml,
      revisedXml: taggedRevisedXml,
      author: options.author,
      date: options.date,
      detectFormatChanges: options.formatDetection.detectFormatChanges,
      detectMoves: options.moveDetection.detectMoves,
      moveSimilarityThreshold: options.moveDetection.moveSimilarityThreshold,
      moveMinimumWordCount: options.moveDetection.moveMinimumWordCount,
      caseInsensitiveMove: options.moveDetection.caseInsensitiveMove,
      numberingEnabled: options.numbering.enabled,
      originalNumberingXml: originalNumberingXml ?? undefined,
      revisedNumberingXml: revisedNumberingXml ?? undefined,
      revisionAttributionRanges: options.revisionAttributionRanges,
      retainStatisticsMarkers: true,
    });
    return {
      taggedOriginalXml,
      taggedRevisedXml,
      finalizedPublication: consumeTaggedPublicationStatistics(
        finalizeTaggedDocumentXml(taggedPublication.xml),
        taggedPublication.stats,
      ),
    };
  };

  let publication = await publish();
  const originalBookmarks = collectBookmarkDiagnostics(originalXml);
  const revisedBookmarks = collectBookmarkDiagnostics(revisedXml);
  const generatedDuplicateNames = collectBookmarkDiagnostics(
    publication.finalizedPublication.xml,
  ).duplicateStartNames.filter((name) =>
    originalBookmarks.startNames.includes(name) &&
    revisedBookmarks.startNames.includes(name) &&
    !originalBookmarks.duplicateStartNames.includes(name) &&
    !revisedBookmarks.duplicateStartNames.includes(name),
  );
  if (generatedDuplicateNames.length > 0) {
    const existingNames = await collectWordPartBookmarkNames([
      originalArchive,
      revisedArchive,
    ]);
    const reservedNames = options.bookmarkNameReservations ?? new Set<string>();
    for (const name of existingNames) reservedNames.add(name);
    const renames = createOriginalBookmarkRenameMap(generatedDuplicateNames, reservedNames);
    for (const name of renames.values()) reservedNames.add(name);
    await renameOriginalBookmarkTargetsAcrossWordParts(originalArchive, renames);
    originalXml = await originalArchive.getDocumentXml();
    originalNumberingXml = await originalArchive.getNumberingXml();
    publication = await publish();
  }
  const { taggedOriginalXml, taggedRevisedXml, finalizedPublication } = publication;
  let taggedXml = finalizedPublication.xml;
  let revisionAttributions: RevisionAttribution[] | undefined;
  if ((options.revisionAttributionRanges?.length ?? 0) > 0) {
    const resolved = resolveTaggedRevisionAttributions(
      taggedXml,
      options.revisionAttributionRanges!.map((range) => range.operationId),
    );
    taggedXml = resolved.xml;
    revisionAttributions = resolved.attributions;
  }

  const resultArchive = await revisedArchive.clone();
  taggedXml = await reconcileTaggedFootnotes({
    originalArchive,
    revisedArchive,
    resultArchive,
    documentXml: taggedXml,
    author: options.author,
    date: options.date,
    formatDetection: options.formatDetection,
    auxiliaryIdRenumberings,
  });
  resultArchive.setDocumentXml(taggedXml);
  await importReferencedRelationships(originalArchive, resultArchive, taggedXml);
  const noteMergeResults = new Map<'footnote' | 'endnote', AuxiliaryMergeResult>();
  for (const descriptor of AUXILIARY_PARTS) {
    let mergeResult: AuxiliaryMergeResult;
    try {
      mergeResult = await mergeAuxiliaryPartDefinitions(
        originalArchive,
        resultArchive,
        taggedXml,
        descriptor,
      );
      await mergeAuxiliaryPartDefinitions(revisedArchive, resultArchive, taggedXml, descriptor);
    } catch (error) {
      if (descriptor.label !== 'footnote' && descriptor.label !== 'endnote') throw error;
      throw new AncillaryStorySafetyError([{
        category: 'strict_field_structure',
        code: 'NOTE_PART_XML_INVALID',
        detail: error instanceof Error ? error.message : String(error),
        locator: {
          locatorType: 'package_part',
          normalizedPartPath: descriptor.partPath,
        },
      }]);
    }
    if (descriptor.label === 'footnote' || descriptor.label === 'endnote') {
      noteMergeResults.set(descriptor.label, mergeResult);
    }
  }
  const rootCommentIds = await collectStoryReferenceIds(
    resultArchive,
    taggedXml,
    'w:commentReference',
    null,
  );
  if (rootCommentIds.size > 0) {
    await mergeCommentAncillaryParts(originalArchive, resultArchive, rootCommentIds);
    await mergeCommentAncillaryParts(revisedArchive, resultArchive, rootCommentIds);
  }
  const ancillaryFieldEvidence = await evaluateAncillaryFieldSafety({
    resultArchive,
    baseArchive: revisedArchive,
    mergeSourceArchive: originalArchive,
    baseSide: 'revised',
    mergeSourceSide: 'original',
    noteMergeResults,
  });
  const finalAuxiliarySidecars = {
    footnotesXmls: [await resultArchive.getFile('word/footnotes.xml')],
    endnotesXmls: [await resultArchive.getFile('word/endnotes.xml')],
  };
  // Project pre-existing revisions exactly as the candidate gate does. A raw
  // revised source can still contain a deletion that accept-all intentionally
  // removes, while a raw original can contain an insertion that reject-all
  // intentionally removes. Comparing the candidate projections to those raw
  // trees would reject a faithful publication.
  const originalProjectionXml = rejectAllChanges(originalXml);
  const revisedProjectionXml = acceptAllChanges(revisedXml);
  const publicationSafety = (options.publicationSafetyEvaluator ?? evaluateSafetyChecks)(
    extractRoundTripComparisonText(originalProjectionXml),
    extractRoundTripComparisonText(revisedProjectionXml),
    collectBookmarkDiagnostics(originalXml),
    collectBookmarkDiagnostics(revisedXml),
    taggedXml,
    finalAuxiliarySidecars,
  );
  const formattingFidelity = (
    options.formattingFidelityEvaluator ?? compareSourceProjectedFormattingFidelity
  )(
    rejectAllChanges(taggedOriginalXml),
    acceptAllChanges(taggedRevisedXml),
    taggedXml,
  );
  const sectionFormattingIsExplicitlyUnrepresented =
    unrepresentedChanges.some((change) => change.scope === 'section') &&
    [formattingFidelity.accept, formattingFidelity.reject].every((report) =>
      report.runFormatting.score === 1 &&
      report.paragraphFormatting.score === 1 &&
      report.tableFormatting.score === 1 &&
      report.unalignedExpectedParagraphs === 0 &&
      report.unalignedActualParagraphs === 0 &&
      report.divergences.every((divergence) => divergence.scope === 'section'),
    );
  const checks: TaggedPublicationSafetyChecks = {
    ...publicationSafety.checks,
    formattingFidelity:
      !options.formatDetection.detectFormatChanges ||
      formattingFidelity.score === 1 ||
      sectionFormattingIsExplicitlyUnrepresented,
  };
  const failedChecks: TaggedPublicationSafetyCheckName[] = [
    ...publicationSafety.failedChecks,
    ...(checks.formattingFidelity ? [] : ['formattingFidelity' as const]),
  ];
  if (failedChecks.length > 0) {
    throw new TaggedPublicationSafetyError({
      checks,
      failedChecks,
      failureDetails: publicationSafety.failureDetails,
      firstDiffSummary: publicationSafety.failureSummary,
      formattingFidelity,
    });
  }
  return {
    document: await resultArchive.save(),
    documentXml: taggedXml,
    stats: finalizedPublication.stats,
    ancillaryFieldEvidence,
    formattingFidelity,
    revisionAttributions,
    unrepresentedChanges:
      unrepresentedChanges.length > 0 ? unrepresentedChanges : undefined,
  };
}

async function relationshipClosureDigest(
  archive: DocxArchive,
  partPath: string,
  ancestors: ReadonlySet<string> = new Set(),
  cache: Map<string, Promise<string>> = new Map(),
): Promise<string> {
  if (ancestors.has(partPath)) return `cycle:${partPath}`;
  const cached = cache.get(partPath);
  if (cached) return cached;
  const computation = (async (): Promise<string> => {
    const bytes = await archive.getFileBuffer(partPath);
    if (!bytes) return `missing:${partPath}`;
    const nextAncestors = new Set(ancestors).add(partPath);
    const relsXml = await archive.getFile(relationshipPartRelsPath(partPath));
    const children: string[] = [];
    const childSemanticsById = new Map<string, string>();
    if (relsXml) {
      const rels = parseXml(relsXml);
      for (const relationship of Array.from(
        rels.getElementsByTagNameNS(PACKAGE_RELATIONSHIP_NS, 'Relationship'),
      )) {
        const id = relationship.getAttribute('Id') ?? '';
        const type = relationship.getAttribute('Type') ?? '';
        const target = relationship.getAttribute('Target') ?? '';
        const mode = relationship.getAttribute('TargetMode') ?? '';
        const identity = mode === 'External'
          ? target
          : await relationshipClosureDigest(
            archive, relationshipPartPath(partPath, target), nextAncestors, cache,
          );
        const semantics = JSON.stringify([type, mode, identity]);
        children.push(semantics);
        if (id) childSemanticsById.set(id, semantics);
      }
      children.sort();
    }
    let semanticBytes = bytes;
    if (/\.(?:xml|rels)$/iu.test(partPath)) {
      try {
        const document = parseXml(bytes.toString('utf8'));
        for (const element of Array.from(document.getElementsByTagName('*'))) {
          for (const attribute of Array.from(element.attributes)) {
            if (attribute.namespaceURI !== OFFICE_RELATIONSHIP_NS) continue;
            const semantics = childSemanticsById.get(attribute.value);
            if (semantics) attribute.value = semantics;
          }
        }
        semanticBytes = Buffer.from(serializer.serializeToString(document));
      } catch {
        // An unused malformed auxiliary part is rejected only if publication
        // provenance selects it. Relationship identity must remain readable
        // enough for the main comparison to take that established path.
      }
    }
    return createHash('sha256')
      .update(semanticBytes)
      .update('\0')
      .update([...new Set(children)].join('\0'))
      .digest('hex');
  })();
  cache.set(partPath, computation);
  return computation;
}

async function relationshipSemanticsById(archive: DocxArchive): Promise<Map<string, string>> {
  const xml = await archive.getFile('word/_rels/document.xml.rels');
  if (!xml) return new Map();
  const document = parseXml(xml);
  const entries = await Promise.all(Array.from(
    document.getElementsByTagNameNS(PACKAGE_RELATIONSHIP_NS, 'Relationship'),
  ).map(async (relationship) => {
    const id = relationship.getAttribute('Id') ?? '';
    const type = relationship.getAttribute('Type') ?? '';
    const target = relationship.getAttribute('Target') ?? '';
    const mode = relationship.getAttribute('TargetMode') ?? '';
    const identity = mode === 'External'
      ? target
      : await relationshipClosureDigest(
        archive,
        relationshipPartPath('word/document.xml', target),
        new Set(),
        // Keep memoization local to one top-level closure. Sharing in-flight
        // promises between roots can deadlock when A and B reference each
        // other from separate concurrent traversals.
        new Map(),
      );
    return [id, JSON.stringify([type, mode, identity])] as const;
  }));
  return new Map(entries.filter(([id]) => id.length > 0));
}

async function canonicalizeRelationshipReferences(
  xml: string,
  sourceArchive: DocxArchive,
  assembledArchive: DocxArchive,
): Promise<string> {
  const [sourceById, assembledById] = await Promise.all([
    relationshipSemanticsById(sourceArchive),
    relationshipSemanticsById(assembledArchive),
  ]);
  const assembledBySemantics = new Map([...assembledById].map(([id, semantics]) => [semantics, id]));
  const document = parseXml(xml);
  for (const element of Array.from(document.getElementsByTagName('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.namespaceURI !== OFFICE_RELATIONSHIP_NS) continue;
      const semantics = sourceById.get(attribute.value);
      const canonicalId = semantics ? assembledBySemantics.get(semantics) : undefined;
      if (canonicalId) element.setAttributeNS(OFFICE_RELATIONSHIP_NS, attribute.name, canonicalId);
    }
  }
  return new XMLSerializer().serializeToString(document);
}

/**
 * Options for the atomizer pipeline.
 */
export interface AtomizerOptions {
  /** Author name for track changes. Default: "Comparison" */
  author?: string;
  /** Timestamp for track changes. Default: current time */
  date?: Date;
  /** Move detection settings */
  moveDetection?: Partial<MoveDetectionSettings>;
  /** Format detection settings */
  formatDetection?: Partial<FormatDetectionSettings>;
  /** Numbering integration settings. */
  numbering?: Partial<NumberingIntegrationOptions>;
  /** @internal Exact source ranges to carry through tagged serialization. */
  revisionAttributionRanges?: import('../compare-types.js').RevisionAttributionRange[];
  /** @internal Test seam for exercising fail-safe publication without malformed fixtures. */
  taggedTreePublicationSafetyEvaluator?: typeof evaluateSafetyChecks;
  /** @internal Test seam for exercising the final formatting-fidelity gate. */
  taggedTreeFormattingFidelityEvaluator?: typeof compareSourceProjectedFormattingFidelity;
}

/** Internal tagged result metadata used by attribution-aware callers. */
export interface TaggedCompareResult extends CompareResult {
  /** Exact tagged revision ranges requested through private attribution input. @internal */
  revisionAttributions?: RevisionAttribution[];
}

interface BookmarkDiagnostics {
  startIds: string[];
  endIds: string[];
  startNames: string[];
  duplicateStartNames: string[];
  referencedBookmarkNames: string[];
  unresolvedReferenceNames: string[];
  duplicateStartIds: string[];
  duplicateEndIds: string[];
  unmatchedStartIds: string[];
  unmatchedEndIds: string[];
}

function collectBookmarkDiagnostics(documentXml: string): BookmarkDiagnostics {
  const root = parseDocumentXml(documentXml);

  const startSet = new Set<string>();
  const endSet = new Set<string>();
  const startNameSet = new Set<string>();
  const duplicateStartSet = new Set<string>();
  const duplicateEndSet = new Set<string>();
  const duplicateStartNameSet = new Set<string>();

  for (const node of findAllByTagName(root, 'w:bookmarkStart')) {
    const id = node.getAttribute('w:id');
    if (!id) continue;
    if (startSet.has(id)) duplicateStartSet.add(id);
    else startSet.add(id);

    const name = node.getAttribute('w:name');
    if (name) {
      if (startNameSet.has(name)) duplicateStartNameSet.add(name);
      else startNameSet.add(name);
    }
  }

  for (const node of findAllByTagName(root, 'w:bookmarkEnd')) {
    const id = node.getAttribute('w:id');
    if (!id) continue;
    if (endSet.has(id)) duplicateEndSet.add(id);
    else endSet.add(id);
  }

  const startIds = Array.from(startSet).sort();
  const endIds = Array.from(endSet).sort();
  const startNames = Array.from(startNameSet).sort();
  const referencedBookmarkNames = collectBookmarkReferenceNamesInXml(documentXml);
  const unresolvedReferenceNames = referencedBookmarkNames
    .filter((name) => !startNameSet.has(name))
    .sort();
  const unmatchedStartIds = startIds.filter((id) => !endSet.has(id));
  const unmatchedEndIds = endIds.filter((id) => !startSet.has(id));

  return {
    startIds,
    endIds,
    startNames,
    duplicateStartNames: Array.from(duplicateStartNameSet).sort(),
    referencedBookmarkNames,
    unresolvedReferenceNames,
    duplicateStartIds: Array.from(duplicateStartSet).sort(),
    duplicateEndIds: Array.from(duplicateEndSet).sort(),
    unmatchedStartIds,
    unmatchedEndIds,
  };
}

/**
 * Bookmark publication can normalize IDs and which source marker carries a
 * name, but it must not introduce structural or reference anomalies absent
 * from the corresponding source inventory.
 */
function containsNoNewValues(actual: string[], allowed: ReadonlySet<string>): boolean {
  return actual.every((value) => allowed.has(value));
}

function bookmarkDiagnosticsIntroduceNoStructuralAnomalies(
  actual: BookmarkDiagnostics,
  allowed: BookmarkDiagnostics,
): boolean {
  return containsNoNewValues(
    actual.duplicateStartNames,
    new Set(allowed.duplicateStartNames),
  ) && containsNoNewValues(
    actual.unresolvedReferenceNames,
    new Set(allowed.unresolvedReferenceNames),
  ) && containsNoNewValues(
    actual.duplicateStartIds,
    new Set(allowed.duplicateStartIds),
  ) && containsNoNewValues(
    actual.duplicateEndIds,
    new Set(allowed.duplicateEndIds),
  );
}

function combinedBookmarkAllowance(
  original: BookmarkDiagnostics,
  revised: BookmarkDiagnostics,
): BookmarkDiagnostics {
  const union = (left: string[], right: string[]): string[] => [...new Set([...left, ...right])];
  return {
    startIds: union(original.startIds, revised.startIds),
    endIds: union(original.endIds, revised.endIds),
    startNames: union(original.startNames, revised.startNames),
    duplicateStartNames: union(original.duplicateStartNames, revised.duplicateStartNames),
    referencedBookmarkNames: union(
      original.referencedBookmarkNames,
      revised.referencedBookmarkNames,
    ),
    unresolvedReferenceNames: union(
      original.unresolvedReferenceNames,
      revised.unresolvedReferenceNames,
    ),
    duplicateStartIds: union(original.duplicateStartIds, revised.duplicateStartIds),
    duplicateEndIds: union(original.duplicateEndIds, revised.duplicateEndIds),
    unmatchedStartIds: union(original.unmatchedStartIds, revised.unmatchedStartIds),
    unmatchedEndIds: union(original.unmatchedEndIds, revised.unmatchedEndIds),
  };
}

function diffIds(expected: string[], actual: string[]): { missing: string[]; unexpected: string[] } {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((id) => !actualSet.has(id));
  const unexpected = actual.filter((id) => !expectedSet.has(id));
  return { missing, unexpected };
}

function buildTextMismatchDetails(expectedText: string, actualText: string): ReconstructionTextMismatchDetails {
  const comparison = compareTexts(expectedText, actualText);
  const expectedParas = expectedText.split('\n');
  const actualParas = actualText.split('\n');
  const maxLen = Math.max(expectedParas.length, actualParas.length);

  let firstDifferingParagraphIndex = -1;
  for (let i = 0; i < maxLen; i++) {
    if ((expectedParas[i] ?? '') !== (actualParas[i] ?? '')) {
      firstDifferingParagraphIndex = i;
      break;
    }
  }

  return {
    expectedLength: comparison.expectedLength,
    actualLength: comparison.actualLength,
    firstDifferingParagraphIndex,
    expectedParagraph:
      firstDifferingParagraphIndex >= 0 ? (expectedParas[firstDifferingParagraphIndex] ?? '') : '',
    actualParagraph:
      firstDifferingParagraphIndex >= 0 ? (actualParas[firstDifferingParagraphIndex] ?? '') : '',
    differenceSample: comparison.differences.slice(0, 3),
  };
}

function buildBookmarkMismatchDetails(
  expected: BookmarkDiagnostics,
  actual: BookmarkDiagnostics
): ReconstructionBookmarkMismatchDetails {
  return {
    startNames: diffIds(expected.startNames, actual.startNames),
    referencedBookmarkNames: diffIds(expected.referencedBookmarkNames, actual.referencedBookmarkNames),
    unresolvedReferenceNames: diffIds(expected.unresolvedReferenceNames, actual.unresolvedReferenceNames),
    startIds: diffIds(expected.startIds, actual.startIds),
    endIds: diffIds(expected.endIds, actual.endIds),
    expectedDuplicateStartNames: expected.duplicateStartNames,
    actualDuplicateStartNames: actual.duplicateStartNames,
    expectedDuplicateStartIds: expected.duplicateStartIds,
    actualDuplicateStartIds: actual.duplicateStartIds,
    expectedDuplicateEndIds: expected.duplicateEndIds,
    actualDuplicateEndIds: actual.duplicateEndIds,
    expectedUnmatchedStartIds: expected.unmatchedStartIds,
    actualUnmatchedStartIds: actual.unmatchedStartIds,
    expectedUnmatchedEndIds: expected.unmatchedEndIds,
    actualUnmatchedEndIds: actual.unmatchedEndIds,
  };
}

function summarizeIdDelta(delta: ReconstructionIdDelta): ReconstructionIdDeltaSummary {
  return {
    missingCount: delta.missing.length,
    unexpectedCount: delta.unexpected.length,
    firstMissing: delta.missing[0],
    firstUnexpected: delta.unexpected[0],
  };
}

function truncateForSummary(value: string, maxLength = 160): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function summarizeTextMismatch(
  details: ReconstructionTextMismatchDetails
): ReconstructionTextMismatchSummary {
  return {
    firstDifferingParagraphIndex: details.firstDifferingParagraphIndex,
    expectedParagraph: truncateForSummary(details.expectedParagraph),
    actualParagraph: truncateForSummary(details.actualParagraph),
    firstDifference: details.differenceSample[0] ?? 'No diff sample',
  };
}

function summarizeBookmarkMismatch(
  details: ReconstructionBookmarkMismatchDetails
): ReconstructionBookmarkMismatchSummary {
  return {
    startNames: summarizeIdDelta(details.startNames),
    referencedBookmarkNames: summarizeIdDelta(details.referencedBookmarkNames),
    unresolvedReferenceNames: summarizeIdDelta(details.unresolvedReferenceNames),
    startIds: summarizeIdDelta(details.startIds),
    endIds: summarizeIdDelta(details.endIds),
    unmatchedStartCount: details.actualUnmatchedStartIds.length,
    unmatchedEndCount: details.actualUnmatchedEndIds.length,
    firstUnmatchedStartId: details.actualUnmatchedStartIds[0],
    firstUnmatchedEndId: details.actualUnmatchedEndIds[0],
  };
}

function buildFailureSummary(
  failureDetails: ReconstructionSafetyFailureDetails | undefined
): ReconstructionSafetyFailureSummary | undefined {
  if (!failureDetails) {
    return undefined;
  }

  const summary: ReconstructionSafetyFailureSummary = {};
  if (failureDetails.acceptText) {
    summary.acceptText = summarizeTextMismatch(failureDetails.acceptText);
  }
  if (failureDetails.rejectText) {
    summary.rejectText = summarizeTextMismatch(failureDetails.rejectText);
  }
  if (failureDetails.acceptBookmarks) {
    summary.acceptBookmarks = summarizeBookmarkMismatch(failureDetails.acceptBookmarks);
  }
  if (failureDetails.rejectBookmarks) {
    summary.rejectBookmarks = summarizeBookmarkMismatch(failureDetails.rejectBookmarks);
  }

  return Object.keys(summary).length > 0 ? summary : undefined;
}

// Declared above splitStories so the function body never observes an
// uninitialized binding under circular imports.
const serializer = new XMLSerializer();

/**
 * Split a docx into per-story XML fragments for field-closure validation.
 *
 * Each footnote/endnote entry is treated as an isolated story: a complex
 * field whose `begin` and `end` markers straddle stories breaks Word's
 * field state machine. We therefore validate each `<w:footnote>` and
 * `<w:endnote>` entry independently rather than treating the whole
 * `footnotes.xml`/`endnotes.xml` as one stream.
 *
 * Accepts arrays of sidecar XMLs (one per source archive) so callers can
 * validate the union of entries from every archive that may contribute to the
 * final result. Step 12 of `compareDocumentsAtomizer` merges entries from a
 * mode-dependent source archive into the base archive; passing both archives'
 * sidecars guarantees that whichever path the merge takes, the entries it
 * could publish have already been screened. Duplicates (same `w:id` in both
 * archives) yield redundant but harmless validation work.
 *
 * Header/footer stories are not yet covered — they require relationship
 * walking to enumerate `headerN.xml`/`footerN.xml`.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.13
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @see https://github.com/UseJunior/safe-docx/issues/212
 */
export function splitStories(
  documentXml: string,
  footnotesXmls: ReadonlyArray<string | null>,
  endnotesXmls: ReadonlyArray<string | null>,
): FieldStory[] {
  const stories: FieldStory[] = [{ label: 'document', xml: documentXml }];

  const collectEntries = (
    sidecars: ReadonlyArray<string | null>,
    entryTag: string,
    labelPrefix: string,
  ): void => {
    for (let s = 0; s < sidecars.length; s++) {
      const sidecarXml = sidecars[s];
      if (!sidecarXml) continue;
      const doc = parseXml(sidecarXml);
      const entries = doc.getElementsByTagName(entryTag);
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i] as Element;
        const id = entry.getAttribute('w:id') ?? String(i);
        stories.push({
          label: `${labelPrefix}[${s}]:${id}`,
          xml: serializer.serializeToString(entry),
        });
      }
    }
  };

  collectEntries(footnotesXmls, 'w:footnote', 'footnote');
  collectEntries(endnotesXmls, 'w:endnote', 'endnote');

  return stories;
}

function evaluateSafetyChecks(
  originalTextForRoundTrip: string,
  revisedTextForRoundTrip: string,
  originalBookmarkDiagnostics: BookmarkDiagnostics,
  revisedBookmarkDiagnostics: BookmarkDiagnostics,
  candidateXml: string,
  auxiliarySidecars: {
    footnotesXmls: ReadonlyArray<string | null>;
    endnotesXmls: ReadonlyArray<string | null>;
  },
): {
  safe: boolean;
  checks: ReconstructionSafetyChecks;
  failedChecks: ReconstructionSafetyCheckName[];
  failureDetails?: ReconstructionSafetyFailureDetails;
  failureSummary?: ReconstructionSafetyFailureSummary;
} {
  const acceptedXml = acceptAllChanges(candidateXml);
  const rejectedXml = rejectAllChanges(candidateXml);
  const acceptedText = extractRoundTripComparisonText(acceptedXml);
  const rejectedText = extractRoundTripComparisonText(rejectedXml);
  const acceptedBookmarkDiagnostics = collectBookmarkDiagnostics(acceptedXml);
  const rejectedBookmarkDiagnostics = collectBookmarkDiagnostics(rejectedXml);
  const combinedBookmarkDiagnostics = collectBookmarkDiagnostics(candidateXml);
  const acceptTextComparison = compareTexts(revisedTextForRoundTrip, acceptedText);
  const rejectTextComparison = compareTexts(originalTextForRoundTrip, rejectedText);

  const combinedBookmarksOk = bookmarkDiagnosticsIntroduceNoStructuralAnomalies(
    combinedBookmarkDiagnostics,
    combinedBookmarkAllowance(originalBookmarkDiagnostics, revisedBookmarkDiagnostics),
  );
  const acceptBookmarksOk = combinedBookmarksOk &&
    bookmarkDiagnosticsIntroduceNoStructuralAnomalies(
      acceptedBookmarkDiagnostics,
      revisedBookmarkDiagnostics,
    );
  const rejectBookmarksOk = combinedBookmarksOk &&
    bookmarkDiagnosticsIntroduceNoStructuralAnomalies(
      rejectedBookmarkDiagnostics,
      originalBookmarkDiagnostics,
    );

  // Validate field structure for the main-story round-trip projection. Final
  // note entries are validated after mode-specific assembly, where the gate
  // knows which base and merge-source definitions actually contributed.
  const acceptedStories = splitStories(
    acceptedXml,
    auxiliarySidecars.footnotesXmls,
    auxiliarySidecars.endnotesXmls,
  );
  const rejectedStories = splitStories(
    rejectedXml,
    auxiliarySidecars.footnotesXmls,
    auxiliarySidecars.endnotesXmls,
  );
  // The full validateFieldStructure check runs on the accept/reject projections
  // (per-story). There is deliberately no additional gate on the combined view:
  // the former #217 no-fldChar-in-del rule was removed after Word 16.112 and
  // Aspose.Words 25.10 were both measured emitting whole deleted fields inside
  // <w:del>, with output that validates against the Transitional WML schema.
  const fieldStructureOk =
    validateFieldStructure(acceptedStories) &&
    validateFieldStructure(rejectedStories);

  const checks: ReconstructionSafetyChecks = {
    acceptText: acceptTextComparison.normalizedIdentical,
    rejectText: rejectTextComparison.normalizedIdentical,
    // Hoisting may intentionally normalize which source marker carries a
    // bookmark name, so source-inventory equality is too strict. Publication
    // still fails closed on new balance, uniqueness, and reference anomalies
    // in the combined document or either projection. An anomaly already
    // present in a source remains diagnostic rather than being silently
    // repaired by the tagged path.
    acceptBookmarks: acceptBookmarksOk,
    rejectBookmarks: rejectBookmarksOk,
    fieldStructure: fieldStructureOk,
  };

  const failedChecks: ReconstructionSafetyCheckName[] = (Object.entries(checks) as Array<
    [ReconstructionSafetyCheckName, boolean]
  >)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  const failureDetails: ReconstructionSafetyFailureDetails = {};
  if (!checks.acceptText) {
    failureDetails.acceptText = buildTextMismatchDetails(revisedTextForRoundTrip, acceptedText);
  }
  if (!checks.rejectText) {
    failureDetails.rejectText = buildTextMismatchDetails(originalTextForRoundTrip, rejectedText);
  }
  if (!acceptBookmarksOk) {
    failureDetails.acceptBookmarks = buildBookmarkMismatchDetails(
      revisedBookmarkDiagnostics,
      acceptedBookmarkDiagnostics
    );
  }
  if (!rejectBookmarksOk) {
    failureDetails.rejectBookmarks = buildBookmarkMismatchDetails(
      originalBookmarkDiagnostics,
      rejectedBookmarkDiagnostics
    );
  }

  return {
    safe: failedChecks.length === 0,
    checks,
    failedChecks,
    failureDetails: failedChecks.length > 0 ? failureDetails : undefined,
    failureSummary: failedChecks.length > 0 ? buildFailureSummary(failureDetails) : undefined,
  };
}

/** Build the authoritative revised-base result without legacy construction. */
async function compareDocumentsTaggedCore(
  original: Buffer,
  revised: Buffer,
  options: AtomizerOptions,
  bookmarkNameReservations?: Set<string>,
): Promise<TaggedCompareResult> {
  const standalone = await buildStandaloneTaggedPackage(original, revised, {
    author: options.author ?? 'Comparison',
    date: options.date ?? new Date(),
    moveDetection: {
      ...DEFAULT_MOVE_DETECTION_SETTINGS,
      ...options.moveDetection,
    },
    formatDetection: {
      ...DEFAULT_FORMAT_DETECTION_SETTINGS,
      ...options.formatDetection,
    },
    numbering: {
      ...DEFAULT_NUMBERING_OPTIONS,
      ...options.numbering,
    },
    revisionAttributionRanges: options.revisionAttributionRanges,
    publicationSafetyEvaluator: options.taggedTreePublicationSafetyEvaluator,
    formattingFidelityEvaluator: options.taggedTreeFormattingFidelityEvaluator,
    bookmarkNameReservations,
  });
  return {
    document: standalone.document,
    stats: standalone.stats,
    engine: 'tagged-tree',
    unrepresentedChanges: standalone.unrepresentedChanges,
    ancillaryFieldEvidence: standalone.ancillaryFieldEvidence,
    revisionAttributions: standalone.revisionAttributions,
  };
}

/**
 * Compare supported VML text-box content as independent nested stories.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.22
 * @see https://github.com/UseJunior/safe-docx/issues/713
 */
async function compareDocumentsTagged(
  original: Buffer,
  revised: Buffer,
  options: AtomizerOptions,
): Promise<TaggedCompareResult> {
  const textBoxPlan = await prepareTextBoxStoryComparison(original, revised);
  if (!textBoxPlan) {
    return compareDocumentsTaggedCore(original, revised, options);
  }

  const [originalArchive, revisedArchive] = await Promise.all([
    DocxArchive.load(original),
    DocxArchive.load(revised),
  ]);
  const bookmarkNameReservations = await collectWordPartBookmarkNames([
    originalArchive,
    revisedArchive,
  ]);
  const outerResult = await compareDocumentsTaggedCore(
    textBoxPlan.outerOriginal,
    textBoxPlan.outerRevised,
    options,
    bookmarkNameReservations,
  );

  const storyResults: Array<{
    index: number;
    visualIndex: number;
    partPath: string;
    container: 'textBox' | 'ancillaryPart';
    result: CompareResult;
  }> = [];
  const rejectedSelectedStoryPaths =
    await rejectedSelectedAncillaryStoryPaths(
      textBoxPlan.outerOriginal,
    );
  const representedPartPaths = new Set<string>();
  for (const story of textBoxPlan.stories) {
    if (
      story.container === 'ancillaryPart' &&
      rejectedSelectedStoryPaths.has(story.partPath)
    ) {
      continue;
    }
    let result = await compareDocumentsTaggedCore(
      story.original,
      story.container === 'ancillaryPart' ? story.original : story.revised,
      options,
      bookmarkNameReservations,
    );
    if (story.container === 'ancillaryPart') {
      const marked = await markInsertedAncillaryStoryParagraphs(
        story.revised,
        outerResult.document,
        options.author ?? 'Comparison',
        options.date ?? new Date(),
      );
      const insertionRanges = marked.directParagraphs;
      result = {
        ...result,
        document: marked.document,
        stats: {
          ...result.stats,
          insertions: insertionRanges,
          insertedRanges: insertionRanges,
          insertedAtoms: Math.max(
            result.stats.insertedAtoms,
            marked.directParagraphs,
          ),
        },
      };
      representedPartPaths.add(story.partPath);
    }
    storyResults.push({
      index: story.index,
      visualIndex: story.visualIndex,
      partPath: story.partPath,
      container: story.container,
      result,
    });
  }

  const document = await assembleTextBoxStoryComparison(
    outerResult.document,
    storyResults.map(({ index, visualIndex, partPath, container, result }) => ({
      index,
      visualIndex,
      partPath,
      container,
      document: result.document,
    })),
  );
  const comparedArchive = await DocxArchive.load(document);
  const comparedDocumentXml = await comparedArchive.getDocumentXml();
  const assembledBookmarkDiagnostics = collectBookmarkDiagnostics(comparedDocumentXml);
  const sourceDuplicateBookmarkNames = new Set([
    ...collectBookmarkDiagnostics(textBoxPlan.originalDocumentXml).duplicateStartNames,
    ...collectBookmarkDiagnostics(textBoxPlan.revisedDocumentXml).duplicateStartNames,
  ]);
  const introducedDuplicateBookmarkNames =
    assembledBookmarkDiagnostics.duplicateStartNames.filter(
      (name) => !sourceDuplicateBookmarkNames.has(name),
    );
  if (introducedDuplicateBookmarkNames.length > 0) {
    throw new UnsupportedTextBoxRevisionError([{
      index: textBoxPlan.stories[0]?.visualIndex ?? 0,
      partPath: textBoxPlan.stories[0]?.partPath ?? 'word/document.xml',
      reason: 'assembled nested stories introduced duplicate bookmark names: ' +
        introducedDuplicateBookmarkNames.join(', '),
    }]);
  }
  const acceptedComparison = compareTexts(
    extractRoundTripComparisonText(textBoxPlan.revisedDocumentXml),
    extractRoundTripComparisonText(acceptAllChanges(comparedDocumentXml)),
  );
  const rejectedComparison = compareTexts(
    extractRoundTripComparisonText(textBoxPlan.originalDocumentXml),
    extractRoundTripComparisonText(rejectAllChanges(comparedDocumentXml)),
  );
  if (
    !acceptedComparison.normalizedIdentical ||
    !rejectedComparison.normalizedIdentical
  ) {
    throw new UnsupportedTextBoxRevisionError([{
      index: textBoxPlan.stories[0]?.visualIndex ?? 0,
      partPath: textBoxPlan.stories[0]?.partPath ?? 'word/document.xml',
      reason: 'assembled nested stories failed accept/reject round-trip validation',
    }]);
  }
  if (
    textBoxPlan.hasAncillaryTextBoxStories ||
    representedPartPaths.size > 0
  ) {
    await assertAncillaryTextBoxStoryProjection(original, revised, document);
  }
  const results = [outerResult, ...storyResults.map(({ result }) => result)];
  const stats = results.reduce<CompareStats>(
    (combined, result) => ({
      atomMetricVersion: 'tagged-token-v1',
      insertions: combined.insertions + result.stats.insertions,
      deletions: combined.deletions + result.stats.deletions,
      modifications: combined.modifications + result.stats.modifications,
      insertedRanges: combined.insertedRanges + result.stats.insertedRanges,
      deletedRanges: combined.deletedRanges + result.stats.deletedRanges,
      insertedAtoms: combined.insertedAtoms + result.stats.insertedAtoms,
      deletedAtoms: combined.deletedAtoms + result.stats.deletedAtoms,
      modifiedParagraphs:
        combined.modifiedParagraphs + result.stats.modifiedParagraphs,
      formatChanges: combined.formatChanges + result.stats.formatChanges,
      formatChangeAtoms:
        combined.formatChangeAtoms + result.stats.formatChangeAtoms,
    }),
    {
      atomMetricVersion: 'tagged-token-v1',
      insertions: 0,
      deletions: 0,
      modifications: 0,
      insertedRanges: 0,
      deletedRanges: 0,
      insertedAtoms: 0,
      deletedAtoms: 0,
      modifiedParagraphs: 0,
      formatChanges: 0,
      formatChangeAtoms: 0,
    },
  );
  const unrepresentedChanges = outerResult.unrepresentedChanges?.filter(
    (change) => !textBoxPlan.representedAncillaryChanges.some(
      (represented) =>
        representedPartPaths.has(represented.partPath) &&
        change.scope === represented.scope &&
        change.kind === represented.kind &&
        change.sectionIndex === represented.sectionIndex &&
        change.role === represented.role,
    ),
  );

  return {
    ...outerResult,
    document,
    stats,
    unrepresentedChanges:
      unrepresentedChanges && unrepresentedChanges.length > 0
        ? unrepresentedChanges
        : undefined,
  };
}

/** Publish through the sole revised-base tagged assembler. */
export async function compareDocumentsAtomizer(
  original: Buffer,
  revised: Buffer,
  options: AtomizerOptions = {},
): Promise<TaggedCompareResult> {
  debugTaggedComparison('starting revised-base comparison', {
    originalBytes: original.length,
    revisedBytes: revised.length,
  });
  return compareDocumentsTagged(original, revised, options);
}

// =============================================================================
// Auxiliary Part Merging (footnotes, endnotes, comments)
//
// Reconstruction may insert content whose auxiliary definitions are absent
// from the base archive. The "source" archive is the one we pull definitions
// from: in inplace mode that is `originalArchive` (deleted-but-referenced
// definitions); in rebuild mode it is `revisedArchive` (added-but-referenced
// definitions). Step 12 in the pipeline picks the correct source per mode.
// =============================================================================

export interface AuxiliaryMergeResult {
  mergedIds: Set<string>;
  createdPart: boolean;
}

function isOnlyFootnoteAnchorInSourceParagraph(documentDoc: Document, id: string): boolean {
  const matches: Element[] = [];
  const references = documentDoc.getElementsByTagName('w:footnoteReference');
  for (let i = 0; i < references.length; i++) {
    const reference = references[i] as Element;
    if (reference.getAttribute('w:id') === id) matches.push(reference);
  }
  if (matches.length !== 1) return false;
  const paragraph = ancestorElement(matches[0]!, 'w:p');
  return paragraph?.getElementsByTagName('w:footnoteReference').length === 1;
}

function hasAncestorTag(element: Element, tagName: string): boolean {
  let current = element.parentNode;
  while (current?.nodeType === 1) {
    if ((current as Element).tagName === tagName) return true;
    current = current.parentNode;
  }
  return false;
}

function ancestorElement(element: Element, tagName: string): Element | null {
  let current = element.parentNode;
  while (current?.nodeType === 1) {
    if ((current as Element).tagName === tagName) return current as Element;
    current = current.parentNode;
  }
  return null;
}

interface FootnoteReferenceProjectionDocs {
  accepted: Document;
  rejected: Document;
}

/**
 * Require either Word's explicit deleted/inserted reference pair or a single
 * unchanged live reference. Ambiguous multiplicity and mixed wrapper shapes
 * retain collision-safe definitions rather than rewriting every matching ID.
 *
 * Endnote definition reconciliation is intentionally outside #763; endnotes
 * continue to use collision-safe renumbering and merge behavior.
 */
function hasSafeEmittedFootnoteReferenceShape(
  documentDoc: Document,
  originalId: string,
  revisedId: string,
  getProjectionDocs: () => FootnoteReferenceProjectionDocs,
): boolean {
  const original: Element[] = [];
  const revised: Element[] = [];
  const references = documentDoc.getElementsByTagName('w:footnoteReference');
  for (let i = 0; i < references.length; i++) {
    const reference = references[i] as Element;
    const id = reference.getAttribute('w:id');
    if (id === originalId) original.push(reference);
    if (id === revisedId) revised.push(reference);
  }
  const originalParagraph = original[0] ? ancestorElement(original[0], 'w:p') : null;
  const revisedParagraph = revised[0] ? ancestorElement(revised[0], 'w:p') : null;
  const pairParagraphIsUnambiguous =
    originalParagraph !== null &&
    originalParagraph === revisedParagraph &&
    originalParagraph.getElementsByTagName('w:footnoteReference').length === 2;
  const explicitPair =
    original.length === 1 &&
    revised.length === 1 &&
    pairParagraphIsUnambiguous &&
    hasAncestorTag(original[0]!, 'w:del') &&
    hasAncestorTag(revised[0]!, 'w:ins');
  const stableReference =
    original.length === 0 &&
    revised.length === 1 &&
    revisedParagraph?.getElementsByTagName('w:footnoteReference').length === 1 &&
    !hasAncestorTag(revised[0]!, 'w:del') &&
    !hasAncestorTag(revised[0]!, 'w:ins');
  if (explicitPair || stableReference) return true;
  if (original.length !== 1 || revised.length !== 1 || !pairParagraphIsUnambiguous) return false;

  const { accepted, rejected } = getProjectionDocs();
  const count = (doc: Document, id: string): number => {
    let matches = 0;
    const refs = doc.getElementsByTagName('w:footnoteReference');
    for (let i = 0; i < refs.length; i++) {
      if ((refs[i] as Element).getAttribute('w:id') === id) matches++;
    }
    return matches;
  };
  return count(accepted, originalId) === 0 &&
    count(accepted, revisedId) === 1 &&
    count(rejected, originalId) === 1 &&
    count(rejected, revisedId) === 0;
}

function footnoteDefinitionPairRequiresCollisionSafeFallback(
  originalEntry: Element,
  revisedEntry: Element,
): boolean {
  if (
    footnoteDefinitionRequiresCollisionSafeFallback(originalEntry) ||
    footnoteDefinitionRequiresCollisionSafeFallback(revisedEntry)
  ) return true;
  const blockKinds = (entry: Element): string[] => childElements(entry)
    .filter((child) => ['p', 'tbl'].includes(child.localName))
    .map((child) => child.localName);
  const originalBlocks = blockKinds(originalEntry);
  const revisedBlocks = blockKinds(revisedEntry);
  const maximum = Math.max(originalBlocks.length, revisedBlocks.length);
  for (let index = 0; index < maximum; index++) {
    const originalKind = originalBlocks[index];
    const revisedKind = revisedBlocks[index];
    if (originalKind !== revisedKind && (originalKind === 'tbl' || revisedKind === 'tbl')) {
      return true;
    }
  }
  return false;
}

export function footnoteDefinitionRequiresCollisionSafeFallback(entry: Element): boolean {
  const unsupportedTags = [
    'w:fldChar',
    'w:fldSimple',
    'w:hyperlink',
    'w:commentReference',
    'w:commentRangeStart',
    'w:commentRangeEnd',
    'w:footnoteReference',
    'w:endnoteReference',
  ];
  if (unsupportedTags.some((tag) => entry.getElementsByTagName(tag).length > 0)) return true;
  const elements = [entry, ...Array.from(entry.getElementsByTagName('*'))] as Element[];
  return elements.some((element) => {
    for (let index = 0; index < element.attributes.length; index++) {
      const attribute = element.attributes.item(index)!;
      if (
        attribute.namespaceURI === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' ||
        attribute.name.startsWith('r:')
      ) return true;
    }
    return false;
  });
}

/**
 * Collect reference IDs across every result story that can host anchors: the
 * merged document.xml plus the result archive's footnote/endnote parts (Word
 * allows comments anchored on note text). `excludePartPath` skips the part
 * whose own definitions are being merged — entries can't reference
 * themselves.
 */
async function collectStoryReferenceIds(
  resultArchive: DocxArchive,
  documentXml: string,
  referenceTag: string,
  excludePartPath: string | null,
): Promise<Set<string>> {
  const ids = collectReferenceIds(documentXml, referenceTag);
  for (const storyPath of ['word/footnotes.xml', 'word/endnotes.xml']) {
    if (storyPath === excludePartPath) continue;
    const storyXml = await resultArchive.getFile(storyPath);
    if (!storyXml) continue;
    for (const id of collectReferenceIds(storyXml, referenceTag)) ids.add(id);
  }
  return ids;
}

/**
 * Collect reference IDs from document.xml using DOM parsing.
 */
function collectReferenceIds(documentXml: string, referenceTag: string): Set<string> {
  const ids = new Set<string>();
  const doc = parseXml(documentXml);
  const refs = doc.getElementsByTagName(referenceTag);
  for (let i = 0; i < refs.length; i++) {
    const id = (refs[i] as Element).getAttribute('w:id');
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Merge auxiliary part definitions (footnotes, endnotes, comments) from the
 * source archive into the result archive. The source archive is whichever
 * side reconstruction may have introduced references to: original in inplace
 * mode (deleted-but-referenced definitions), revised in rebuild mode
 * (added-but-referenced definitions).
 */
async function mergeAuxiliaryPartDefinitions(
  sourceArchive: DocxArchive,
  resultArchive: DocxArchive,
  documentXml: string,
  descriptor: AuxiliaryPartDescriptor,
): Promise<AuxiliaryMergeResult> {
  const result: AuxiliaryMergeResult = { mergedIds: new Set(), createdPart: false };

  // Anchors may live in the merged body or on note text in the result's
  // footnote/endnote stories. AUXILIARY_PARTS merges notes before comments,
  // so by the comment pass the note stories already carry any merged-in
  // comment anchors.
  const referencedIds = await collectStoryReferenceIds(
    resultArchive, documentXml, descriptor.referenceTag, descriptor.partPath
  );
  if (referencedIds.size === 0) return result;

  const resultPartXml = await resultArchive.getFile(descriptor.partPath);
  const resultParsed = resultPartXml ? parseEntries(resultPartXml, descriptor.entryTag) : null;
  const missingIds = [...referencedIds].filter((id) => !resultParsed?.entries.has(id));
  if (missingIds.length === 0) return result;

  const sourcePartXml = await sourceArchive.getFile(descriptor.partPath);
  if (!sourcePartXml) return result;
  const sourceParsed = parseEntries(sourcePartXml, descriptor.entryTag);

  // Find missing entries: referenced in document.xml but not in result
  const missingElements: Element[] = [];
  for (const id of missingIds) {
    if (sourceParsed.entries.has(id)) {
      missingElements.push(sourceParsed.entries.get(id)!);
      result.mergedIds.add(id);
    }
  }

  if (missingElements.length === 0) return result;

  if (resultPartXml && resultParsed) {
    // Insert missing entries into existing result part
    const rootEl = resultParsed.doc.getElementsByTagName(descriptor.rootTag)[0] as Element;
    if (rootEl) {
      for (const el of missingElements) {
        const imported = resultParsed.doc.importNode(el, true);
        rootEl.appendChild(imported);
      }
      resultArchive.setFile(descriptor.partPath, serializer.serializeToString(resultParsed.doc));
    }
  } else {
    // Create part from scratch: clone root from merge source, drop every
    // non-reserved entry, then append the missing referenced ones.
    // Reserved entries are footnote/endnote separators identified by
    // w:type="separator" / w:type="continuationSeparator" — Word expects
    // them to exist and they don't carry user content. Filtering by w:type
    // (not by magic w:id values) keeps this robust across authoring tools.
    const newDoc = parseXml(sourcePartXml);
    const rootEl = newDoc.getElementsByTagName(descriptor.rootTag)[0] as Element;
    if (rootEl) {
      const existingEntries = rootEl.getElementsByTagName(descriptor.entryTag);
      const toRemove: Element[] = [];
      for (let i = 0; i < existingEntries.length; i++) {
        const el = existingEntries[i] as Element;
        const type = el.getAttribute('w:type');
        if (type !== 'separator' && type !== 'continuationSeparator') {
          toRemove.push(el);
        }
      }
      for (const el of toRemove) {
        rootEl.removeChild(el);
      }
      for (const el of missingElements) {
        const imported = newDoc.importNode(el, true);
        rootEl.appendChild(imported);
      }
      resultArchive.setFile(descriptor.partPath, serializer.serializeToString(newDoc));
      result.createdPart = true;

      await ensureOpcMetadata(resultArchive, descriptor);
    }
  }

  return result;
}

// =============================================================================
// OPC Metadata Bootstrapping
// =============================================================================

const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/**
 * Ensure [Content_Types].xml and document.xml.rels have entries for a
 * newly-created auxiliary part.
 */
async function ensureOpcMetadata(
  archive: DocxArchive,
  descriptor: AuxiliaryPartDescriptor,
): Promise<void> {
  // 1. Update [Content_Types].xml
  const ctXml = await archive.getFile('[Content_Types].xml');
  if (ctXml) {
    const ctDoc = parseXml(ctXml);
    const typesEl = ctDoc.documentElement;
    const overrides = typesEl.getElementsByTagNameNS(CT_NS, 'Override');
    const partName = `/${descriptor.partPath}`;

    let found = false;
    for (let i = 0; i < overrides.length; i++) {
      if ((overrides[i] as Element).getAttribute('PartName') === partName) {
        found = true;
        break;
      }
    }

    if (!found) {
      const override = ctDoc.createElementNS(CT_NS, 'Override');
      override.setAttribute('PartName', partName);
      override.setAttribute('ContentType', descriptor.contentType);
      typesEl.appendChild(override);
      archive.setFile('[Content_Types].xml', serializer.serializeToString(ctDoc));
    }
  }

  // 2. Update word/_rels/document.xml.rels
  const relsPath = 'word/_rels/document.xml.rels';
  const relsXml = await archive.getFile(relsPath);
  if (relsXml) {
    const relsDoc = parseXml(relsXml);
    const relsEl = relsDoc.documentElement;
    const existingRels = relsEl.getElementsByTagNameNS(REL_NS, 'Relationship');

    let found = false;
    let maxId = 0;
    for (let i = 0; i < existingRels.length; i++) {
      const rel = existingRels[i] as Element;
      if (rel.getAttribute('Type') === descriptor.relationshipType) {
        found = true;
      }
      const id = rel.getAttribute('Id') ?? '';
      const idMatch = /^rId(\d+)$/.exec(id);
      if (idMatch) maxId = Math.max(maxId, parseInt(idMatch[1]!, 10));
    }

    if (!found) {
      maxId++;
      const rel = relsDoc.createElementNS(REL_NS, 'Relationship');
      rel.setAttribute('Id', `rId${maxId}`);
      rel.setAttribute('Type', descriptor.relationshipType);
      rel.setAttribute('Target', descriptor.partPath.replace('word/', ''));
      relsEl.appendChild(rel);
      archive.setFile(relsPath, serializer.serializeToString(relsDoc));
    }
  }
}

// =============================================================================
// Hyperlink Relationship Merging (issue #376)
//
// Rebuild output is cloned from the ORIGINAL archive, so a hyperlink inserted
// or retargeted by the revision references an r:id that resolves only in the
// REVISED package. These helpers ship the revised destination into the output's
// document.xml.rels — reusing an original relationship that already points at
// the same target, or allocating a fresh collision-free id — mirroring the
// copy-if-missing convention used for auxiliary parts (issue #94).
// =============================================================================

// =============================================================================
// Comment Ancillary Parts Merging
// =============================================================================

/**
 * Walk the comment reply graph from each root referenced in the result
 * document, merging reply <w:comment> entries, their commentsExtended.xml
 * threading entries, and people.xml authors. Replies have no
 * <w:commentReference> in document.xml — they're discoverable only via
 * w15:paraIdParent in commentsExtended.xml. Without this expansion, rebuild
 * mode silently drops reply threads (issue #108).
 */
async function mergeCommentAncillaryParts(
  sourceArchive: DocxArchive,
  resultArchive: DocxArchive,
  rootCommentIds: Set<string>,
): Promise<void> {
  const sourceCommentsXml = await sourceArchive.getFile('word/comments.xml');
  if (!sourceCommentsXml) return;

  const sourceDoc = parseXml(sourceCommentsXml);

  // Build full source comment maps. The threading key is the comment's LAST
  // content paragraph's w14:paraId — Word keys its w15:commentEx and
  // w16cid:commentId rows by that paragraph, not the first one, for
  // multi-paragraph comments (Word extension-part behavior, [MS-DOCX]).
  // getCommentAncillaryParaId() falls back to the first <w:p> when the last
  // carries no paraId, so single-paragraph comments (first == last, the common
  // case) are unaffected.
  const commentById = new Map<string, Element>();
  const paraIdByCommentId = new Map<string, string>();
  const commentIdByParaId = new Map<string, string>();
  const authorByCommentId = new Map<string, string>();
  const allCommentEls = sourceDoc.getElementsByTagName('w:comment');
  for (let i = 0; i < allCommentEls.length; i++) {
    const el = allCommentEls[i] as Element;
    const id = el.getAttribute('w:id');
    if (!id) continue;
    commentById.set(id, el);
    const author = el.getAttribute('w:author');
    if (author) authorByCommentId.set(id, author);
    const paraId = getCommentAncillaryParaId(el);
    if (paraId) {
      paraIdByCommentId.set(id, paraId);
      commentIdByParaId.set(paraId, id);
    }
  }

  // Seed inclusion sets from the root IDs that appear in the result document.
  const includedCommentIds = new Set<string>();
  const includedParaIds = new Set<string>();
  const includedAuthors = new Set<string>();
  for (const id of rootCommentIds) {
    if (!commentById.has(id)) continue;
    includedCommentIds.add(id);
    const pid = paraIdByCommentId.get(id);
    if (pid) includedParaIds.add(pid);
    const author = authorByCommentId.get(id);
    if (author) includedAuthors.add(author);
  }

  // BFS over commentsExtended.xml's paraIdParent graph from each included
  // root paraId. Skip entries that don't resolve to a real source comment so
  // we never pull in dangling commentEx/people without a backing definition.
  const sourceExtendedXml = await sourceArchive.getFile('word/commentsExtended.xml');
  if (sourceExtendedXml) {
    const exDoc = parseXml(sourceExtendedXml);
    const exEls = exDoc.getElementsByTagName('w15:commentEx');
    const childrenOf = new Map<string, string[]>();
    for (let i = 0; i < exEls.length; i++) {
      const ex = exEls[i] as Element;
      const childPid = ex.getAttribute('w15:paraId');
      const parentPid = ex.getAttribute('w15:paraIdParent');
      if (!childPid || !parentPid) continue;
      const arr = childrenOf.get(parentPid);
      if (arr) arr.push(childPid);
      else childrenOf.set(parentPid, [childPid]);
    }

    const queue: string[] = [...includedParaIds];
    while (queue.length > 0) {
      const pid = queue.shift()!;
      const children = childrenOf.get(pid);
      if (!children) continue;
      for (const childPid of children) {
        if (includedParaIds.has(childPid)) continue;
        const childCommentId = commentIdByParaId.get(childPid);
        if (!childCommentId) continue;
        includedParaIds.add(childPid);
        includedCommentIds.add(childCommentId);
        const author = authorByCommentId.get(childCommentId);
        if (author) includedAuthors.add(author);
        queue.push(childPid);
      }
    }
  }

  // Append any reply <w:comment> definitions still missing from result.
  // The generic merge already added roots when needed; we add the replies
  // (and any roots not yet present in the result, defensively).
  await mergeMissingCommentDefinitions(resultArchive, commentById, includedCommentIds);

  // Merge commentsExtended, commentsIds, and people for the expanded set.
  await mergeCommentsExtended(sourceArchive, resultArchive, includedParaIds);
  await mergeCommentsIds(sourceArchive, resultArchive, includedParaIds);
  await mergePeople(sourceArchive, resultArchive, includedAuthors);
}

/**
 * Return the w14:paraId Word uses to key a comment's ancillary threading rows
 * (w15:commentEx in commentsExtended.xml, w16cid:commentId in commentsIds.xml).
 *
 * Word keys those rows by the comment's LAST content paragraph's paraId, not
 * the first — so for a multi-paragraph comment the first-paragraph paraId used
 * elsewhere (e.g. getCommentElParaId() in primitives/comments.ts) would miss
 * the row and drop reply/thread metadata on merge (issue #470). This is a Word
 * extension-part convention ([MS-DOCX] w15/w16cid), outside the base OOXML
 * wordprocessingml schema.
 *
 * Falls back to the first <w:p> paraId when the last paragraph carries none, so
 * single-paragraph comments (first === last, the common case) resolve exactly
 * as before.
 */
function getCommentAncillaryParaId(commentEl: Element): string | null {
  const paras = commentEl.getElementsByTagName('w:p');
  let firstParaId: string | null = null;
  for (let i = 0; i < paras.length; i++) {
    const pid = (paras[i] as Element).getAttribute('w14:paraId');
    if (pid && firstParaId === null) firstParaId = pid;
  }
  // Walk backwards for the last paragraph that carries a paraId.
  for (let i = paras.length - 1; i >= 0; i--) {
    const pid = (paras[i] as Element).getAttribute('w14:paraId');
    if (pid) return pid;
  }
  return firstParaId;
}

/**
 * Append any source <w:comment> definitions in `includedCommentIds` that
 * aren't already in result/word/comments.xml. Mirrors the append-with-importNode
 * pattern used by mergeCommentsExtended below.
 */
async function mergeMissingCommentDefinitions(
  resultArchive: DocxArchive,
  commentById: Map<string, Element>,
  includedCommentIds: Set<string>,
): Promise<void> {
  if (includedCommentIds.size === 0) return;
  const resultXml = await resultArchive.getFile('word/comments.xml');
  if (!resultXml) {
    // If result has no comments.xml at all, the generic merge would have
    // bootstrapped it for any included root. Nothing to do here.
    return;
  }
  const resultDoc = parseXml(resultXml);
  const rootEl = resultDoc.documentElement;

  const existingIds = new Set<string>();
  const existing = rootEl.getElementsByTagName('w:comment');
  for (let i = 0; i < existing.length; i++) {
    const id = (existing[i] as Element).getAttribute('w:id');
    if (id) existingIds.add(id);
  }

  let appended = false;
  for (const id of includedCommentIds) {
    if (existingIds.has(id)) continue;
    const sourceEl = commentById.get(id);
    if (!sourceEl) continue;
    rootEl.appendChild(resultDoc.importNode(sourceEl, true));
    appended = true;
  }

  if (appended) {
    resultArchive.setFile('word/comments.xml', serializer.serializeToString(resultDoc));
  }
}

async function mergeCommentsExtended(
  sourceArchive: DocxArchive,
  resultArchive: DocxArchive,
  mergedParaIds: Set<string>,
): Promise<void> {
  if (mergedParaIds.size === 0) return;

  const sourceXml = await sourceArchive.getFile('word/commentsExtended.xml');
  if (!sourceXml) return;

  const sourceDoc = parseXml(sourceXml);
  const sourceEntries = sourceDoc.getElementsByTagName('w15:commentEx');

  // Collect entries whose paraId matches a merged comment's paragraph
  const entriesToMerge: Element[] = [];
  for (let i = 0; i < sourceEntries.length; i++) {
    const el = sourceEntries[i] as Element;
    const paraId = el.getAttribute('w15:paraId');
    if (paraId && mergedParaIds.has(paraId)) {
      entriesToMerge.push(el);
    }
  }

  if (entriesToMerge.length === 0) return;

  const resultXml = await resultArchive.getFile('word/commentsExtended.xml');

  if (resultXml) {
    const resultDoc = parseXml(resultXml);
    const rootEl = resultDoc.documentElement;

    const existingParaIds = new Set<string>();
    const existing = rootEl.getElementsByTagName('w15:commentEx');
    for (let i = 0; i < existing.length; i++) {
      const pid = (existing[i] as Element).getAttribute('w15:paraId');
      if (pid) existingParaIds.add(pid);
    }

    for (const el of entriesToMerge) {
      const pid = el.getAttribute('w15:paraId');
      if (pid && !existingParaIds.has(pid)) {
        rootEl.appendChild(resultDoc.importNode(el, true));
      }
    }

    resultArchive.setFile('word/commentsExtended.xml', serializer.serializeToString(resultDoc));
    return;
  }

  // Bootstrap: result lacks commentsExtended.xml but the merged comments
  // depend on it for reply threading / done state. Clone the source's root
  // (preserves namespaces), drop non-matching entries, then add OPC metadata.
  const newDoc = parseXml(sourceXml);
  const newRoot = newDoc.documentElement;
  const allEntries = newRoot.getElementsByTagName('w15:commentEx');
  const toRemove: Element[] = [];
  for (let i = 0; i < allEntries.length; i++) {
    const el = allEntries[i] as Element;
    const paraId = el.getAttribute('w15:paraId');
    if (!paraId || !mergedParaIds.has(paraId)) toRemove.push(el);
  }
  for (const el of toRemove) newRoot.removeChild(el);
  resultArchive.setFile('word/commentsExtended.xml', serializer.serializeToString(newDoc));
  await ensureOpcMetadata(resultArchive, COMMENTS_EXTENDED_DESCRIPTOR);
}

const COMMENTS_EXTENDED_DESCRIPTOR: AuxiliaryPartDescriptor = {
  label: 'commentsExtended',
  partPath: 'word/commentsExtended.xml',
  referenceTag: '',
  entryTag: 'w15:commentEx',
  rootTag: 'w15:commentsEx',
  contentType: 'application/vnd.ms-word.commentsExtended+xml',
  relationshipType: 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended',
  idBearingTags: [], // keyed by w15:paraId, not w:id
};

const COMMENTS_IDS_DESCRIPTOR: AuxiliaryPartDescriptor = {
  label: 'commentsIds',
  partPath: 'word/commentsIds.xml',
  referenceTag: '',
  entryTag: 'w16cid:commentId',
  rootTag: 'w16cid:commentsIds',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml',
  relationshipType: 'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds',
  idBearingTags: [], // keyed by w16cid:paraId, not w:id
};

/**
 * Merge the merge-source side's commentsIds.xml durable-ID rows for the
 * expanded comment set. commentsIds.xml ([MS-DOCX]) keys each
 * <w16cid:commentId> by the comment paragraph's w16cid:paraId — the same
 * paraIds threaded through commentsExtended.xml — so merged-in comments retain
 * their Word durable IDs instead of forcing Word to regenerate them (issue
 * #471). Mirrors mergeCommentsExtended's append/bootstrap shape.
 */
async function mergeCommentsIds(
  sourceArchive: DocxArchive,
  resultArchive: DocxArchive,
  mergedParaIds: Set<string>,
): Promise<void> {
  if (mergedParaIds.size === 0) return;

  const sourceXml = await sourceArchive.getFile('word/commentsIds.xml');
  if (!sourceXml) return;

  const sourceDoc = parseXml(sourceXml);
  const sourceEntries = sourceDoc.getElementsByTagName('w16cid:commentId');

  // Collect rows whose paraId matches a merged comment's paragraph.
  const entriesToMerge: Element[] = [];
  for (let i = 0; i < sourceEntries.length; i++) {
    const el = sourceEntries[i] as Element;
    const paraId = el.getAttribute('w16cid:paraId');
    if (paraId && mergedParaIds.has(paraId)) {
      entriesToMerge.push(el);
    }
  }

  if (entriesToMerge.length === 0) return;

  const resultXml = await resultArchive.getFile('word/commentsIds.xml');

  if (resultXml) {
    const resultDoc = parseXml(resultXml);
    const rootEl = resultDoc.documentElement;

    const existingParaIds = new Set<string>();
    const existing = rootEl.getElementsByTagName('w16cid:commentId');
    for (let i = 0; i < existing.length; i++) {
      const pid = (existing[i] as Element).getAttribute('w16cid:paraId');
      if (pid) existingParaIds.add(pid);
    }

    for (const el of entriesToMerge) {
      const pid = el.getAttribute('w16cid:paraId');
      if (pid && !existingParaIds.has(pid)) {
        rootEl.appendChild(resultDoc.importNode(el, true));
      }
    }

    resultArchive.setFile('word/commentsIds.xml', serializer.serializeToString(resultDoc));
    return;
  }

  // Bootstrap: result lacks commentsIds.xml but the merged comments carry
  // durable IDs. Clone the source's root (preserves namespaces), drop
  // non-matching rows, then add OPC metadata.
  const newDoc = parseXml(sourceXml);
  const newRoot = newDoc.documentElement;
  const allEntries = newRoot.getElementsByTagName('w16cid:commentId');
  const toRemove: Element[] = [];
  for (let i = 0; i < allEntries.length; i++) {
    const el = allEntries[i] as Element;
    const paraId = el.getAttribute('w16cid:paraId');
    if (!paraId || !mergedParaIds.has(paraId)) toRemove.push(el);
  }
  for (const el of toRemove) newRoot.removeChild(el);
  resultArchive.setFile('word/commentsIds.xml', serializer.serializeToString(newDoc));
  await ensureOpcMetadata(resultArchive, COMMENTS_IDS_DESCRIPTOR);
}

const PEOPLE_DESCRIPTOR: AuxiliaryPartDescriptor = {
  label: 'people',
  partPath: 'word/people.xml',
  referenceTag: '',
  entryTag: 'w15:person',
  rootTag: 'w15:people',
  contentType: 'application/vnd.ms-word.people+xml',
  relationshipType: 'http://schemas.microsoft.com/office/2011/relationships/people',
  idBearingTags: [], // keyed by w15:author, not w:id
};

async function mergePeople(
  sourceArchive: DocxArchive,
  resultArchive: DocxArchive,
  mergedAuthors: Set<string>,
): Promise<void> {
  if (mergedAuthors.size === 0) return;

  const sourceXml = await sourceArchive.getFile('word/people.xml');
  if (!sourceXml) return;

  const sourceDoc = parseXml(sourceXml);
  const sourcePersons = sourceDoc.getElementsByTagName('w15:person');

  const personsToMerge: Element[] = [];
  for (let i = 0; i < sourcePersons.length; i++) {
    const el = sourcePersons[i] as Element;
    const author = el.getAttribute('w15:author');
    if (author && mergedAuthors.has(author)) {
      personsToMerge.push(el);
    }
  }

  if (personsToMerge.length === 0) return;

  const resultXml = await resultArchive.getFile('word/people.xml');

  if (resultXml) {
    const resultDoc = parseXml(resultXml);
    const rootEl = resultDoc.documentElement;

    const existingAuthors = new Set<string>();
    const existing = rootEl.getElementsByTagName('w15:person');
    for (let i = 0; i < existing.length; i++) {
      const a = (existing[i] as Element).getAttribute('w15:author');
      if (a) existingAuthors.add(a);
    }

    for (const el of personsToMerge) {
      const a = el.getAttribute('w15:author');
      if (a && !existingAuthors.has(a)) {
        rootEl.appendChild(resultDoc.importNode(el, true));
      }
    }

    resultArchive.setFile('word/people.xml', serializer.serializeToString(resultDoc));
    return;
  }

  // Bootstrap: result lacks people.xml. Clone source root (preserves
  // namespaces), remove non-matching authors, then add OPC metadata.
  const newDoc = parseXml(sourceXml);
  const newRoot = newDoc.documentElement;
  const allPersons = newRoot.getElementsByTagName('w15:person');
  const toRemove: Element[] = [];
  for (let i = 0; i < allPersons.length; i++) {
    const el = allPersons[i] as Element;
    const author = el.getAttribute('w15:author');
    if (!author || !mergedAuthors.has(author)) toRemove.push(el);
  }
  for (const el of toRemove) newRoot.removeChild(el);
  resultArchive.setFile('word/people.xml', serializer.serializeToString(newDoc));
  await ensureOpcMetadata(resultArchive, PEOPLE_DESCRIPTOR);
}
