import { describe, expect } from 'vitest';
import { parseXml, serializeXml } from '../src/primitives/xml.js';
import { OOXML, W } from '../src/primitives/namespaces.js';
import { getParagraphBookmarkId, insertParagraphBookmarks } from '../src/primitives/bookmarks.js';
import { setParagraphSpacing, setTableCellPadding, setTableRowHeight } from '../src/primitives/layout.js';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

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

describe('Traceability: docx-primitives — OOXML Layout', () => {
  test.openspec('setParagraphSpacing creates missing pPr and spacing containers')('Scenario: setParagraphSpacing creates missing pPr and spacing containers', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    const doc = makeDoc('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
    insertParagraphBookmarks(doc, 'test-attachment');
    const p = doc.getElementsByTagNameNS(OOXML.W_NS, W.p).item(0)!;
    const paraId = getParagraphBookmarkId(p)!;

    await given('a paragraph element without w:spacing children', async () => {
      await attachPrettyJson('Paragraph ID', { paraId });
    });

    await when('setParagraphSpacing is called', async () => {
      const result = setParagraphSpacing(doc, {
        paragraphIds: [paraId],
        beforeTwips: 120,
        afterTwips: 240,
        lineTwips: 360,
        lineRule: 'auto',
      });
      await attachPrettyJson('Result', result);
    });

    await then('the engine SHALL create pPr and spacing elements', () => {
      const pPr = p.getElementsByTagNameNS(OOXML.W_NS, W.pPr).item(0) as Element;
      expect(pPr).toBeTruthy();
      const spacing = pPr.getElementsByTagNameNS(OOXML.W_NS, W.spacing).item(0) as Element;
      expect(spacing).toBeTruthy();
      expect(getWAttr(spacing, W.before)).toBe('120');
      expect(getWAttr(spacing, W.after)).toBe('240');
    });
  });

  test.openspec('setParagraphSpacing preserves unrelated formatting nodes')('Scenario: setParagraphSpacing preserves unrelated formatting nodes', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    const doc = makeDoc(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Beta</w:t></w:r></w:p>',
    );
    insertParagraphBookmarks(doc, 'test-attachment');
    const p = doc.getElementsByTagNameNS(OOXML.W_NS, W.p).item(0)!;
    const paraId = getParagraphBookmarkId(p)!;

    await given('a paragraph with existing pPr children', () => {
      const jc = doc.getElementsByTagNameNS(OOXML.W_NS, W.jc);
      expect(jc.length).toBe(1);
    });

    await when('setParagraphSpacing is called', async () => {
      setParagraphSpacing(doc, { paragraphIds: [paraId], afterTwips: 180 });
      await attachPrettyJson('Result XML', serializeXml(doc));
    });

    await then('existing pPr children SHALL be preserved', () => {
      const pPr = p.getElementsByTagNameNS(OOXML.W_NS, W.pPr).item(0)!;
      const jc = pPr.getElementsByTagNameNS(OOXML.W_NS, W.jc).item(0) as Element;
      expect(jc).toBeTruthy();
      expect(getWAttr(jc, W.val)).toBe('center');
      const spacing = pPr.getElementsByTagNameNS(OOXML.W_NS, W.spacing).item(0) as Element;
      expect(spacing).toBeTruthy();
    });
  });

  test.openspec('setTableRowHeight reports missing indexes')('Scenario: setTableRowHeight reports missing indexes', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const doc = makeDoc(
      '<w:tbl>' +
      '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc></w:tr>' +
      '</w:tbl>',
    );

    let result!: ReturnType<typeof setTableRowHeight>;
    await when('setTableRowHeight is called with out-of-range indexes', async () => {
      result = setTableRowHeight(doc, {
        tableIndexes: [0, 2],
        rowIndexes: [1, 5],
        valueTwips: 420,
        rule: 'exact',
      });
      await attachPrettyJson('Result', result);
    });

    await then('the result SHALL report missing indexes', () => {
      expect(result.missingTableIndexes).toContain(2);
      expect(result.missingRowIndexes).toEqual(
        expect.arrayContaining([expect.objectContaining({ tableIndex: 0, rowIndex: 5 })]),
      );
    });
  });

  test.openspec('setTableCellPadding creates tcPr and tcMar containers')('Scenario: setTableCellPadding creates tcPr and tcMar containers', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    const doc = makeDoc(
      '<w:tbl>' +
      '<w:tr>' +
      '<w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>' +
      '</w:tr>' +
      '</w:tbl>',
    );

    await given('a table cell without tcPr or tcMar children', () => {
      const tcPr = doc.getElementsByTagNameNS(OOXML.W_NS, 'tcPr');
      expect(tcPr.length).toBe(0);
    });

    await when('setTableCellPadding is called', async () => {
      const result = setTableCellPadding(doc, {
        tableIndexes: [0],
        rowIndexes: [0],
        cellIndexes: [0],
        topDxa: 80,
        bottomDxa: 120,
        leftDxa: 40,
        rightDxa: 60,
      });
      await attachPrettyJson('Result', result);
    });

    await then('the engine SHALL create container elements and untargeted cells SHALL NOT be modified', () => {
      const firstCell = doc.getElementsByTagNameNS(OOXML.W_NS, W.tc).item(0)!;
      const secondCell = doc.getElementsByTagNameNS(OOXML.W_NS, W.tc).item(1)!;

      const tcMar = firstCell.getElementsByTagNameNS(OOXML.W_NS, W.tcMar).item(0);
      expect(tcMar).toBeTruthy();

      const secondCellMar = secondCell.getElementsByTagNameNS(OOXML.W_NS, W.tcMar).item(0);
      expect(secondCellMar).toBeNull();
    });
  });
});
