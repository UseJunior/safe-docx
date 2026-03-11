import { describe, expect } from 'vitest';
import { parseXml } from '../src/primitives/xml.js';
import { OOXML } from '../src/primitives/namespaces.js';
import { getParagraphBookmarkId, insertParagraphBookmarks } from '../src/primitives/bookmarks.js';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Bookmarks' });

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${OOXML.W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

describe('Traceability: docx-primitives — Paragraph Bookmarks', () => {
  test.openspec('insertParagraphBookmarks mints IDs matching expected pattern')(
    'insertParagraphBookmarks mints IDs matching expected pattern',
    async ({ when, then, attachPrettyJson }: AllureBddContext) => {
      let doc!: Document;
      let result: unknown;
      doc = makeDoc('<w:p><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p>');

      await when('insertParagraphBookmarks is called on paragraphs lacking bookmarks', async () => {
        result = insertParagraphBookmarks(doc, 'test-attachment');
        await attachPrettyJson('Result', result);
      });

      await then('each paragraph receives a _bk_* identifier matching the pattern', () => {
        const paras = doc.getElementsByTagNameNS(OOXML.W_NS, 'p');
        for (let i = 0; i < paras.length; i++) {
          const id = getParagraphBookmarkId(paras[i]);
          expect(id).not.toBeNull();
          expect(id).toMatch(/^_bk_[0-9a-f]{12}$/);
        }
      });
    },
  );

  test.openspec('getParagraphBookmarkId retrieves minted ID')(
    'getParagraphBookmarkId retrieves minted ID',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let doc!: Document;
      let id: string | null = null;

      await given('a paragraph with a previously minted _bk_* bookmark', async () => {
        doc = makeDoc('<w:p><w:r><w:t>Test</w:t></w:r></w:p>');
        insertParagraphBookmarks(doc, 'test-attachment');
      });

      await when('getParagraphBookmarkId is called', async () => {
        const para = doc.getElementsByTagNameNS(OOXML.W_NS, 'p')[0];
        id = getParagraphBookmarkId(para);
        await attachPrettyJson('Result', { id });
      });

      await then('the result returns the stable identifier', () => {
        expect(id).not.toBeNull();
        expect(id).toMatch(/^_bk_[0-9a-f]{12}$/);
      });
    },
  );
});
