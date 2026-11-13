import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { acceptChanges } from './accept_changes.js';
import {
  isEmptyNumberedParagraph,
  isParagraphMarkTrackedDeleted,
  paragraphHasVisibleContent,
  resolveDisplayedListNumbering,
} from './empty_numbered_paragraph.js';
import { OOXML, W } from './namespaces.js';
import { parseNumberingXml } from './numbering.js';
import { parseStylesXml } from './styles.js';
import { replaceParagraphTextRange } from './text.js';
import { createRevisionContext, createRevisionIdState } from './track-changes-emitter.js';
import { parseXml } from './xml.js';

const W_NS = OOXML.W_NS;
const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Empty Numbered Paragraph Detection' });

const NUMBERING = parseNumberingXml(parseXml(
  `<w:numbering xmlns:w="${W_NS}">`
  + '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%1)"/></w:lvl>'
  + '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading2"/><w:lvlText w:val="%2."/></w:lvl></w:abstractNum>'
  + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
  + '</w:numbering>',
));
const STYLES = parseStylesXml(parseXml(
  `<w:styles xmlns:w="${W_NS}">`
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>'
  + '<w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style>'
  + '</w:styles>',
));

const NUM_PR = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';

function body(xml: string): Document {
  return parseXml(`<w:document xmlns:w="${W_NS}" xmlns:m="${M_NS}"><w:body>${xml}<w:sectPr/></w:body></w:document>`);
}

function paragraphs(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagNameNS(W_NS, W.p));
}

function onlyParagraph(inner: string, pPr = `<w:pPr>${NUM_PR}</w:pPr>`): Element {
  return paragraphs(body(`<w:p>${pPr}${inner}</w:p><w:p><w:r><w:t>next</w:t></w:r></w:p>`))[0]!;
}

describe('empty numbered paragraph detection (#1047)', () => {
  test('visible content: whitespace, tabs, breaks and anchors are not content; text, symbols, embedded objects and note marks are', async ({ then }: AllureBddContext) => {
    await then('each paragraph body is classified as the accepted view renders it', () => {
      const cases: Array<[string, boolean]> = [
        ['', false],
        ['<w:r><w:t xml:space="preserve">    </w:t></w:r>', false],
        ['<w:r><w:tab/><w:br/></w:r>', false],
        ['<w:bookmarkStart w:id="1" w:name="_Ref1"/><w:bookmarkEnd w:id="1"/>', false],
        ['<w:commentRangeStart w:id="2"/><w:commentRangeEnd w:id="2"/><w:r><w:commentReference w:id="2"/></w:r>', false],
        ['<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> XE "x" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>', false],
        ['<w:del w:id="3" w:author="A"><w:r><w:delText>gone</w:delText></w:r></w:del>', false],
        ['<w:r><w:t>text</w:t></w:r>', true],
        ['<w:ins w:id="4" w:author="A"><w:r><w:t>inserted</w:t></w:r></w:ins>', true],
        ['<w:r><w:sym w:font="Wingdings" w:char="F0FE"/></w:r>', true],
        ['<w:r><w:drawing/></w:r>', true],
        ['<w:r><w:pict/></w:r>', true],
        ['<w:r><w:object/></w:r>', true],
        ['<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>', true],
        ['<w:r><w:footnoteReference w:id="1"/></w:r>', true],
      ];
      for (const [inner, expected] of cases) {
        expect([inner, paragraphHasVisibleContent(onlyParagraph(inner))]).toEqual([inner, expected]);
      }
    });
  });

  test('numbering: direct and style-inherited labels count; an undefined w:num or a missing numbering part does not', async ({ then }: AllureBddContext) => {
    await then('resolveDisplayedListNumbering follows the style chain and the numbering part', () => {
      expect(resolveDisplayedListNumbering(onlyParagraph(''), STYLES, NUMBERING)?.numId).toBe('1');
      expect(resolveDisplayedListNumbering(onlyParagraph('', '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>'), STYLES, NUMBERING)?.ilvl).toBe(1);
      expect(resolveDisplayedListNumbering(onlyParagraph('', '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="9"/></w:numPr></w:pPr>'), STYLES, NUMBERING)).toBeNull();
      expect(resolveDisplayedListNumbering(onlyParagraph(''), STYLES, null)).toBeNull();
      expect(resolveDisplayedListNumbering(onlyParagraph('', ''), STYLES, NUMBERING)).toBeNull();
    });
  });

  test('a deleted paragraph mark hides the paragraph only when accept-all can merge or remove it', async ({ then }: AllureBddContext) => {
    await then('a list item with a deleted mark before another paragraph is not empty-numbered, a table cell\'s only paragraph is', () => {
      const deletedMark = `<w:pPr>${NUM_PR}<w:rPr><w:del w:id="5" w:author="A"/></w:rPr></w:pPr>`;
      const listItem = onlyParagraph('<w:del w:id="6" w:author="A"><w:r><w:delText>gone</w:delText></w:r></w:del>', deletedMark);
      expect(isParagraphMarkTrackedDeleted(listItem)).toBe(true);
      expect(isEmptyNumberedParagraph(listItem, STYLES, NUMBERING)).toBe(false);

      const cell = paragraphs(body(
        `<w:tbl><w:tr><w:tc><w:tcPr/><w:p>${deletedMark}<w:del w:id="6" w:author="A"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p></w:tc></w:tr></w:tbl><w:p/>`,
      ))[0]!;
      expect(isEmptyNumberedParagraph(cell, STYLES, NUMBERING)).toBe(true);
    });
  });

  test('before a table, the predicate agrees with accept-all on whether a mark-deleted list item survives', async ({ then }: AllureBddContext) => {
    await then('a mark-deleted item still holding whitespace survives accept-all and is reported; one holding only deleted text is removed and is not', () => {
      const deletedMark = `<w:pPr>${NUM_PR}<w:rPr><w:del w:id="5" w:author="A"/></w:rPr></w:pPr>`;
      const deletedText = '<w:del w:id="6" w:author="A"><w:r><w:delText>gone</w:delText></w:r></w:del>';
      const table = '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>last</w:t></w:r></w:p>';
      for (const [inner, survives] of [[`${deletedText}<w:r><w:t xml:space="preserve"> </w:t></w:r>`, true], [deletedText, false]] as const) {
        const doc = body(`<w:p><w:r><w:t>first</w:t></w:r></w:p><w:p>${deletedMark}${inner}</w:p>${table}`);
        const item = paragraphs(doc)[1]!;
        expect(isEmptyNumberedParagraph(item, STYLES, NUMBERING)).toBe(survives);
        acceptChanges(doc);
        expect(!!item.parentNode).toBe(survives);
      }
    });
  });

  test('whitespace left in a numbered paragraph is empty-numbered; a detached paragraph is not', async ({ then }: AllureBddContext) => {
    await then('the predicate fires for whitespace and stops once the paragraph is removed', () => {
      const p = onlyParagraph('<w:r><w:t xml:space="preserve"> </w:t></w:r>');
      expect(isEmptyNumberedParagraph(p, STYLES, NUMBERING)).toBe(true);
      p.parentNode!.removeChild(p);
      expect(isEmptyNumberedParagraph(p, STYLES, NUMBERING)).toBe(false);
    });
  });

  describe('a table cell keeps its only paragraph when that paragraph is blanked', () => {
    const tableBody = (cellParagraph: string): string =>
      '<w:p><w:r><w:t>before</w:t></w:r></w:p>'
      + `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>${cellParagraph}</w:tc></w:tr></w:tbl>`
      + '<w:p><w:r><w:t>after</w:t></w:r></w:p>';
    const cellParagraphs = (doc: Document): Element[] =>
      Array.from(doc.getElementsByTagNameNS(W_NS, 'tc').item(0)!.childNodes)
        .filter((c): c is Element => c.nodeType === 1 && (c as Element).localName === 'p');

    test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.65' })(
      'untracked: a cell with w:tcPr keeps its only paragraph',
      async ({ given, when, then }: AllureBddContext) => {
        let doc!: Document;
        await given('a one-cell table with cell properties and one numbered paragraph', () => {
          doc = body(tableBody(`<w:p><w:pPr>${NUM_PR}</w:pPr><w:r><w:t>cell text</w:t></w:r></w:p>`));
        });
        await when('the cell paragraph is blanked untracked', () => {
          replaceParagraphTextRange(cellParagraphs(doc)[0]!, 0, 'cell text'.length, '');
        });
        await then('the cell still ends with a paragraph', () => {
          expect(cellParagraphs(doc)).toHaveLength(1);
        });
      },
    );

    test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.65' })(
      'tracked then accepted: a cell with w:tcPr keeps its only paragraph',
      async ({ given, when, then }: AllureBddContext) => {
        let doc!: Document;
        await given('a one-cell table with cell properties and one numbered paragraph', () => {
          doc = body(tableBody(`<w:p><w:pPr>${NUM_PR}</w:pPr><w:r><w:t>cell text</w:t></w:r></w:p>`));
        });
        await when('the cell paragraph is blanked as a tracked change and all changes are accepted', () => {
          const ctx = createRevisionContext({ author: 'A', date: '2026-01-01T00:00:00Z', idState: createRevisionIdState(1) });
          replaceParagraphTextRange(cellParagraphs(doc)[0]!, 0, 'cell text'.length, '', ctx);
          acceptChanges(doc);
        });
        await then('the cell still ends with a paragraph', () => {
          expect(cellParagraphs(doc)).toHaveLength(1);
        });
      },
    );
  });
});
