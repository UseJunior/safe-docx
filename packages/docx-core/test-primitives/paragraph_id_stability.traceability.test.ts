import { describe, expect } from 'vitest';
import { parseXml } from '../src/primitives/xml.js';
import { OOXML } from '../src/primitives/namespaces.js';
import { getParagraphBookmarkId, insertParagraphBookmarks } from '../src/primitives/bookmarks.js';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

const TEST_FEATURE = 'document-paragraph-id-stability-and-fingerprint';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${OOXML.W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

describe('Traceability: document-paragraph-id-stability-and-fingerprint — Paragraph Bookmark Identity', () => {
  test.openspec('insertParagraphBookmarks mints IDs matching expected pattern')(
    'insertParagraphBookmarks mints IDs matching expected pattern',
    async ({ when, then }: AllureBddContext) => {
      const doc = makeDoc(
        '<w:p><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p>',
      );

      await when('insertParagraphBookmarks is called', async () => {
        insertParagraphBookmarks(doc, 'test-attachment');
      });

      await then('each paragraph receives an identifier matching _bk_[0-9a-f]{12}', () => {
        const paras = doc.getElementsByTagNameNS(OOXML.W_NS, 'p');
        for (let i = 0; i < paras.length; i++) {
          const id = getParagraphBookmarkId(paras[i]);
          expect(id).toMatch(/^_bk_[0-9a-f]{12}$/);
        }
      });
    },
  );

  test.openspec('getParagraphBookmarkId retrieves minted ID')(
    'getParagraphBookmarkId retrieves minted ID',
    async ({ given, when, then }: AllureBddContext) => {
      const doc = makeDoc('<w:p><w:r><w:t>Test paragraph</w:t></w:r></w:p>');
      let id: string | null = null;

      await given('insertParagraphBookmarks has minted an identifier', async () => {
        insertParagraphBookmarks(doc, 'test-attachment');
      });

      await when('getParagraphBookmarkId is called on the paragraph', async () => {
        const para = doc.getElementsByTagNameNS(OOXML.W_NS, 'p')[0];
        id = getParagraphBookmarkId(para);
      });

      await then('the result returns the stable identifier', () => {
        expect(id).toMatch(/^_bk_[0-9a-f]{12}$/);
      });
    },
  );

  test.openspec('Identifiers are stable across reopens of the same document')(
    'Identifiers are stable across reopens of the same document',
    async ({ given, when, then }: AllureBddContext) => {
      const xmlBody =
        '<w:p><w:r><w:t>Indemnification clause.</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Governing law clause.</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Termination clause.</w:t></w:r></w:p>';

      let firstOpenIds: (string | null)[] = [];
      let secondOpenIds: (string | null)[] = [];

      await given('the same document content is opened twice independently', async () => {
        const doc1 = makeDoc(xmlBody);
        insertParagraphBookmarks(doc1, 'test-attachment');
        firstOpenIds = Array.from(
          doc1.getElementsByTagNameNS(OOXML.W_NS, 'p'),
        ).map((p) => getParagraphBookmarkId(p as Element));

        const doc2 = makeDoc(xmlBody);
        insertParagraphBookmarks(doc2, 'test-attachment');
        secondOpenIds = Array.from(
          doc2.getElementsByTagNameNS(OOXML.W_NS, 'p'),
        ).map((p) => getParagraphBookmarkId(p as Element));
      });

      await when('the identifiers are compared paragraph by paragraph', async () => {
        // No-op step; comparison happens in then.
      });

      await then('identifiers are byte-identical across opens', () => {
        expect(firstOpenIds.length).toBe(3);
        expect(secondOpenIds).toEqual(firstOpenIds);
        for (const id of firstOpenIds) {
          expect(id).toMatch(/^_bk_[0-9a-f]{12}$/);
        }
      });
    },
  );

  test.openspec('insertParagraphBookmarks resolves seed collisions with a deterministic salt')(
    'insertParagraphBookmarks resolves seed collisions with a deterministic salt',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      const xmlBody =
        '<w:p><w:r><w:t>Anchor context.</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Duplicate clause.</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Tail context.</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Anchor context.</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Duplicate clause.</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Tail context.</w:t></w:r></w:p>';
      const doc = makeDoc(xmlBody);
      let duplicateIds: (string | null)[] = [];

      await given('two paragraphs have identical text and identical neighbor context', async () => {
        await attachPrettyJson('Collision fixture', {
          duplicateParagraphIndexes: [1, 4],
          duplicateText: 'Duplicate clause.',
          previousText: 'Anchor context.',
          nextText: 'Tail context.',
        });
      });

      await when('insertParagraphBookmarks is called', async () => {
        insertParagraphBookmarks(doc, 'test-attachment');
        const paragraphs = Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, 'p'));
        duplicateIds = [paragraphs[1], paragraphs[4]].map((p) => getParagraphBookmarkId(p as Element));
        await attachPrettyJson('Duplicate paragraph identifiers', duplicateIds);
      });

      await then('the colliding paragraphs receive distinct canonical identifiers', () => {
        expect(duplicateIds.length).toBe(2);
        expect(duplicateIds[0]).toMatch(/^_bk_[0-9a-f]{12}$/);
        expect(duplicateIds[1]).toMatch(/^_bk_[0-9a-f]{12}$/);
        expect(duplicateIds[1]).not.toEqual(duplicateIds[0]);
      });
    },
  );

  test.openspec('Collision resolution is stable across independent reopens')(
    'Collision resolution is stable across independent reopens',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      const xmlBody =
        '<w:p><w:r><w:t>Anchor context.</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Duplicate clause.</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Tail context.</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Anchor context.</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Duplicate clause.</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Tail context.</w:t></w:r></w:p>';

      let firstOpenIds: (string | null)[] = [];
      let secondOpenIds: (string | null)[] = [];

      await given('the same colliding paragraph content is opened twice independently', async () => {
        await attachPrettyJson('Collision fixture', {
          duplicateParagraphIndexes: [1, 4],
          duplicateText: 'Duplicate clause.',
          previousText: 'Anchor context.',
          nextText: 'Tail context.',
        });
      });

      await when('insertParagraphBookmarks is applied to each open', async () => {
        const doc1 = makeDoc(xmlBody);
        insertParagraphBookmarks(doc1, 'test-attachment');
        const firstParagraphs = Array.from(doc1.getElementsByTagNameNS(OOXML.W_NS, 'p'));
        firstOpenIds = [firstParagraphs[1], firstParagraphs[4]].map((p) =>
          getParagraphBookmarkId(p as Element),
        );

        const doc2 = makeDoc(xmlBody);
        insertParagraphBookmarks(doc2, 'test-attachment');
        const secondParagraphs = Array.from(doc2.getElementsByTagNameNS(OOXML.W_NS, 'p'));
        secondOpenIds = [secondParagraphs[1], secondParagraphs[4]].map((p) =>
          getParagraphBookmarkId(p as Element),
        );

        await attachPrettyJson('Duplicate paragraph identifiers by open', {
          firstOpenIds,
          secondOpenIds,
        });
      });

      await then('collision salts are assigned byte-identically by document order', () => {
        expect(firstOpenIds.length).toBe(2);
        expect(secondOpenIds).toEqual(firstOpenIds);
        for (const id of firstOpenIds) {
          expect(id).toMatch(/^_bk_[0-9a-f]{12}$/);
        }
        expect(firstOpenIds[1]).not.toEqual(firstOpenIds[0]);
      });
    },
  );
});
