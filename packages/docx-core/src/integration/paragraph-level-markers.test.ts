import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { compareDocumentsAtomizer as compareDocuments } from '@usejunior/docx-compare';
import { rejectAllChanges } from '@usejunior/docx-compare';

function countParagraphs(xml: string): number {
  return (xml.match(/<w:p(\s|>)/g) ?? []).length;
}

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Paragraph-level markers' });

describe('Paragraph-Level Track Changes Markers (Aspose-Style)', () => {
  const projectRoot = join(dirname(import.meta.url.replace('file://', '')), '../../../..');

  test('encodes inserted/deleted paragraphs with pPr-level marker and rejects without stubs', async ({ given, when, then, and }: AllureBddContext) => {
    let originalBuf: Buffer;
    let revisedBuf: Buffer;
    let result: Awaited<ReturnType<typeof compareDocuments>>;
    let xml: string;

    await given('original and revised paragraph-insert fixture documents are loaded', async () => {
      const originalPath = join(
        projectRoot,
        'packages/docx-core/src/testing/fixtures/paragraph-insert/original.docx'
      );
      const revisedPath = join(
        projectRoot,
        'packages/docx-core/src/testing/fixtures/paragraph-insert/revised.docx'
      );

      [originalBuf, revisedBuf] = await Promise.all([
        readFile(originalPath),
        readFile(revisedPath),
      ]);
    });

    await when('documents are compared in rebuild mode', async () => {
      result = await compareDocuments(originalBuf, revisedBuf, {
        reconstructionMode: 'rebuild',
        author: 'Test',
      });

      const archive = await DocxArchive.load(result.document);
      xml = await archive.getDocumentXml();
    });

    await then('output uses Aspose-style paragraph insertion markers', async () => {
      // Aspose-style paragraph insertion:
      // <w:p><w:pPr><w:rPr><w:ins .../></w:rPr></w:pPr><w:ins ...>...</w:ins></w:p>
      expect(xml).toMatch(/<w:pPr[\s\S]*?<w:rPr[\s\S]*?<w:ins\b[^>]*\/>/);
      expect(xml).toMatch(/<w:ins\b[^>]*>\s*<w:r\b/);
    });

    await and('output does NOT generate invalid structure', async () => {
      // Must NOT generate invalid structure <w:ins><w:p>...</w:p></w:ins>
      expect(xml).not.toMatch(/<w:ins\b[^>]*>\s*<w:p\b/);
    });

    await and('programmatic reject restores the original paragraph count', async () => {
      // Programmatic reject should restore the original paragraph count
      // (a proxy for "no stub paragraph breaks"). This is a guardrail test.
      const rejectedXml = rejectAllChanges(xml);

      const origXml = await (await DocxArchive.load(originalBuf)).getDocumentXml();
      expect(countParagraphs(rejectedXml)).toBe(countParagraphs(origXml));
    });
  });

  test('reject detects the paragraph mark strictly (pPr/rPr) and ignores w:ins nested in a w:pPrChange snapshot', async ({ given, when, then, and }: AllureBddContext) => {
    // Regression: paragraphHasParaMarker must match only the live w:pPr > w:rPr > w:ins
    // shape, not any descendant w:ins under w:pPr. A w:pPrChange snapshot stores a prior
    // w:pPr/w:rPr that can contain a w:ins; a descendant search would mistake it for the
    // live paragraph mark and drop a paragraph the primitive rejectChanges keeps.
    let xml: string;
    let rejectedXml = '';

    await given('a doc with (A) a paragraph whose only w:ins under pPr is nested in a w:pPrChange + a bare run, and (B) a paragraph with a direct pPr/rPr w:ins mark', () => {
      const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
      xml =
        `<w:document ${ns}><w:body>` +
        // (A) nested-in-pPrChange — NOT a live mark → must survive reject (its run stays)
        '<w:p><w:pPr><w:pPrChange w:id="9" w:author="x" w:date="2024-01-01T00:00:00Z">' +
        '<w:pPr><w:rPr><w:ins w:id="8" w:author="x" w:date="2024-01-01T00:00:00Z"/></w:rPr></w:pPr>' +
        '</w:pPrChange></w:pPr><w:r><w:t>survives</w:t></w:r></w:p>' +
        // (B) direct PPR-INS mark → must be dropped on reject
        '<w:p><w:pPr><w:rPr><w:ins w:id="1" w:author="x" w:date="2024-01-01T00:00:00Z"/></w:rPr></w:pPr>' +
        '<w:ins w:id="2" w:author="x" w:date="2024-01-01T00:00:00Z"><w:r><w:t>inserted</w:t></w:r></w:ins></w:p>' +
        '</w:body></w:document>';
    });

    await when('rejectAllChanges is applied', () => {
      rejectedXml = rejectAllChanges(xml);
    });

    await then('the pPrChange-nested paragraph survives (its run is kept)', () => {
      expect(rejectedXml).toContain('survives');
    });

    await and('the directly-PPR-INS-marked paragraph is dropped', () => {
      expect(rejectedXml).not.toContain('inserted');
      // Exactly one paragraph remains: the pPrChange one kept, the marked one removed.
      expect(countParagraphs(rejectedXml)).toBe(1);
    });
  });
});
