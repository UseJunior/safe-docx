import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { acceptChanges } from './accept_changes.js';
import { rejectChanges } from './reject_changes.js';
import { getParagraphText } from './text.js';
import { parseXml } from './xml.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEST_FEATURE = 'refactor-revision-resolution-phases';

const test = testAllure.epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.21' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.22' },
  );

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

describe('Tracked revision resolution phases (issue #1313)', () => {
  describe('Nested wrappers phase', () => {
    test('unwraps deeply nested insertion wrappers deepest-first on accept', async ({
      given,
      when,
      then,
    }: AllureBddContext) => {
      let doc: Document;

      await given('a document with nested w:ins wrappers', () => {
        doc = makeDoc(
          '<w:p>' +
            '<w:ins w:id="1" w:author="AuthorA">' +
              '<w:ins w:id="2" w:author="AuthorA">' +
                '<w:r><w:t>Nested Content</w:t></w:r>' +
              '</w:ins>' +
            '</w:ins>' +
          '</w:p>',
        );
      });

      await when('acceptChanges is executed', () => {
        const res = acceptChanges(doc);
        expect(res.insertionsAccepted).toBe(2);
      });

      await then('all nested wrappers are removed and inner text is preserved', () => {
        const insList = doc.getElementsByTagNameNS(W_NS, 'ins');
        expect(insList.length).toBe(0);
        const p = doc.getElementsByTagNameNS(W_NS, 'p').item(0)!;
        expect(getParagraphText(p)).toBe('Nested Content');
      });
    });

    test('unwraps nested deletion wrappers deepest-first and restores delText on reject', async ({
      given,
      when,
      then,
    }: AllureBddContext) => {
      let doc: Document;

      await given('a document with nested w:del wrappers', () => {
        doc = makeDoc(
          '<w:p>' +
            '<w:del w:id="1" w:author="AuthorA">' +
              '<w:del w:id="2" w:author="AuthorA">' +
                '<w:r><w:delText>Deleted Inner Text</w:delText></w:r>' +
              '</w:del>' +
            '</w:del>' +
          '</w:p>',
        );
      });

      await when('rejectChanges is executed', () => {
        const res = rejectChanges(doc);
        expect(res.deletionsRestored).toBe(2);
      });

      await then('all w:del wrappers are unwrapped and text is restored to w:t', () => {
        const delList = doc.getElementsByTagNameNS(W_NS, 'del');
        expect(delList.length).toBe(0);
        const delTextList = doc.getElementsByTagNameNS(W_NS, 'delText');
        expect(delTextList.length).toBe(0);
        const p = doc.getElementsByTagNameNS(W_NS, 'p').item(0)!;
        expect(getParagraphText(p)).toBe('Deleted Inner Text');
      });
    });
  });

  describe('Moves phase and issue #1020 linkage', () => {
    test('resolves moves and cleans range markers on accept and reject', async ({
      given,
      when,
      then,
    }: AllureBddContext) => {
      let docAccept: Document;
      let docReject: Document;

      const xml =
        '<w:p>' +
          '<w:moveFromRangeStart w:id="10" w:name="move1" w:author="AuthorA"/>' +
          '<w:moveFrom w:id="11" w:author="AuthorA"><w:r><w:delText>Source Text</w:delText></w:r></w:moveFrom>' +
          '<w:moveFromRangeEnd w:id="10"/>' +
          '<w:moveToRangeStart w:id="10" w:name="move1" w:author="AuthorA"/>' +
          '<w:moveTo w:id="12" w:author="AuthorA"><w:r><w:t>Dest Text</w:t></w:r></w:moveTo>' +
          '<w:moveToRangeEnd w:id="10"/>' +
        '</w:p>';

      await given('documents containing moveFrom, moveTo, and range markers', () => {
        docAccept = makeDoc(xml);
        docReject = makeDoc(xml);
      });

      await when('acceptChanges is executed', () => {
        const res = acceptChanges(docAccept);
        expect(res.movesResolved).toBe(2);
      });

      await then('destination content is kept and move markers are cleaned', () => {
        expect(docAccept.getElementsByTagNameNS(W_NS, 'moveFrom').length).toBe(0);
        expect(docAccept.getElementsByTagNameNS(W_NS, 'moveTo').length).toBe(0);
        expect(docAccept.getElementsByTagNameNS(W_NS, 'moveFromRangeStart').length).toBe(0);
        expect(docAccept.getElementsByTagNameNS(W_NS, 'moveToRangeEnd').length).toBe(0);
        const p = docAccept.getElementsByTagNameNS(W_NS, 'p').item(0)!;
        expect(getParagraphText(p)).toBe('Dest Text');
      });

      await when('rejectChanges is executed', () => {
        const res = rejectChanges(docReject);
        expect(res.movesReverted).toBe(2);
      });

      await then('source content is kept and move markers are cleaned', () => {
        expect(docReject.getElementsByTagNameNS(W_NS, 'moveFrom').length).toBe(0);
        expect(docReject.getElementsByTagNameNS(W_NS, 'moveTo').length).toBe(0);
        const p = docReject.getElementsByTagNameNS(W_NS, 'p').item(0)!;
        expect(getParagraphText(p)).toBe('Source Text');
      });
    });

    test('preserves documented issue #1020 behavior for selective author move range resolution', async ({
      given,
      when,
      then,
    }: AllureBddContext) => {
      let doc: Document;

      await given('a move with authored start and authorless end alongside another author revision', () => {
        doc = makeDoc(
          '<w:p>' +
            '<w:moveFromRangeStart w:id="20" w:name="move1" w:author="AuthorA"/>' +
            '<w:moveFrom w:id="21" w:author="AuthorA"><w:r><w:delText>Moved</w:delText></w:r></w:moveFrom>' +
            '<w:moveFromRangeEnd w:id="20"/>' +
            '<w:ins w:id="22" w:author="AuthorB"><w:r><w:t>Other Author</w:t></w:r></w:ins>' +
          '</w:p>',
        );
      });

      await when('selective filter for AuthorA is applied', () => {
        // Author filter matches AuthorA; rangeEnd has no w:author attribute so filter returns false.
        const filter = (el: Element) => {
          const author = el.getAttributeNS(W_NS, 'author') ?? el.getAttribute('w:author');
          return author === 'AuthorA';
        };
        acceptChanges(doc, { filter });
      });

      await then('authored start is removed while authorless range end remains per #1020 baseline', () => {
        expect(doc.getElementsByTagNameNS(W_NS, 'moveFromRangeStart').length).toBe(0);
        // Link #1020: authorless move range end is not matched by selective filter and remains behind
        expect(doc.getElementsByTagNameNS(W_NS, 'moveFromRangeEnd').length).toBe(1);
        // Foreign revision by AuthorB is untouched
        expect(doc.getElementsByTagNameNS(W_NS, 'ins').length).toBe(1);
      });
    });
  });

  describe('Rows/cells phase', () => {
    test('resolves row-level revisions (w:trPr > w:del and w:ins)', async ({
      given,
      when,
      then,
    }: AllureBddContext) => {
      let docAccept: Document;
      let docReject: Document;

      const xml =
        '<w:tbl>' +
          '<w:tr>' +
            '<w:trPr><w:del w:id="30" w:author="AuthorA"/></w:trPr>' +
            '<w:tc><w:p><w:r><w:t>Deleted Row</w:t></w:r></w:p></w:tc>' +
          '</w:tr>' +
          '<w:tr>' +
            '<w:trPr><w:ins w:id="31" w:author="AuthorA"/></w:trPr>' +
            '<w:tc><w:p><w:r><w:t>Inserted Row</w:t></w:r></w:p></w:tc>' +
          '</w:tr>' +
        '</w:tbl>';

      await given('a table with a deleted row and an inserted row', () => {
        docAccept = makeDoc(xml);
        docReject = makeDoc(xml);
      });

      await when('acceptChanges is executed', () => {
        const res = acceptChanges(docAccept);
        expect(res.deletionsAccepted).toBe(1);
        expect(res.insertionsAccepted).toBe(1);
      });

      await then('the deleted row is removed and inserted row marker is stripped', () => {
        const rows = docAccept.getElementsByTagNameNS(W_NS, 'tr');
        expect(rows.length).toBe(1);
        expect(rows.item(0)!.getElementsByTagNameNS(W_NS, 'ins').length).toBe(0);
        expect(getParagraphText(rows.item(0)!.getElementsByTagNameNS(W_NS, 'p').item(0)!)).toBe('Inserted Row');
      });

      await when('rejectChanges is executed', () => {
        const res = rejectChanges(docReject);
        expect(res.deletionsRestored).toBe(1);
        expect(res.insertionsRemoved).toBe(1);
      });

      await then('the inserted row is removed and deleted row marker is stripped', () => {
        const rows = docReject.getElementsByTagNameNS(W_NS, 'tr');
        expect(rows.length).toBe(1);
        expect(rows.item(0)!.getElementsByTagNameNS(W_NS, 'del').length).toBe(0);
        expect(getParagraphText(rows.item(0)!.getElementsByTagNameNS(W_NS, 'p').item(0)!)).toBe('Deleted Row');
      });
    });
  });

  describe('Properties and paragraph marks phases', () => {
    test('resolves paragraph property changes and paragraph mark merges', async ({
      given,
      when,
      then,
    }: AllureBddContext) => {
      let docAccept: Document;
      let docReject: Document;

      const xml =
        '<w:p>' +
          '<w:pPr>' +
            '<w:rPr><w:del w:id="40" w:author="AuthorA"/></w:rPr>' +
            '<w:pPrChange w:id="41" w:author="AuthorA">' +
              '<w:pPr><w:jc w:val="left"/></w:pPr>' +
            '</w:pPrChange>' +
          '</w:pPr>' +
          '<w:r><w:t>First Paragraph</w:t></w:r>' +
        '</w:p>' +
        '<w:p>' +
          '<w:r><w:t>Second Paragraph</w:t></w:r>' +
        '</w:p>';

      await given('two paragraphs where the first paragraph mark has a deleted mark and pPrChange', () => {
        docAccept = makeDoc(xml);
        docReject = makeDoc(xml);
      });

      await when('acceptChanges is executed', () => {
        const res = acceptChanges(docAccept);
        expect(res.propertyChangesResolved).toBe(1);
      });

      await then('the deleted break merges first paragraph into the second paragraph', () => {
        const paragraphs = docAccept.getElementsByTagNameNS(W_NS, 'p');
        expect(paragraphs.length).toBe(1);
        expect(getParagraphText(paragraphs.item(0)!)).toBe('First ParagraphSecond Paragraph');
      });

      await when('rejectChanges is executed', () => {
        const res = rejectChanges(docReject);
        expect(res.propertyChangesReverted).toBe(1);
      });

      await then('the paragraphs remain separate and original paragraph properties are restored', () => {
        const paragraphs = docReject.getElementsByTagNameNS(W_NS, 'p');
        expect(paragraphs.length).toBe(2);
        const jc = paragraphs.item(0)!.getElementsByTagNameNS(W_NS, 'jc');
        expect(jc.length).toBe(1);
        expect(jc.item(0)!.getAttributeNS(W_NS, 'val') ?? jc.item(0)!.getAttribute('w:val')).toBe('left');
      });
    });
  });
});
