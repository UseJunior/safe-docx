import { describe, expect } from 'vitest';
import { DocxDocument } from '../src/primitives/document.js';
import { DocxZip } from '../src/primitives/zip.js';
import { getParagraphBookmarkId } from '../src/primitives/bookmarks.js';
import { createRevisionContext } from '../src/primitives/track-changes-emitter.js';
import { SafeDocxError } from '../src/primitives/errors.js';
import { buildDocxFromBodyXml } from '../src/testing/ooxml-fixtures.js';
import { testAllure } from './helpers/allure-test.js';

const TEST_FEATURE = 'add-structural-table-row-operations';
const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.48' });
const baseRows = (extra = '') => `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>
  <w:tr><w:trPr><w:tblHeader/><w:trHeight w:val="240"/></w:trPr>
    <w:tc><w:tcPr><w:tcW w:w="100"/><w:hideMark/></w:tcPr><w:p><w:pPr><w:numPr/><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>A1</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc></w:tr>
  <w:tr>${extra}<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>`;

async function indexedDoc(body = baseRows()): Promise<{ doc: DocxDocument; anchors: string[] }> {
  const doc = await DocxDocument.load(await buildDocxFromBodyXml(body));
  doc.insertParagraphBookmarks('table-row-test');
  return { doc, anchors: doc.getParagraphs().map((p) => getParagraphBookmarkId(p)!).filter(Boolean) };
}

async function documentXml(doc: DocxDocument): Promise<string> {
  const { buffer } = await doc.toBuffer({ cleanBookmarks: false });
  const zip = await DocxZip.load(buffer);
  return zip.readText('word/document.xml');
}

async function xmlFromBuffer(buffer: Buffer): Promise<string> {
  const zip = await DocxZip.load(buffer);
  return zip.readText('word/document.xml');
}

describe('structural table row operations', () => {
  test.openspec('[SDX-TABLEROW-01] clean insertion uses an anchored formatting shell')(
    'inserts at the requested row and returns targetable cell anchors', async () => {
      const { doc, anchors } = await indexedDoc();
      const result = doc.insertTableRow({ positionalAnchorNodeId: anchors[0]!, relativePosition: 'AFTER', cellTexts: ['N1', 'N2'] });
      expect(result).toMatchObject({ rowIndex: 1 });
      expect(result.cellParagraphIds).toHaveLength(2);
      expect(doc.getParagraphTextById(result.cellParagraphIds[0]!)).toBe('N1');
      const chained = doc.insertTableRow({ positionalAnchorNodeId: result.cellParagraphIds[0]!, relativePosition: 'AFTER', cellTexts: ['C1', 'C2'] });
      expect(chained.rowIndex).toBe(2);
      expect(await documentXml(doc)).toContain('<w:trHeight w:val="240"');
    },
  );

  test.openspec('[SDX-TABLEROW-02] inserted rows do not duplicate authored content or semantic properties')(
    'copies only the safe formatting shell', async () => {
      const { doc, anchors } = await indexedDoc();
      doc.insertTableRow({ positionalAnchorNodeId: anchors[0]!, relativePosition: 'BEFORE', cellTexts: ['plain', 'text'] });
      const xml = await documentXml(doc);
      const inserted = xml.slice(xml.indexOf('<w:tr>'), xml.indexOf('</w:tr>') + 7);
      expect(inserted).toContain('<w:trHeight');
      expect(inserted).toContain('<w:tcW');
      expect(inserted).toContain('<w:b');
      expect(inserted).not.toMatch(/tblHeader|hideMark|numPr|A1|bookmarkStart[^>]+table-row-test/);
    },
  );

  test.openspec('[SDX-TABLEROW-03] clean deletion preserves table and range validity')(
    'removes exactly one row, its anchors, and a surviving cross-row endpoint', async () => {
      const body = baseRows().replace('<w:r><w:t>A1', '<w:bookmarkStart w:id="88" w:name="cross"/><w:r><w:t>A1')
        .replace('<w:r><w:t>B1', '<w:bookmarkEnd w:id="88"/><w:r><w:t>B1');
      const { doc, anchors } = await indexedDoc(body);
      doc.deleteTableRow({ targetParagraphId: anchors[0]! });
      const xml = await documentXml(doc);
      expect(xml).not.toContain('A1');
      expect(xml).toContain('B1');
      expect(xml).not.toContain('w:id="88"');
      expect(doc.getParagraphElementById(anchors[0]!)).toBeNull();
    },
  );

  test.openspec('[SDX-TABLEROW-04] tracked insertion has inverse projections')(
    'emits row, paragraph-mark, and content insertion records with inverse projections', async () => {
      const { doc, anchors } = await indexedDoc();
      const ctx = createRevisionContext({ author: 'AI', date: '2026-01-01T00:00:00Z' });
      doc.insertTableRow({ positionalAnchorNodeId: anchors[0]!, relativePosition: 'AFTER', cellTexts: ['N1', 'N2'] }, ctx);
      const tracked = await doc.toBuffer({ cleanBookmarks: false });
      expect((await xmlFromBuffer(tracked.buffer)).match(/<w:ins/g)?.length).toBeGreaterThanOrEqual(5);
      const accepted = await DocxDocument.load(tracked.buffer);
      expect((await accepted.acceptChanges()).unresolvedRowRevisions).toBe(0);
      expect(await documentXml(accepted)).toContain('N1');
      const rejected = await DocxDocument.load(tracked.buffer);
      expect((await rejected.rejectChanges()).unresolvedRowRevisions).toBe(0);
      expect(await documentXml(rejected)).not.toContain('N1');
    },
  );

  test.openspec('[SDX-TABLEROW-05] tracked deletion has inverse projections and valid ranges')(
    'emits complete deletion metadata and resolves both projections', async () => {
      const { doc, anchors } = await indexedDoc();
      doc.deleteTableRow({ targetParagraphId: anchors[0]! }, createRevisionContext({ author: 'AI', date: '2026-01-01T00:00:00Z' }));
      const tracked = await doc.toBuffer({ cleanBookmarks: false });
      const trackedXml = await xmlFromBuffer(tracked.buffer);
      expect(trackedXml).toMatch(/<w:trPr>[\s\S]*?<w:del w:id=/);
      expect(trackedXml).toContain('<w:delText>A1</w:delText>');
      const accepted = await DocxDocument.load(tracked.buffer);
      await accepted.acceptChanges();
      expect(await documentXml(accepted)).not.toContain('A1');
      const rejected = await DocxDocument.load(tracked.buffer);
      await rejected.rejectChanges();
      expect(await documentXml(rejected)).toContain('A1');
    },
  );

  test.openspec('[SDX-TABLEROW-07] merge, wrapper, and nested-table guards are table-wide')(
    'rejects unsupported topology anywhere in the table before mutation', async () => {
      const nested = '<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>';
      const cases: Array<[string, string]> = [
        ['gridBefore', baseRows('<w:trPr><w:gridBefore w:val="1"/></w:trPr>')],
        ['gridAfter', baseRows('<w:trPr><w:gridAfter w:val="1"/></w:trPr>')],
        ['tblPrEx', baseRows('<w:tblPrEx/>')],
        ['gridSpan', baseRows().replace('<w:tcPr><w:tcW', '<w:tcPr><w:gridSpan w:val="2"/><w:tcW')],
        ['vMerge', baseRows().replace('<w:tcPr><w:tcW', '<w:tcPr><w:vMerge w:val="restart"/><w:tcW')],
        ['nestedTable', baseRows().replace('<w:p><w:r><w:t>B1', `${nested}<w:p><w:r><w:t>B1`)],
        ['rowContainer', baseRows().replace(/(<w:tr><w:tc><w:p><w:r><w:t>B1[\s\S]*?<\/w:tr>)/, '<w:sdt><w:sdtContent>$1</w:sdtContent></w:sdt>')],
        ['cellContainer', baseRows().replace('<w:tc><w:p><w:r><w:t>B1', '<w:sdt><w:sdtContent><w:tc><w:p><w:r><w:t>B1').replace('</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2', '</w:t></w:r></w:p></w:tc></w:sdtContent></w:sdt><w:tc><w:p><w:r><w:t>B2')],
      ];
      for (const [feature, body] of cases) {
        const { doc, anchors } = await indexedDoc(body);
        const before = await documentXml(doc);
        let thrown: unknown;
        try { doc.insertTableRow({ positionalAnchorNodeId: anchors[0]!, relativePosition: 'AFTER', cellTexts: ['x', 'y'] }); } catch (error) { thrown = error; }
        expect(thrown, feature).toBeInstanceOf(SafeDocxError);
        expect(thrown, feature).toMatchObject({ code: 'UNSUPPORTED_EDIT', detail: { feature } });
        expect(await documentXml(doc), feature).toBe(before);
      }
    },
  );

  test.openspec('[SDX-TABLEROW-08] malformed and topology-revised tables are transactional')(
    'does not allocate revision ids for malformed, revised, duplicate-marker, or final-row input', async () => {
      const { doc, anchors } = await indexedDoc();
      const ctx = createRevisionContext({ author: 'AI', date: '2026-01-01T00:00:00Z' });
      const nextId = ctx.idState.nextId;
      expect(() => doc.insertTableRow({ positionalAnchorNodeId: anchors[0]!, relativePosition: 'AFTER', cellTexts: ['only-one'] }, ctx))
        .toThrowError(SafeDocxError);
      expect(ctx.idState.nextId).toBe(nextId);

      const invalidBodies = [
        baseRows().replace('<w:gridCol/><w:gridCol/>', '<w:gridCol/><w:gridCol/><w:tblGridChange/>'),
        baseRows().replace('<w:tcPr><w:tcW', '<w:tcPr><w:tcPrChange><w:tcPr><w:gridSpan w:val="2"/></w:tcPr></w:tcPrChange><w:tcW'),
        baseRows().replace('<w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc>', ''),
        baseRows().replace('<w:p><w:r><w:t>B2</w:t></w:r></w:p>', '<w:sdt><w:sdtContent><w:p/></w:sdtContent></w:sdt>'),
      ];
      for (const body of invalidBodies) {
        const invalid = await indexedDoc(body);
        const before = await documentXml(invalid.doc);
        expect(() => invalid.doc.insertTableRow({ positionalAnchorNodeId: invalid.anchors[0]!, relativePosition: 'AFTER', cellTexts: ['x', 'y'] }, ctx))
          .toThrowError(SafeDocxError);
        expect(await documentXml(invalid.doc)).toBe(before);
        expect(ctx.idState.nextId).toBe(nextId);
      }

      for (const marker of ['ins', 'del'] as const) {
        const marked = await indexedDoc(baseRows(`<w:trPr><w:${marker} w:id="42" w:author="Other"/></w:trPr>`));
        expect(() => marked.doc.deleteTableRow({ targetParagraphId: marked.anchors[2]! }, ctx)).toThrowError(SafeDocxError);
        expect(ctx.idState.nextId).toBe(nextId);
      }

      const single = await indexedDoc(baseRows().replace(/<w:tr>\s*<w:tc><w:p><w:r><w:t>B1[\s\S]*?<\/w:tr>/, ''));
      expect(() => single.doc.deleteTableRow({ targetParagraphId: single.anchors[0]! }, ctx)).toThrowError(SafeDocxError);
      expect(ctx.idState.nextId).toBe(nextId);
    },
  );
});
