import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { parseXml } from './xml.js';
import { acceptChanges } from './accept_changes.js';
import { rejectChanges } from './reject_changes.js';

// #1019: accepting a wholly deleted paragraph must not consume a bookmark
// boundary whose counterpart lives in a kept paragraph. Word's own projection
// of these shapes is UNVERIFIED; the expectations below mirror Reject of the
// w:ins case, not measured Word output.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Native spanning bookmark acceptance' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' },
  );
const DATE = 'w:author="A" w:date="2026-01-01T00:00:00Z"';
const mark = (kind: 'del' | 'ins' | 'moveFrom', id: number) =>
  `<w:pPr><w:rPr><w:${kind} w:id="${id}" ${DATE}/></w:rPr></w:pPr>`;
const deleted = (text: string) => `<w:del w:id="2" ${DATE}><w:r><w:delText>${text}</w:delText></w:r></w:del>`;
const document = (body: string) =>
  parseXml(`<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`);
const texts = (doc: Document) => Array.from(doc.getElementsByTagNameNS(W, 'p')).map(p =>
  Array.from(p.getElementsByTagNameNS(W, 't')).map(t => t.textContent).join(''));
const ids = (doc: Document, kind: string) =>
  Array.from(doc.getElementsByTagNameNS(W, kind)).map(n => n.getAttributeNS(W, 'id'));
/** Direct children of each body paragraph, as `bs:<id>`, `be:<id>` or `t:<text>`. */
const shape = (doc: Document) => Array.from(doc.getElementsByTagNameNS(W, 'p')).map(p =>
  Array.from(p.childNodes).filter((n): n is Element => n.nodeType === 1).flatMap((n) => {
    if (n.localName === 'bookmarkStart') return [`bs:${n.getAttributeNS(W, 'id')}`];
    if (n.localName === 'bookmarkEnd') return [`be:${n.getAttributeNS(W, 'id')}`];
    if (n.localName === 'r') return [`t:${n.textContent}`];
    return [];
  }));

describe('native Accept keeps bookmarks spanning out of a deleted paragraph (#1019)', () => {
  test('a start in a deleted paragraph relocates into the following kept content', () => {
    const doc = document(
      `<w:p>${mark('del', 1)}<w:bookmarkStart w:id="77" w:name="Span"/>${deleted('GONE')}</w:p>` +
      '<w:p><w:r><w:t>STABLE</w:t></w:r><w:bookmarkEnd w:id="77"/></w:p>');
    acceptChanges(doc);
    expect(texts(doc)).toEqual(['STABLE']);
    expect(shape(doc)).toEqual([['bs:77', 't:STABLE', 'be:77']]);
    expect(Array.from(doc.getElementsByTagNameNS(W, 'bookmarkStart')).map(n => n.getAttributeNS(W, 'name'))).toEqual(['Span']);
  });

  test('an end in a deleted paragraph stays balanced with its kept start', () => {
    const doc = document(
      '<w:p><w:bookmarkStart w:id="78" w:name="Back"/><w:r><w:t>KEEP</w:t></w:r></w:p>' +
      `<w:p>${mark('del', 1)}${deleted('GONE')}<w:bookmarkEnd w:id="78"/></w:p>` +
      '<w:p><w:r><w:t>STABLE</w:t></w:r></w:p>');
    acceptChanges(doc);
    expect(texts(doc)).toEqual(['KEEP', 'STABLE']);
    expect(ids(doc, 'bookmarkStart')).toEqual(['78']);
    expect(ids(doc, 'bookmarkEnd')).toEqual(['78']);
  });

  test('a start in a whole moved-from paragraph relocates into the following kept content', () => {
    const doc = document(
      `<w:moveFromRangeStart w:id="10" w:name="move1" ${DATE}/>` +
      `<w:p>${mark('moveFrom', 11)}<w:bookmarkStart w:id="77" w:name="Span"/>` +
      `<w:moveFrom w:id="12" ${DATE}><w:r><w:t>MOVED</w:t></w:r></w:moveFrom></w:p>` +
      '<w:moveFromRangeEnd w:id="10"/>' +
      '<w:p><w:r><w:t>STABLE</w:t></w:r><w:bookmarkEnd w:id="77"/></w:p>');
    acceptChanges(doc);
    expect(shape(doc)).toEqual([['bs:77', 't:STABLE', 'be:77']]);
  });

  test('an end in a terminal deleted paragraph is rescued into the previous kept paragraph', () => {
    const doc = document(
      '<w:p><w:bookmarkStart w:id="78" w:name="Back"/><w:r><w:t>KEEP</w:t></w:r></w:p>' +
      `<w:p>${mark('del', 1)}${deleted('GONE')}<w:bookmarkEnd w:id="78"/></w:p>`);
    acceptChanges(doc);
    expect(shape(doc)).toEqual([['bs:78', 't:KEEP', 'be:78']]);
  });

  test('a start in a deleted paragraph before a table is rescued into the next kept paragraph', () => {
    const doc = document(
      `<w:p>${mark('del', 1)}<w:bookmarkStart w:id="77" w:name="Span"/>${deleted('GONE')}</w:p>` +
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>CELL</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:p><w:r><w:t>AFTER</w:t></w:r><w:bookmarkEnd w:id="77"/></w:p>');
    acceptChanges(doc);
    expect(shape(doc)).toEqual([['t:CELL'], ['bs:77', 't:AFTER', 'be:77']]);
  });

  test('an end in a terminal deleted table-cell paragraph is rescued within the cell', () => {
    const doc = document(
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>' +
      '<w:p><w:bookmarkStart w:id="82" w:name="Cell"/><w:r><w:t>KEEP</w:t></w:r></w:p>' +
      `<w:p>${mark('del', 1)}${deleted('GONE')}<w:bookmarkEnd w:id="82"/></w:p>` +
      '</w:tc></w:tr></w:tbl><w:p/>');
    acceptChanges(doc);
    expect(shape(doc)).toEqual([['bs:82', 't:KEEP', 'be:82'], []]);
  });

  for (const terminal of [false, true]) {
    test(`a range across two ${terminal ? 'terminal ' : ''}deleted paragraphs collapses into the survivor`, () => {
      const doc = document(
        '<w:p><w:r><w:t>KEEP</w:t></w:r></w:p>' +
        `<w:p>${mark('del', 1)}<w:bookmarkStart w:id="83" w:name="Both"/>${deleted('G1')}</w:p>` +
        `<w:p>${mark('del', 3)}${deleted('G2')}<w:bookmarkEnd w:id="83"/></w:p>` +
        (terminal ? '' : '<w:p><w:r><w:t>STABLE</w:t></w:r></w:p>'));
      acceptChanges(doc);
      expect(shape(doc)).toEqual(terminal
        ? [['t:KEEP', 'bs:83', 'be:83']]
        : [['t:KEEP'], ['bs:83', 'be:83', 't:STABLE']]);
    });
  }

  test('a local pair inside a wholly deleted paragraph is still consumed', () => {
    const doc = document(
      `<w:p>${mark('del', 1)}<w:bookmarkStart w:id="79" w:name="Local"/>${deleted('GONE')}<w:bookmarkEnd w:id="79"/></w:p>` +
      '<w:p><w:r><w:t>STABLE</w:t></w:r></w:p>');
    acceptChanges(doc);
    expect(shape(doc)).toEqual([['t:STABLE']]);
  });

  test('a local pair around mixed surviving content keeps its current behaviour', () => {
    const doc = document(
      `<w:p>${mark('del', 1)}<w:bookmarkStart w:id="80" w:name="Mixed"/>${deleted('GONE')}` +
      '<w:r><w:t>KEPT</w:t></w:r><w:bookmarkEnd w:id="80"/></w:p>' +
      '<w:p><w:r><w:t>STABLE</w:t></w:r></w:p>');
    acceptChanges(doc);
    expect(shape(doc)).toEqual([['bs:80', 't:KEPT', 'be:80', 't:STABLE']]);
  });

  test('Reject of the inserted mirror keeps both endpoints (unchanged)', () => {
    const doc = document(
      `<w:p>${mark('ins', 1)}<w:bookmarkStart w:id="77" w:name="Span"/>` +
      `<w:ins w:id="2" ${DATE}><w:r><w:t>NEW</w:t></w:r></w:ins></w:p>` +
      '<w:p><w:r><w:t>STABLE</w:t></w:r><w:bookmarkEnd w:id="77"/></w:p>');
    rejectChanges(doc);
    expect(shape(doc)).toEqual([['bs:77', 't:STABLE', 'be:77']]);
  });
});
