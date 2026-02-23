import { describe, expect } from 'vitest';
import { itAllure } from '../testing/allure-test.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { compareDocuments } from '../index.js';
import { rejectAllChanges } from '../baselines/atomizer/trackChangesAcceptorAst.js';

function countParagraphs(xml: string): number {
  return (xml.match(/<w:p(\s|>)/g) ?? []).length;
}

describe('Paragraph-Level Track Changes Markers (Aspose-Style)', () => {
  const it = itAllure.epic('Document Comparison').withLabels({ feature: 'Paragraph-level markers' });
  const projectRoot = join(dirname(import.meta.url.replace('file://', '')), '../../../..');

  it('encodes inserted/deleted paragraphs with pPr-level marker and rejects without stubs', async () => {
    const originalPath = join(
      projectRoot,
      'packages/docx-comparison/src/testing/fixtures/paragraph-insert/original.docx'
    );
    const revisedPath = join(
      projectRoot,
      'packages/docx-comparison/src/testing/fixtures/paragraph-insert/revised.docx'
    );

    const [originalBuf, revisedBuf] = await Promise.all([
      readFile(originalPath),
      readFile(revisedPath),
    ]);

    const result = await compareDocuments(originalBuf, revisedBuf, {
      engine: 'atomizer',
      reconstructionMode: 'rebuild',
      author: 'Test',
    });

    const archive = await DocxArchive.load(result.document);
    const xml = await archive.getDocumentXml();

    // Aspose-style paragraph insertion:
    // <w:p><w:pPr><w:rPr><w:ins .../></w:rPr></w:pPr><w:ins ...>...</w:ins></w:p>
    expect(xml).toMatch(/<w:pPr[\s\S]*?<w:rPr[\s\S]*?<w:ins\b[^>]*\/>/);
    expect(xml).toMatch(/<w:ins\b[^>]*>\s*<w:r\b/);

    // Must NOT generate invalid structure <w:ins><w:p>...</w:p></w:ins>
    expect(xml).not.toMatch(/<w:ins\b[^>]*>\s*<w:p\b/);

    // Programmatic reject should restore the original paragraph count
    // (a proxy for "no stub paragraph breaks"). This is a guardrail test.
    const rejectedXml = rejectAllChanges(xml);

    const origXml = await (await DocxArchive.load(originalBuf)).getDocumentXml();
    expect(countParagraphs(rejectedXml)).toBe(countParagraphs(origXml));
  });
});
