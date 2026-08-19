import { createHash } from 'node:crypto';
import { checkGeneratedPackage, parseXml } from '@usejunior/docx-core';
import JSZip from 'jszip';
import type {
  CompareResult,
  CompareStats,
  ComparisonStrategy,
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

export interface StrategyDifferentialFixture {
  id: string;
  original: Buffer;
  revised: Buffer;
  capabilityTags: string[];
  expectedPackageParts?: string[];
  forbiddenPayloads?: string[];
  approvedDivergenceIds?: string[];
}

export type ApprovedDivergenceDimension =
  | 'legacy-tagged.semanticDifference'
  | 'legacy.acceptProjection'
  | 'legacy.rejectProjection'
  | 'tagged-tree.acceptProjection'
  | 'tagged-tree.rejectProjection'
  | 'tagged-tree.atomStatisticsSemantics';

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
  strategy: ComparisonStrategy;
  projections: {
    accept: ProjectionSummary;
    reject: ProjectionSummary;
  };
  packageParts: PackagePartSummary[];
  stats: CompareStats;
  fallback: {
    comparisonStrategyUsed?: ComparisonStrategy;
    comparisonStrategyFallbackReason?: string;
    reconstructionModeUsed?: string;
    fallbackReason?: string;
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
  unsupportedStoryDiagnostics: string[];
  forbiddenPayloadLeaks: string[];
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

function unsupportedStoryDiagnostics(result: CompareResult): string[] {
  return (result.ancillaryFallbackDiagnostics?.issues ?? [])
    .map((issue) => `${issue.category}:${issue.code}:${issue.detail}`)
    .sort();
}

function structuralIssueKey(issue: { check: string; part: string; message: string }): string {
  return `${issue.check}\u0000${issue.part}\u0000${issue.message}`;
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
  const forbiddenPayloadLeaks = (fixture.forbiddenPayloads ?? [])
    .filter((payload) => payload && result.document.includes(Buffer.from(payload)))
    .sort();

  return {
    strategy: 'tagged-tree',
    projections: {
      accept: projectionSummary(acceptedXml, revisedXml),
      reject: projectionSummary(rejectedXml, originalXml),
    },
    packageParts: await packagePartSummaries(result.document),
    stats: result.stats,
    fallback: {
      comparisonStrategyUsed: result.comparisonStrategyUsed,
      ...(result.comparisonStrategyFallbackReason === undefined
        ? {}
        : { comparisonStrategyFallbackReason: result.comparisonStrategyFallbackReason }),
      reconstructionModeUsed: result.reconstructionModeUsed,
      ...(result.fallbackReason === undefined
        ? {}
        : { fallbackReason: result.fallbackReason }),
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
    unsupportedStoryDiagnostics: unsupportedStoryDiagnostics(result),
    forbiddenPayloadLeaks,
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
): void {
  for (const evidence of [row.taggedTree]) {
    if (evidence.fallback.comparisonStrategyUsed !== evidence.strategy) {
      throw new Error(
        `${row.fixture.id}/${evidence.strategy} fell back to ` +
          `${String(evidence.fallback.comparisonStrategyUsed)}`,
      );
    }
    const acceptDimension = `${evidence.strategy}.acceptProjection` as const;
    const rejectDimension = `${evidence.strategy}.rejectProjection` as const;
    if (
      !evidence.projections.accept.matchesSourceText
      && !approvedDimensions.has(acceptDimension)
    ) {
      throw new Error(`${row.fixture.id}/${evidence.strategy} accept projection drifted`);
    }
    if (
      !evidence.projections.reject.matchesSourceText
      && !approvedDimensions.has(rejectDimension)
    ) {
      throw new Error(`${row.fixture.id}/${evidence.strategy} reject projection drifted`);
    }
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
    if (evidence.forbiddenPayloadLeaks.length > 0) {
      throw new Error(`${row.fixture.id}/${evidence.strategy} leaked forbidden payloads`);
    }
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
