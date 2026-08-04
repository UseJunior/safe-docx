import fs from 'node:fs/promises';
import path from 'node:path';
import type { CompareResult, DocumentIntegrityCertificate } from '@usejunior/docx-compare';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { makeMinimalDocx } from '../../testing/docx_test_utils.js';
import { createTrackedTempDir, registerCleanup } from '../../testing/session-test-utils.js';
import { runCompareCommand } from '../commands/compare.js';
import {
  LLM_CERTIFICATE_SCHEMA_ID,
  projectLlmVerificationCertificate,
} from './llm_certificate.js';

registerCleanup();

const TEST_FEATURE = 'add-llm-verifier-certificate';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
const passedCheck = { status: 'passed' as const, claim: 'Canonical repeated claim.' };
const failedCheck = { status: 'failed' as const, claim: 'Canonical repeated claim.' };

const checks = (fieldCheck = passedCheck) => ({
  acceptingAllTrackedChangesMatchesRevisedText: passedCheck,
  rejectingAllTrackedChangesMatchesOriginalText: passedCheck,
  acceptingAllTrackedChangesKeepsValidFieldStructure: fieldCheck,
  rejectingAllTrackedChangesKeepsValidFieldStructure: passedCheck,
  comparedStoryHasNoFieldMarkersInsideDeletions: passedCheck,
  trackedMoveRangesAreCorrectlyPaired: passedCheck,
});

function canonicalCertificate(): DocumentIntegrityCertificate {
  return {
    status: 'passed',
    verifier: 'Lean XML triple checker',
    protocolVersion: 1,
    checkerProtocolVersion: 7,
    scope: 'word/document.xml',
    reconstructionMode: 'inplace',
    inputSha256: {
      originalDocumentXml: 'original-xml-sha',
      revisedDocumentXml: 'revised-xml-sha',
      comparedDocumentXml: 'compared-xml-sha',
    },
    inputPackageSha256: {
      originalDocx: 'original-package-sha',
      revisedDocx: 'revised-package-sha',
      comparedDocx: 'compared-package-sha',
    },
    checks: {
      acceptingAllTrackedChangesMatchesRevisedText: passedCheck,
      rejectingAllTrackedChangesMatchesOriginalText: passedCheck,
      acceptingAllTrackedChangesKeepsValidFieldStructure: passedCheck,
      rejectingAllTrackedChangesKeepsValidFieldStructure: passedCheck,
      comparedDocumentHasNoFieldMarkersInsideDeletions: passedCheck,
      trackedMoveRangesAreCorrectlyPaired: passedCheck,
    },
    parsedTokenCounts: { original: 10, revised: 11, compared: 12 },
    fixedStoryScope: ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'],
    stories: [
      {
        name: 'main',
        status: 'passed',
        checks: checks(),
        parsedTokenCounts: { original: 10, revised: 11, compared: 12 },
        presence: { original: true, revised: true, compared: true },
      },
      {
        name: 'footnotes',
        status: 'passed',
        checks: checks(),
        parsedTokenCounts: { original: 3, revised: 3, compared: 4 },
        presence: { original: true, revised: true, compared: true },
      },
    ],
    relationshipStories: [
      {
        physicalStoryOrdinal: 0,
        kind: 'header',
        originalPartPath: 'word/header1.xml',
        revisedPartPath: 'word/header2.xml',
        comparedPartPath: 'word/header2.xml',
        selectingSlotOrdinals: [0, 2],
        status: 'passed',
        checks: checks(),
        parsedTokenCounts: { original: 2, revised: 2, compared: 3 },
      },
    ],
    exclusions: ['visual rendering'],
  };
}

function comparisonResult(documentIntegrity: DocumentIntegrityCertificate): CompareResult {
  return {
    document: Buffer.from('redline'),
    stats: {
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
    engine: 'atomizer',
    reconstructionModeRequested: 'inplace',
    reconstructionModeUsed: 'inplace',
    documentIntegrity,
  };
}

async function documentPaths(prefix: string): Promise<{
  originalPath: string;
  revisedPath: string;
  outputPath: string;
  certificatePath: string;
}> {
  const tmpDir = await createTrackedTempDir(prefix);
  const originalPath = path.join(tmpDir, 'original.docx');
  const revisedPath = path.join(tmpDir, 'revised.docx');
  await Promise.all([
    fs.writeFile(originalPath, await makeMinimalDocx(['Original'])),
    fs.writeFile(revisedPath, await makeMinimalDocx(['Revised'])),
  ]);
  return {
    originalPath,
    revisedPath,
    outputPath: path.join(tmpDir, 'redline.docx'),
    certificatePath: path.join(tmpDir, 'certificate.json'),
  };
}

describe('LLM verifier certificate projection', () => {
  test.openspec('[CLI-CERT-01] Full format remains backward compatible')(
    'keeps the canonical certificate unchanged by default and for full',
    async () => {
      const certificate = canonicalCertificate();
      for (const certificateFormat of [undefined, 'full'] as const) {
        const paths = await documentPaths('safe-docx-full-certificate-');
        const result = await runCompareCommand(
          { ...paths, certificateFormat },
          { compare: async () => comparisonResult(certificate) },
        );
        expect(result.certificate_format).toBe('full');
        expect(result.verification).toEqual(certificate);
        expect(JSON.parse(await fs.readFile(paths.certificatePath, 'utf8'))).toEqual(certificate);
      }
    },
  );

  test.openspec('[CLI-CERT-02] LLM format is consistent across outputs')(
    'emits the same normalized certificate in JSON and the requested artifact',
    async () => {
      const paths = await documentPaths('safe-docx-llm-certificate-');
      const result = await runCompareCommand(
        { ...paths, certificateFormat: 'llm' },
        {
          compare: async (_original, _revised, options) => {
            expect(options?.leanXmlVerifier).toEqual({ enabled: true });
            return comparisonResult(canonicalCertificate());
          },
        },
      );
      expect(result.certificate_format).toBe('llm');
      expect(result.verification).toMatchObject({ schemaId: LLM_CERTIFICATE_SCHEMA_ID });
      expect(JSON.parse(await fs.readFile(paths.certificatePath, 'utf8'))).toEqual(
        result.verification,
      );
    },
  );

  test('rejects an unknown certificate format before reading input files', async () => {
    await expect(
      runCompareCommand({
        originalPath: 'unused-original.docx',
        revisedPath: 'unused-revised.docx',
        certificateFormat: 'compact',
      }),
    ).rejects.toThrow('Unsupported certificate format: compact. Use full or llm.');
  });

  test.openspec('[CLI-CERT-03] Uniform passes are grouped without repeated claims')(
    'defines claims once and groups stories with identical vectors',
    () => {
      const projected = projectLlmVerificationCertificate(canonicalCertificate());
      expect(projected.scope).toMatchObject({ fixedStories: 2, relationshipStories: 1 });
      expect(projected.statusSummary.genericStories).toEqual({ passed: 3, failed: 0 });
      expect(projected.statusSummary.invariantRelations).toEqual({
        passed: 18,
        failed: 0,
        not_evaluated: 0,
      });
      expect(projected.resultSets).toHaveLength(1);
      expect(projected.resultSets[0]?.storyIds).toEqual([
        'fixed:main',
        'fixed:footnotes',
        'relationship:0:header',
      ]);
      expect(JSON.stringify(projected).match(/Canonical repeated claim\./g)).toBeNull();
      expect(projected.invariantDefinitions).toHaveLength(6);
    },
  );

  test.openspec('[CLI-CERT-04] Non-passing evidence survives projection')(
    'retains failed relations, structured anomalies, reason, and exclusions',
    () => {
      const canonical = canonicalCertificate();
      canonical.status = 'failed';
      canonical.reason = 'one or more invariants failed';
      canonical.stories![0]!.status = 'failed';
      canonical.stories![0]!.checks.acceptingAllTrackedChangesKeepsValidFieldStructure =
        failedCheck;
      canonical.stories![0]!.checks.trackedMoveRangesAreCorrectlyPaired = undefined;
      canonical.presenceMismatches = [
        {
          name: 'footnotes',
          packagePart: 'word/footnotes.xml',
          required: false,
          presence: { original: true, revised: false, combined: true },
        },
      ];
      canonical.fixedStoryFailures = [
        {
          code: 'OPTIONAL_STORY_INVALID_XML',
          name: 'footnotes',
          side: 'revised',
          packagePart: 'word/footnotes.xml',
          detail: 'invalid XML',
        },
      ];
      canonical.relationshipSelectionFailures = [
        { code: 'MISSING_RELATIONSHIP', detail: 'missing header relationship' },
      ];
      canonical.noteIntegrityFailures = [
        {
          code: 'MISSING_DEFINITION',
          side: 'compared',
          kind: 'footnotes',
          detail: 'reference has no definition',
          ordinalSpace: 'reference',
          firstOccurrenceOrdinal: 0,
          occurrenceCount: 1,
        },
      ];
      canonical.commentIntegrityFailures = [
        {
          code: 'UNMATCHED_RANGE_START',
          side: 'compared',
          kind: 'comments',
          detail: 'range start has no end',
          ordinalSpace: 'rangeStart',
          firstOccurrenceOrdinal: 0,
          occurrenceCount: 1,
        },
      ];

      const projected = projectLlmVerificationCertificate(canonical);
      expect(projected.verdict).toBe('failed');
      expect(projected.reason).toBe(canonical.reason);
      expect(projected.scope.exclusions).toEqual(['visual rendering']);
      expect(projected.statusSummary.invariantRelations).toEqual({
        passed: 16,
        failed: 1,
        not_evaluated: 1,
      });
      expect(projected.anomalies).toEqual({
        presenceMismatches: canonical.presenceMismatches,
        fixedStoryFailures: canonical.fixedStoryFailures,
        relationshipSelectionFailures: canonical.relationshipSelectionFailures,
        noteIntegrityFailures: canonical.noteIntegrityFailures,
        commentIntegrityFailures: canonical.commentIntegrityFailures,
      });
    },
  );

  test.openspec('[CLI-CERT-05] Projection ordering is deterministic')(
    'serializes byte-identically for repeated projections',
    async ({ given, when, then }: AllureBddContext) => {
      const canonical = canonicalCertificate();
      let first = '';
      await given('one canonical certificate', () => undefined);
      await when('it is projected once', () => {
        first = JSON.stringify(projectLlmVerificationCertificate(canonical));
      });
      const second = JSON.stringify(projectLlmVerificationCertificate(canonical));
      await then('a repeated projection has identical bytes', () => expect(second).toBe(first));
    },
  );
});
