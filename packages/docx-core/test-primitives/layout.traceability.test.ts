import { describe, expect } from 'vitest';
import { parseXml, serializeXml } from '../src/primitives/xml.js';
import { OOXML, W } from '../src/primitives/namespaces.js';
import { getParagraphBookmarkId, insertParagraphBookmarks } from '../src/primitives/bookmarks.js';
import { setParagraphSpacing, setTableCellPadding, setTableRowHeight } from '../src/primitives/layout.js';
import { itAllure, allureStep, allureJsonAttachment } from './helpers/allure-test.js';

const TEST_FEATURE = 'docx-primitives';

const it = itAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });

const humanReadableIt = it.allure({
  
  tags: ['human-readable'],
  
  parameters: { audience: 'non-technical' },
  
});

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
  humanReadableIt.openspec('setParagraphSpacing creates missing pPr and spacing containers')('Scenario: setParagraphSpacing creates missing pPr and spacing containers', async () => {
    const doc = makeDoc('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
    insertParagraphBookmarks(doc, 'test-attachment');
    const p = doc.getElementsByTagNameNS(OOXML.W_NS, W.p).item(0)!;
    const paraId = getParagraphBookmarkId(p)!;

    await allureStep('Given a paragraph element without w:spacing children', async () => {
      await allureJsonAttachment('Paragraph ID', { paraId });
    });

    await allureStep('When setParagraphSpacing is called', async () => {
      const result = setParagraphSpacing(doc, {
        paragraphIds: [paraId],
        beforeTwips: 120,
        afterTwips: 240,
        lineTwips: 360,
        lineRule: 'auto',
      });
      await allureJsonAttachment('Result', result);
    });

    await allureStep('Then the engine SHALL create pPr and spacing elements', () => {
      const pPr = p.getElementsByTagNameNS(OOXML.W_NS, W.pPr).item(0) as Element;
      expect(pPr).toBeTruthy();
      const spacing = pPr.getElementsByTagNameNS(OOXML.W_NS, W.spacing).item(0) as Element;
      expect(spacing).toBeTruthy();
      expect(getWAttr(spacing, W.before)).toBe('120');
      expect(getWAttr(spacing, W.after)).toBe('240');
    });
  });

  humanReadableIt.openspec('setParagraphSpacing preserves unrelated formatting nodes')('Scenario: setParagraphSpacing preserves unrelated formatting nodes', async () => {
    const doc = makeDoc(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Beta</w:t></w:r></w:p>',
    );
    insertParagraphBookmarks(doc, 'test-attachment');
    const p = doc.getElementsByTagNameNS(OOXML.W_NS, W.p).item(0)!;
    const paraId = getParagraphBookmarkId(p)!;

    await allureStep('Given a paragraph with existing pPr children', async () => {
      const jc = doc.getElementsByTagNameNS(OOXML.W_NS, W.jc);
      expect(jc.length).toBe(1);
    });

    await allureStep('When setParagraphSpacing is called', async () => {
      setParagraphSpacing(doc, { paragraphIds: [paraId], afterTwips: 180 });
      await allureJsonAttachment('Result XML', serializeXml(doc));
    });

    await allureStep('Then existing pPr children SHALL be preserved', () => {
      const pPr = p.getElementsByTagNameNS(OOXML.W_NS, W.pPr).item(0)!;
      const jc = pPr.getElementsByTagNameNS(OOXML.W_NS, W.jc).item(0) as Element;
      expect(jc).toBeTruthy();
      expect(getWAttr(jc, W.val)).toBe('center');
      const spacing = pPr.getElementsByTagNameNS(OOXML.W_NS, W.spacing).item(0) as Element;
      expect(spacing).toBeTruthy();
    });
  });

  humanReadableIt.openspec('setTableRowHeight reports missing indexes')('Scenario: setTableRowHeight reports missing indexes', async () => {
    const doc = makeDoc(
      '<w:tbl>' +
      '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc></w:tr>' +
      '</w:tbl>',
    );

    const result = await allureStep('When setTableRowHeight is called with out-of-range indexes', async () => {
      const r = setTableRowHeight(doc, {
        tableIndexes: [0, 2],
        rowIndexes: [1, 5],
        valueTwips: 420,
        rule: 'exact',
      });
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then the result SHALL report missing indexes', () => {
      expect(result.missingTableIndexes).toContain(2);
      expect(result.missingRowIndexes).toEqual(
        expect.arrayContaining([expect.objectContaining({ tableIndex: 0, rowIndex: 5 })]),
      );
    });
  });

  humanReadableIt.openspec('setTableCellPadding creates tcPr and tcMar containers')('Scenario: setTableCellPadding creates tcPr and tcMar containers', async () => {
    const doc = makeDoc(
      '<w:tbl>' +
      '<w:tr>' +
      '<w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>' +
      '</w:tr>' +
      '</w:tbl>',
    );

    await allureStep('Given a table cell without tcPr or tcMar children', async () => {
      const tcPr = doc.getElementsByTagNameNS(OOXML.W_NS, 'tcPr');
      expect(tcPr.length).toBe(0);
    });

    await allureStep('When setTableCellPadding is called', async () => {
      const result = setTableCellPadding(doc, {
        tableIndexes: [0],
        rowIndexes: [0],
        cellIndexes: [0],
        topDxa: 80,
        bottomDxa: 120,
        leftDxa: 40,
        rightDxa: 60,
      });
      await allureJsonAttachment('Result', result);
    });

    await allureStep('Then the engine SHALL create container elements and untargeted cells SHALL NOT be modified', () => {
      const firstCell = doc.getElementsByTagNameNS(OOXML.W_NS, W.tc).item(0)!;
      const secondCell = doc.getElementsByTagNameNS(OOXML.W_NS, W.tc).item(1)!;

      const tcMar = firstCell.getElementsByTagNameNS(OOXML.W_NS, W.tcMar).item(0);
      expect(tcMar).toBeTruthy();

      const secondCellMar = secondCell.getElementsByTagNameNS(OOXML.W_NS, W.tcMar).item(0);
      expect(secondCellMar).toBeNull();
    });
  });
});
