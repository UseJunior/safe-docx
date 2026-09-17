import { describe, expect } from 'vitest';
import { testAllure } from './helpers/allure-test.js';
import { parseXml, serializeXml } from '../src/primitives/xml.js';
import { OOXML } from '../src/primitives/namespaces.js';
import { rejectChanges } from '../src/primitives/reject_changes.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Reject Changes' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.29' });
const W = OOXML.W_NS;
const revision = 'w:id="9" w:author="AI" w:date="2026-09-17T00:00:00Z"';

function documentWithProperties(live: string, snapshot: string): Document {
  return parseXml(`<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>` +
    `<w:jc w:val="right"/>${live}<w:pPrChange ${revision}><w:pPr>${snapshot}</w:pPr></w:pPrChange>` +
    '</w:pPr><w:r><w:t>First section</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:sectPr><w:pgSz w:w="15840" w:h="12240"/></w:sectPr></w:pPr>' +
    '<w:r><w:t>Second section</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>');
}

describe('reject paragraph base-property snapshots without losing live extensions', () => {
  for (const [name, live] of [
    ['paragraph-mark formatting', '<w:rPr><w:color w:val="FF0000"/></w:rPr>'],
    ['section topology', '<w:sectPr><w:pgSz w:w="10000" w:h="14000"/></w:sectPr>'],
    ['both extensions', '<w:rPr><w:color w:val="FF0000"/></w:rPr><w:sectPr><w:pgSz w:w="10000" w:h="14000"/></w:sectPr>'],
  ]) {
    for (const empty of [false, true]) {
      test(`preserves ${name} with ${empty ? 'empty' : 'populated'} snapshot`, () => {
        const doc = documentWithProperties(live!, empty ? '' : '<w:jc w:val="both"/>');
        const beforeSections = Array.from(doc.getElementsByTagNameNS(W, 'sectPr')).map(serializeXml);
        expect(rejectChanges(doc).propertyChangesReverted).toBe(1);
        const properties = doc.getElementsByTagNameNS(W, 'pPr')[0]!;
        expect(serializeXml(properties)).toContain(live!);
        expect(Array.from(properties.childNodes).filter(n => n.nodeType === 1).map(n => (n as Element).localName))
          .toEqual([...(empty ? [] : ['jc']), ...(live!.includes('rPr') ? ['rPr'] : []), ...(live!.includes('sectPr') ? ['sectPr'] : [])]);
        expect(Array.from(doc.getElementsByTagNameNS(W, 'sectPr')).map(serializeXml)).toEqual(beforeSections);
        expect(doc.getElementsByTagNameNS(W, 'pPrChange').length).toBe(0);
      });
    }
  }

  test('selective Reject preserves foreign mark history and section history byte-for-byte', () => {
    const live = '<w:rPr><w:color w:val="FF0000"/><w:rPrChange w:id="10" w:author="Human"><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr>' +
      '<w:sectPr><w:pgSz w:w="10000" w:h="14000"/><w:sectPrChange w:id="11" w:author="Human"><w:sectPr><w:pgSz w:w="9000" w:h="13000"/></w:sectPr></w:sectPrChange></w:sectPr>';
    const doc = documentWithProperties(live, '<w:jc w:val="both"/>');
    const foreignBefore = ['rPrChange', 'sectPrChange'].map(name => serializeXml(doc.getElementsByTagNameNS(W, name)[0]!));
    rejectChanges(doc, { filter: el => el.getAttributeNS(W, 'author') === 'AI' });
    expect(['rPrChange', 'sectPrChange'].map(name => serializeXml(doc.getElementsByTagNameNS(W, name)[0]!))).toEqual(foreignBefore);
    expect(doc.getElementsByTagNameNS(W, 'jc')[0]!.getAttributeNS(W, 'val')).toBe('both');
  });

  test('selective Reject leaves a foreign paragraph property revision untouched', () => {
    const doc = documentWithProperties('<w:rPr><w:color w:val="FF0000"/></w:rPr>', '<w:jc w:val="both"/>');
    const before = serializeXml(doc);
    expect(rejectChanges(doc, { filter: el => el.getAttributeNS(W, 'author') === 'Human' }).propertyChangesReverted).toBe(0);
    expect(serializeXml(doc)).toBe(before);
  });
});
