import { describe, expect } from 'vitest';
import { testAllure } from './testing/allure-test.js';
import {
  extractRoundTripComparisonText,
  pagerefComparisonIdentity,
} from './fieldComparisonSemantics.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'add-scoped-field-evaluation',
});
const conformanceTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.45' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.51' },
);

function field(instruction: string, result: string): string {
  return '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
    + `<w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>`
    + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    + `<w:r><w:t>${result}</w:t></w:r>`
    + '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
}

function documentXml(paragraphs: string): string {
  return `<w:document xmlns:w="${W_NS}"><w:body>${paragraphs}</w:body></w:document>`;
}

describe('shared field classification in comparison', () => {
  conformanceTest.openspec('[SDX-FIELD-EVAL-06] TOC PAGEREF identity uses shared classification')(
    'uses normalized PAGEREF identity instead of a volatile TOC page cache',
    () => {
      const instruction = ' pageref   &quot;_Toc 42&quot;  \\h ';
      const xml = documentXml(
        '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>'
          + field(instruction, '19')
          + '</w:p>',
      );

      expect(pagerefComparisonIdentity(' pageref   "_Toc 42"  \\h ')).toBe(
        '__safe_docx_pageref__|PAGEREF "_Toc 42" \\h',
      );
      expect(extractRoundTripComparisonText(xml)).toBe(
        '__safe_docx_pageref__|PAGEREF "_Toc 42" \\h',
      );
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-07] Suppression boundary remains narrow')(
    'keeps ordinary PAGEREF and REF cached results visible outside a TOC',
    () => {
      const xml = documentXml(
        `<w:p>${field(' PAGEREF Target \\h ', '12')}</w:p>`
          + `<w:p>${field(' REF Target \\h ', 'Clause text')}</w:p>`,
      );

      expect(extractRoundTripComparisonText(xml)).toBe('12\nClause text');
    },
  );
});
