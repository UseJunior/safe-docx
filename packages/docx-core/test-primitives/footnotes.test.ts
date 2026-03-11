import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { OOXML, W } from '../src/primitives/namespaces.js';
import { parseXml, serializeXml } from '../src/primitives/xml.js';
import {
  addFootnote,
  bootstrapFootnoteParts,
  deleteFootnote,
  getFootnote,
  getFootnotes,
  isReservedFootnote,
  updateFootnoteText,
} from '../src/primitives/footnotes.js';
import { DocxZip } from '../src/primitives/zip.js';
import { getParagraphBookmarkId, insertParagraphBookmarks } from '../src/primitives/bookmarks.js';
import { getParagraphText } from '../src/primitives/text.js';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

const TEST_FEATURE = 'add-footnote-support';
const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });
const humanReadableTest = test.allure({
  tags: ['human-readable'],
  parameters: { audience: 'non-technical' },
});

function makeDocument(bodyXml: string): Document {
  return parseXml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${OOXML.W_NS}" xmlns:r="${OOXML.R_NS}">` +
      `<w:body>${bodyXml}</w:body>` +
      `</w:document>`,
  );
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function makeFootnotesXml(
  entries: Array<{ id: number; type?: 'separator' | 'continuationSeparator'; text?: string; paragraphXml?: string }>,
): string {
  const rendered = entries
    .map((entry) => {
      const typeAttr = entry.type ? ` w:type="${entry.type}"` : '';
      if (entry.paragraphXml) {
        return `<w:footnote w:id="${entry.id}"${typeAttr}>${entry.paragraphXml}</w:footnote>`;
      }
      const text = escapeXmlText(entry.text ?? '');
      return (
        `<w:footnote w:id="${entry.id}"${typeAttr}>` +
        `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
        `</w:footnote>`
      );
    })
    .join('');

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:footnotes xmlns:w="${OOXML.W_NS}" xmlns:w14="${OOXML.W14_NS}">` +
    rendered +
    `</w:footnotes>`
  );
}

const RESERVED_FOOTNOTES_XML = makeFootnotesXml([
  {
    id: -1,
    type: 'separator',
    paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>',
  },
  {
    id: 0,
    type: 'continuationSeparator',
    paragraphXml: '<w:p><w:r><w:continuationSeparator/></w:r></w:p>',
  },
]);

function getParagraphs(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, W.p));
}

function getFootnoteReferences(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, W.footnoteReference));
}

async function makeZipFromDocumentXml(documentXml: string, extraFiles?: Record<string, string>): Promise<DocxZip> {
  const zip = new JSZip();
  zip.file('word/document.xml', documentXml);
  for (const [name, content] of Object.entries(extraFiles ?? {})) {
    zip.file(name, content);
  }
  const buffer = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
  return DocxZip.load(buffer);
}

async function makeZipFromDocument(doc: Document, extraFiles?: Record<string, string>): Promise<DocxZip> {
  return makeZipFromDocumentXml(serializeXml(doc), extraFiles);
}

async function readFootnotesXml(zip: DocxZip): Promise<Document> {
  return parseXml(await zip.readText('word/footnotes.xml'));
}

function findFootnoteById(doc: Document, id: number): Element | null {
  const nodes = doc.getElementsByTagNameNS(OOXML.W_NS, W.footnote);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes.item(i) as Element;
    const raw = node.getAttributeNS(OOXML.W_NS, 'id') ?? node.getAttribute('w:id');
    if (raw && Number.parseInt(raw, 10) === id) return node;
  }
  return null;
}

describe('footnotes', () => {
  describe('bootstrapFootnoteParts', () => {
    humanReadableTest.openspec('bootstrap creates footnotes.xml when missing')(
      'Scenario: bootstrap creates footnotes.xml when missing',
      async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
        let zip: DocxZip;
        let result: Awaited<ReturnType<typeof bootstrapFootnoteParts>>;

        await given('a document with no footnotes.xml', async () => {
          const documentXml = makeDocument('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
          zip = await makeZipFromDocument(documentXml);
        });

        await when('bootstrapFootnoteParts is called', async () => {
          result = await bootstrapFootnoteParts(zip);
        });

        await then('footnotes.xml is created with separators', async () => {
          expect(result.partsCreated).toEqual(['word/footnotes.xml']);
          const footnotesXml = await zip.readText('word/footnotes.xml');
          expect(footnotesXml).toContain('w:type="separator"');
          expect(footnotesXml).toContain('w:type="continuationSeparator"');
        });

        await and('content types and rels are updated', async () => {
          const contentTypesXml = await zip.readText('[Content_Types].xml');
          const relsXml = await zip.readText('word/_rels/document.xml.rels');
          expect(contentTypesXml).toContain('/word/footnotes.xml');
          expect(relsXml).toContain('Target="footnotes.xml"');

          await attachPrettyJson('bootstrap-footnotes-artifacts', {
            partsCreated: result.partsCreated,
            footnotesXml: await zip.readText('word/footnotes.xml'),
            contentTypesXml,
            relsXml,
          });
        });
      },
    );

    humanReadableTest.openspec('bootstrap is idempotent')(
      'Scenario: bootstrap is idempotent',
      async ({ given, when, then }: AllureBddContext) => {
        let zip: DocxZip;
        let first: Awaited<ReturnType<typeof bootstrapFootnoteParts>>;
        let firstFootnotes: string;
        let second: Awaited<ReturnType<typeof bootstrapFootnoteParts>>;
        let secondFootnotes: string;

        await given('a document bootstrapped once', async () => {
          const documentXml = makeDocument('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
          zip = await makeZipFromDocument(documentXml);
          first = await bootstrapFootnoteParts(zip);
          firstFootnotes = await zip.readText('word/footnotes.xml');
        });

        await when('bootstrapFootnoteParts is called again', async () => {
          second = await bootstrapFootnoteParts(zip);
          secondFootnotes = await zip.readText('word/footnotes.xml');
        });

        await then('no parts are created and XML is unchanged', async () => {
          expect(first.partsCreated).toEqual(['word/footnotes.xml']);
          expect(second.partsCreated).toEqual([]);
          expect(secondFootnotes).toBe(firstFootnotes);
        });
      },
    );

    test('adds footnote entries when content-types and rels files already exist', async ({ given, when, then, and }: AllureBddContext) => {
      let zip: DocxZip;
      let result: Awaited<ReturnType<typeof bootstrapFootnoteParts>>;

      await given('a document with existing content-types and rels', async () => {
        const documentXml = makeDocument('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
        zip = await makeZipFromDocument(documentXml, {
          '[Content_Types].xml':
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
            `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
            `</Types>`,
          'word/_rels/document.xml.rels':
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<Relationships xmlns="${OOXML.REL_NS}">` +
            `<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
            `</Relationships>`,
        });
      });

      await when('bootstrapFootnoteParts is called', async () => {
        result = await bootstrapFootnoteParts(zip);
      });

      await then('footnotes.xml is created', async () => {
        expect(result.partsCreated).toEqual(['word/footnotes.xml']);
      });

      await and('content types and rels include footnotes', async () => {
        const contentTypes = await zip.readText('[Content_Types].xml');
        const rels = await zip.readText('word/_rels/document.xml.rels');
        expect(contentTypes).toContain('/word/footnotes.xml');
        expect(rels).toContain('relationships/footnotes');
        expect(rels).toContain('Target="footnotes.xml"');
      });
    });

    humanReadableTest.openspec('bootstrap preserves existing reserved entries')(
      'Scenario: bootstrap preserves existing reserved entries',
      async ({ given, when, then }: AllureBddContext) => {
        let zip: DocxZip;
        let existingFootnotes: string;
        let result: Awaited<ReturnType<typeof bootstrapFootnoteParts>>;

        await given('a document with existing footnotes including reserved', async () => {
          existingFootnotes = makeFootnotesXml([
            {
              id: -1,
              type: 'separator',
              paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>',
            },
            {
              id: 0,
              type: 'continuationSeparator',
              paragraphXml: '<w:p><w:r><w:continuationSeparator/></w:r></w:p>',
            },
            { id: 7, text: 'Pre-existing note' },
          ]);
          const doc = makeDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p>');
          zip = await makeZipFromDocument(doc, { 'word/footnotes.xml': existingFootnotes });
        });

        await when('bootstrapFootnoteParts is called', async () => {
          result = await bootstrapFootnoteParts(zip);
        });

        await then('no parts created and reserved entries preserved', async () => {
          const after = await zip.readText('word/footnotes.xml');
          expect(result.partsCreated).toEqual([]);
          expect(after).toBe(existingFootnotes);

          const parsed = parseXml(after).getElementsByTagNameNS(OOXML.W_NS, W.footnote);
          expect(isReservedFootnote(parsed.item(0) as Element)).toBe(true);
          expect(isReservedFootnote(parsed.item(1) as Element)).toBe(true);
        });
      },
    );
  });

  describe('reading', () => {
    humanReadableTest.openspec('read from empty document returns empty array')(
      'Scenario: read from empty document returns empty array',
      async ({ given, when, then }: AllureBddContext) => {
        let notes: Awaited<ReturnType<typeof getFootnotes>>;

        await given('a document with no footnote references', async () => {
          // setup is inline
        });

        await when('getFootnotes is called', async () => {
          const doc = makeDocument('<w:p><w:r><w:t>No notes</w:t></w:r></w:p>');
          const zip = await makeZipFromDocument(doc);
          notes = await getFootnotes(zip, doc);
        });

        await then('an empty array is returned', async () => {
          expect(notes).toEqual([]);
        });
      },
    );

    humanReadableTest.openspec('read footnotes from document with multiple footnotes')(
      'Scenario: read footnotes from document with multiple footnotes',
      async ({ given, when, then }: AllureBddContext) => {
        let notes: Awaited<ReturnType<typeof getFootnotes>>;

        await given('a document with three footnote references', async () => {
          // setup is inline
        });

        await when('getFootnotes is called', async () => {
          const doc = makeDocument(
            '<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="4"/></w:r></w:p>' +
              '<w:p><w:r><w:t>B</w:t><w:footnoteReference w:id="5"/></w:r></w:p>' +
              '<w:p><w:r><w:t>C</w:t><w:footnoteReference w:id="6"/></w:r></w:p>',
          );
          const zip = await makeZipFromDocument(doc, {
            'word/footnotes.xml': makeFootnotesXml([
              { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
              { id: 0, type: 'continuationSeparator', paragraphXml: '<w:p><w:r><w:continuationSeparator/></w:r></w:p>' },
              { id: 4, text: 'Alpha note' },
              { id: 5, text: 'Beta note' },
              { id: 6, text: 'Gamma note' },
            ]),
          });
          notes = await getFootnotes(zip, doc);
        });

        await then('three footnotes with correct data are returned', async () => {
          expect(notes).toHaveLength(3);
          expect(notes.map((n) => n.id)).toEqual([4, 5, 6]);
          expect(notes.map((n) => n.text)).toEqual(['Alpha note', 'Beta note', 'Gamma note']);
          expect(notes.map((n) => n.displayNumber)).toEqual([1, 2, 3]);
        });
      },
    );

    humanReadableTest.openspec('display numbers follow document order')(
      'Scenario: display numbers follow document order',
      async ({ given, when, then }: AllureBddContext) => {
        let notes: Awaited<ReturnType<typeof getFootnotes>>;

        await given('a document with out-of-order footnote IDs', async () => {
          // setup is inline
        });

        await when('getFootnotes is called', async () => {
          const doc = makeDocument(
            '<w:p><w:r><w:t>First</w:t><w:footnoteReference w:id="8"/></w:r></w:p>' +
              '<w:p><w:r><w:t>Second</w:t><w:footnoteReference w:id="4"/></w:r></w:p>' +
              '<w:p><w:r><w:t>Third</w:t><w:footnoteReference w:id="8"/></w:r></w:p>' +
              '<w:p><w:r><w:t>Fourth</w:t><w:footnoteReference w:id="6"/></w:r></w:p>',
          );
          const zip = await makeZipFromDocument(doc, {
            'word/footnotes.xml': makeFootnotesXml([
              { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
              { id: 0, type: 'continuationSeparator', paragraphXml: '<w:p><w:r><w:continuationSeparator/></w:r></w:p>' },
              { id: 4, text: 'N4' },
              { id: 6, text: 'N6' },
              { id: 8, text: 'N8' },
            ]),
          });
          notes = await getFootnotes(zip, doc);
        });

        await then('display numbers follow document order', async () => {
          expect(notes.map((n) => ({ id: n.id, display: n.displayNumber }))).toEqual([
            { id: 8, display: 1 },
            { id: 4, display: 2 },
            { id: 6, display: 3 },
          ]);
        });
      },
    );

    humanReadableTest.openspec('anchored paragraph IDs resolved')(
      'Scenario: anchored paragraph IDs resolved',
      async ({ given, when, then }: AllureBddContext) => {
        let notes: Awaited<ReturnType<typeof getFootnotes>>;
        let expected: (string | null)[];

        await given('a document with bookmarked paragraphs', async () => {
          // setup is inline
        });

        await when('getFootnotes is called after bookmark insertion', async () => {
          const doc = makeDocument(
            '<w:p><w:r><w:t>Para A</w:t><w:footnoteReference w:id="1"/></w:r></w:p>' +
              '<w:p><w:r><w:t>Para B</w:t><w:footnoteReference w:id="2"/></w:r></w:p>',
          );
          insertParagraphBookmarks(doc, 'footnotes-test');
          const paragraphs = getParagraphs(doc);
          expected = paragraphs.map((p) => getParagraphBookmarkId(p));
          expect(expected[0]).toMatch(/^_bk_/);
          expect(expected[1]).toMatch(/^_bk_/);

          const zip = await makeZipFromDocument(doc, {
            'word/footnotes.xml': makeFootnotesXml([
              { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
              { id: 0, type: 'continuationSeparator', paragraphXml: '<w:p><w:r><w:continuationSeparator/></w:r></w:p>' },
              { id: 1, text: 'A-note' },
              { id: 2, text: 'B-note' },
            ]),
          });
          notes = await getFootnotes(zip, doc);
        });

        await then('anchored paragraph IDs match bookmarks', async () => {
          expect(notes.map((n) => n.anchoredParagraphId)).toEqual(expected);
        });
      },
    );

    humanReadableTest.openspec('mixed-run references handled')(
      'Scenario: mixed-run references handled',
      async ({ given, when, then }: AllureBddContext) => {
        let notes: Awaited<ReturnType<typeof getFootnotes>>;

        await given('a paragraph with mixed-run footnote reference', async () => {
          // setup is inline
        });

        await when('getFootnotes is called', async () => {
          const doc = makeDocument(
            '<w:p><w:r><w:t>Alpha</w:t><w:footnoteReference w:id="9"/><w:t>Beta</w:t></w:r></w:p>',
          );
          const zip = await makeZipFromDocument(doc, {
            'word/footnotes.xml': makeFootnotesXml([
              { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
              { id: 0, type: 'continuationSeparator', paragraphXml: '<w:p><w:r><w:continuationSeparator/></w:r></w:p>' },
              {
                id: 9,
                paragraphXml:
                  '<w:p>' +
                  '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>' +
                  '<w:r><w:t>Mixed run note</w:t></w:r>' +
                  '</w:p>',
              },
            ]),
          });
          notes = await getFootnotes(zip, doc);
        });

        await then('footnote is found with correct text', async () => {
          expect(notes).toHaveLength(1);
          expect(notes[0]?.id).toBe(9);
          expect(notes[0]?.text).toBe('Mixed run note');
        });
      },
    );

    test('getFootnote returns one item by ID and null when not found', async ({ given, when, then, and }: AllureBddContext) => {
      let found: Awaited<ReturnType<typeof getFootnote>>;
      let missing: Awaited<ReturnType<typeof getFootnote>>;

      await given('a document with footnote ID 3', async () => {
        // setup is inline
      });

      await when('getFootnote is called with ID 3 and 999', async () => {
        const doc = makeDocument('<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="3"/></w:r></w:p>');
        const zip = await makeZipFromDocument(doc, {
          'word/footnotes.xml': makeFootnotesXml([
            { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
            { id: 0, type: 'continuationSeparator', paragraphXml: '<w:p><w:r><w:continuationSeparator/></w:r></w:p>' },
            { id: 3, text: 'Find me' },
          ]),
        });
        found = await getFootnote(zip, doc, 3);
        missing = await getFootnote(zip, doc, 999);
      });

      await then('found footnote has correct text', async () => {
        expect(found?.text).toBe('Find me');
      });

      await and('missing ID returns null', async () => {
        expect(missing).toBeNull();
      });
    });
  });

  describe('addFootnote', () => {
    humanReadableTest.openspec('add footnote at end of paragraph')(
      'Scenario: add footnote at end of paragraph',
      async ({ given, when, then }: AllureBddContext) => {
        let doc: Document;
        let zip: DocxZip;
        let result: Awaited<ReturnType<typeof addFootnote>>;

        await given('a document with one paragraph', async () => {
          doc = makeDocument('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
          zip = await makeZipFromDocument(doc, { 'word/footnotes.xml': RESERVED_FOOTNOTES_XML });
        });

        await when('addFootnote is called at end of paragraph', async () => {
          const paragraph = getParagraphs(doc)[0]!;
          result = await addFootnote(doc, zip, {
            paragraphEl: paragraph,
            text: 'End note',
          });
        });

        await then('footnote reference is inserted with ID 1', async () => {
          expect(result.noteId).toBe(1);
          const refs = getFootnoteReferences(doc);
          expect(refs).toHaveLength(1);
          expect(serializeXml(doc)).toContain('w:footnoteReference w:id="1"');
        });
      },
    );

    humanReadableTest.openspec('add footnote after specific text with mid-run split')(
      'Scenario: add footnote after specific text with mid-run split',
      async ({ given, when, then }: AllureBddContext) => {
        let doc: Document;
        let zip: DocxZip;

        await given('a document with "Hello World" in one run', async () => {
          doc = makeDocument('<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>');
          zip = await makeZipFromDocument(doc, { 'word/footnotes.xml': RESERVED_FOOTNOTES_XML });
        });

        await when('addFootnote is called after "Hello"', async () => {
          const paragraph = getParagraphs(doc)[0]!;
          await addFootnote(doc, zip, {
            paragraphEl: paragraph,
            afterText: 'Hello',
            text: 'Split note',
          });
        });

        await then('reference is between "Hello" and " World"', async () => {
          const serialized = serializeXml(doc);
          const helloIndex = serialized.indexOf('>Hello<');
          const refIndex = serialized.indexOf('footnoteReference');
          const worldIndex = serialized.indexOf('> World<');
          expect(helloIndex).toBeGreaterThan(-1);
          expect(refIndex).toBeGreaterThan(helloIndex);
          expect(worldIndex).toBeGreaterThan(refIndex);
        });
      },
    );

    test('inserts after boundary match when afterText ends exactly at a run boundary', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let zip: DocxZip;

      await given('a document with "Hello" and " World" in two runs', async () => {
        doc = makeDocument(
          '<w:p>' +
            '<w:r><w:t>Hello</w:t></w:r>' +
            '<w:r><w:t xml:space="preserve"> World</w:t></w:r>' +
            '</w:p>',
        );
        zip = await makeZipFromDocument(doc, { 'word/footnotes.xml': RESERVED_FOOTNOTES_XML });
      });

      await when('addFootnote is called after "Hello"', async () => {
        const paragraph = getParagraphs(doc)[0]!;
        await addFootnote(doc, zip, {
          paragraphEl: paragraph,
          afterText: 'Hello',
          text: 'Boundary note',
        });
      });

      await then('reference is between the two runs', async () => {
        const serialized = serializeXml(doc);
        const firstRun = serialized.indexOf('>Hello<');
        const refRun = serialized.indexOf('footnoteReference');
        const secondRun = serialized.indexOf('> World<');
        expect(firstRun).toBeGreaterThan(-1);
        expect(refRun).toBeGreaterThan(firstRun);
        expect(secondRun).toBeGreaterThan(refRun);
      });
    });

    humanReadableTest.openspec('ID allocation skips reserved entries by type')(
      'Scenario: ID allocation skips reserved entries by type',
      async ({ given, when, then }: AllureBddContext) => {
        let doc: Document;
        let zip: DocxZip;
        let result: Awaited<ReturnType<typeof addFootnote>>;

        await given('a document with existing user footnote ID 7', async () => {
          doc = makeDocument('<w:p><w:r><w:t>Allocate</w:t></w:r></w:p>');
          zip = await makeZipFromDocument(doc, {
            'word/footnotes.xml': makeFootnotesXml([
              { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
              { id: 0, type: 'continuationSeparator', paragraphXml: '<w:p><w:r><w:continuationSeparator/></w:r></w:p>' },
              { id: 7, text: 'Existing user note' },
            ]),
          });
        });

        await when('addFootnote is called', async () => {
          const paragraph = getParagraphs(doc)[0]!;
          result = await addFootnote(doc, zip, {
            paragraphEl: paragraph,
            text: 'Next id note',
          });
        });

        await then('allocated ID is 8', async () => {
          expect(result.noteId).toBe(8);
        });
      },
    );

    humanReadableTest.openspec('footnote body includes Word-compatible skeleton')(
      'Scenario: footnote body includes Word-compatible skeleton',
      async ({ given, when, then }: AllureBddContext) => {
        let doc: Document;
        let zip: DocxZip;

        await given('a document with one paragraph', async () => {
          doc = makeDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p>');
          zip = await makeZipFromDocument(doc, { 'word/footnotes.xml': RESERVED_FOOTNOTES_XML });
        });

        await when('addFootnote is called with padded text', async () => {
          const paragraph = getParagraphs(doc)[0]!;
          await addFootnote(doc, zip, {
            paragraphEl: paragraph,
            text: '  padded text  ',
          });
        });

        await then('footnotes XML has Word-compatible skeleton', async () => {
          const footnotesXml = await zip.readText('word/footnotes.xml');
          expect(footnotesXml).toContain('<w:pStyle w:val="FootnoteText"/>');
          expect(footnotesXml).toContain('<w:rStyle w:val="FootnoteReference"/>');
          expect(footnotesXml).toContain('<w:footnoteRef/>');
          expect(footnotesXml).toContain('xml:space="preserve"');
        });
      },
    );

    test('throws when afterText is not found', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let zip: DocxZip;

      await given('a document without "Missing" text', async () => {
        doc = makeDocument('<w:p><w:r><w:t>No target here</w:t></w:r></w:p>');
        zip = await makeZipFromDocument(doc, { 'word/footnotes.xml': RESERVED_FOOTNOTES_XML });
      });

      await when('addFootnote is called with afterText "Missing"', async () => {
        // assertion is in then step
      });

      await then('an error is thrown', async () => {
        const paragraph = getParagraphs(doc)[0]!;
        await expect(
          addFootnote(doc, zip, {
            paragraphEl: paragraph,
            afterText: 'Missing',
            text: 'Not added',
          }),
        ).rejects.toThrow("after_text 'Missing' not found in paragraph");
      });
    });

    test('throws when afterText is ambiguous', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let zip: DocxZip;

      await given('a document with "Echo Echo" text', async () => {
        doc = makeDocument('<w:p><w:r><w:t>Echo Echo</w:t></w:r></w:p>');
        zip = await makeZipFromDocument(doc, { 'word/footnotes.xml': RESERVED_FOOTNOTES_XML });
      });

      await when('addFootnote is called with afterText "Echo"', async () => {
        // assertion is in then step
      });

      await then('an ambiguity error is thrown', async () => {
        const paragraph = getParagraphs(doc)[0]!;
        await expect(
          addFootnote(doc, zip, {
            paragraphEl: paragraph,
            afterText: 'Echo',
            text: 'Ambiguous',
          }),
        ).rejects.toThrow("after_text 'Echo' found 2 times in paragraph");
      });
    });
  });

  describe('updateFootnoteText', () => {
    humanReadableTest.openspec('update changes text content')(
      'Scenario: update changes text content',
      async ({ given, when, then }: AllureBddContext) => {
        let zip: DocxZip;

        await given('a document with footnote ID 3', async () => {
          const doc = makeDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p>');
          zip = await makeZipFromDocument(doc, {
            'word/footnotes.xml': makeFootnotesXml([
              { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
              { id: 0, type: 'continuationSeparator', paragraphXml: '<w:p><w:r><w:continuationSeparator/></w:r></w:p>' },
              {
                id: 3,
                paragraphXml:
                  '<w:p>' +
                  '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>' +
                  '<w:r><w:t>old text</w:t></w:r>' +
                  '</w:p>',
              },
            ]),
          });
        });

        await when('updateFootnoteText is called with new text', async () => {
          await updateFootnoteText(zip, { noteId: 3, newText: ' new text ' });
        });

        await then('footnote text is updated and skeleton preserved', async () => {
          const updated = await zip.readText('word/footnotes.xml');
          expect(updated).toContain(' new text ');
          expect(updated).toContain('<w:footnoteRef/>');
          expect(updated).toContain('xml:space="preserve"');
        });
      },
    );

    humanReadableTest.openspec('update preserves other footnotes')(
      'Scenario: update preserves other footnotes',
      async ({ given, when, then }: AllureBddContext) => {
        let zip: DocxZip;

        await given('a document with footnotes ID 4 and 5', async () => {
          const doc = makeDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p>');
          zip = await makeZipFromDocument(doc, {
            'word/footnotes.xml': makeFootnotesXml([
              { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
              { id: 0, type: 'continuationSeparator', paragraphXml: '<w:p><w:r><w:continuationSeparator/></w:r></w:p>' },
              { id: 4, text: 'A old' },
              { id: 5, text: 'B untouched' },
            ]),
          });
        });

        await when('updateFootnoteText is called on ID 4', async () => {
          await updateFootnoteText(zip, { noteId: 4, newText: 'A new' });
        });

        await then('ID 4 is updated and ID 5 is preserved', async () => {
          const updated = await zip.readText('word/footnotes.xml');
          expect(updated).toContain('A new');
          expect(updated).toContain('B untouched');
        });
      },
    );

    test('rejects updates for missing or reserved footnotes and malformed entries', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;

      await given('a document with reserved and malformed footnotes', async () => {
        const doc = makeDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p>');
        zip = await makeZipFromDocument(doc, {
          'word/footnotes.xml': makeFootnotesXml([
            { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
            { id: 1, paragraphXml: '<w:tbl/>' },
          ]),
        });
      });

      await when('updateFootnoteText is called with invalid IDs', async () => {
        // assertions are in then step
      });

      await then('appropriate errors are thrown', async () => {
        await expect(updateFootnoteText(zip, { noteId: 404, newText: 'x' })).rejects.toThrow(
          'Footnote ID 404 not found',
        );
        await expect(updateFootnoteText(zip, { noteId: -1, newText: 'x' })).rejects.toThrow(
          'Cannot update reserved footnote ID -1',
        );
        await expect(updateFootnoteText(zip, { noteId: 1, newText: 'x' })).rejects.toThrow(
          'Footnote ID 1 has no paragraphs',
        );
      });
    });
  });

  describe('deleteFootnote', () => {
    humanReadableTest.openspec('delete removes footnoteReference from mixed run without losing text')(
      'Scenario: delete removes footnoteReference from mixed run without losing text',
      async ({ given, when, then, and }: AllureBddContext) => {
        let doc: Document;
        let zip: DocxZip;

        await given('a paragraph with mixed-run footnote reference', async () => {
          doc = makeDocument(
            '<w:p><w:r><w:t>Alpha</w:t><w:footnoteReference w:id="11"/><w:t>Omega</w:t></w:r></w:p>',
          );
          zip = await makeZipFromDocument(doc, {
            'word/footnotes.xml': makeFootnotesXml([
              { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
              { id: 11, text: 'To delete' },
            ]),
          });
        });

        await when('deleteFootnote is called for ID 11', async () => {
          await deleteFootnote(doc, zip, { noteId: 11 });
        });

        await then('footnote reference is removed', async () => {
          const serialized = serializeXml(doc);
          expect(serialized).not.toContain('footnoteReference');
        });

        await and('surrounding text is preserved', async () => {
          const serialized = serializeXml(doc);
          expect(serialized).toContain('Alpha');
          expect(serialized).toContain('Omega');
          expect(getParagraphText(getParagraphs(doc)[0]!)).toBe('AlphaOmega');
        });
      },
    );

    humanReadableTest.openspec('delete removes dedicated reference run')(
      'Scenario: delete removes dedicated reference run',
      async ({ given, when, then, and }: AllureBddContext) => {
        let doc: Document;
        let zip: DocxZip;

        await given('a paragraph with dedicated footnote run', async () => {
          doc = makeDocument(
            '<w:p>' +
              '<w:r><w:footnoteReference w:id="12"/></w:r>' +
              '<w:r><w:t>Tail</w:t></w:r>' +
              '</w:p>',
          );
          zip = await makeZipFromDocument(doc, {
            'word/footnotes.xml': makeFootnotesXml([
              { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
              { id: 12, text: 'Delete dedicated run' },
            ]),
          });
        });

        await when('deleteFootnote is called for ID 12', async () => {
          await deleteFootnote(doc, zip, { noteId: 12 });
        });

        await then('footnote reference and its run are removed', async () => {
          const refs = getFootnoteReferences(doc);
          const runs = getParagraphs(doc)[0]!.getElementsByTagNameNS(OOXML.W_NS, W.r);
          expect(refs).toHaveLength(0);
          expect(runs.length).toBe(1);
        });

        await and('remaining text is "Tail"', async () => {
          expect(getParagraphText(getParagraphs(doc)[0]!)).toBe('Tail');
        });
      },
    );

    humanReadableTest.openspec('delete refuses reserved type entries')(
      'Scenario: delete refuses reserved type entries',
      async ({ given, when, then }: AllureBddContext) => {
        let doc: Document;
        let zip: DocxZip;

        await given('a document with reserved footnote entries', async () => {
          doc = makeDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p>');
          zip = await makeZipFromDocument(doc, {
            'word/footnotes.xml': makeFootnotesXml([
              { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
            ]),
          });
        });

        await when('deleteFootnote is called for reserved ID -1', async () => {
          // assertion is in then step
        });

        await then('a reserved-entry error is thrown', async () => {
          await expect(deleteFootnote(doc, zip, { noteId: -1 })).rejects.toThrow(
            'Cannot delete reserved footnote ID -1',
          );
        });
      },
    );

    test('throws when deleting a missing footnote ID', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let zip: DocxZip;

      await given('a document with only reserved footnotes', async () => {
        doc = makeDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p>');
        zip = await makeZipFromDocument(doc, {
          'word/footnotes.xml': RESERVED_FOOTNOTES_XML,
        });
      });

      await when('deleteFootnote is called for ID 1000', async () => {
        // assertion is in then step
      });

      await then('a not-found error is thrown', async () => {
        await expect(deleteFootnote(doc, zip, { noteId: 1000 })).rejects.toThrow(
          'Footnote ID 1000 not found',
        );
      });
    });
  });

  describe('round-trip', () => {
    humanReadableTest.openspec('round-trip preserves footnotes')(
      'Scenario: round-trip preserves footnotes',
      async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
        let doc: Document;
        let zip: DocxZip;
        let notes: Awaited<ReturnType<typeof getFootnotes>>;
        let reloadedZip: DocxZip;
        let reloadedDocument: Document;

        await given('a document with comments and hyperlinks', async () => {
          doc = makeDocument(
            '<w:p>' +
              '<w:commentRangeStart w:id="7"/>' +
              '<w:r><w:t>Hello</w:t></w:r>' +
              '<w:commentRangeEnd w:id="7"/>' +
              '<w:hyperlink r:id="rId99"><w:r><w:t>link</w:t></w:r></w:hyperlink>' +
              '</w:p>' +
              '<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>',
          );
          zip = await makeZipFromDocument(doc);
          await bootstrapFootnoteParts(zip);
        });

        await when('two footnotes are added and reloaded', async () => {
          const paragraphs = getParagraphs(doc);
          const first = await addFootnote(doc, zip, {
            paragraphEl: paragraphs[0]!,
            afterText: 'Hello',
            text: 'First round-trip footnote',
          });
          const second = await addFootnote(doc, zip, {
            paragraphEl: paragraphs[1]!,
            text: 'Second round-trip footnote',
          });
          await attachPrettyJson('created-footnotes', {
            first,
            second,
          });

          zip.writeText('word/document.xml', serializeXml(doc));
          const buffer = await zip.toBuffer();
          reloadedZip = await DocxZip.load(buffer);
          reloadedDocument = parseXml(await reloadedZip.readText('word/document.xml'));
          notes = await getFootnotes(reloadedZip, reloadedDocument);
        });

        await then('both footnotes survive the round-trip', async () => {
          expect(notes).toHaveLength(2);
          expect(notes.map((n) => n.displayNumber)).toEqual([1, 2]);
          expect(notes.map((n) => n.text.trimStart())).toEqual([
            'First round-trip footnote',
            'Second round-trip footnote',
          ]);
        });

        await and('individual footnote lookup works', async () => {
          const readOne = await getFootnote(reloadedZip, reloadedDocument, notes[0]!.id);
          expect(readOne?.text.trimStart()).toBe('First round-trip footnote');
        });
      },
    );
  });

  test('recognizes reserved footnote entries by type', async ({ given, when, then }: AllureBddContext) => {
    let separator: Element;
    let continuation: Element;
    let regular: Element;

    await given('a footnotes XML with reserved and regular entries', async () => {
      // setup is inline
    });

    await when('isReservedFootnote is checked on each entry', async () => {
      const parsed = await readFootnotesXml(
        await makeZipFromDocument(
          makeDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p>'),
          {
            'word/footnotes.xml': makeFootnotesXml([
              { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
              { id: 0, type: 'continuationSeparator', paragraphXml: '<w:p><w:r><w:continuationSeparator/></w:r></w:p>' },
              { id: 10, text: 'Real note' },
            ]),
          },
        ),
      );
      separator = findFootnoteById(parsed, -1)!;
      continuation = findFootnoteById(parsed, 0)!;
      regular = findFootnoteById(parsed, 10)!;
    });

    await then('reserved entries are detected correctly', async () => {
      expect(isReservedFootnote(separator)).toBe(true);
      expect(isReservedFootnote(continuation)).toBe(true);
      expect(isReservedFootnote(regular)).toBe(false);
    });
  });
});
