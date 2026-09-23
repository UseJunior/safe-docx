import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { parseXml, serializeXml, rejectChanges } from '@usejunior/docx-core';
import { rejectAllChanges } from './trackChangesAcceptorAst.js';

/**
 * Reject All parity for a paragraph mark that carries BOTH a break revision
 * marker and a w:rPrChange (#991). The native selective path now transplants
 * surviving markers when it restores the snapshot; with no filter every
 * marker is resolved, so the native and AST projectors must still agree.
 */
const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Paragraph-mark history parity' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.30' });
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DT = 'w:date="2026-09-17T00:00:00Z"';
const wrap = (body: string) => `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
const fixture = (kind: string, markAuthor: string) => wrap(
  `<w:p><w:pPr><w:rPr><w:${kind} w:id="2" w:author="${markAuthor}" ${DT}/><w:b/>` +
  `<w:rPrChange w:id="1" w:author="AI" ${DT}><w:rPr><w:i/></w:rPr></w:rPrChange>` +
  '</w:rPr></w:pPr><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>B</w:t></w:r></w:p>');
const texts = (doc: Document) => Array.from(doc.getElementsByTagNameNS(W, 'p')).map(p =>
  Array.from(p.getElementsByTagNameNS(W, 't')).map(t => t.textContent).join(''));

describe('Reject All over a paragraph mark with a break marker and formatting history', () => {
  for (const kind of ['ins', 'del', 'moveFrom', 'moveTo']) {
    for (const markAuthor of ['AI', 'Human']) {
      test(`${kind} mark by ${markAuthor}: native agrees with AST`, () => {
        const input = fixture(kind, markAuthor);
        const doc = parseXml(input);
        rejectChanges(doc);
        expect(serializeXml(doc)).toBe(serializeXml(parseXml(rejectAllChanges(input))));
        expect(texts(doc)).toEqual(kind === 'ins' || kind === 'moveTo' ? ['AB'] : ['A', 'B']);
        for (const name of [kind, 'rPrChange', 'b']) expect(doc.getElementsByTagNameNS(W, name)).toHaveLength(0);
      });
    }
  }

  test('selective native reject keeps the foreign break marker the AST Reject All would resolve', () => {
    const doc = parseXml(fixture('ins', 'Human'));
    rejectChanges(doc, { filter: e => e.getAttributeNS(W, 'author') === 'AI' });
    expect(doc.getElementsByTagNameNS(W, 'ins')).toHaveLength(1);
    expect(doc.getElementsByTagNameNS(W, 'rPrChange')).toHaveLength(0);
    expect(texts(doc)).toEqual(['A', 'B']);
  });
});
