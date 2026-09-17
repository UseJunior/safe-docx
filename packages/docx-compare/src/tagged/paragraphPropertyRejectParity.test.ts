import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { parseXml, serializeXml, rejectChanges } from '@usejunior/docx-core';
import { rejectAllChanges } from './trackChangesAcceptorAst.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Track Changes Acceptor' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.29' });
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

describe('native and AST paragraph property Reject parity', () => {
  for (const snapshot of ['', '<w:jc w:val="both"/>']) {
    for (const separateHistory of [false, true]) {
      test(`retains live mark/section with ${snapshot ? 'populated' : 'empty'} snapshot and ${separateHistory ? 'separate' : 'no'} histories`, () => {
        const markHistory = separateHistory ? '<w:rPrChange w:id="2" w:author="AI"><w:rPr><w:color w:val="00FF00"/></w:rPr></w:rPrChange>' : '';
        const sectionHistory = separateHistory ? '<w:sectPrChange w:id="3" w:author="AI"><w:sectPr><w:pgSz w:w="9000" w:h="13000"/></w:sectPr></w:sectPrChange>' : '';
        const input = `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:jc w:val="right"/>` +
          `<w:rPr><w:color w:val="FF0000"/>${markHistory}</w:rPr>` +
          `<w:sectPr><w:pgSz w:w="10000" w:h="14000"/>${sectionHistory}</w:sectPr>` +
          `<w:pPrChange w:id="1" w:author="AI"><w:pPr>${snapshot}</w:pPr></w:pPrChange>` +
          '</w:pPr><w:r><w:t>Unchanged section</w:t></w:r></w:p><w:sectPr/></w:body></w:document>';
        const native = parseXml(input);
        rejectChanges(native);
        const ast = parseXml(rejectAllChanges(input));
        expect(serializeXml(native)).toBe(serializeXml(ast));
        expect(native.getElementsByTagNameNS(W, 'sectPr').length).toBe(2);
        expect(native.getElementsByTagNameNS(W, 'color')[0]!.getAttributeNS(W, 'val')).toBe(separateHistory ? '00FF00' : 'FF0000');
        expect(native.getElementsByTagNameNS(W, 'pgSz')[0]!.getAttributeNS(W, 'w')).toBe(separateHistory ? '9000' : '10000');
      });
    }
  }
});
