import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { makeMinimalDocx } from '../../testing/docx_test_utils.js';
import { createTrackedTempDir, registerCleanup } from '../../testing/session-test-utils.js';
import { runCompareCommand } from './compare.js';
import type {
  CompareResult,
  DocumentIntegrityCertificate,
} from '@usejunior/docx-compare';
import {
  DocxDocument,
  getParagraphText,
  OOXML,
  replaceParagraphTextRange,
} from '@usejunior/docx-core';

registerCleanup();

const TEST_FEATURE = 'add-verified-comparison-cli';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

const zeroStats = {
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
};

function certificate(
  status: DocumentIntegrityCertificate['status'],
  reason?: string,
): DocumentIntegrityCertificate {
  const check = { status: 'passed' as const, claim: 'Test claim.' };
  return {
    status,
    verifier: 'Lean XML triple checker',
    protocolVersion: 1,
    scope: 'word/document.xml',
    reconstructionMode: 'inplace',
    inputSha256: {
      originalDocumentXml: 'original',
      revisedDocumentXml: 'revised',
      comparedDocumentXml: 'compared',
    },
    checks: {
      acceptingAllTrackedChangesMatchesRevisedText: check,
      rejectingAllTrackedChangesMatchesOriginalText: check,
      acceptingAllTrackedChangesKeepsValidFieldStructure: check,
      rejectingAllTrackedChangesKeepsValidFieldStructure: check,
      comparedDocumentHasNoFieldMarkersInsideDeletions: check,
    },
    checkerProtocolVersion: 7,
    reason,
  };
}

function comparisonResult(
  documentIntegrity?: DocumentIntegrityCertificate,
): CompareResult {
  return {
    document: Buffer.from('verified-redline'),
    stats: zeroStats,
    engine: 'atomizer',
    reconstructionModeRequested: 'inplace',
    reconstructionModeUsed: 'inplace',
    documentIntegrity,
  };
}

describe('safe-docx compare command', () => {
  test('defaults to the shared inplace reconstruction mode', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const tmpDir = await createTrackedTempDir('safe-docx-compare-default-');
    const originalPath = path.join(tmpDir, 'original.docx');
    const revisedPath = path.join(tmpDir, 'revised.docx');
    await given('a minimal document pair with one text revision', async () => {
      await Promise.all([
        fs.writeFile(originalPath, await makeMinimalDocx(['Original text'])),
        fs.writeFile(revisedPath, await makeMinimalDocx(['Revised text'])),
      ]);
    });

    let result: Awaited<ReturnType<typeof runCompareCommand>>;
    await when('the CLI compare command runs without an explicit mode', async () => {
      result = await runCompareCommand({ originalPath, revisedPath });
    });

    await then('inplace is requested and reflected in the default output name', async () => {
      expect(result.mode_requested).toBe('inplace');
      expect(result.output).toBe(path.join(tmpDir, 'revised.REDLINE.atomizer.inplace.docx'));
      expect((await fs.stat(result.output)).isFile()).toBe(true);
    });
  });

  test('honors an explicit rebuild mode', async ({ given, when, then }: AllureBddContext) => {
    const tmpDir = await createTrackedTempDir('safe-docx-compare-rebuild-');
    const originalPath = path.join(tmpDir, 'original.docx');
    const revisedPath = path.join(tmpDir, 'revised.docx');
    await given('a minimal document pair', async () => {
      await Promise.all([
        fs.writeFile(originalPath, await makeMinimalDocx(['Original text'])),
        fs.writeFile(revisedPath, await makeMinimalDocx(['Revised text'])),
      ]);
    });

    let result: Awaited<ReturnType<typeof runCompareCommand>>;
    await when('the CLI compare command explicitly requests rebuild', async () => {
      result = await runCompareCommand({ originalPath, revisedPath, mode: 'rebuild' });
    });

    await then('the explicit mode remains authoritative', () => {
      expect(result.mode_requested).toBe('rebuild');
      expect(result.output).toBe(path.join(tmpDir, 'revised.REDLINE.atomizer.rebuild.docx'));
    });
  });

  test
    .openspec('[CLI-VERIFY-01] Verified comparison returns a passing certificate')
    .openspec('[CLI-VERIFY-02] Certificate path implies verified comparison')(
    'publishes a passing certificate and redline only after verification',
    async ({ given, when, then }: AllureBddContext) => {
      const tmpDir = await createTrackedTempDir('safe-docx-compare-verified-');
      const originalPath = path.join(tmpDir, 'original.docx');
      const revisedPath = path.join(tmpDir, 'revised.docx');
      const outputPath = path.join(tmpDir, 'verified.docx');
      const certificatePath = path.join(tmpDir, 'certificate.json');
      await given('a document pair and a passing compiled-verifier result', async () => {
        await Promise.all([
          fs.writeFile(originalPath, await makeMinimalDocx(['Original text'])),
          fs.writeFile(revisedPath, await makeMinimalDocx(['Revised text'])),
        ]);
      });

      const passed = certificate('passed');
      let result: Awaited<ReturnType<typeof runCompareCommand>>;
      await when('the caller requests a certificate artifact', async () => {
        result = await runCompareCommand(
          { originalPath, revisedPath, outputPath, certificatePath },
          { compare: async (_original, _revised, options) => {
            expect(options?.leanXmlVerifier).toEqual({ enabled: true });
            return comparisonResult(passed);
          } },
        );
      });

      await then('the JSON result and durable artifact carry the same certificate', async () => {
        expect(result.verification).toEqual(passed);
        expect(result.certificate_path).toBe(certificatePath);
        expect(await fs.readFile(outputPath, 'utf8')).toBe('verified-redline');
        expect(JSON.parse(await fs.readFile(certificatePath, 'utf8'))).toEqual(passed);
      });
    },
  );

  test.openspec('[CLI-VERIFY-03] Requested verification fails closed')(
    'writes neither output when requested verification does not pass',
    async ({ given, when, then }: AllureBddContext) => {
      const tmpDir = await createTrackedTempDir('safe-docx-compare-rejected-');
      const originalPath = path.join(tmpDir, 'original.docx');
      const revisedPath = path.join(tmpDir, 'revised.docx');
      const outputPath = path.join(tmpDir, 'must-not-exist.docx');
      const certificatePath = path.join(tmpDir, 'must-not-exist.json');
      await given('a document pair and a non-passing verifier result', async () => {
        await Promise.all([
          fs.writeFile(originalPath, await makeMinimalDocx(['Original text'])),
          fs.writeFile(revisedPath, await makeMinimalDocx(['Revised text'])),
        ]);
      });

      await when('verified comparison returns not_run', async () => {
        await expect(runCompareCommand(
          {
            originalPath,
            revisedPath,
            outputPath,
            certificatePath,
            verify: true,
          },
          {
            compare: async () =>
              comparisonResult(certificate('not_run', 'unsupported package subset')),
          },
        )).rejects.toThrow(
          'Verified comparison did not pass (not_run): unsupported package subset',
        );
      });

      await then('neither requested artifact was published', async () => {
        await expect(fs.stat(outputPath)).rejects.toThrow();
        await expect(fs.stat(certificatePath)).rejects.toThrow();
      });
    },
  );

  test.openspec('[CLI-VERIFY-04] Ordinary comparison remains unchanged')(
    'does not configure the verifier without an explicit request',
    async () => {
      const tmpDir = await createTrackedTempDir('safe-docx-compare-unverified-');
      const originalPath = path.join(tmpDir, 'original.docx');
      const revisedPath = path.join(tmpDir, 'revised.docx');
      await Promise.all([
        fs.writeFile(originalPath, await makeMinimalDocx(['Original text'])),
        fs.writeFile(revisedPath, await makeMinimalDocx(['Revised text'])),
      ]);

      await runCompareCommand(
        { originalPath, revisedPath },
        { compare: async (_original, _revised, options) => {
          expect(options?.leanXmlVerifier).toBeUndefined();
          return comparisonResult();
        } },
      );
    },
  );
});

const leanCheckerPath = path.resolve(
  __dirname,
  '../../../../../verification/lean/.lake/build/bin/leanDocxChecker',
);
const describeWithCompiledLean = existsSync(leanCheckerPath) ? describe : describe.skip;

describeWithCompiledLean('safe-docx verified comparison performance', () => {
  test
    .openspec('[CLI-VERIFY-05] Public real-document verification meets the budget')(
    'compares and certifies the public NVCA-derived pair within ten seconds',
    async () => {
      const tmpDir = await createTrackedTempDir('safe-docx-cli-verified-nvca-');
      const originalPath = path.resolve(
        __dirname,
        '../../../../../tests/test_documents/nvca-regression/source.docx',
      );
      const revisedPath = path.join(tmpDir, 'minimally-revised.docx');
      const outputPath = path.join(tmpDir, 'verified-redline.docx');
      const original = await fs.readFile(originalPath);
      const revised = await DocxDocument.load(original);
      const paragraph = revised.getParagraphs().find((candidate) => {
        const text = getParagraphText(candidate);
        return text.length >= 20 &&
          candidate.getElementsByTagNameNS(OOXML.W_NS, 'fldChar').length === 0;
      });
      if (!paragraph) throw new Error('public NVCA fixture has no editable body paragraph');
      const paragraphText = getParagraphText(paragraph);
      replaceParagraphTextRange(
        paragraph,
        0,
        1,
        paragraphText[0] === 'A' ? 'B' : 'A',
      );
      await fs.writeFile(
        revisedPath,
        (await revised.toBuffer({ cleanBookmarks: false })).buffer,
      );
      const previousChecker = process.env.SAFE_DOCX_LEAN_XML_CHECKER;
      process.env.SAFE_DOCX_LEAN_XML_CHECKER = leanCheckerPath;
      try {
        const started = performance.now();
        const result = await runCompareCommand({
          originalPath,
          revisedPath,
          outputPath,
          verify: true,
        });
        const elapsedMs = performance.now() - started;
        expect(result.certificate_format).toBe('full');
        expect(result.verification).toBeDefined();
        expect(result.verification && 'status' in result.verification).toBe(true);
        if (!result.verification || !('status' in result.verification)) {
          throw new Error('expected the default full certificate');
        }
        expect(result.verification.status, result.verification.reason).toBe('passed');
        expect(result.verification.checkerProtocolVersion).toBe(7);
        expect(result.mode).toBe('inplace');
        expect(elapsedMs, `verified comparison took ${elapsedMs.toFixed(0)}ms`).toBeLessThanOrEqual(
          10_000,
        );
      } finally {
        if (previousChecker === undefined) {
          delete process.env.SAFE_DOCX_LEAN_XML_CHECKER;
        } else {
          process.env.SAFE_DOCX_LEAN_XML_CHECKER = previousChecker;
        }
      }
    },
    20_000,
  );
});
