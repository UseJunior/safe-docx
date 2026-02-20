/**
 * Round-Trip Tests (Inplace Reconstruction)
 *
 * These tests ensure the inplace reconstructor preserves Word's accept/reject semantics:
 * 1. Accept all changes -> matches revised
 * 2. Reject all changes -> matches original
 */

import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
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

const fixturesPath = join(dirname(import.meta.url.replace('file://', '')), '../testing/fixtures');

const FIXTURES = [
  'simple-word-change',
  'paragraph-insert',
  'paragraph-delete',
  'no-change',
] as const;

describe('Round-Trip Tests - Inplace Reconstruction', () => {
  for (const name of FIXTURES) {
    it(`${name}: accept changes should match revised`, async () => {
      const original = await readFile(join(fixturesPath, name, 'original.docx'));
      const revised = await readFile(join(fixturesPath, name, 'revised.docx'));

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });

      const resultArchive = await DocxArchive.load(result.document);
      const resultXml = await resultArchive.getDocumentXml();
      const acceptedText = extractTextWithParagraphs(acceptAllChanges(resultXml));

      const revisedArchive = await DocxArchive.load(revised);
      const revisedText = extractTextWithParagraphs(await revisedArchive.getDocumentXml());

      expect(compareTexts(revisedText, acceptedText).normalizedIdentical).toBe(true);
    });

    it(`${name}: reject changes should match original`, async () => {
      const original = await readFile(join(fixturesPath, name, 'original.docx'));
      const revised = await readFile(join(fixturesPath, name, 'revised.docx'));

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });

      const resultArchive = await DocxArchive.load(result.document);
      const resultXml = await resultArchive.getDocumentXml();
      const rejectedText = extractTextWithParagraphs(rejectAllChanges(resultXml));

      const originalArchive = await DocxArchive.load(original);
      const originalText = extractTextWithParagraphs(await originalArchive.getDocumentXml());

      expect(compareTexts(originalText, rejectedText).normalizedIdentical).toBe(true);
    });
  }
});

it('split-run-boundary-change: reject changes should match original', async () => {
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

  const original = await makeDocxWithRuns([
    'THIS CONFIDENTIALITY AGREEMENT (“Agreement”) is made as of t',
    'he ______ day of _________, 201_',
    ' by and between the parties.',
  ]);
  const revised = await makeDocxWithRuns([
    'THIS CONFIDENTIALITY AGREEMENT (“Agreement”) is made as of ',
    'January 15, 2025',
    ' by and between the parties.',
  ]);

  const result = await compareDocuments(original, revised, {
    engine: 'atomizer',
    reconstructionMode: 'inplace',
  });

  const resultArchive = await DocxArchive.load(result.document);
  const resultXml = await resultArchive.getDocumentXml();
  const rejectedText = extractTextWithParagraphs(rejectAllChanges(resultXml));

  const originalArchive = await DocxArchive.load(original);
  const originalText = extractTextWithParagraphs(await originalArchive.getDocumentXml());

  expect(compareTexts(originalText, rejectedText).normalizedIdentical).toBe(true);
});
