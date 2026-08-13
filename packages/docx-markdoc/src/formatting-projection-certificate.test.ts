import { describe, expect } from 'vitest';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import JSZip from 'jszip';
import { buildSyntheticDocx, DocxDocument, getParagraphRuns } from '@usejunior/docx-core';
import { compareDocuments } from '@usejunior/docx-compare';
import { compileMarkdoc, projectionChecksPassed, verifyFormattingProjections } from './compile.js';
import { importDocxToMarkdoc } from './import.js';

async function replaceDocumentXml(buffer: Buffer, transform: (xml: string) => string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const original = await zip.file('word/document.xml')?.async('string');
  if (!original) throw new Error('Fixture DOCX is missing word/document.xml');
  zip.file('word/document.xml', transform(original));
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

async function formattingFixture(): Promise<{ source: Buffer; clean: Buffer; tracked: Buffer }> {
  const source = await buildSyntheticDocx({ paragraphs: ['Original text.'] });
  const clean = await replaceDocumentXml(source, (xml) => xml.replace(
    '<w:r><w:t>Original text.</w:t></w:r>',
    '<w:r><w:rPr><w:highlight w:val="yellow"/><w:u w:val="single"/></w:rPr><w:t>Replacement words.</w:t></w:r>',
  ));
  const compared = await compareDocuments(source, clean, {
    engine: 'atomizer',
    reconstructionMode: 'inplace',
    author: 'Formatting certificate test',
    date: new Date('2026-08-12T00:00:00.000Z'),
  });
  return { source, clean, tracked: compared.document };
}

function removeInsertedProperty(xml: string, pattern: RegExp, property: string): string {
  const start = xml.indexOf('<w:ins');
  const end = xml.indexOf('</w:ins>', start);
  if (start < 0 || end < 0) throw new Error('Fixture tracked XML has no inserted revision.');
  const insertion = xml.slice(start, end + '</w:ins>'.length);
  const tamperedInsertion = insertion.replace(pattern, '');
  if (tamperedInsertion === insertion) throw new Error(`Fixture inserted revision did not contain ${property}`);
  return `${xml.slice(0, start)}${tamperedInsertion}${xml.slice(end + '</w:ins>'.length)}`;
}

describe('formatting-aware projection certificate', () => {
  itAllure('[SDX-MDOC-27] reports semantic formatting fidelity for both replay projections', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Pinned text.'] });
    const imported = await importDocxToMarkdoc(source);
    const result = await compileMarkdoc(imported.anchoredSource, imported.markdoc);

    expect(result.certificate).toMatchObject({
      rejectAllFormattingEqualsSource: true,
      acceptAllFormattingEqualsClean: true,
      projectionPassed: true,
      passed: true,
      deliveryReady: true,
      formattingProjections: {
        sourceRejectAll: { score: 1, divergenceCount: 0, divergences: [] },
        cleanAcceptAll: { score: 1, divergenceCount: 0, divergences: [] },
      },
    });
  });

  for (const [property, pattern] of [
    ['highlight', /<w:highlight\b[^>]*\/>/u],
    ['underline', /<w:u\b[^>]*\/>/u],
  ] as const) {
    itAllure(`[SDX-MDOC-28] blocks the accepted formatting projection when tracked ${property} is removed`, async () => {
    const { source, clean, tracked } = await formattingFixture();
    const tampered = await replaceDocumentXml(tracked, (xml) => removeInsertedProperty(xml, pattern, property));

    const certification = await verifyFormattingProjections(source, clean, tampered);
    const accepted = await DocxDocument.load(tampered);
    await accepted.acceptChanges();
    const acceptedText = accepted.getParagraphs()
      .map((paragraph) => getParagraphRuns(paragraph).map((run) => run.text).join(''))
      .join('\n');
    const cleanDocument = await DocxDocument.load(clean);
    const cleanText = cleanDocument.getParagraphs()
      .map((paragraph) => getParagraphRuns(paragraph).map((run) => run.text).join(''))
      .join('\n');

    expect(certification.rejectAllFormattingEqualsSource).toBe(true);
    expect(certification.acceptAllFormattingEqualsClean).toBe(false);
    expect(acceptedText).toBe(cleanText);
    expect(projectionChecksPassed({
      sourceSha256Matches: true,
      scaffoldComplete: true,
      paragraphFingerprintsMatch: true,
      operationsAppliedExactlyOnce: true,
      rejectAllEqualsSource: true,
      acceptAllEqualsClean: acceptedText === cleanText,
      rejectAllFormattingEqualsSource: certification.rejectAllFormattingEqualsSource,
      acceptAllFormattingEqualsClean: certification.acceptAllFormattingEqualsClean,
      unchangedPackagePartsPreserved: true,
    })).toBe(false);
    expect(certification.formattingProjections.cleanAcceptAll).toMatchObject({
      divergenceCount: expect.any(Number),
      divergences: [expect.objectContaining({ scope: 'run', property })],
    });
    expect(certification.formattingProjections.cleanAcceptAll.divergences.length).toBeLessThanOrEqual(8);
    });
  }
});
