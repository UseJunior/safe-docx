import { describe, expect } from 'vitest';
import { buildDocxWithAncillaryParts, paragraphWithText } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { getParagraphBookmarkId } from './bookmarks.js';
import { DocxDocument } from './document.js';
import { OOXML, W } from './namespaces.js';
import { parseXml } from './xml.js';
import { readZipText } from './zip.js';

const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W_NS = OOXML.W_NS;
const HEADER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const FOOTER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
const TEST_FEATURE = 'add-markdoc-header-footer-authoring';

const paragraph = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const table =
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>'
  + '<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>Cell one</w:t></w:r></w:p>'
  + '<w:p><w:r><w:t>Cell tail</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

async function fixture(): Promise<Buffer> {
  return buildDocxWithAncillaryParts({
    bodyXml: paragraphWithText('Repeated text'),
    sectPrXml:
      '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/>'
      + '<w:headerReference w:type="even" r:id="rIdHeader"/>'
      + '<w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr>',
    relationships: [
      { id: 'rIdHeader', type: `${REL_BASE}/header`, target: 'header1.xml' },
      { id: 'rIdFooter', type: `${REL_BASE}/footer`, target: 'footer1.xml' },
    ],
    parts: [
      {
        path: 'word/header1.xml',
        contentType: HEADER_CONTENT_TYPE,
        xml: `<w:hdr xmlns:w="${W_NS}">${paragraph('Repeated text')}${table}</w:hdr>`,
      },
      {
        path: 'word/footer1.xml',
        contentType: FOOTER_CONTENT_TYPE,
        xml: `<w:ftr xmlns:w="${W_NS}">${paragraph('Repeated text')}</w:ftr>`,
      },
      {
        path: 'word/header-orphan.xml',
        contentType: HEADER_CONTENT_TYPE,
        xml: `<w:hdr xmlns:w="${W_NS}">${paragraph('Orphan')}</w:hdr>`,
      },
    ],
  });
}

async function singleHeaderFixture(headerXml: string): Promise<Buffer> {
  return buildDocxWithAncillaryParts({
    bodyXml: paragraphWithText('Body'),
    sectPrXml: '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr>',
    relationships: [{ id: 'rIdHeader', type: `${REL_BASE}/header`, target: 'header1.xml' }],
    parts: [{
      path: 'word/header1.xml',
      contentType: HEADER_CONTENT_TYPE,
      xml: `<w:hdr xmlns:w="${W_NS}">${headerXml}</w:hdr>`,
    }],
  });
}

function requiredXml(xml: string | null): string {
  if (xml === null) throw new Error('Expected OOXML package part');
  return xml;
}

function paragraphIds(xml: string | null): string[] {
  xml = requiredXml(xml);
  const doc = parseXml(xml);
  return Array.from(doc.getElementsByTagNameNS(W_NS, W.p))
    .map((item) => getParagraphBookmarkId(item))
    .filter((id): id is string => id !== null);
}

function bookmarkKeys(xml: string | null): { names: string[]; numericIds: string[] } {
  xml = requiredXml(xml);
  const doc = parseXml(xml);
  const starts = Array.from(doc.getElementsByTagNameNS(W_NS, W.bookmarkStart));
  return {
    names: starts.map((start) => start.getAttributeNS(W_NS, 'name') ?? ''),
    numericIds: starts.map((start) => start.getAttributeNS(W_NS, 'id') ?? ''),
  };
}

describe('relationship-selected story paragraph primitives', () => {
  const test = testAllure.epic('Document Comparison')
    .withLabels({ feature: TEST_FEATURE })
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' })
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.66' })
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.84' });

  test.openspec('[SDX-PRIM-STORY-02] Story paragraph mutations stay local and table-safe')(
    'allocates package-wide anchors and applies local table-safe mutations',
    async () => {
      const source = await fixture();
      const originalOrphan = await readZipText(source, 'word/header-orphan.xml');
      const document = await DocxDocument.load(source);
      await document.insertStoryParagraphBookmarks('word/header1.xml', 'header');
      await document.insertStoryParagraphBookmarks('word/footer1.xml', 'footer');
      document.insertParagraphBookmarks('body');
      const anchored = (await document.toBuffer({ cleanBookmarks: false })).buffer;

      const parts = await Promise.all([
        readZipText(anchored, 'word/document.xml'),
        readZipText(anchored, 'word/header1.xml'),
        readZipText(anchored, 'word/footer1.xml'),
      ]);
      const all = parts.flatMap((xml) => {
        const keys = bookmarkKeys(xml);
        return keys.names.map((name, index) => `${keys.numericIds[index]}:${name}`);
      });
      expect(new Set(all).size).toBe(all.length);
      expect(new Set(parts.flatMap((xml) => bookmarkKeys(xml).names)).size).toBe(all.length);
      expect(new Set(parts.flatMap((xml) => bookmarkKeys(xml).numericIds)).size).toBe(all.length);

      const headerIds = paragraphIds(parts[1]!);
      const footerIds = paragraphIds(parts[2]!);
      const bodyIds = paragraphIds(parts[0]!);
      expect(headerIds).toHaveLength(3);
      expect(footerIds).toHaveLength(1);
      expect(await document.getStoryParagraphTextById('word/header1.xml', footerIds[0]!)).toBeNull();
      await expect(document.insertStoryParagraph({
        partPath: 'word/header1.xml',
        positionalAnchorNodeId: footerIds[0]!,
        relativePosition: 'AFTER',
        newText: 'Wrong story',
      })).rejects.toThrow(/not found in word\/header1\.xml/);
      await expect(document.getStoryParagraphTextById('word/header-orphan.xml', 'anything'))
        .rejects.toThrow(/not selected/);

      document.insertSectionBreak({
        anchorParagraphId: bodyIds[0]!,
        breakType: 'nextPage',
      });

      await document.replaceStoryText({
        partPath: 'word/header1.xml',
        targetParagraphId: headerIds[0]!,
        findText: 'Repeated text',
        replaceText: 'Header date',
      });
      const inserted = await document.insertStoryParagraph({
        partPath: 'word/header1.xml',
        positionalAnchorNodeId: headerIds[1]!,
        relativePosition: 'AFTER',
        newText: 'Inserted cell paragraph',
      });
      document.insertParagraph({
        positionalAnchorNodeId: bodyIds[0]!,
        relativePosition: 'AFTER',
        newText: 'Body insertion after story allocation',
      });
      await document.replaceStoryTextAtRange({
        partPath: 'word/header1.xml',
        targetParagraphId: inserted.newParagraphId,
        start: 0,
        end: 'Inserted'.length,
        replaceText: 'New',
      });
      expect(await document.getStoryParagraphTextById('word/header1.xml', inserted.newParagraphId))
        .toBe('New cell paragraph');
      expect(await document.validateStoryParagraphTableCell('word/header1.xml', inserted.newParagraphId))
        .toMatchObject({ inTableCell: true, verticalMergeContinuation: false });
      await document.deleteStoryParagraph('word/header1.xml', headerIds[1]!);

      const output = (await document.toBuffer({ cleanBookmarks: false })).buffer;
      const header = await readZipText(output, 'word/header1.xml');
      expect(header).toContain('Header date');
      expect(header).toContain('<w:t>New</w:t>');
      expect(header).toContain('cell paragraph');
      expect(header).not.toContain('Cell one');
      expect(await readZipText(output, 'word/footer1.xml')).toBe(parts[2]);
      expect(await readZipText(output, 'word/header-orphan.xml')).toBe(originalOrphan);
      expect(await readZipText(source, 'word/header1.xml')).toContain('Repeated text');
      const finalParts = await Promise.all([
        readZipText(output, 'word/document.xml'),
        readZipText(output, 'word/header1.xml'),
        readZipText(output, 'word/footer1.xml'),
      ]);
      const finalNumericIds = finalParts.flatMap((xml) => bookmarkKeys(xml).numericIds);
      expect(new Set(finalNumericIds).size).toBe(finalNumericIds.length);
    },
  );

  test.openspec('[SDX-PRIM-STORY-02] Story paragraph mutations stay local and table-safe')(
    'rejects deletion of the final direct table-cell paragraph before mutation',
    async () => {
      const document = await DocxDocument.load(await fixture());
      await document.insertStoryParagraphBookmarks('word/header1.xml', 'header');
      const anchored = (await document.toBuffer({ cleanBookmarks: false })).buffer;
      const ids = paragraphIds(await readZipText(anchored, 'word/header1.xml'));
      await document.deleteStoryParagraph('word/header1.xml', ids[1]!);
      await expect(document.deleteStoryParagraph('word/header1.xml', ids[2]!))
        .rejects.toThrow(/without a trailing paragraph/);
      const header = await readZipText((await document.toBuffer({ cleanBookmarks: false })).buffer, 'word/header1.xml');
      expect(header).toContain('Cell tail');
    },
  );

  test.openspec('[SDX-PRIM-STORY-02] Story paragraph mutations stay local and table-safe')(
    'rejects nested-table edits and repairs foreign ranges cut by deletion',
    async () => {
      const nested =
        '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>'
        + '<w:tr><w:tc><w:tcPr/><w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1200"/></w:tblGrid>'
        + '<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>Nested</w:t></w:r></w:p></w:tc></w:tr>'
        + '</w:tbl><w:p/></w:tc></w:tr></w:tbl>';
      const nestedDocument = await DocxDocument.load(await singleHeaderFixture(nested));
      await nestedDocument.insertStoryParagraphBookmarks('word/header1.xml', 'header');
      const nestedBuffer = (await nestedDocument.toBuffer({ cleanBookmarks: false })).buffer;
      const nestedIds = paragraphIds(await readZipText(nestedBuffer, 'word/header1.xml'));
      await expect(nestedDocument.replaceStoryText({
        partPath: 'word/header1.xml',
        targetParagraphId: nestedIds[0]!,
        findText: 'Nested',
        replaceText: 'Changed',
      })).rejects.toThrow(/nested table/);

      const ranged =
        '<w:p><w:bookmarkStart w:id="77" w:name="foreign-range"/><w:r><w:t>Delete me</w:t></w:r></w:p>'
        + '<w:p><w:bookmarkEnd w:id="77"/><w:r><w:t>Keep me</w:t></w:r></w:p>';
      const rangedDocument = await DocxDocument.load(await singleHeaderFixture(ranged));
      await rangedDocument.insertStoryParagraphBookmarks('word/header1.xml', 'header');
      const rangedBuffer = (await rangedDocument.toBuffer({ cleanBookmarks: false })).buffer;
      const rangedIds = paragraphIds(await readZipText(rangedBuffer, 'word/header1.xml'));
      await rangedDocument.deleteStoryParagraph('word/header1.xml', rangedIds[0]!);
      const output = await readZipText(
        (await rangedDocument.toBuffer({ cleanBookmarks: false })).buffer,
        'word/header1.xml',
      );
      expect(output).not.toContain('w:id="77"');
      expect(output).toContain('Keep me');
    },
  );
});
