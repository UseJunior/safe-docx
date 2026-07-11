import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { buildSyntheticDocx } from '@usejunior/docx-core';
import { compareDocuments } from '../../index.js';
import { runLeanXmlTripleVerifier } from './leanXmlVerifier.js';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  normalizeText,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { buildDocxFromBodyXml, paragraphWithText } from '../../testing/ooxml-fixtures.js';

const TEST_FEATURE = 'Lean XML Triple Verifier';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

const TEST_DIR = dirname(import.meta.url.replace('file://', ''));
const PROJECT_ROOT = join(TEST_DIR, '../../../../..');
const LEAN_EXE = join(PROJECT_ROOT, 'verification/lean/.lake/build/bin/leanDocxChecker');

const exeExists = existsSync(LEAN_EXE);
if (!exeExists) {
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
        expect(result.documentIntegrity?.scope).toEqual([
          'word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml',
        ]);
        expect(result.documentIntegrity?.inputSha256.originalDocx).toMatch(/^[0-9a-f]{64}$/);
        expect(
          result.documentIntegrity?.stories[0]?.checks.acceptingAllTrackedChangesMatchesRevisedText.claim
        ).toContain('revised story');
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
        expect(result.documentIntegrity?.stories).toEqual([]);
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

async function replacePart(docx: Buffer, path: string, xml: string | null): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  if (xml === null) zip.remove(path);
  else zip.file(path, xml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function readPart(docx: Buffer, path: string): Promise<string> {
  const part = (await JSZip.loadAsync(docx)).file(path);
  if (!part) throw new Error(`missing test part: ${path}`);
  return part.async('string');
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const footnotes = (userBody: string, separatorBody = '<w:r><w:separator/></w:r>') =>
  `<w:footnotes xmlns:w="${W_NS}">` +
  `<w:footnote w:id="-1"><w:p>${separatorBody}</w:p></w:footnote>` +
  `<w:footnote w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="1"><w:p>${userBody}</w:p></w:footnote></w:footnotes>`;
const endnotes = (userBody: string) =>
  `<w:endnotes xmlns:w="${W_NS}">` +
  `<w:endnote w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>` +
  `<w:endnote w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>` +
  `<w:endnote w:id="1"><w:p>${userBody}</w:p></w:endnote></w:endnotes>`;

describeWithLean('Lean fixed-story package protocol', () => {
  const run = (originalDocx: Buffer, revisedDocx: Buffer, comparedDocx: Buffer) =>
    runLeanXmlTripleVerifier({
      originalDocx, revisedDocx, comparedDocx,
      reconstructionMode: 'inplace',
      options: { executablePath: LEAN_EXE },
    });

  test.openspec('[LEAN-STORY-01] Fixed stories pass together')(
    'checks main, footnote, and endnote stories in one compiled invocation', async () => {
      const docx = await buildSyntheticDocx({
        paragraphs: ['Body'], footnoteOnParagraph: 0, footnoteText: 'Foot',
        endnoteOnParagraph: 0, endnoteText: 'End',
      });
      const certificate = await run(docx, docx, docx);
      expect(certificate.status).toBe('passed');
      expect(certificate.stories.map((story) => story.name)).toEqual(['main', 'footnotes', 'endnotes']);
    });

  test.openspec('[LEAN-STORY-02] Side-story state is isolated')(
    'rejects malformed fields even when markers balance across side stories', async () => {
      const base = await buildSyntheticDocx({
        paragraphs: ['Body'], footnoteOnParagraph: 0, endnoteOnParagraph: 0,
      });
      const withFootnote = await replacePart(base, 'word/footnotes.xml', footnotes('<w:r><w:fldChar w:fldCharType="begin"/></w:r>'));
      const malformed = await replacePart(withFootnote, 'word/endnotes.xml', endnotes('<w:r><w:fldChar w:fldCharType="end"/></w:r>'));
      const certificate = await run(malformed, malformed, malformed);
      expect(certificate.status).toBe('failed');
      expect(certificate.stories.filter((story) => story.status === 'failed').map((story) => story.name)).toEqual(['footnotes', 'endnotes']);
    });

  test.openspec('[LEAN-STORY-03] Optional presence mismatch fails')(
    'fails closed when an optional story is absent from one package', async () => {
      const withNote = await buildSyntheticDocx({ paragraphs: ['Body'], footnoteOnParagraph: 0 });
      const withoutNote = await replacePart(withNote, 'word/footnotes.xml', null);
      const certificate = await run(withNote, withNote, withoutNote);
      expect(certificate.status).toBe('failed');
      expect(certificate.presenceMismatches?.[0]?.name).toBe('footnotes');
    });

  test.openspec('[LEAN-STORY-04] Reserved separator text is excluded')(
    'ignores reserved separator entry text through the Lean projection', async () => {
      const base = await buildSyntheticDocx({ paragraphs: ['Body'], footnoteOnParagraph: 0 });
      const original = await replacePart(base, 'word/footnotes.xml', footnotes('<w:r><w:t>User note</w:t></w:r>', '<w:r><w:t>Old separator</w:t></w:r>'));
      const revised = await replacePart(base, 'word/footnotes.xml', footnotes('<w:r><w:t>User note</w:t></w:r>', '<w:r><w:t>New separator</w:t></w:r>'));
      expect((await run(original, revised, revised)).status).toBe('passed');
    });

  test.openspec('[LEAN-STORY-05] Side-story divergence is visible')(
    'reports reject text divergence in a footnote story', async () => {
      const base = await buildSyntheticDocx({ paragraphs: ['Body'], footnoteOnParagraph: 0 });
      const original = await replacePart(base, 'word/footnotes.xml', footnotes('<w:r><w:t>Original note</w:t></w:r>'));
      const revised = await replacePart(base, 'word/footnotes.xml', footnotes('<w:r><w:t>Revised note</w:t></w:r>'));
      const certificate = await run(original, revised, revised);
      expect(certificate.status).toBe('failed');
      expect(certificate.stories.find((story) => story.name === 'footnotes')?.checks.rejectingAllTrackedChangesMatchesOriginalText.status).toBe('failed');
    });

  test('agrees with the existing TS accept/reject oracle on a tracked footnote protocol case', async () => {
    const base = await buildSyntheticDocx({ paragraphs: ['Body'], footnoteOnParagraph: 0 });
    const original = await replacePart(base, 'word/footnotes.xml', footnotes('<w:r><w:t>Original note</w:t></w:r>'));
    const revised = await replacePart(base, 'word/footnotes.xml', footnotes('<w:r><w:t>Revised note</w:t></w:r>'));
    const combinedBody =
      '<w:del><w:r><w:delText>Original note</w:delText></w:r></w:del>' +
      '<w:ins><w:r><w:t>Revised note</w:t></w:r></w:ins>';
    const combined = await replacePart(base, 'word/footnotes.xml', footnotes(combinedBody));

    const [originalXml, revisedXml, combinedXml] = await Promise.all([
      readPart(original, 'word/footnotes.xml'),
      readPart(revised, 'word/footnotes.xml'),
      readPart(combined, 'word/footnotes.xml'),
    ]);
    expect(normalizeText(extractTextWithParagraphs(acceptAllChanges(combinedXml)))).toBe(
      normalizeText(extractTextWithParagraphs(acceptAllChanges(revisedXml)))
    );
    expect(normalizeText(extractTextWithParagraphs(rejectAllChanges(combinedXml)))).toBe(
      normalizeText(extractTextWithParagraphs(rejectAllChanges(originalXml)))
    );
    expect((await run(original, revised, combined)).status).toBe('passed');
  });
});
