import { describe, expect } from 'vitest';
import { parseXml } from './xml.js';
import { OOXML } from './namespaces.js';
import { getParagraphBookmarkId, insertParagraphBookmarks } from './bookmarks.js';
import { itAllure, allureStep, allureJsonAttachment } from './testing/allure-test.js';

const TEST_FEATURE = 'docx-primitives';

const it = itAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });

const humanReadableIt = it.allure({
  
  tags: ['human-readable'],
  
  parameters: { audience: 'non-technical' },
  
});

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${OOXML.W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

describe('Traceability: docx-primitives — Paragraph Bookmarks', () => {
  humanReadableIt.openspec('insertParagraphBookmarks mints IDs matching expected pattern')('Scenario: insertParagraphBookmarks mints IDs matching expected pattern', async () => {
    const doc = makeDoc('<w:p><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p>');

    await allureStep('When insertParagraphBookmarks is called on paragraphs lacking bookmarks', async () => {
      const result = insertParagraphBookmarks(doc, 'test-attachment');
      await allureJsonAttachment('Result', result);
    });

    await allureStep('Then each paragraph SHALL receive a _bk_* identifier matching the pattern', () => {
      const paras = doc.getElementsByTagNameNS(OOXML.W_NS, 'p');
      for (let i = 0; i < paras.length; i++) {
        const id = getParagraphBookmarkId(paras[i]!);
        expect(id).not.toBeNull();
        expect(id).toMatch(/^_bk_[0-9a-f]{12}$/);
      }
    });
  });

  humanReadableIt.openspec('getParagraphBookmarkId retrieves minted ID')('Scenario: getParagraphBookmarkId retrieves minted ID', async () => {
    const doc = makeDoc('<w:p><w:r><w:t>Test</w:t></w:r></w:p>');

    await allureStep('Given a paragraph with a previously minted _bk_* bookmark', async () => {
      insertParagraphBookmarks(doc, 'test-attachment');
    });

    const id = await allureStep('When getParagraphBookmarkId is called', async () => {
      const para = doc.getElementsByTagNameNS(OOXML.W_NS, 'p')[0]!;
      const result = getParagraphBookmarkId(para);
      await allureJsonAttachment('Result', { id: result });
      return result;
    });

    await allureStep('Then the result SHALL return the stable identifier', () => {
      expect(id).not.toBeNull();
      expect(id).toMatch(/^_bk_[0-9a-f]{12}$/);
    });
  });
});
