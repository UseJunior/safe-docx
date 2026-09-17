import { describe, expect } from 'vitest';
import { XMLSerializer } from '@xmldom/xmldom';
import { testAllure } from '../testing/allure-test.js';
import { parseXml, serializeXml, acceptChanges, rejectChanges } from '@usejunior/docx-core';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Terminal mark cleanup parity' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' });
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const subtree = (element: Element) => new XMLSerializer().serializeToString(element);
const wrap = (body: string) => `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
const paragraph = (kind: string, color: boolean, text: boolean) => '<w:p><w:pPr><w:jc w:val="right"/><w:rPr>' +
  `<w:${kind} w:id="1" w:author="AI"/>${color ? '<w:color w:val="FF0000"/>' : ''}` +
  `</w:rPr></w:pPr>${text ? '<w:r><w:t>Surviving text</w:t></w:r>' : ''}</w:p>`;
const cell = (p: string) => '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>' + p + '</w:tc></w:tr></w:tbl>';

describe('resolved terminal paragraph-mark properties', () => {
  for (const [name, kind, nativeProject, astProject] of [
    ['Accept', 'del', acceptChanges, acceptAllChanges], ['Reject', 'ins', rejectChanges, rejectAllChanges],
  ] as const) {
    for (const inCell of [false, true]) {
      for (const color of [false, true]) {
        test(`${name} terminal ${inCell ? 'cell' : 'body'} mark ${color ? 'retains color' : 'drops empty rPr'}`, () => {
          const p = paragraph(kind, color, true);
          const input = wrap(inCell ? cell(p) : p);
          const doc = parseXml(input);
          nativeProject(doc);
          expect(serializeXml(doc)).toBe(serializeXml(parseXml(astProject(input))));
          expect(doc.getElementsByTagNameNS(W, 'p').length).toBe(1);
          expect(doc.getElementsByTagNameNS(W, 't')[0]!.textContent).toBe('Surviving text');
          expect(doc.getElementsByTagNameNS(W, 'rPr').length).toBe(color ? 1 : 0);
        });
      }
    }

    test(`${name} preserves the required empty last table-cell paragraph`, () => {
      const input = wrap(cell(paragraph(kind, false, false)));
      const doc = parseXml(input);
      nativeProject(doc);
      expect(doc.getElementsByTagNameNS(W, 'p').length).toBe(1);
      expect(doc.getElementsByTagNameNS(W, 'rPr').length).toBe(0);
      expect(serializeXml(doc)).toBe(serializeXml(parseXml(astProject(input))));
    });

    test(`${name} resolves one author while preserving a foreign terminal mark and formatting`, () => {
      const foreign = paragraph(kind, true, true).replace('w:author="AI"', 'w:author="Human"');
      const input = wrap(cell(paragraph(kind, false, true)) + cell(foreign));
      const doc = parseXml(input);
      const foreignBefore = subtree(doc.getElementsByTagNameNS(W, 'p')[1]!);
      nativeProject(doc, { filter: e => e.getAttributeNS(W, 'author') === 'AI' });
      expect(subtree(doc.getElementsByTagNameNS(W, 'p')[1]!)).toBe(foreignBefore);
      expect(doc.getElementsByTagNameNS(W, 'p')[0]!.getElementsByTagNameNS(W, 'rPr').length).toBe(0);
      expect(doc.getElementsByTagNameNS(W, 'p').length).toBe(2);
    });
  }
});
