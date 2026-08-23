import { createHash } from 'node:crypto';
import {
  checkGeneratedPackage,
  collectFieldStructureIssues,
  parseXml,
  REVISION_ID_ELEMENT_NAMES,
  validateBookmarkIntegrity,
} from '@usejunior/docx-core';
import JSZip from 'jszip';
import type {
  CompareStats,
  UnrepresentedChange,
} from '../compare-types.js';
import { compareDocumentsAtomizer } from '../tagged/pipeline.js';
import { compareSourceProjectedFormattingFidelity } from '../tagged/formattingFidelity.js';
import {
  acceptAllChanges,
  rejectAllChanges,
} from '../tagged/trackChangesAcceptorAst.js';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';

const AUTHOR = 'Strategy Differential';
const DATE = new Date('2026-08-17T12:00:00Z');
const XML_PART_PATTERN = /(?:\.xml|\.rels)$/u;
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
type TaggedStrategy = 'tagged-tree';

export interface StrategyDifferentialFixture {
  id: string;
  original: Buffer;
  revised: Buffer;
  capabilityTags: string[];
  expectedPackageParts?: string[];
  approvedDivergenceIds?: string[];
}

export type ApprovedDivergenceDimension =
  | 'tagged-tree.acceptProjection'
  | 'tagged-tree.rejectProjection'
  | 'tagged-tree.formattingFidelity';

export interface PackagePartSummary {
  path: string;
  bytes: number;
  sha256: string;
  kind: 'xml' | 'binary';
}

export interface ProjectionSummary {
  xmlSha256: string;
  textSha256: string;
  sourceTextSha256: string;
  matchesSourceText: boolean;
  firstDifference: {
    index: number;
    projectedLength: number;
    sourceLength: number;
    projectedCodePoint: number | null;
    sourceCodePoint: number | null;
  } | null;
}

export interface StrategyEvidence {
  strategy: TaggedStrategy;
  projections: {
    accept: ProjectionSummary;
    reject: ProjectionSummary;
  };
  packageParts: PackagePartSummary[];
  stats: CompareStats;
  authority: {
    comparisonStrategyUsed?: TaggedStrategy;
  };
  unrepresentedChanges: UnrepresentedChange[];
  schema: {
    packageStructural: 'passed' | 'inherited' | 'failed';
    issues: Array<{ check: string; part: string; message: string }>;
    introducedIssues: Array<{ check: string; part: string; message: string }>;
  };
  formatting: {
    score: number;
    acceptScore: number;
    rejectScore: number;
    acceptDivergences: number;
    rejectDivergences: number;
  };
  closure: {
    relationshipIssues: string[];
    auxiliaryDefinitionIssues: string[];
  };
  integrity: {
    fieldIssues: string[];
    bookmarkIssues: string[];
    revisionIdIssues: string[];
    moveBalanceIssues: string[];
  };
  unsupportedStoryDiagnostics: string[];
}

export interface StrategyDifferentialRow {
  fixture: {
    id: string;
    pairSha256: string;
    originalSha256: string;
    revisedSha256: string;
    capabilityTags: string[];
    sourcePackageParts: string[];
    sourceStructuralIssues: Array<{ check: string; part: string; message: string }>;
  };
  approvedDivergenceIds: string[];
  taggedTree: StrategyEvidence;
}

export function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizePart(path: string, value: Buffer): Buffer | string {
  if (!XML_PART_PATTERN.test(path)) return value;
  return value.toString('utf8').replaceAll('\r\n', '\n');
}

async function readPackage(buffer: Buffer): Promise<Map<string, Buffer>> {
  const zip = await JSZip.loadAsync(buffer);
  const parts = new Map<string, Buffer>();
  for (const path of Object.keys(zip.files).sort()) {
    const entry = zip.files[path];
    if (!entry || entry.dir) continue;
    parts.set(path, await entry.async('nodebuffer'));
  }
  return parts;
}

async function packagePartSummaries(buffer: Buffer): Promise<PackagePartSummary[]> {
  const parts = await readPackage(buffer);
  return Array.from(parts, ([path, value]) => {
    const normalized = normalizePart(path, value);
    return {
      path,
      bytes: Buffer.byteLength(normalized),
      sha256: sha256(normalized),
      kind: XML_PART_PATTERN.test(path) ? 'xml' as const : 'binary' as const,
    };
  });
}

async function documentXml(buffer: Buffer): Promise<string> {
  const parts = await readPackage(buffer);
  const value = parts.get('word/document.xml');
  if (!value) throw new Error('DOCX has no word/document.xml');
  return value.toString('utf8');
}

function projectionSummary(candidateXml: string, sourceXml: string): ProjectionSummary {
  const candidateText = extractRoundTripComparisonText(candidateXml);
  const sourceText = extractRoundTripComparisonText(sourceXml);
  let firstDifferenceIndex = -1;
  const sharedLength = Math.min(candidateText.length, sourceText.length);
  for (let index = 0; index < sharedLength; index++) {
    if (candidateText[index] !== sourceText[index]) {
      firstDifferenceIndex = index;
      break;
    }
  }
  if (firstDifferenceIndex < 0 && candidateText.length !== sourceText.length) {
    firstDifferenceIndex = sharedLength;
  }
  return {
    xmlSha256: sha256(candidateXml),
    textSha256: sha256(candidateText),
    sourceTextSha256: sha256(sourceText),
    matchesSourceText: candidateText === sourceText,
    firstDifference: firstDifferenceIndex < 0
      ? null
      : {
          index: firstDifferenceIndex,
          projectedLength: candidateText.length,
          sourceLength: sourceText.length,
          projectedCodePoint: candidateText.codePointAt(firstDifferenceIndex) ?? null,
          sourceCodePoint: sourceText.codePointAt(firstDifferenceIndex) ?? null,
        },
  };
}

function ids(xml: string | undefined, definitionTag: string): Set<string> {
  if (!xml) return new Set();
  const document = parseXml(xml);
  return new Set(
    Array.from(document.getElementsByTagName(definitionTag))
      .map((element) => element.getAttribute('w:id'))
      .filter((value): value is string => value !== null),
  );
}

function referencedIds(parts: Map<string, Buffer>, referenceTag: string): Set<string> {
  const found = new Set<string>();
  for (const [path, value] of parts) {
    if (!path.startsWith('word/') || !path.endsWith('.xml')) continue;
    const document = parseXml(value.toString('utf8'));
    for (const element of Array.from(document.getElementsByTagName(referenceTag))) {
      const id = element.getAttribute('w:id');
      if (id) found.add(id);
    }
  }
  return found;
}

async function auxiliaryDefinitionIssues(buffer: Buffer): Promise<string[]> {
  const parts = await readPackage(buffer);
  const configurations = [
    ['comment', 'w:commentReference', 'word/comments.xml', 'w:comment'],
    ['footnote', 'w:footnoteReference', 'word/footnotes.xml', 'w:footnote'],
    ['endnote', 'w:endnoteReference', 'word/endnotes.xml', 'w:endnote'],
  ] as const;
  const issues: string[] = [];
  for (const [kind, referenceTag, definitionPath, definitionTag] of configurations) {
    const references = referencedIds(parts, referenceTag);
    const definitions = ids(parts.get(definitionPath)?.toString('utf8'), definitionTag);
    for (const id of references) {
      if (!definitions.has(id)) issues.push(`${kind}:${id}:missing-definition`);
    }
  }
  return issues.sort();
}

function structuralIssueKey(issue: { check: string; part: string; message: string }): string {
  return `${issue.check}\u0000${issue.part}\u0000${issue.message}`;
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function bookmarkNames(xml: string): string[] {
  const document = parseXml(xml);
  return Array.from(document.getElementsByTagNameNS(W_NS, 'bookmarkStart'))
    .map((element) => element.getAttributeNS(W_NS, 'name') ?? element.getAttribute('w:name'))
    .filter((name): name is string => name !== null)
    .sort();
}

function bookmarkStructuralIssues(xml: string): string[] {
  const diagnostics = validateBookmarkIntegrity(xml);
  return [
    ...diagnostics.unmatchedStartIds.map((id) => `unmatched-start:${id}`),
    ...diagnostics.unmatchedEndIds.map((id) => `unmatched-end:${id}`),
    ...diagnostics.duplicateStartIds.map((id) => `duplicate-start-id:${id}`),
    ...diagnostics.duplicateEndIds.map((id) => `duplicate-end-id:${id}`),
    ...duplicateValues(bookmarkNames(xml)).map((name) => `duplicate-name:${name}`),
  ].sort();
}

function bookmarkIntegrityIssues(
  candidateXml: string,
  acceptedXml: string,
  rejectedXml: string,
  originalXml: string,
  revisedXml: string,
): string[] {
  const issues: string[] = [];
  const originalIssues = new Set(bookmarkStructuralIssues(rejectAllChanges(originalXml)));
  const revisedIssues = new Set(bookmarkStructuralIssues(acceptAllChanges(revisedXml)));
  // Compatibility hoists range boundaries out of revision wrappers so Word
  // retains their position. A malformed source boundary can consequently
  // remain visible in both projections. Treat that defect as inherited no
  // matter which source authored it, while still failing every anomaly absent
  // from both inputs (including comparison-generated duplicate names).
  const inheritedIssues = new Set([...originalIssues, ...revisedIssues]);
  for (const [label, xml, inherited] of [
    ['combined', candidateXml, inheritedIssues],
    ['accept', acceptedXml, inheritedIssues],
    ['reject', rejectedXml, inheritedIssues],
  ] as const) {
    for (const issue of bookmarkStructuralIssues(xml)) {
      if (!inherited.has(issue)) issues.push(`${label}:${issue}`);
    }
  }
  // Hoisting and projection-safe source renames may intentionally change which
  // internal name carries a range. Exact source-inventory equality is therefore
  // not a safety invariant. Newly introduced unbalanced IDs and duplicate names,
  // plus resolvable field targets, remain asserted on combined/projected markup;
  // pre-existing source defects stay visible in fixture structural evidence.
  return issues.sort();
}

interface RevisionIdentity {
  element: string;
  id: string;
  author: string;
  date: string;
  scope: string;
}

const FORMATTING_PROPERTY_CHANGE_ELEMENTS = new Set([
  'pPrChange', 'rPrChange', 'sectPrChange', 'tblPrChange', 'tblPrExChange',
  'trPrChange', 'tcPrChange', 'tblGridChange', 'numberingChange',
]);

function revisionIdentitySignature(identity: RevisionIdentity): string {
  // One logical formatting edit can require several OOXML property-change
  // records (for example pPrChange + nested sectPrChange, or pPrChange +
  // rPrChange for the paragraph mark). The tagged emitter intentionally gives
  // those facets one ID; consumer-compatibility guards uniqueness within each
  // element kind while preserving this cross-kind property-change pairing.
  const element = FORMATTING_PROPERTY_CHANGE_ELEMENTS.has(identity.element)
    ? 'formatting-property-change'
    : identity.element;
  return `${element}\u0000${identity.author}\u0000${identity.date}\u0000${identity.scope}`;
}

function revisionIdentities(xml: string): RevisionIdentity[] {
  const document = parseXml(xml);
  const rangeNames = new Set([
    'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd',
    'customXmlInsRangeStart', 'customXmlInsRangeEnd',
    'customXmlDelRangeStart', 'customXmlDelRangeEnd',
    'customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd',
    'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd',
  ]);
  const scopeByElement = new Map<Element, string>();
  for (const scopeName of ['p', 'tc', 'tr', 'tbl'] as const) {
    for (const [index, element] of Array.from(
      document.getElementsByTagNameNS(W_NS, scopeName),
    ).entries()) {
      scopeByElement.set(element, `${scopeName}:${index}`);
    }
  }
  const scopeFor = (element: Element): string => {
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const scope = scopeByElement.get(ancestor);
      if (scope) return scope;
    }
    // Block-level revision wrappers contain rather than descend from their
    // paragraph. Anchor those identities to the first contained paragraph so
    // separate body-level revisions cannot silently reuse an ID.
    const paragraph = element.getElementsByTagNameNS(W_NS, 'p').item(0);
    return (paragraph && scopeByElement.get(paragraph)) ?? 'document';
  };
  return REVISION_ID_ELEMENT_NAMES
    .filter((name) => !rangeNames.has(name))
    .flatMap((name) => Array.from(document.getElementsByTagNameNS(W_NS, name)).map((element) => ({
      element: name,
      id: element.getAttributeNS(W_NS, 'id') ?? element.getAttribute('w:id') ?? '',
      author: element.getAttributeNS(W_NS, 'author') ?? element.getAttribute('w:author') ?? '',
      date: element.getAttributeNS(W_NS, 'date') ?? element.getAttribute('w:date') ?? '',
      scope: scopeFor(element),
    })))
    .filter((identity) => identity.id !== '');
}

export function collectRevisionIdIssues(
  candidateXml: string,
  originalXml: string,
  revisedXml: string,
): string[] {
  const issues: string[] = [];
  const sourceIdentities = [
    ...revisionIdentities(originalXml),
    ...revisionIdentities(revisedXml),
  ];
  const sourceSignaturesById = new Map<string, Set<string>>();
  for (const identity of sourceIdentities) {
    const signature = revisionIdentitySignature(identity);
    const signatures = sourceSignaturesById.get(identity.id) ?? new Set<string>();
    signatures.add(signature);
    sourceSignaturesById.set(identity.id, signatures);
  }
  const identitiesById = new Map<string, Set<string>>();

  for (const identity of revisionIdentities(candidateXml)) {
    const signature = revisionIdentitySignature(identity);
    const signatures = identitiesById.get(identity.id) ?? new Set<string>();
    signatures.add(signature);
    identitiesById.set(identity.id, signatures);
    if (
      identity.author === AUTHOR
      && sourceSignaturesById.has(identity.id)
      && !sourceSignaturesById.get(identity.id)?.has(signature)
    ) {
      issues.push(`comparison-id-collides-with-source:${identity.id}`);
    }
  }

  for (const [id, signatures] of identitiesById) {
    // Compatibility can split one logical revision across wrappers or linked
    // property-change facets. The shared ID is valid only while the normalized
    // element family and revision metadata identify that same logical revision;
    // reuse across identities is a real allocator collision.
    if (signatures.size > 1) issues.push(`revision-id-reused-across-identities:${id}`);
  }
  return [...new Set(issues)].sort();
}

function moveBalanceIssues(candidateXml: string): string[] {
  const document = parseXml(candidateXml);
  const ids = (name: string): string[] => Array.from(
    document.getElementsByTagNameNS(W_NS, name),
  ).map((element) => element.getAttributeNS(W_NS, 'id') ?? element.getAttribute('w:id'))
    .filter((id): id is string => id !== null)
    .sort();
  const issues: string[] = [];
  for (const direction of ['moveFrom', 'moveTo'] as const) {
    const starts = ids(`${direction}RangeStart`);
    const ends = ids(`${direction}RangeEnd`);
    if (JSON.stringify(starts) !== JSON.stringify(ends)) {
      issues.push(`${direction}:range-boundaries-unbalanced`);
    }
    if (duplicateValues(starts).length > 0) issues.push(`${direction}:duplicate-range-id`);
  }
  if (ids('moveFrom').length !== ids('moveTo').length) {
    issues.push('move-wrapper-count-unbalanced');
  }
  if (ids('moveFromRangeStart').length !== ids('moveToRangeStart').length) {
    issues.push('move-range-count-unbalanced');
  }
  return issues.sort();
}

async function characterizeStrategy(
  fixture: StrategyDifferentialFixture,
  originalXml: string,
  revisedXml: string,
  inheritedStructuralIssueKeys: ReadonlySet<string>,
): Promise<StrategyEvidence> {
  const result = await compareDocumentsAtomizer(fixture.original, fixture.revised, {
    author: AUTHOR,
    date: DATE,
  });
  const candidateXml = await documentXml(result.document);
  const acceptedXml = acceptAllChanges(candidateXml);
  const rejectedXml = rejectAllChanges(candidateXml);
  const formatting = compareSourceProjectedFormattingFidelity(
    originalXml,
    revisedXml,
    candidateXml,
  );
  const structural = await checkGeneratedPackage(result.document);
  const introducedStructuralIssues = structural.issues.filter(
    (issue) => !inheritedStructuralIssueKeys.has(structuralIssueKey(issue)),
  );
  const relationshipIssues = structural.issues
    .filter((issue) =>
      ['content_type_coverage', 'relationship_target', 'rid_resolution'].includes(issue.check),
    )
    .map((issue) => `${issue.check}:${issue.part}:${issue.message}`)
    .sort();
  const fieldIssues = [
    ...collectFieldStructureIssues(candidateXml).map((issue) => `combined:${issue.code}`),
    ...collectFieldStructureIssues(acceptedXml).map((issue) => `accept:${issue.code}`),
    ...collectFieldStructureIssues(rejectedXml).map((issue) => `reject:${issue.code}`),
  ].sort();

  return {
    strategy: 'tagged-tree',
    projections: {
      accept: projectionSummary(acceptedXml, revisedXml),
      reject: projectionSummary(rejectedXml, originalXml),
    },
    packageParts: await packagePartSummaries(result.document),
    stats: result.stats,
    authority: {
      comparisonStrategyUsed: result.engine,
    },
    unrepresentedChanges: result.unrepresentedChanges ?? [],
    schema: {
      packageStructural: structural.ok
        ? 'passed'
        : introducedStructuralIssues.length === 0 ? 'inherited' : 'failed',
      issues: structural.issues,
      introducedIssues: introducedStructuralIssues,
    },
    formatting: {
      score: formatting.score,
      acceptScore: formatting.accept.score,
      rejectScore: formatting.reject.score,
      acceptDivergences: formatting.accept.divergences.length,
      rejectDivergences: formatting.reject.divergences.length,
    },
    closure: {
      relationshipIssues,
      auxiliaryDefinitionIssues: await auxiliaryDefinitionIssues(result.document),
    },
    integrity: {
      fieldIssues,
      bookmarkIssues: bookmarkIntegrityIssues(
        candidateXml,
        acceptedXml,
        rejectedXml,
        originalXml,
        revisedXml,
      ),
      revisionIdIssues: collectRevisionIdIssues(candidateXml, originalXml, revisedXml),
      moveBalanceIssues: moveBalanceIssues(candidateXml),
    },
    // A successful fail-closed comparison necessarily emitted no unsupported
    // story diagnostic. Such failures are thrown instead of returned as
    // result metadata.
    unsupportedStoryDiagnostics: [],
  };
}

export async function characterizeStrategyDifferential(
  fixture: StrategyDifferentialFixture,
): Promise<StrategyDifferentialRow> {
  const [
    originalXml,
    revisedXml,
    originalParts,
    revisedParts,
    originalStructural,
    revisedStructural,
  ] = await Promise.all([
    documentXml(fixture.original),
    documentXml(fixture.revised),
    packagePartSummaries(fixture.original),
    packagePartSummaries(fixture.revised),
    checkGeneratedPackage(fixture.original),
    checkGeneratedPackage(fixture.revised),
  ]);
  const sourceStructuralIssues = [
    ...originalStructural.issues,
    ...revisedStructural.issues,
  ].filter((issue, index, issues) =>
    issues.findIndex((candidate) => structuralIssueKey(candidate) === structuralIssueKey(issue))
      === index,
  );
  const inheritedStructuralIssueKeys = new Set(sourceStructuralIssues.map(structuralIssueKey));
  const taggedTree = await characterizeStrategy(
    fixture,
    originalXml,
    revisedXml,
    inheritedStructuralIssueKeys,
  );
  // Hash normalized package contents rather than ZIP container bytes. JSZip's
  // entry timestamps are not comparison evidence and may vary when a fixture
  // is materialized without changing any OOXML or binary part.
  const originalSha256 = sha256(JSON.stringify(originalParts));
  const revisedSha256 = sha256(JSON.stringify(revisedParts));
  return {
    fixture: {
      id: fixture.id,
      pairSha256: sha256(`${originalSha256}:${revisedSha256}`),
      originalSha256,
      revisedSha256,
      capabilityTags: [...new Set(fixture.capabilityTags)].sort(),
      sourcePackageParts: [
        ...new Set([
          ...originalParts.map((part) => part.path),
          ...revisedParts.map((part) => part.path),
        ]),
      ].sort(),
      sourceStructuralIssues,
    },
    approvedDivergenceIds: [...new Set(fixture.approvedDivergenceIds ?? [])].sort(),
    taggedTree,
  };
}

export function assertCharacterizationSafety(
  row: StrategyDifferentialRow,
  approvedDimensions: ReadonlySet<ApprovedDivergenceDimension> = new Set(),
): Set<ApprovedDivergenceDimension> {
  const consumedDimensions = new Set<ApprovedDivergenceDimension>();
  for (const evidence of [row.taggedTree]) {
    if (evidence.authority.comparisonStrategyUsed !== evidence.strategy) {
      throw new Error(
        `${row.fixture.id}/${evidence.strategy} fell back to ` +
          `${String(evidence.authority.comparisonStrategyUsed)}`,
      );
    }
    const acceptDimension: ApprovedDivergenceDimension = 'tagged-tree.acceptProjection';
    const rejectDimension: ApprovedDivergenceDimension = 'tagged-tree.rejectProjection';
    if (
      !evidence.projections.accept.matchesSourceText
      && !approvedDimensions.has(acceptDimension)
    ) {
      throw new Error(`${row.fixture.id}/${evidence.strategy} accept projection drifted`);
    }
    if (!evidence.projections.accept.matchesSourceText) consumedDimensions.add(acceptDimension);
    if (
      !evidence.projections.reject.matchesSourceText
      && !approvedDimensions.has(rejectDimension)
    ) {
      throw new Error(`${row.fixture.id}/${evidence.strategy} reject projection drifted`);
    }
    if (!evidence.projections.reject.matchesSourceText) consumedDimensions.add(rejectDimension);
    if (evidence.schema.packageStructural === 'failed') {
      throw new Error(
        `${row.fixture.id}/${evidence.strategy} introduced package structural failures: ` +
          evidence.schema.introducedIssues
            .map((issue) => `${issue.check}:${issue.part}:${issue.message}`)
            .join('; '),
      );
    }
    if (evidence.closure.relationshipIssues.length > 0) {
      throw new Error(`${row.fixture.id}/${evidence.strategy} has relationship closure issues`);
    }
    if (evidence.closure.auxiliaryDefinitionIssues.length > 0) {
      throw new Error(`${row.fixture.id}/${evidence.strategy} has auxiliary definition issues`);
    }
    if (
      evidence.formatting.score !== 1 &&
      !approvedDimensions.has('tagged-tree.formattingFidelity')
    ) {
      throw new Error(
        `${row.fixture.id}/${evidence.strategy} formatting fidelity drifted ` +
          `(score ${evidence.formatting.score})`,
      );
    }
    if (evidence.formatting.score !== 1) {
      consumedDimensions.add('tagged-tree.formattingFidelity');
    }
    if (evidence.unsupportedStoryDiagnostics.length > 0) {
      throw new Error(
        `${row.fixture.id}/${evidence.strategy} reported unsupported story diagnostics: ` +
          evidence.unsupportedStoryDiagnostics.join('; '),
      );
    }
    for (const [label, issues] of Object.entries(evidence.integrity)) {
      if (issues.length > 0) {
        throw new Error(
          `${row.fixture.id}/${evidence.strategy} failed ${label}: ${issues.join('; ')}`,
        );
      }
    }
  }
  return consumedDimensions;
}

export function assertActiveDivergencesConsumed(
  activeDivergenceIds: ReadonlySet<string>,
  consumedDivergenceIds: ReadonlySet<string>,
): void {
  const unconsumed = [...activeDivergenceIds]
    .filter((id) => !consumedDivergenceIds.has(id))
    .sort();
  if (unconsumed.length > 0) {
    throw new Error(
      `active divergences did not suppress an observed assertion: ${unconsumed.join(', ')}`,
    );
  }
}

export function assertExpectedPackageParts(
  fixture: StrategyDifferentialFixture,
  row: StrategyDifferentialRow,
): void {
  for (const expectedPath of fixture.expectedPackageParts ?? []) {
    if (!row.fixture.sourcePackageParts.includes(expectedPath)) {
      throw new Error(`${fixture.id} no longer exercises expected source part ${expectedPath}`);
    }
    for (const evidence of [row.taggedTree]) {
      if (!evidence.packageParts.some((part) => part.path === expectedPath)) {
        throw new Error(`${fixture.id}/${evidence.strategy} dropped expected part ${expectedPath}`);
      }
    }
  }
}
