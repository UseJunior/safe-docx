import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { compareDocuments } from '../index.js';
import { rejectAllChanges } from '../baselines/atomizer/trackChangesAcceptorAst.js';

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
        engine: 'atomizer',
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
});
