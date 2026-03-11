import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { parseXml } from '../src/primitives/xml.js';
import { OOXML, W } from '../src/primitives/namespaces.js';
import { getParagraphBookmarkId, insertParagraphBookmarks } from '../src/primitives/bookmarks.js';
import { setParagraphSpacing, setTableCellPadding, setTableRowHeight } from '../src/primitives/layout.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Layout' });

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${OOXML.W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, localName) ?? el.getAttribute(`w:${localName}`);
}

describe('layout mutations', () => {
  test('sets paragraph spacing and creates missing pPr/spacing containers', async ({ given, when, then, and }: AllureBddContext) => {
    let doc: Document;
    let paraId: string;
    let beforeCount: number;
    let result: ReturnType<typeof setParagraphSpacing>;
    let afterCount: number;

    await given('a paragraph without pPr or spacing elements', async () => {
      doc = makeDoc(`<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>`);
      insertParagraphBookmarks(doc, 'mcp_test');
      const p = doc.getElementsByTagNameNS(OOXML.W_NS, W.p).item(0)!;
      paraId = getParagraphBookmarkId(p)!;
      expect(paraId).toMatch(/^_bk_[0-9a-f]{12}$/);
      beforeCount = doc.getElementsByTagNameNS(OOXML.W_NS, W.p).length;
    });

    await when('setParagraphSpacing is called with all attributes', async () => {
      result = setParagraphSpacing(doc!, {
        paragraphIds: [paraId!],
        beforeTwips: 120,
        afterTwips: 240,
        lineTwips: 360,
        lineRule: 'auto',
      });
      afterCount = doc!.getElementsByTagNameNS(OOXML.W_NS, W.p).length;
    });

    await then('spacing is applied without adding extra paragraphs', async () => {
      expect(result!.affectedParagraphs).toBe(1);
      expect(result!.missingParagraphIds).toEqual([]);
      expect(afterCount!).toBe(beforeCount!);
    });

    await and('pPr/spacing elements are created with correct values', async () => {
      const p = doc!.getElementsByTagNameNS(OOXML.W_NS, W.p).item(0)!;
      const pPr = p.getElementsByTagNameNS(OOXML.W_NS, W.pPr).item(0) as Element | null;
      expect(pPr).toBeTruthy();
      const spacing = pPr?.getElementsByTagNameNS(OOXML.W_NS, W.spacing).item(0) as Element | null;
      expect(spacing).toBeTruthy();
      expect(getWAttr(spacing!, W.before)).toBe('120');
      expect(getWAttr(spacing!, W.after)).toBe('240');
      expect(getWAttr(spacing!, W.line)).toBe('360');
      expect(getWAttr(spacing!, W.lineRule)).toBe('auto');
    });
  });

  test('preserves unrelated paragraph formatting nodes when writing spacing', async ({ given, when, then, and }: AllureBddContext) => {
    let doc: Document;
    let paraId: string;
    let result: ReturnType<typeof setParagraphSpacing>;

    await given('a paragraph with existing jc center formatting', async () => {
      doc = makeDoc(
        `<w:p>` +
        `<w:pPr><w:jc w:val="center"/></w:pPr>` +
        `<w:r><w:t>Beta</w:t></w:r>` +
        `</w:p>`,
      );
      insertParagraphBookmarks(doc, 'mcp_test');
      const p = doc.getElementsByTagNameNS(OOXML.W_NS, W.p).item(0)!;
      paraId = getParagraphBookmarkId(p)!;
    });

    await when('setParagraphSpacing is called with afterTwips only', async () => {
      result = setParagraphSpacing(doc!, { paragraphIds: [paraId!], afterTwips: 180 });
    });

    await then('spacing is applied successfully', async () => {
      expect(result!.affectedParagraphs).toBe(1);
    });

    await and('existing jc formatting is preserved alongside new spacing', async () => {
      const p = doc!.getElementsByTagNameNS(OOXML.W_NS, W.p).item(0)!;
      const pPr = p.getElementsByTagNameNS(OOXML.W_NS, W.pPr).item(0)!;
      const jc = pPr.getElementsByTagNameNS(OOXML.W_NS, W.jc).item(0) as Element | null;
      const spacing = pPr.getElementsByTagNameNS(OOXML.W_NS, W.spacing).item(0) as Element | null;
      expect(jc).toBeTruthy();
      expect(getWAttr(jc!, W.val)).toBe('center');
      expect(spacing).toBeTruthy();
      expect(getWAttr(spacing!, W.after)).toBe('180');
    });
  });

  test('sets table row height on selected rows with missing-index reporting', async ({ given, when, then, and }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof setTableRowHeight>;

    await given('a table with two rows', async () => {
      doc = makeDoc(
        `<w:tbl>` +
        `<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc></w:tr>` +
        `<w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc></w:tr>` +
        `</w:tbl>`,
      );
    });

    await when('setTableRowHeight targets valid and out-of-range indexes', async () => {
      result = setTableRowHeight(doc!, {
        tableIndexes: [0, 2],
        rowIndexes: [1, 5],
        valueTwips: 420,
        rule: 'exact',
      });
    });

    await then('one row is affected and missing indexes are reported', async () => {
      expect(result!.affectedRows).toBe(1);
      expect(result!.missingTableIndexes).toEqual([2]);
      expect(result!.missingRowIndexes).toEqual([{ tableIndex: 0, rowIndex: 5 }]);
    });

    await and('the target row has correct height attributes', async () => {
      const table = doc!.getElementsByTagNameNS(OOXML.W_NS, W.tbl).item(0)!;
      const rows = table.getElementsByTagNameNS(OOXML.W_NS, W.tr);
      const row = rows.item(1)!;
      const trHeight = row.getElementsByTagNameNS(OOXML.W_NS, W.trHeight).item(0) as Element | null;
      expect(trHeight).toBeTruthy();
      expect(getWAttr(trHeight!, W.val)).toBe('420');
      expect(getWAttr(trHeight!, W.hRule)).toBe('exact');
    });
  });

  test('sets table cell padding on selected cells with container creation', async ({ given, when, then, and }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof setTableCellPadding>;

    await given('a table with two cells in one row', async () => {
      doc = makeDoc(
        `<w:tbl>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `</w:tbl>`,
      );
    });

    await when('setTableCellPadding is called on the first cell', async () => {
      result = setTableCellPadding(doc!, {
        tableIndexes: [0],
        rowIndexes: [0],
        cellIndexes: [0],
        topDxa: 80,
        bottomDxa: 120,
        leftDxa: 40,
        rightDxa: 60,
      });
    });

    await then('one cell is affected with no missing indexes', async () => {
      expect(result!.affectedCells).toBe(1);
      expect(result!.missingTableIndexes).toEqual([]);
      expect(result!.missingRowIndexes).toEqual([]);
      expect(result!.missingCellIndexes).toEqual([]);
    });

    await and('tcMar elements are created with correct padding values', async () => {
      const firstCell = doc!.getElementsByTagNameNS(OOXML.W_NS, W.tc).item(0)!;
      const secondCell = doc!.getElementsByTagNameNS(OOXML.W_NS, W.tc).item(1)!;

      const tcMar = firstCell.getElementsByTagNameNS(OOXML.W_NS, W.tcMar).item(0) as Element | null;
      expect(tcMar).toBeTruthy();

      const top = tcMar?.getElementsByTagNameNS(OOXML.W_NS, W.top).item(0) as Element | null;
      const bottom = tcMar?.getElementsByTagNameNS(OOXML.W_NS, W.bottom).item(0) as Element | null;
      const left = tcMar?.getElementsByTagNameNS(OOXML.W_NS, W.left).item(0) as Element | null;
      const right = tcMar?.getElementsByTagNameNS(OOXML.W_NS, W.right).item(0) as Element | null;
      expect(getWAttr(top!, W.w)).toBe('80');
      expect(getWAttr(top!, W.type)).toBe('dxa');
      expect(getWAttr(bottom!, W.w)).toBe('120');
      expect(getWAttr(left!, W.w)).toBe('40');
      expect(getWAttr(right!, W.w)).toBe('60');

      const secondCellMar = secondCell.getElementsByTagNameNS(OOXML.W_NS, W.tcMar).item(0);
      expect(secondCellMar).toBeNull();
    });
  });
});
