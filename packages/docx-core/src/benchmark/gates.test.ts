/**
 * Gate tests for quality benchmark.
 *
 * Covers G1 (text round-trip), G2 (formatting projection), G3 (structural integrity).
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { compareDocuments } from '../index.js';
import { extractTextWithParagraphs } from '../baselines/atomizer/trackChangesAcceptorAst.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { gateTextRoundTrip, gateFormattingProjection, gateStructuralIntegrity, runGates } from './gates.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Benchmark Gates' });

const benchmarkDir = dirname(fileURLToPath(import.meta.url));
const fixturesPath = join(benchmarkDir, '../testing/fixtures');

async function loadFixture(name: string) {
  const originalBuffer = await readFile(join(fixturesPath, name, 'original.docx'));
  const revisedBuffer = await readFile(join(fixturesPath, name, 'revised.docx'));
  return { originalBuffer, revisedBuffer };
}

async function getDocumentXml(buffer: Buffer): Promise<string> {
  const archive = await DocxArchive.load(buffer);
  return archive.getDocumentXml();
}

describe('G1: Text round-trip gate', () => {
  test('G1a pass: atomizer on simple-word-change produces matching text', async ({ given, when, then }: AllureBddContext) => {
    let resultDocXml: string;
    let originalText: string;
    let revisedText: string;

    await given('simple-word-change fixture is compared with atomizer', async () => {
      const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
      const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
      resultDocXml = await getDocumentXml(result.document);
      originalText = extractTextWithParagraphs(await getDocumentXml(originalBuffer));
      revisedText = extractTextWithParagraphs(await getDocumentXml(revisedBuffer));
    });

    await then('G1 normalizedTextParity passes', () => {
      const g1 = gateTextRoundTrip(resultDocXml, originalText, revisedText);
      expect(g1.normalizedTextParity.passed).toBe(true);
    });
  }, 30_000);

  test('G1a fail: swapped original/revised text detects mismatch', async ({ given, then }: AllureBddContext) => {
    let resultDocXml: string;
    let originalText: string;
    let revisedText: string;

    await given('simple-word-change fixture is compared and texts are swapped', async () => {
      const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
      const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
      resultDocXml = await getDocumentXml(result.document);
      originalText = extractTextWithParagraphs(await getDocumentXml(originalBuffer));
      revisedText = extractTextWithParagraphs(await getDocumentXml(revisedBuffer));
    });

    await then('G1 normalizedTextParity fails when texts are swapped', () => {
      // Deliberately swap: expect accept→original (wrong) and reject→revised (wrong)
      const g1 = gateTextRoundTrip(resultDocXml, revisedText, originalText);
      // At least one direction should fail if the documents differ
      if (originalText !== revisedText) {
        expect(g1.normalizedTextParity.passed).toBe(false);
      }
    });
  }, 30_000);

  test('G1b pass: paragraph count matches on simple-word-change', async ({ given, then }: AllureBddContext) => {
    let resultDocXml: string;
    let originalText: string;
    let revisedText: string;

    await given('simple-word-change fixture is compared with atomizer', async () => {
      const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
      const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
      resultDocXml = await getDocumentXml(result.document);
      originalText = extractTextWithParagraphs(await getDocumentXml(originalBuffer));
      revisedText = extractTextWithParagraphs(await getDocumentXml(revisedBuffer));
    });

    await then('G1 paragraphCountParity passes', () => {
      const g1 = gateTextRoundTrip(resultDocXml, originalText, revisedText);
      expect(g1.paragraphCountParity.passed).toBe(true);
    });
  }, 30_000);

  test('G1c handles minimal valid document without crashing', async ({ given, then }: AllureBddContext) => {
    let minimalXml: string;

    await given('a minimal document XML with no track changes', () => {
      minimalXml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body></w:body></w:document>';
    });

    await then('G1 handles it gracefully with passing checks', () => {
      const g1 = gateTextRoundTrip(minimalXml, '', '');
      expect(g1.xmlParseValidity.passed).toBe(true);
      expect(g1.normalizedTextParity.passed).toBe(true);
    });
  });

  test('G1 all sub-checks pass on no-change fixture', async ({ given, then }: AllureBddContext) => {
    let resultDocXml: string;
    let originalText: string;
    let revisedText: string;

    await given('no-change fixture is compared with atomizer', async () => {
      const { originalBuffer, revisedBuffer } = await loadFixture('no-change');
      const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
      resultDocXml = await getDocumentXml(result.document);
      originalText = extractTextWithParagraphs(await getDocumentXml(originalBuffer));
      revisedText = extractTextWithParagraphs(await getDocumentXml(revisedBuffer));
    });

    await then('all G1 sub-checks pass', () => {
      const g1 = gateTextRoundTrip(resultDocXml, originalText, revisedText);
      expect(g1.xmlParseValidity.passed).toBe(true);
      expect(g1.normalizedTextParity.passed).toBe(true);
      expect(g1.paragraphCountParity.passed).toBe(true);
    });
  }, 30_000);
});

describe('G2: Formatting projection gate (soft)', () => {
  test('G2 soft: atomizer on simple-word-change runs without crashing', async ({ given, then }: AllureBddContext) => {
    let result: Awaited<ReturnType<typeof compareDocuments>>;
    let originalBuffer: Buffer;
    let revisedBuffer: Buffer;

    await given('simple-word-change fixture is compared with atomizer', async () => {
      ({ originalBuffer, revisedBuffer } = await loadFixture('simple-word-change'));
      result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
    });

    await then('G2 runs and returns a result object', async () => {
      const g2 = await gateFormattingProjection(result.document, revisedBuffer, originalBuffer);
      // G2 is soft — we just verify it runs and produces a result
      expect(g2).toHaveProperty('passed');
      expect(g2).toHaveProperty('detail');
      expect(typeof g2.detail).toBe('string');
    });
  }, 60_000);
});

describe('G3: Structural integrity gate', () => {
  test('G3 pass: atomizer on simple-word-change produces structurally sound output', async ({ given, then }: AllureBddContext) => {
    let result: Awaited<ReturnType<typeof compareDocuments>>;

    await given('simple-word-change fixture is compared with atomizer', async () => {
      const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
      result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
    });

    await then('G3 structural integrity passes', async () => {
      const g3 = await gateStructuralIntegrity(result.document);
      expect(g3.passed).toBe(true);
    });
  }, 30_000);

  test('G3 fail: synthetic broken bookmark', async ({ given, when, then }: AllureBddContext) => {
    let modifiedBuffer: Buffer;

    await given('simple-word-change result has a broken bookmark injected', async () => {
      const { originalBuffer, revisedBuffer } = await loadFixture('simple-word-change');
      const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });

      // Inject broken bookmark into the result
      const archive = await DocxArchive.load(result.document);
      let docXml = await archive.getDocumentXml();
      // Insert a bookmarkStart without matching bookmarkEnd
      docXml = docXml.replace(
        '</w:body>',
        '<w:bookmarkStart w:id="99999" w:name="broken_test"/></w:body>',
      );
      archive.setDocumentXml(docXml);
      modifiedBuffer = await archive.save();
    });

    await when('G3 structural integrity is checked', () => {
      // check happens in then
    });

    await then('G3 fails and reports unmatched bookmark', async () => {
      const g3 = await gateStructuralIntegrity(modifiedBuffer);
      expect(g3.passed).toBe(false);
      expect(g3.detail).toContain('Unmatched bookmark');
    });
  }, 30_000);
});

describe('runGates orchestrator', () => {
  test('returns correct hardGatesPassed for passing fixture', async ({ given, then }: AllureBddContext) => {
    let result: Awaited<ReturnType<typeof compareDocuments>>;
    let resultDocXml: string;
    let originalText: string;
    let revisedText: string;
    let originalBuffer: Buffer;
    let revisedBuffer: Buffer;

    await given('simple-word-change fixture is compared with atomizer', async () => {
      ({ originalBuffer, revisedBuffer } = await loadFixture('simple-word-change'));
      result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer' });
      resultDocXml = await getDocumentXml(result.document);
      originalText = extractTextWithParagraphs(await getDocumentXml(originalBuffer));
      revisedText = extractTextWithParagraphs(await getDocumentXml(revisedBuffer));
    });

    await then('all hard gates pass', async () => {
      const { gates, hardGatesPassed } = await runGates(
        result.document,
        resultDocXml,
        originalText,
        revisedText,
        originalBuffer,
        revisedBuffer,
      );

      expect(gates.textRoundTrip.xmlParseValidity.passed).toBe(true);
      expect(gates.textRoundTrip.normalizedTextParity.passed).toBe(true);
      expect(gates.structuralIntegrity.passed).toBe(true);
      expect(hardGatesPassed).toBe(true);
    });
  }, 60_000);
});
