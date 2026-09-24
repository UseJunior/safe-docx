import { describe, expect } from 'vitest';
import { DocxDocument } from '../src/primitives/document.js';
import { DocxZip } from '../src/primitives/zip.js';
import { getParagraphBookmarkId } from '../src/primitives/bookmarks.js';
import { createRevisionContext } from '../src/primitives/track-changes-emitter.js';
import { insertTableColumn as insertTableColumnCore } from '../src/primitives/table_columns.js';
import { serializeXml } from '../src/primitives/xml.js';
import { buildDocxFromBodyXml } from '../src/testing/ooxml-fixtures.js';
import { testAllure } from './helpers/allure-test.js';

const TEST_FEATURE = 'add-structural-table-column-operations';
const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.16' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.17' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.48' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.71' },
  );

const BODY = `<w:tbl><w:tblPr><w:tblW w:w="300" w:type="dxa"/></w:tblPr>
  <w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="200"/></w:tblGrid>
  <w:tr><w:tc><w:tcPr><w:tcW w:w="300" w:type="dxa"/><w:gridSpan w:val="2"/></w:tcPr>
    <w:p><w:r><w:t>Heading</w:t></w:r></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:tcPr><w:tcW w:w="100" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Left</w:t></w:r></w:p></w:tc>
    <w:tc><w:tcPr><w:tcW w:w="200" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Right</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>`;

async function loaded(body = BODY) {
  const doc = await DocxDocument.load(await buildDocxFromBodyXml(body));
  doc.insertParagraphBookmarks('column-test');
  return { doc, anchorParagraphId: getParagraphBookmarkId(doc.getParagraphs()[0]!)! };
}

async function xml(doc: DocxDocument): Promise<string> {
  const { buffer } = await doc.toBuffer({ cleanBookmarks: false });
  return (await DocxZip.load(buffer)).readText('word/document.xml');
}

describe('clean logical table column operations', () => {
  test.openspec('[SDX-TABLECOL-01] clean insertion across simple and spanning rows')('grows the title span and adds a physical cell in the second row', async () => {
    const { doc, anchorParagraphId } = await loaded();
    const result = doc.insertTableColumn({ anchorParagraphId, columnIndex: 1, widthTwips: 50,
      rowActions: [{ kind: 'growCell', side: 'left' }, { kind: 'cell', text: 'Middle' }] });
    expect(result.gridColumns).toBe(3);
    expect(result.cellParagraphIds).toHaveLength(1);
    expect(doc.getParagraphTextById(result.cellParagraphIds[0]!)).toBe('Middle');
    const output = await xml(doc);
    expect(output).toContain('<w:gridSpan w:val="3"/>');
    expect(output).toContain('<w:gridCol w:w="50"/>');
    expect(output).toContain('<w:tblW w:w="350" w:type="dxa"/>');
  });

  test.openspec('[SDX-TABLECOL-02] clean deletion across simple and spanning rows')('removes a physical cell and shrinks the title span', async () => {
    const { doc, anchorParagraphId } = await loaded();
    const result = doc.deleteTableColumn({ anchorParagraphId, columnIndex: 1 });
    expect(result).toEqual({ gridColumns: 1, deleted: true });
    const output = await xml(doc);
    expect(output).not.toContain('Right');
    expect(output).not.toContain('gridSpan');
    expect(output).toContain('<w:tblW w:w="100" w:type="dxa"/>');
    expect(output).toContain('<w:tcW w:w="100" w:type="dxa"/>');
  });

  test.openspec('[SDX-TABLECOL-09] explicit width bookkeeping')('restores source widths after inserting and deleting the same column', async () => {
    const { doc, anchorParagraphId } = await loaded();
    const before = await xml(doc);
    doc.insertTableColumn({ anchorParagraphId, columnIndex: 1, widthTwips: 50,
      rowActions: [{ kind: 'growCell', side: 'left' }, { kind: 'cell', text: 'Middle' }] });
    doc.deleteTableColumn({ anchorParagraphId, columnIndex: 1 });
    expect(await xml(doc)).toBe(before);
  });

  test('grows a full-width title at the first and last grid boundaries', async () => {
    for (const [columnIndex, side] of [[0, 'right'], [2, 'left']] as const) {
      const { doc, anchorParagraphId } = await loaded();
      const result = doc.insertTableColumn({ anchorParagraphId, columnIndex, widthTwips: 40,
        rowActions: [{ kind: 'growCell', side }, { kind: 'cell', text: 'Edge' }] });
      expect(result.gridColumns).toBe(3);
      expect(await xml(doc)).toContain('<w:gridSpan w:val="3"/>');
    }
  });

  test('rejects ambiguous width values without changing the document', async () => {
    for (const [body, operation] of [
      [BODY.replace('w:w="300" w:type="dxa"', 'w:w="300"'), 'insert'],
      [BODY.replace('<w:gridCol w:w="200"/>', '<w:gridCol/>'), 'delete'],
      [BODY.replace('w:w="300" w:type="dxa"', 'w:w="1in" w:type="dxa"'), 'insert'],
    ] as const) {
      const { doc, anchorParagraphId } = await loaded(body);
      const before = await xml(doc);
      if (operation === 'insert') {
        expect(() => doc.insertTableColumn({ anchorParagraphId, columnIndex: 1, widthTwips: 50,
          rowActions: [{ kind: 'growCell', side: 'left' }, { kind: 'cell', text: 'Middle' }] })).toThrowError(/width/i);
      } else {
        expect(() => doc.deleteTableColumn({ anchorParagraphId, columnIndex: 1 })).toThrowError(/width/i);
      }
      expect(await xml(doc)).toBe(before);
    }
  });

  test('keeps non-dxa preferred widths unchanged', async () => {
    const body = BODY.replace('<w:tblW w:w="300" w:type="dxa"/>', '<w:tblW w:w="5000" w:type="pct"/>')
      .replace('<w:tcW w:w="300" w:type="dxa"/>', '<w:tcW w:w="5000" w:type="pct"/>');
    const { doc, anchorParagraphId } = await loaded(body);
    doc.insertTableColumn({ anchorParagraphId, columnIndex: 1, widthTwips: 50,
      rowActions: [{ kind: 'growCell', side: 'left' }, { kind: 'cell', text: 'Middle' }] });
    const output = await xml(doc);
    expect(output).toContain('<w:tblW w:w="5000" w:type="pct"/>');
    expect(output).toContain('<w:tcW w:w="5000" w:type="pct"/>');
  });

  test('accepts nil cell and auto table widths without a w attribute', async () => {
    const body = BODY.replace('<w:tblW w:w="300" w:type="dxa"/>', '<w:tblW w:type="auto"/>')
      .replace('<w:tcW w:w="300" w:type="dxa"/>', '<w:tcW w:type="nil"/>');
    const { doc, anchorParagraphId } = await loaded(body);
    doc.insertTableColumn({ anchorParagraphId, columnIndex: 1, widthTwips: 50,
      rowActions: [{ kind: 'growCell', side: 'left' }, { kind: 'cell', text: 'Middle' }] });
    const output = await xml(doc);
    expect(output).toContain('<w:tblW w:type="auto"/>');
    expect(output).toContain('<w:tcW w:type="nil"/>');
  });

  test('places a new gridSpan after cnfStyle when tcW is absent', async () => {
    const body = BODY.replace('<w:tcW w:w="300" w:type="dxa"/><w:gridSpan w:val="2"/>',
      '<w:cnfStyle w:val="100000000000"/><w:gridSpan w:val="2"/><w:shd w:val="clear" w:fill="FFFF00"/>');
    const { doc, anchorParagraphId } = await loaded(body);
    doc.insertTableColumn({ anchorParagraphId, columnIndex: 1, widthTwips: 50,
      rowActions: [{ kind: 'growCell', side: 'left' }, { kind: 'cell', text: 'Middle' }] });
    const output = await xml(doc);
    expect(output).toContain('<w:cnfStyle w:val="100000000000"/><w:gridSpan w:val="3"/><w:shd w:val="clear" w:fill="FFFF00"/>');
  });

  test('preserves the live paragraph element reference after successful insertion', async () => {
    const { doc, anchorParagraphId } = await loaded();
    const heldParagraph = doc.getParagraphs()[0]!;
    doc.insertTableColumn({ anchorParagraphId, columnIndex: 1, widthTwips: 50,
      rowActions: [{ kind: 'growCell', side: 'left' }, { kind: 'cell', text: 'Middle' }] });
    expect(doc.getParagraphs()[0]).toBe(heldParagraph);
    expect(heldParagraph.parentNode).not.toBeNull();
  });

  test('keeps the exported core API transactional on a later-row width failure', async () => {
    const body = BODY.replace('<w:tcW w:w="100" w:type="dxa"/>', '<w:tcW w:w="1in" w:type="dxa"/>');
    const { doc, anchorParagraphId } = await loaded(body);
    const documentXml = doc.getDocumentXmlClone();
    const before = serializeXml(documentXml);
    expect(() => insertTableColumnCore(documentXml, { anchorParagraphId, columnIndex: 1, widthTwips: 50,
      rowActions: [{ kind: 'growCell', side: 'left' }, { kind: 'growCell', side: 'left' }] })).toThrowError(/width/i);
    expect(serializeXml(documentXml)).toBe(before);
  });

  test.openspec('[SDX-TABLECOL-06] unsupported or invalid requests leave no trace')('rejects later-row action and tracked context without mutation or revision IDs', async () => {
    const { doc, anchorParagraphId } = await loaded();
    const before = await xml(doc);
    expect(() => doc.insertTableColumn({ anchorParagraphId, columnIndex: 1, widthTwips: 50,
      rowActions: [{ kind: 'growCell', side: 'left' }, { kind: 'cell', text: 'Middle' }, { kind: 'cell', text: 'Extra' }] }))
      .toThrowError(/row action/i);
    expect(await xml(doc)).toBe(before);
    const ctx = createRevisionContext({ author: 'Tester', date: '2026-09-24T00:00:00Z' });
    const nextId = ctx.idState.nextId;
    expect(() => doc.deleteTableColumn({ anchorParagraphId, columnIndex: 1 }, ctx)).toThrowError(/Tracked column/);
    expect(ctx.idState.nextId).toBe(nextId);
    expect(await xml(doc)).toBe(before);
  });

  test('rejects nested tables and vertical merges without mutation', async () => {
    const nested = BODY.replace('<w:p><w:r><w:t>Right</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>Right</w:t></w:r></w:p><w:tbl><w:tblPr/><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl><w:p/>');
    const vertical = BODY.replace('<w:gridSpan w:val="2"/>', '<w:gridSpan w:val="2"/><w:vMerge w:val="restart"/>');
    for (const body of [nested, vertical]) {
      const { doc, anchorParagraphId } = await loaded(body);
      const before = await xml(doc);
      expect(() => doc.deleteTableColumn({ anchorParagraphId, columnIndex: 1 })).toThrowError();
      expect(await xml(doc)).toBe(before);
    }
  });

  test('rejects removing a cell with pending tracked content', async () => {
    const body = BODY.replace('<w:r><w:t>Right</w:t></w:r>',
      '<w:ins w:id="8" w:author="Tester" w:date="2026-09-24T00:00:00Z"><w:r><w:t>Right</w:t></w:r></w:ins>');
    const { doc, anchorParagraphId } = await loaded(body);
    const before = await xml(doc);
    expect(() => doc.deleteTableColumn({ anchorParagraphId, columnIndex: 1 })).toThrowError(/pending revisions/i);
    expect(await xml(doc)).toBe(before);
  });

  test.openspec('[SDX-TABLECOL-07] unaffected content and identities survive')('preserves an unchanged bookmarked cell subtree exactly', async () => {
    const { doc, anchorParagraphId } = await loaded();
    const before = await xml(doc);
    const left = before.match(/<w:tc><w:tcPr><w:tcW w:w="100" w:type="dxa"\/><\/w:tcPr>.*?<\/w:tc>/s)?.[0];
    expect(left).toBeDefined();
    doc.insertTableColumn({ anchorParagraphId, columnIndex: 1, widthTwips: 50,
      rowActions: [{ kind: 'growCell', side: 'left' }, { kind: 'cell', text: 'Middle' }] });
    expect(await xml(doc)).toContain(left!);
  });
});
