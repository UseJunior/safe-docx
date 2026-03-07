import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { OOXML, W } from './namespaces.js';
import { parseXml, serializeXml } from './xml.js';
import {
  addFootnote,
  bootstrapFootnoteParts,
  deleteFootnote,
  getFootnote,
  getFootnotes,
  isReservedFootnote,
  updateFootnoteText,
} from './footnotes.js';
import { DocxZip } from './zip.js';
import { getParagraphBookmarkId, insertParagraphBookmarks } from './bookmarks.js';
import { getParagraphText } from './text.js';
import { allureJsonAttachment, allureStep, testAllure } from './testing/allure-test.js';

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
      async () => {
        const documentXml = makeDocument('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
        const zip = await makeZipFromDocument(documentXml);

        const result = await bootstrapFootnoteParts(zip);

        expect(result.partsCreated).toEqual(['word/footnotes.xml']);
        const footnotesXml = await zip.readText('word/footnotes.xml');
        const contentTypesXml = await zip.readText('[Content_Types].xml');
        const relsXml = await zip.readText('word/_rels/document.xml.rels');

        expect(footnotesXml).toContain('w:type="separator"');
        expect(footnotesXml).toContain('w:type="continuationSeparator"');
        expect(contentTypesXml).toContain('/word/footnotes.xml');
        expect(relsXml).toContain('Target="footnotes.xml"');

        await allureJsonAttachment('bootstrap-footnotes-artifacts', {
          partsCreated: result.partsCreated,
          footnotesXml,
          contentTypesXml,
          relsXml,
        });
      },
    );

    humanReadableTest.openspec('bootstrap is idempotent')('Scenario: bootstrap is idempotent', async () => {
      const documentXml = makeDocument('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
      const zip = await makeZipFromDocument(documentXml);

      const first = await bootstrapFootnoteParts(zip);
      const firstFootnotes = await zip.readText('word/footnotes.xml');
      const second = await bootstrapFootnoteParts(zip);
      const secondFootnotes = await zip.readText('word/footnotes.xml');

      expect(first.partsCreated).toEqual(['word/footnotes.xml']);
      expect(second.partsCreated).toEqual([]);
      expect(secondFootnotes).toBe(firstFootnotes);
    });

    test('adds footnote entries when content-types and rels files already exist', async () => {
      const documentXml = makeDocument('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
      const zip = await makeZipFromDocument(documentXml, {
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

      const result = await bootstrapFootnoteParts(zip);
      const contentTypes = await zip.readText('[Content_Types].xml');
      const rels = await zip.readText('word/_rels/document.xml.rels');

      expect(result.partsCreated).toEqual(['word/footnotes.xml']);
      expect(contentTypes).toContain('/word/footnotes.xml');
      expect(rels).toContain('relationships/footnotes');
      expect(rels).toContain('Target="footnotes.xml"');
    });

    humanReadableTest.openspec('bootstrap preserves existing reserved entries')(
      'Scenario: bootstrap preserves existing reserved entries',
      async () => {
        const existingFootnotes = makeFootnotesXml([
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
        const zip = await makeZipFromDocument(doc, { 'word/footnotes.xml': existingFootnotes });

        const result = await bootstrapFootnoteParts(zip);
        const after = await zip.readText('word/footnotes.xml');

        expect(result.partsCreated).toEqual([]);
        expect(after).toBe(existingFootnotes);

        const parsed = parseXml(after).getElementsByTagNameNS(OOXML.W_NS, W.footnote);
        expect(isReservedFootnote(parsed.item(0) as Element)).toBe(true);
        expect(isReservedFootnote(parsed.item(1) as Element)).toBe(true);
      },
    );
  });

  describe('reading', () => {
    humanReadableTest.openspec('read from empty document returns empty array')(
      'Scenario: read from empty document returns empty array',
      async () => {
        const doc = makeDocument('<w:p><w:r><w:t>No notes</w:t></w:r></w:p>');
        const zip = await makeZipFromDocument(doc);
        const notes = await getFootnotes(zip, doc);

        expect(notes).toEqual([]);
      },
    );

    humanReadableTest.openspec('read footnotes from document with multiple footnotes')(
      'Scenario: read footnotes from document with multiple footnotes',
      async () => {
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

        const notes = await getFootnotes(zip, doc);

        expect(notes).toHaveLength(3);
        expect(notes.map((n) => n.id)).toEqual([4, 5, 6]);
        expect(notes.map((n) => n.text)).toEqual(['Alpha note', 'Beta note', 'Gamma note']);
        expect(notes.map((n) => n.displayNumber)).toEqual([1, 2, 3]);
      },
    );

    humanReadableTest.openspec('display numbers follow document order')(
      'Scenario: display numbers follow document order',
      async () => {
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

        const notes = await getFootnotes(zip, doc);
        expect(notes.map((n) => ({ id: n.id, display: n.displayNumber }))).toEqual([
          { id: 8, display: 1 },
          { id: 4, display: 2 },
          { id: 6, display: 3 },
        ]);
      },
    );

    humanReadableTest.openspec('anchored paragraph IDs resolved')(
      'Scenario: anchored paragraph IDs resolved',
      async () => {
        const doc = makeDocument(
          '<w:p><w:r><w:t>Para A</w:t><w:footnoteReference w:id="1"/></w:r></w:p>' +
            '<w:p><w:r><w:t>Para B</w:t><w:footnoteReference w:id="2"/></w:r></w:p>',
        );
        insertParagraphBookmarks(doc, 'footnotes-test');
        const paragraphs = getParagraphs(doc);
        const expected = paragraphs.map((p) => getParagraphBookmarkId(p));
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

        const notes = await getFootnotes(zip, doc);
        expect(notes.map((n) => n.anchoredParagraphId)).toEqual(expected);
      },
    );

    humanReadableTest.openspec('mixed-run references handled')(
      'Scenario: mixed-run references handled',
      async () => {
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

        const notes = await getFootnotes(zip, doc);
        expect(notes).toHaveLength(1);
        expect(notes[0]?.id).toBe(9);
        expect(notes[0]?.text).toBe('Mixed run note');
      },
    );

    test('getFootnote returns one item by ID and null when not found', async () => {
      const doc = makeDocument('<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="3"/></w:r></w:p>');
      const zip = await makeZipFromDocument(doc, {
        'word/footnotes.xml': makeFootnotesXml([
          { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
          { id: 0, type: 'continuationSeparator', paragraphXml: '<w:p><w:r><w:continuationSeparator/></w:r></w:p>' },
          { id: 3, text: 'Find me' },
        ]),
      });

      const found = await getFootnote(zip, doc, 3);
      const missing = await getFootnote(zip, doc, 999);
      expect(found?.text).toBe('Find me');
      expect(missing).toBeNull();
    });
  });

  describe('addFootnote', () => {
    humanReadableTest.openspec('add footnote at end of paragraph')(
      'Scenario: add footnote at end of paragraph',
      async () => {
        const doc = makeDocument('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
        const zip = await makeZipFromDocument(doc, { 'word/footnotes.xml': RESERVED_FOOTNOTES_XML });
        const paragraph = getParagraphs(doc)[0]!;

        const result = await addFootnote(doc, zip, {
          paragraphEl: paragraph,
          text: 'End note',
        });

        expect(result.noteId).toBe(1);
        const refs = getFootnoteReferences(doc);
        expect(refs).toHaveLength(1);
        expect(serializeXml(doc)).toContain('w:footnoteReference w:id="1"');
      },
    );

    humanReadableTest.openspec('add footnote after specific text with mid-run split')(
      'Scenario: add footnote after specific text with mid-run split',
      async () => {
        const doc = makeDocument('<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>');
        const zip = await makeZipFromDocument(doc, { 'word/footnotes.xml': RESERVED_FOOTNOTES_XML });
        const paragraph = getParagraphs(doc)[0]!;

        await addFootnote(doc, zip, {
          paragraphEl: paragraph,
          afterText: 'Hello',
          text: 'Split note',
        });

        const serialized = serializeXml(doc);
        const helloIndex = serialized.indexOf('>Hello<');
        const refIndex = serialized.indexOf('footnoteReference');
        const worldIndex = serialized.indexOf('> World<');
        expect(helloIndex).toBeGreaterThan(-1);
        expect(refIndex).toBeGreaterThan(helloIndex);
        expect(worldIndex).toBeGreaterThan(refIndex);
      },
    );

    test('inserts after boundary match when afterText ends exactly at a run boundary', async () => {
      const doc = makeDocument(
        '<w:p>' +
          '<w:r><w:t>Hello</w:t></w:r>' +
          '<w:r><w:t xml:space="preserve"> World</w:t></w:r>' +
          '</w:p>',
      );
      const zip = await makeZipFromDocument(doc, { 'word/footnotes.xml': RESERVED_FOOTNOTES_XML });
      const paragraph = getParagraphs(doc)[0]!;

      await addFootnote(doc, zip, {
        paragraphEl: paragraph,
        afterText: 'Hello',
        text: 'Boundary note',
      });

      const serialized = serializeXml(doc);
      const firstRun = serialized.indexOf('>Hello<');
      const refRun = serialized.indexOf('footnoteReference');
      const secondRun = serialized.indexOf('> World<');
      expect(firstRun).toBeGreaterThan(-1);
      expect(refRun).toBeGreaterThan(firstRun);
      expect(secondRun).toBeGreaterThan(refRun);
    });

    humanReadableTest.openspec('ID allocation skips reserved entries by type')(
      'Scenario: ID allocation skips reserved entries by type',
      async () => {
        const doc = makeDocument('<w:p><w:r><w:t>Allocate</w:t></w:r></w:p>');
        const zip = await makeZipFromDocument(doc, {
          'word/footnotes.xml': makeFootnotesXml([
            { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
            { id: 0, type: 'continuationSeparator', paragraphXml: '<w:p><w:r><w:continuationSeparator/></w:r></w:p>' },
            { id: 7, text: 'Existing user note' },
          ]),
        });
        const paragraph = getParagraphs(doc)[0]!;

        const result = await addFootnote(doc, zip, {
          paragraphEl: paragraph,
          text: 'Next id note',
        });

        expect(result.noteId).toBe(8);
      },
    );

    humanReadableTest.openspec('footnote body includes Word-compatible skeleton')(
      'Scenario: footnote body includes Word-compatible skeleton',
      async () => {
        const doc = makeDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p>');
        const zip = await makeZipFromDocument(doc, { 'word/footnotes.xml': RESERVED_FOOTNOTES_XML });
        const paragraph = getParagraphs(doc)[0]!;

        await addFootnote(doc, zip, {
          paragraphEl: paragraph,
          text: '  padded text  ',
        });

        const footnotesXml = await zip.readText('word/footnotes.xml');
        expect(footnotesXml).toContain('<w:pStyle w:val="FootnoteText"/>');
        expect(footnotesXml).toContain('<w:rStyle w:val="FootnoteReference"/>');
        expect(footnotesXml).toContain('<w:footnoteRef/>');
        expect(footnotesXml).toContain('xml:space="preserve"');
      },
    );

    test('throws when afterText is not found', async () => {
      const doc = makeDocument('<w:p><w:r><w:t>No target here</w:t></w:r></w:p>');
      const zip = await makeZipFromDocument(doc, { 'word/footnotes.xml': RESERVED_FOOTNOTES_XML });
      const paragraph = getParagraphs(doc)[0]!;

      await expect(
        addFootnote(doc, zip, {
          paragraphEl: paragraph,
          afterText: 'Missing',
          text: 'Not added',
        }),
      ).rejects.toThrow("after_text 'Missing' not found in paragraph");
    });

    test('throws when afterText is ambiguous', async () => {
      const doc = makeDocument('<w:p><w:r><w:t>Echo Echo</w:t></w:r></w:p>');
      const zip = await makeZipFromDocument(doc, { 'word/footnotes.xml': RESERVED_FOOTNOTES_XML });
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

  describe('updateFootnoteText', () => {
    humanReadableTest.openspec('update changes text content')(
      'Scenario: update changes text content',
      async () => {
        const doc = makeDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p>');
        const zip = await makeZipFromDocument(doc, {
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

        await updateFootnoteText(zip, { noteId: 3, newText: ' new text ' });
        const updated = await zip.readText('word/footnotes.xml');
        expect(updated).toContain(' new text ');
        expect(updated).toContain('<w:footnoteRef/>');
        expect(updated).toContain('xml:space="preserve"');
      },
    );

    humanReadableTest.openspec('update preserves other footnotes')(
      'Scenario: update preserves other footnotes',
      async () => {
        const doc = makeDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p>');
        const zip = await makeZipFromDocument(doc, {
          'word/footnotes.xml': makeFootnotesXml([
            { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
            { id: 0, type: 'continuationSeparator', paragraphXml: '<w:p><w:r><w:continuationSeparator/></w:r></w:p>' },
            { id: 4, text: 'A old' },
            { id: 5, text: 'B untouched' },
          ]),
        });

        await updateFootnoteText(zip, { noteId: 4, newText: 'A new' });
        const updated = await zip.readText('word/footnotes.xml');
        expect(updated).toContain('A new');
        expect(updated).toContain('B untouched');
      },
    );

    test('rejects updates for missing or reserved footnotes and malformed entries', async () => {
      const doc = makeDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p>');
      const zip = await makeZipFromDocument(doc, {
        'word/footnotes.xml': makeFootnotesXml([
          { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
          { id: 1, paragraphXml: '<w:tbl/>' },
        ]),
      });

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

  describe('deleteFootnote', () => {
    humanReadableTest.openspec('delete removes footnoteReference from mixed run without losing text')(
      'Scenario: delete removes footnoteReference from mixed run without losing text',
      async () => {
        const doc = makeDocument(
          '<w:p><w:r><w:t>Alpha</w:t><w:footnoteReference w:id="11"/><w:t>Omega</w:t></w:r></w:p>',
        );
        const zip = await makeZipFromDocument(doc, {
          'word/footnotes.xml': makeFootnotesXml([
            { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
            { id: 11, text: 'To delete' },
          ]),
        });

        await deleteFootnote(doc, zip, { noteId: 11 });
        const serialized = serializeXml(doc);
        expect(serialized).toContain('Alpha');
        expect(serialized).toContain('Omega');
        expect(serialized).not.toContain('footnoteReference');
        expect(getParagraphText(getParagraphs(doc)[0]!)).toBe('AlphaOmega');
      },
    );

    humanReadableTest.openspec('delete removes dedicated reference run')(
      'Scenario: delete removes dedicated reference run',
      async () => {
        const doc = makeDocument(
          '<w:p>' +
            '<w:r><w:footnoteReference w:id="12"/></w:r>' +
            '<w:r><w:t>Tail</w:t></w:r>' +
            '</w:p>',
        );
        const zip = await makeZipFromDocument(doc, {
          'word/footnotes.xml': makeFootnotesXml([
            { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
            { id: 12, text: 'Delete dedicated run' },
          ]),
        });

        await deleteFootnote(doc, zip, { noteId: 12 });
        const refs = getFootnoteReferences(doc);
        const runs = getParagraphs(doc)[0]!.getElementsByTagNameNS(OOXML.W_NS, W.r);
        expect(refs).toHaveLength(0);
        expect(runs.length).toBe(1);
        expect(getParagraphText(getParagraphs(doc)[0]!)).toBe('Tail');
      },
    );

    humanReadableTest.openspec('delete refuses reserved type entries')(
      'Scenario: delete refuses reserved type entries',
      async () => {
        const doc = makeDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p>');
        const zip = await makeZipFromDocument(doc, {
          'word/footnotes.xml': makeFootnotesXml([
            { id: -1, type: 'separator', paragraphXml: '<w:p><w:r><w:separator/></w:r></w:p>' },
          ]),
        });

        await expect(deleteFootnote(doc, zip, { noteId: -1 })).rejects.toThrow(
          'Cannot delete reserved footnote ID -1',
        );
      },
    );

    test('throws when deleting a missing footnote ID', async () => {
      const doc = makeDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p>');
      const zip = await makeZipFromDocument(doc, {
        'word/footnotes.xml': RESERVED_FOOTNOTES_XML,
      });

      await expect(deleteFootnote(doc, zip, { noteId: 1000 })).rejects.toThrow(
        'Footnote ID 1000 not found',
      );
    });
  });

  describe('round-trip', () => {
    humanReadableTest.openspec('round-trip preserves footnotes')(
      'Scenario: round-trip preserves footnotes',
      async () => {
        const doc = makeDocument(
          '<w:p>' +
            '<w:commentRangeStart w:id="7"/>' +
            '<w:r><w:t>Hello</w:t></w:r>' +
            '<w:commentRangeEnd w:id="7"/>' +
            '<w:hyperlink r:id="rId99"><w:r><w:t>link</w:t></w:r></w:hyperlink>' +
            '</w:p>' +
            '<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>',
        );
        const zip = await makeZipFromDocument(doc);

        await bootstrapFootnoteParts(zip);
        const paragraphs = getParagraphs(doc);

        await allureStep('Add two footnotes before serialization', async () => {
          const first = await addFootnote(doc, zip, {
            paragraphEl: paragraphs[0]!,
            afterText: 'Hello',
            text: 'First round-trip footnote',
          });
          const second = await addFootnote(doc, zip, {
            paragraphEl: paragraphs[1]!,
            text: 'Second round-trip footnote',
          });
          await allureJsonAttachment('created-footnotes', {
            first,
            second,
          });
        });

        zip.writeText('word/document.xml', serializeXml(doc));
        const buffer = await zip.toBuffer();
        const reloadedZip = await DocxZip.load(buffer);
        const reloadedDocument = parseXml(await reloadedZip.readText('word/document.xml'));
        const notes = await getFootnotes(reloadedZip, reloadedDocument);

        expect(notes).toHaveLength(2);
        expect(notes.map((n) => n.displayNumber)).toEqual([1, 2]);
        expect(notes.map((n) => n.text.trimStart())).toEqual([
          'First round-trip footnote',
          'Second round-trip footnote',
        ]);

        const readOne = await getFootnote(reloadedZip, reloadedDocument, notes[0]!.id);
        expect(readOne?.text.trimStart()).toBe('First round-trip footnote');
      },
    );
  });

  test('recognizes reserved footnote entries by type', async () => {
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
    const separator = findFootnoteById(parsed, -1)!;
    const continuation = findFootnoteById(parsed, 0)!;
    const regular = findFootnoteById(parsed, 10)!;

    expect(isReservedFootnote(separator)).toBe(true);
    expect(isReservedFootnote(continuation)).toBe(true);
    expect(isReservedFootnote(regular)).toBe(false);
  });
});
