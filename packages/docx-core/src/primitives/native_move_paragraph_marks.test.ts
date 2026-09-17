import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { parseXml } from './xml.js';
import { acceptChanges } from './accept_changes.js';
import { rejectChanges } from './reject_changes.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Native move paragraph marks' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.21' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.22' },
  );
// Complete range/mark/content shapes are the subjects of these consumer tests.
const endpoint = (kind: 'moveFrom' | 'moveTo', base: number, body: string, bookmark = true) =>
  '<w:' + kind + 'RangeStart w:id="' + base + '" w:name="move1" w:author="AI"/>' +
  '<w:p><w:pPr><w:rPr><w:' + kind + ' w:id="' + (base + 1) + '" w:author="AI"/></w:rPr></w:pPr>' +
  (bookmark ? '<w:bookmarkStart w:id="' + (base + 2) + '" w:name="anchor' + base + '"/>' : '') +
  body +
  (bookmark ? '<w:bookmarkEnd w:id="' + (base + 2) + '"/>' : '') +
  '</w:p><w:' + kind + 'RangeEnd w:id="' + base + '"/>';
const content = (kind: 'moveFrom' | 'moveTo', id: number, author = 'AI') =>
  '<w:' + kind + ' w:id="' + id + '" w:author="' + author + '"><w:r><w:t>MOVED</w:t></w:r></w:' + kind + '>';
const stable = '<w:p><w:r><w:t>STABLE</w:t></w:r></w:p>';
const document = (body: string) => parseXml('<w:document xmlns:w="' + W + '"><w:body>' + body + '<w:sectPr/></w:body></w:document>');
const texts = (doc: Document) => Array.from(doc.getElementsByTagNameNS(W, 'p')).map(p =>
  Array.from(p.getElementsByTagNameNS(W, 't')).map(t => t.textContent).join(''));

describe('native move-mark resolution without comparison coverage indirection', () => {
  for (const terminal of [false, true]) {
    for (const [name, resolve, expectedBookmark] of [
      ['accept', acceptChanges, '12'], ['reject', rejectChanges, '3'],
    ] as const) {
      test(name + ' resolves ' + (terminal ? 'terminal' : 'middle') + ' move marks and local bookmark pairs', () => {
        const from = endpoint('moveFrom', 1, content('moveFrom', 4));
        const to = endpoint('moveTo', 10, content('moveTo', 13));
        const doc = document(terminal ? from + stable + to : from + to + stable);
        resolve(doc);
        expect(texts(doc)).toEqual(name === 'accept' && terminal ? ['STABLE', 'MOVED'] : ['MOVED', 'STABLE']);
        for (const kind of ['bookmarkStart', 'bookmarkEnd']) {
          expect(Array.from(doc.getElementsByTagNameNS(W, kind)).map(n => n.getAttributeNS(W, 'id')))
            .toEqual([expectedBookmark]);
        }
        for (const kind of ['moveFrom', 'moveTo', 'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd']) {
          expect(doc.getElementsByTagNameNS(W, kind)).toHaveLength(0);
        }
      });
    }
  }
  for (const [name, body] of [
    ['empty', ''],
    ['untracked', '<w:r><w:t>KEPT</w:t></w:r>'],
    ['foreign move', content('moveTo', 13, 'Human')],
    ['mixed surviving content', content('moveTo', 13) + '<w:r><w:t>KEPT</w:t></w:r>'],
  ]) {
    test('reject preserves local bookmarks around ' + name + ' content', () => {
      const doc = document(endpoint('moveTo', 10, body!) + stable);
      rejectChanges(doc, { filter: e => e.getAttributeNS(W, 'author') === 'AI' || e.localName.endsWith('RangeEnd') });
      expect(Array.from(doc.getElementsByTagNameNS(W, 'bookmarkStart')).map(n => n.getAttributeNS(W, 'id'))).toEqual(['12']);
      expect(Array.from(doc.getElementsByTagNameNS(W, 'bookmarkEnd')).map(n => n.getAttributeNS(W, 'id'))).toEqual(['12']);
      expect(texts(doc)).toEqual([name === 'foreign move' ? 'MOVEDSTABLE' : name === 'empty' ? 'STABLE' : 'KEPTSTABLE']);
      expect(doc.getElementsByTagNameNS(W, 'moveTo')).toHaveLength(name === 'foreign move' ? 1 : 0);
    });
  }
  test('reject consumes local bookmark pairs around fully selected insertion content at a moved break', () => {
    const doc = document(endpoint('moveTo', 10, '<w:ins w:id="13" w:author="AI"><w:r><w:t>INSERTED</w:t></w:r></w:ins>') + stable);
    rejectChanges(doc);
    expect(texts(doc)).toEqual(['STABLE']);
    expect(doc.getElementsByTagNameNS(W, 'bookmarkStart')).toHaveLength(0);
    expect(doc.getElementsByTagNameNS(W, 'bookmarkEnd')).toHaveLength(0);
  });
});
