import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect } from 'vitest';
import { compareDocuments } from '../../index.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { buildDocxFromBodyXml, paragraphWithText } from '../../testing/ooxml-fixtures.js';

const TEST_FEATURE = 'Lean XML Triple Verifier';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

const TEST_DIR = dirname(import.meta.url.replace('file://', ''));
const PROJECT_ROOT = join(TEST_DIR, '../../../../..');
const LEAN_EXE = join(PROJECT_ROOT, 'verification/lean/.lake/build/bin/leanDocxChecker');

const exeExists = existsSync(LEAN_EXE);
if (!exeExists) {
  // eslint-disable-next-line no-console
  console.warn(
    `[lean-xml-verifier] SKIP: ${LEAN_EXE} not found. ` +
      `Build it with: (cd verification/lean && lake build leanDocxChecker)`,
  );
}
const describeWithLean = exeExists ? describe : describe.skip;

describeWithLean('Lean XML triple verifier certificate', () => {
  test
    .openspec('[LEAN-XML-CHECK-01] Lean verifier accepts a valid inplace comparison triple')
    .openspec('[LEAN-XML-CERT-01] Inplace comparison reports plain checked properties')(
    'passes a real inplace comparison XML triple through the compiled Lean checker',
    async ({ given, when, then }: AllureBddContext) => {
      let original!: Buffer;
      let revised!: Buffer;
      let result: Awaited<ReturnType<typeof compareDocuments>>;

      await given('a simple document pair that can be reconstructed in place', async () => {
        original = await buildDocxFromBodyXml(paragraphWithText('Hello'));
        revised = await buildDocxFromBodyXml(paragraphWithText('Hello world'));
      });

      await when('the atomizer runs with the compiled Lean verifier enabled', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
          leanXmlVerifier: { enabled: true, executablePath: LEAN_EXE },
        });
      });

      await then('the certificate reports plain document properties and hashes', () => {
        expect(result.reconstructionModeUsed).toBe('inplace');
        expect(result.documentIntegrity?.status).toBe('passed');
        expect(result.documentIntegrity?.scope).toBe('word/document.xml');
        expect(result.documentIntegrity?.inputSha256.originalDocumentXml).toMatch(/^[0-9a-f]{64}$/);
        expect(
          result.documentIntegrity?.checks.acceptingAllTrackedChangesMatchesRevisedText.claim
        ).toContain('revised document');
        expect(JSON.stringify(result.documentIntegrity)).not.toContain('tier2.checker_sound');
        expect(JSON.stringify(result.documentIntegrity)).not.toContain('INV');
      });
    },
  );
});

describe('Lean XML triple verifier scope boundary', () => {
  test.openspec('[LEAN-XML-CHECK-02] Lean verifier failure is not converted into a verified claim')(
    'marks an unavailable verifier as not_run instead of verified',
    async ({ given, when, then }: AllureBddContext) => {
      let original!: Buffer;
      let revised!: Buffer;
      let result: Awaited<ReturnType<typeof compareDocuments>>;

      await given('a document pair that otherwise reconstructs in place', async () => {
        original = await buildDocxFromBodyXml(paragraphWithText('Alpha'));
        revised = await buildDocxFromBodyXml(paragraphWithText('Alpha beta'));
      });

      await when('the verifier is enabled but its executable is unavailable', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
          leanXmlVerifier: { enabled: true, executablePath: '/does/not/exist' },
        });
      });

      await then('the certificate does not make a verified claim', () => {
        expect(result.reconstructionModeUsed).toBe('inplace');
        expect(result.documentIntegrity?.status).toBe('not_run');
        expect(
          result.documentIntegrity?.checks.acceptingAllTrackedChangesMatchesRevisedText.status
        ).toBe('not_evaluated');
        expect(JSON.stringify(result.documentIntegrity)).not.toContain('verified');
      });
    },
  );

  test.openspec('[LEAN-XML-CERT-02] Rebuild comparison does not overclaim')(
    'marks rebuild output as not applicable even when verifier option is enabled',
    async ({ given, when, then }: AllureBddContext) => {
      let original!: Buffer;
      let revised!: Buffer;
      let result: Awaited<ReturnType<typeof compareDocuments>>;

      await given('a document pair compared in rebuild mode', async () => {
        original = await buildDocxFromBodyXml(paragraphWithText('One'));
        revised = await buildDocxFromBodyXml(paragraphWithText('Two'));
      });

      await when('the atomizer runs with the verifier enabled', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
          leanXmlVerifier: { enabled: true, executablePath: '/does/not/exist' },
        });
      });

      await then('the certificate states that rebuild output is outside this verifier scope', () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        expect(result.documentIntegrity?.status).toBe('not_applicable');
        expect(result.documentIntegrity?.reason).toContain('inplace comparison output only');
      });
    },
  );
});
