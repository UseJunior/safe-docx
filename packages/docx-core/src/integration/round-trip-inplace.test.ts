/**
 * Round-Trip Tests (Inplace Reconstruction)
 *
 * These tests ensure the inplace reconstructor preserves Word's accept/reject semantics:
 * 1. Accept all changes -> matches revised
 * 2. Reject all changes -> matches original
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import JSZip from 'jszip';
import { compareDocuments } from '../index.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import {
  acceptAllChanges,
  rejectAllChanges,
  extractTextWithParagraphs,
  compareTexts,
} from '../baselines/atomizer/trackChangesAcceptorAst.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Inplace Round-Trip' });

const fixturesPath = join(dirname(import.meta.url.replace('file://', '')), '../testing/fixtures');

const FIXTURES = [
  'simple-word-change',
  'paragraph-insert',
  'paragraph-delete',
  'no-change',
] as const;

describe('Round-Trip Tests - Inplace Reconstruction', () => {
  for (const name of FIXTURES) {
    test(`${name}: accept changes should match revised`, async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer;
      let revised: Buffer;
      let result: Awaited<ReturnType<typeof compareDocuments>>;
      let acceptedText: string;
      let revisedText: string;

      await given(`${name} original and revised documents are loaded`, async () => {
        original = await readFile(join(fixturesPath, name, 'original.docx'));
        revised = await readFile(join(fixturesPath, name, 'revised.docx'));
      });

      await when('documents are compared in inplace mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });

        const resultArchive = await DocxArchive.load(result.document);
        const resultXml = await resultArchive.getDocumentXml();
        acceptedText = extractTextWithParagraphs(acceptAllChanges(resultXml));

        const revisedArchive = await DocxArchive.load(revised);
        revisedText = extractTextWithParagraphs(await revisedArchive.getDocumentXml());
      });

      await then('accepting all changes produces text matching the revised document', async () => {
        expect(compareTexts(revisedText, acceptedText).normalizedIdentical).toBe(true);
      });
    });

    test(`${name}: reject changes should match original`, async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer;
      let revised: Buffer;
      let result: Awaited<ReturnType<typeof compareDocuments>>;
      let rejectedText: string;
      let originalText: string;

      await given(`${name} original and revised documents are loaded`, async () => {
        original = await readFile(join(fixturesPath, name, 'original.docx'));
        revised = await readFile(join(fixturesPath, name, 'revised.docx'));
      });

      await when('documents are compared in inplace mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });

        const resultArchive = await DocxArchive.load(result.document);
        const resultXml = await resultArchive.getDocumentXml();
        rejectedText = extractTextWithParagraphs(rejectAllChanges(resultXml));

        const originalArchive = await DocxArchive.load(original);
        originalText = extractTextWithParagraphs(await originalArchive.getDocumentXml());
      });

      await then('rejecting all changes produces text matching the original document', async () => {
        expect(compareTexts(originalText, rejectedText).normalizedIdentical).toBe(true);
      });
    });
  }
});

test('split-run-boundary-change: reject changes should match original', async ({ given, when, then }: AllureBddContext) => {
  const makeDocxWithRuns = async (runs: string[]): Promise<Buffer> => {
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      ${runs.map((t) => `<w:r><w:t>${t.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</w:t></w:r>`).join('')}
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rootRels);
    zip.file('word/document.xml', documentXml);
    return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
  };

  let original: Buffer;
  let revised: Buffer;
  let result: Awaited<ReturnType<typeof compareDocuments>>;
  let rejectedText: string;
  let originalText: string;

  await given('synthetic split-run-boundary-change documents are constructed', async () => {
    original = await makeDocxWithRuns([
      'THIS CONFIDENTIALITY AGREEMENT ("Agreement") is made as of t',
      'he ______ day of _________, 201_',
      ' by and between the parties.',
    ]);
    revised = await makeDocxWithRuns([
      'THIS CONFIDENTIALITY AGREEMENT ("Agreement") is made as of ',
      'January 15, 2025',
      ' by and between the parties.',
    ]);
  });

  await when('documents are compared in inplace mode', async () => {
    result = await compareDocuments(original, revised, {
      engine: 'atomizer',
      reconstructionMode: 'inplace',
    });

    const resultArchive = await DocxArchive.load(result.document);
    const resultXml = await resultArchive.getDocumentXml();
    rejectedText = extractTextWithParagraphs(rejectAllChanges(resultXml));

    const originalArchive = await DocxArchive.load(original);
    originalText = extractTextWithParagraphs(await originalArchive.getDocumentXml());
  });

  await then('rejecting all changes produces text matching the original document', async () => {
    expect(compareTexts(originalText, rejectedText).normalizedIdentical).toBe(true);
  });
});
