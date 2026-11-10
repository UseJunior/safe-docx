import { describe, expect } from 'vitest';
import { parseXml } from '../src/primitives/xml.js';
import { OOXML } from '../src/primitives/namespaces.js';
import { getParagraphBookmarkId, getW14ParaId, insertParagraphBookmarks } from '../src/primitives/bookmarks.js';
import { DocxDocument } from '../src/primitives/document.js';
import { createRevisionContext, createRevisionIdState } from '../src/primitives/track-changes-emitter.js';
import { createZipBuffer, readZipText } from '../src/primitives/zip.js';
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

      await then('each paragraph receives an identifier matching _bk_[0-9a-f]{10}', () => {
        const paras = doc.getElementsByTagNameNS(OOXML.W_NS, 'p');
        for (let i = 0; i < paras.length; i++) {
          const id = getParagraphBookmarkId(paras[i]);
          expect(id).toMatch(/^_bk_[0-9a-f]{10}$/);
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
        expect(id).toMatch(/^_bk_[0-9a-f]{10}$/);
      });
    },
  );

  test.openspec('Legacy identifiers remain canonical')(
    'preserves and resolves a legacy 12-hex paragraph bookmark',
    async ({ given, when, then }: AllureBddContext) => {
      const legacyId = '_bk_a3f29c10b8e4';
      const doc = makeDoc(
        `<w:p><w:bookmarkStart w:id="1" w:name="${legacyId}"/><w:r><w:t>Legacy</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>`,
      );

      await given('a paragraph carrying a legacy 12-hex safe-docx bookmark', async () => {});
      await when('paragraph bookmarks are allocated again', async () => {
        insertParagraphBookmarks(doc, 'test-attachment');
      });
      await then('the legacy bookmark remains canonical and resolvable', () => {
        const paragraph = doc.getElementsByTagNameNS(OOXML.W_NS, 'p')[0]!;
        expect(getParagraphBookmarkId(paragraph)).toBe(legacyId);
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
          expect(id).toMatch(/^_bk_[0-9a-f]{10}$/);
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

      await then('the colliding paragraphs receive the unsalted hash then the |salt:1 hash', () => {
        expect(duplicateIds.length).toBe(2);
        expect(duplicateIds[0]).toMatch(/^_bk_[0-9a-f]{10}$/);
        expect(duplicateIds[1]).toMatch(/^_bk_[0-9a-f]{10}$/);
        expect(duplicateIds[1]).not.toEqual(duplicateIds[0]);
        // Pin the exact derivation so the test characterizes the salt-loop, not
        // just "two distinct IDs". If buildParagraphSeed later includes sibling
        // position or wider context, both IDs would still be distinct without
        // the salt loop ever running — this assertion fails loudly in that case.
        expect(duplicateIds[0]).toBe('_bk_04c5b72c79'); // sha10(seed)
        expect(duplicateIds[1]).toBe('_bk_a2abd08897'); // sha10(seed|salt:1)
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
          expect(id).toMatch(/^_bk_[0-9a-f]{10}$/);
        }
        expect(firstOpenIds[1]).not.toEqual(firstOpenIds[0]);
        // Pin the cross-open salt assignment so any drift in salt-loop iteration
        // order (e.g., if derivation later considered prior-document state)
        // would fail the test loudly. See companion scenario for the seed math.
        expect(firstOpenIds).toEqual(['_bk_04c5b72c79', '_bk_a2abd08897']);
      });
    },
  );

  test(
    'insertParagraph assigns distinct w14:paraId values and keeps _bk_* IDs stable across save and reopen (#1220)',
    async ({ given, when, then }: AllureBddContext) => {
      const contentTypesXml =
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `</Types>`;
      const relsXml =
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
        `</Relationships>`;
      const documentXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${OOXML.W_NS}" xmlns:w14="${OOXML.W14_NS}" ` +
        `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"><w:body>` +
        `<w:p w14:paraId="10000001" w14:textId="77777777"><w:r><w:t>Alpha</w:t></w:r></w:p>` +
        `<w:p w14:paraId="10000002" w14:textId="77777777"><w:r><w:t>Bravo</w:t></w:r></w:p>` +
        `<w:sectPr/></w:body></w:document>`;

      let doc!: DocxDocument;
      let alphaId = '';
      let bravoId = '';
      let charlieId = '';
      let deltaId = '';
      let echoId = '';
      let foxtrotId = '';

      await given('a document with two w14:paraId-bearing paragraphs Alpha (10000001) and Bravo (10000002)', async () => {
        const buffer = await createZipBuffer({
          '[Content_Types].xml': contentTypesXml,
          '_rels/.rels': relsXml,
          'word/document.xml': documentXml,
        });
        doc = await DocxDocument.load(buffer);
        doc.insertParagraphBookmarks('attachment-1220');
        const initial = doc.readParagraphs().paragraphs;
        alphaId = initial[0]!.id;
        bravoId = initial[1]!.id;
      });

      await when('three tracked insertParagraph calls insert Charlie, Delta (with styleSourceId), and Echo\\n\\nFoxtrot', async () => {
        const idState = createRevisionIdState();
        const ctx = createRevisionContext({ author: 'SafeDocX', idState });

        const insCharlie = doc.insertParagraph({
          positionalAnchorNodeId: bravoId,
          relativePosition: 'AFTER',
          newText: 'Charlie',
        }, ctx);
        charlieId = insCharlie.newParagraphId;

        const insDelta = doc.insertParagraph({
          positionalAnchorNodeId: bravoId,
          relativePosition: 'BEFORE',
          styleSourceId: alphaId,
          newText: 'Delta',
        }, ctx);
        deltaId = insDelta.newParagraphId;

        const insMulti = doc.insertParagraph({
          positionalAnchorNodeId: alphaId,
          relativePosition: 'AFTER',
          newText: 'Echo\n\nFoxtrot',
        }, ctx);
        echoId = insMulti.newParagraphIds[0]!;
        foxtrotId = insMulti.newParagraphIds[1]!;
      });

      await then('no w14:paraId is duplicated in clean or tracked output, and _bk_* IDs remain stable across save and reopen', async () => {
        const expectedOrderIds = [alphaId, echoId, foxtrotId, deltaId, bravoId, charlieId];
        expect(new Set(expectedOrderIds).size).toBe(6);

        const trackedSaved = await doc.toBuffer({ cleanBookmarks: true });
        const cleanSaved = await doc.toAcceptedBuffer({ author: 'SafeDocX' }, { cleanBookmarks: true });

        for (const [label, savedBuffer] of [['tracked', trackedSaved.buffer], ['clean', cleanSaved.buffer]] as const) {
          const savedXml = (await readZipText(savedBuffer, 'word/document.xml'))!;
          const parsed = parseXml(savedXml);
          const paragraphs = Array.from(parsed.getElementsByTagNameNS(OOXML.W_NS, 'p'));
          expect(paragraphs, `${label} paragraph count`).toHaveLength(6);

          const paraIds = paragraphs.map((p) => getW14ParaId(p as Element)?.toUpperCase() ?? null);
          expect(paraIds.every((id) => id !== null && /^[0-9A-F]{8}$/.test(id)), `${label} valid 8-hex paraIds`).toBe(true);
          expect(new Set(paraIds).size, `${label} unique w14:paraId count`).toBe(6);
          expect(paraIds[0]).toBe('10000001');
          expect(paraIds[4]).toBe('10000002');
          for (const insertedIndex of [1, 2, 3, 5]) {
            expect(paraIds[insertedIndex]).not.toBe('10000001');
            expect(paraIds[insertedIndex]).not.toBe('10000002');
          }

          const reopened = await DocxDocument.load(savedBuffer);
          reopened.insertParagraphBookmarks('reopened-1220');
          const reopenedIds = reopened.readParagraphs().paragraphs.map((p) => p.id);
          expect(reopenedIds, `${label} reopened _bk_* IDs`).toEqual(expectedOrderIds);
        }
      });
    },
  );
});
