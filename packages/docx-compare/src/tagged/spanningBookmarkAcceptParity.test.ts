import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { parseXml, serializeXml, acceptChanges, rejectChanges } from '@usejunior/docx-core';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

// #1019: accepting a wholly deleted paragraph must keep a bookmark boundary
// whose counterpart lives in a kept paragraph, in both the AST projector and
// the native primitive. Word's projection of these shapes is UNVERIFIED; the
// expectations mirror Reject of the w:ins case, not measured Word output.
const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Spanning bookmark acceptance parity' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' },
  );
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DATE = 'w:author="A" w:date="2026-01-01T00:00:00Z"';
const wrap = (body: string) => `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
const mark = (kind: 'del' | 'ins' | 'moveFrom', id: number) =>
  `<w:pPr><w:rPr><w:${kind} w:id="${id}" ${DATE}/></w:rPr></w:pPr>`;
const deleted = `<w:del w:id="2" ${DATE}><w:r><w:delText>GONE</w:delText></w:r></w:del>`;
const stableWithEnd = '<w:p><w:r><w:t>STABLE</w:t></w:r><w:bookmarkEnd w:id="77"/></w:p>';
/** Direct children of each paragraph, as `bs:<id>`, `be:<id>` or `t:<text>`. */
const shape = (xml: string) => Array.from(parseXml(xml).getElementsByTagNameNS(W, 'p')).map(p =>
  Array.from(p.childNodes).filter((n): n is Element => n.nodeType === 1).flatMap((n) => {
    if (n.localName === 'bookmarkStart') return [`bs:${n.getAttributeNS(W, 'id')}`];
    if (n.localName === 'bookmarkEnd') return [`be:${n.getAttributeNS(W, 'id')}`];
    if (n.localName === 'r') return [`t:${n.textContent}`];
    return [];
  }));
type NativeProject = (doc: Document) => unknown;
const native = (input: string, project: NativeProject) => {
  const doc = parseXml(input);
  project(doc);
  return serializeXml(doc);
};

describe('Accept keeps a bookmark spanning out of a deleted paragraph (#1019)', () => {
  const cases: Array<[string, string, NativeProject, (xml: string) => string, string[][]]> = [
    ['Accept deleted paragraph (issue repro)',
      `<w:p>${mark('del', 1)}<w:bookmarkStart w:id="77" w:name="Span"/>${deleted}</w:p>` + stableWithEnd,
      acceptChanges, acceptAllChanges, [['bs:77', 't:STABLE', 'be:77']]],
    ['Accept whole moved-from paragraph',
      `<w:moveFromRangeStart w:id="10" w:name="move1" ${DATE}/>` +
      `<w:p>${mark('moveFrom', 11)}<w:bookmarkStart w:id="77" w:name="Span"/>` +
      `<w:moveFrom w:id="12" ${DATE}><w:r><w:t>MOVED</w:t></w:r></w:moveFrom></w:p>` +
      '<w:moveFromRangeEnd w:id="10"/>' + stableWithEnd,
      acceptChanges, acceptAllChanges, [['bs:77', 't:STABLE', 'be:77']]],
    ['Accept terminal deleted paragraph holding a spanning end',
      '<w:p><w:bookmarkStart w:id="78" w:name="Back"/><w:r><w:t>KEEP</w:t></w:r></w:p>' +
      `<w:p>${mark('del', 1)}${deleted}<w:bookmarkEnd w:id="78"/></w:p>`,
      acceptChanges, acceptAllChanges, [['bs:78', 't:KEEP', 'be:78']]],
    ['Accept deleted paragraph before a table holding a spanning start',
      `<w:p>${mark('del', 1)}<w:bookmarkStart w:id="77" w:name="Span"/>${deleted}</w:p>` +
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>CELL</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:p><w:r><w:t>AFTER</w:t></w:r><w:bookmarkEnd w:id="77"/></w:p>',
      acceptChanges, acceptAllChanges, [['t:CELL'], ['bs:77', 't:AFTER', 'be:77']]],
    ['Accept terminal deleted table-cell paragraph holding a spanning end',
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>' +
      '<w:p><w:bookmarkStart w:id="82" w:name="Cell"/><w:r><w:t>KEEP</w:t></w:r></w:p>' +
      `<w:p>${mark('del', 1)}${deleted}<w:bookmarkEnd w:id="82"/></w:p>` +
      '</w:tc></w:tr></w:tbl><w:p/>',
      acceptChanges, acceptAllChanges, [['bs:82', 't:KEEP', 'be:82'], []]],
    ['Accept range across two deleted paragraphs',
      '<w:p><w:r><w:t>KEEP</w:t></w:r></w:p>' +
      `<w:p>${mark('del', 1)}<w:bookmarkStart w:id="83" w:name="Both"/>${deleted}</w:p>` +
      `<w:p>${mark('del', 3)}${deleted}<w:bookmarkEnd w:id="83"/></w:p><w:p><w:r><w:t>STABLE</w:t></w:r></w:p>`,
      acceptChanges, acceptAllChanges, [['t:KEEP'], ['bs:83', 'be:83', 't:STABLE']]],
    ['Accept range across two terminal deleted paragraphs',
      '<w:p><w:r><w:t>KEEP</w:t></w:r></w:p>' +
      `<w:p>${mark('del', 1)}<w:bookmarkStart w:id="83" w:name="Both"/>${deleted}</w:p>` +
      `<w:p>${mark('del', 3)}${deleted}<w:bookmarkEnd w:id="83"/></w:p>`,
      acceptChanges, acceptAllChanges, [['t:KEEP', 'bs:83', 'be:83']]],
    ['Accept consumes a local pair in a wholly deleted paragraph',
      `<w:p>${mark('del', 1)}<w:bookmarkStart w:id="79" w:name="Local"/>${deleted}<w:bookmarkEnd w:id="79"/></w:p>` +
      '<w:p><w:r><w:t>STABLE</w:t></w:r></w:p>',
      acceptChanges, acceptAllChanges, [['t:STABLE']]],
    ['Accept keeps a local pair around mixed surviving content',
      `<w:p>${mark('del', 1)}<w:bookmarkStart w:id="80" w:name="Mixed"/>${deleted}` +
      '<w:r><w:t>KEPT</w:t></w:r><w:bookmarkEnd w:id="80"/></w:p><w:p><w:r><w:t>STABLE</w:t></w:r></w:p>',
      acceptChanges, acceptAllChanges, [['bs:80', 't:KEPT', 'be:80', 't:STABLE']]],
    ['Reject inserted mirror (unchanged)',
      `<w:p>${mark('ins', 1)}<w:bookmarkStart w:id="77" w:name="Span"/>` +
      `<w:ins w:id="2" ${DATE}><w:r><w:t>NEW</w:t></w:r></w:ins></w:p>` + stableWithEnd,
      rejectChanges, rejectAllChanges, [['bs:77', 't:STABLE', 'be:77']]],
  ];
  for (const [name, body, nativeProject, astProject, expected] of cases) {
    test(`${name}: native and AST keep balanced endpoints`, () => {
      const input = wrap(body);
      expect(shape(astProject(input))).toEqual(expected);
      expect(shape(native(input, nativeProject))).toEqual(expected);
    });
  }
});
