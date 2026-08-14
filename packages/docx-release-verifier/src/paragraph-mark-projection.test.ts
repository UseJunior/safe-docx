import { describe, expect } from 'vitest';
import { itAllure, testAllure } from '../../docx-core/src/testing/allure-test.js';
import { projectDocumentXml } from './xml.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const documentXml = (body: string) => `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
const paragraph = (body: string) => `<w:p>${body}</w:p>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const deletedRun = (text: string) => `<w:del w:id="11"><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
const insertedRun = (text: string) => `<w:ins w:id="12"><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:ins>`;
const deletedMark = '<w:pPr><w:rPr><w:del w:id="21"/></w:rPr></w:pPr>';
const insertedMark = '<w:pPr><w:rPr><w:ins w:id="22"/></w:rPr></w:pPr>';

function project(body: string) {
  return {
    accept: projectDocumentXml(documentXml(body), 'accept').paragraphs,
    reject: projectDocumentXml(documentXml(body), 'reject').paragraphs,
  };
}

const conformanceTest = testAllure.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' },
);

const moveConformanceTest = testAllure.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.21' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.26' },
);

describe('paragraph-mark revision projection', () => {
  conformanceTest('merges a deleted paragraph mark into the following paragraph on accept only', () => {
    const body = paragraph(`${deletedMark}${run('alpha ')}`) + paragraph(run('beta'));
    expect(project(body)).toEqual({ accept: ['alpha beta'], reject: ['alpha ', 'beta'] });
  });

  conformanceTest('dissolves an inserted paragraph boundary on reject only', () => {
    const body = paragraph(`${insertedMark}${insertedRun('added')}`) + paragraph(run('omega'));
    expect(project(body)).toEqual({ accept: ['added', 'omega'], reject: ['omega'] });
  });

  itAllure('drops a fully deleted paragraph on accept without an empty residue', () => {
    const body = paragraph(run('first')) + paragraph(`${deletedMark}${deletedRun('doomed')}`) + paragraph(run('last'));
    expect(project(body)).toEqual({ accept: ['first', 'last'], reject: ['first', 'doomed', 'last'] });
  });

  itAllure('keeps an inserted empty paragraph only in the accept view', () => {
    const body = paragraph(run('first')) + paragraph(insertedMark) + paragraph(run('last'));
    expect(project(body)).toEqual({ accept: ['first', '', 'last'], reject: ['first', 'last'] });
  });

  itAllure('keeps a mark-deleted empty paragraph only in the reject view', () => {
    const body = paragraph(run('first')) + paragraph(deletedMark) + paragraph(run('last'));
    expect(project(body)).toEqual({ accept: ['first', 'last'], reject: ['first', '', 'last'] });
  });

  itAllure('collapses a chain of deleted paragraph marks into one logical paragraph at the first position', () => {
    const body = paragraph(`${deletedMark}${run('one ')}`) + paragraph(`${deletedMark}${run('two ')}`) + paragraph(run('three'));
    expect(project(body)).toEqual({ accept: ['one two three'], reject: ['one ', 'two ', 'three'] });
  });

  itAllure('keeps the final paragraph of a flow when its mark has no following paragraph', () => {
    const body = paragraph(run('only')) + paragraph(`${deletedMark}${run('tail')}`);
    expect(project(body)).toEqual({ accept: ['only', 'tail'], reject: ['only', 'tail'] });
  });

  itAllure('projects an inserted signature layout with its spacer only in the accept view', () => {
    const body = paragraph(run('Agreed terms.'))
      + paragraph(insertedMark)
      + paragraph(`${insertedMark}${insertedRun('By: ________')}`)
      + paragraph(`${insertedMark}${insertedRun('Name: Placeholder Person')}`)
      + paragraph(run('Remainder text.'));
    expect(project(body)).toEqual({
      accept: ['Agreed terms.', '', 'By: ________', 'Name: Placeholder Person', 'Remainder text.'],
      reject: ['Agreed terms.', 'Remainder text.'],
    });
  });

  itAllure('combines run-level revisions with a deleted paragraph mark in the same paragraph', () => {
    const body = paragraph(`${deletedMark}${run('keep ')}${deletedRun('old ')}${insertedRun('new ')}`) + paragraph(run('tail'));
    expect(project(body)).toEqual({ accept: ['keep new tail'], reject: ['keep old ', 'tail'] });
  });

  itAllure('merges a host paragraph past its nested text box exactly once', () => {
    const drawing = '<w:r><w:drawing xmlns:wp="urn:wp" xmlns:a="urn:a" xmlns:wps="urn:wps"><wp:inline><a:graphic><wps:txbx><w:txbxContent><w:p><w:r><w:t>Box</w:t></w:r></w:p></w:txbxContent></wps:txbx></a:graphic></wp:inline></w:drawing></w:r>';
    const body = paragraph(`${deletedMark}${run('Body')}${drawing}`) + paragraph(run('Tail'));
    expect(project(body)).toEqual({ accept: ['BodyTail', 'Box'], reject: ['Body', 'Box', 'Tail'] });
  });

  itAllure('never merges the last text-box paragraph into the following body paragraph', () => {
    const drawing = `<w:r><w:drawing xmlns:wp="urn:wp" xmlns:a="urn:a" xmlns:wps="urn:wps"><wp:inline><a:graphic><wps:txbx><w:txbxContent><w:p>${deletedMark}<w:r><w:t>Box</w:t></w:r></w:p></w:txbxContent></wps:txbx></a:graphic></wp:inline></w:drawing></w:r>`;
    const body = paragraph(`${run('Host')}${drawing}`) + paragraph(run('Tail'));
    expect(project(body)).toEqual({ accept: ['Host', 'Box', 'Tail'], reject: ['Host', 'Box', 'Tail'] });
  });

  itAllure('does not merge a deleted paragraph mark across a table', () => {
    const table = `<w:tbl><w:tr><w:tc>${paragraph(run('InCell'))}</w:tc></w:tr></w:tbl>`;
    const body = paragraph(`${deletedMark}${run('before')}`) + table + paragraph(run('after'));
    expect(project(body)).toEqual({ accept: ['before', 'InCell', 'after'], reject: ['before', 'InCell', 'after'] });
  });

  itAllure('drops a fully deleted paragraph directly before a table on accept', () => {
    const table = `<w:tbl><w:tr><w:tc>${paragraph(run('Cell'))}</w:tc></w:tr></w:tbl>`;
    const body = paragraph(run('First')) + paragraph(`${deletedMark}${deletedRun('Doomed')}`) + table + paragraph(run('After'));
    expect(project(body)).toEqual({ accept: ['First', 'Cell', 'After'], reject: ['First', 'Doomed', 'Cell', 'After'] });
  });

  itAllure('drops a fully deleted terminal paragraph on accept', () => {
    const body = paragraph(run('First')) + paragraph(`${deletedMark}${deletedRun('Doomed')}`);
    expect(project(body)).toEqual({ accept: ['First'], reject: ['First', 'Doomed'] });
  });

  itAllure('drops an inserted terminal or table-blocked empty paragraph on reject', () => {
    const terminal = paragraph(run('First')) + paragraph(insertedMark);
    expect(project(terminal)).toEqual({ accept: ['First', ''], reject: ['First'] });
    const table = `<w:tbl><w:tr><w:tc>${paragraph(run('Cell'))}</w:tc></w:tr></w:tbl>`;
    const beforeTable = paragraph(run('First')) + paragraph(insertedMark) + table;
    expect(project(beforeTable)).toEqual({ accept: ['First', '', 'Cell'], reject: ['First', 'Cell'] });
  });

  itAllure('drops a chain of fully deleted empty paragraphs before a table on accept', () => {
    const table = `<w:tbl><w:tr><w:tc>${paragraph(run('Cell'))}</w:tc></w:tr></w:tbl>`;
    const body = paragraph(run('First')) + paragraph(deletedMark) + paragraph(deletedMark) + table + paragraph(run('After'));
    expect(project(body)).toEqual({ accept: ['First', 'Cell', 'After'], reject: ['First', '', '', 'Cell', 'After'] });
  });

  itAllure('keeps a structurally required empty paragraph despite its removed mark', () => {
    const soleCellParagraph = `<w:tbl><w:tr><w:tc>${paragraph(`${deletedMark}${deletedRun('Gone')}`)}</w:tc></w:tr></w:tbl>` + paragraph(run('After'));
    expect(project(soleCellParagraph)).toEqual({ accept: ['', 'After'], reject: ['Gone', 'After'] });

    const table = `<w:tbl><w:tr><w:tc>${paragraph(run('Cell'))}</w:tc></w:tr></w:tbl>`;
    const trailingAfterTable = table + paragraph(deletedMark);
    expect(project(trailingAfterTable)).toEqual({ accept: ['Cell', ''], reject: ['Cell', ''] });

    const betweenTables = table + paragraph(deletedMark) + table;
    expect(project(betweenTables)).toEqual({ accept: ['Cell', '', 'Cell'], reject: ['Cell', '', 'Cell'] });

    const emptiedChainAfterTable = table + paragraph(deletedMark) + paragraph(deletedMark);
    expect(project(emptiedChainAfterTable)).toEqual({ accept: ['Cell', ''], reject: ['Cell', '', ''] });
  });

  itAllure('keeps a textless terminal paragraph whose surviving content is a drawing', () => {
    const drawing = '<w:r><w:drawing xmlns:wp="urn:wp" xmlns:a="urn:a" xmlns:wps="urn:wps"><wp:inline><a:graphic><wps:txbx><w:txbxContent><w:p><w:r><w:t>Box</w:t></w:r></w:p></w:txbxContent></wps:txbx></a:graphic></wp:inline></w:drawing></w:r>';
    const body = paragraph(run('First')) + paragraph(`${deletedMark}${drawing}`);
    expect(project(body)).toEqual({ accept: ['First', '', 'Box'], reject: ['First', '', 'Box'] });
  });

  moveConformanceTest('treats moveFrom and moveTo paragraph marks like deletion and insertion marks', () => {
    const movedAway = '<w:pPr><w:rPr><w:moveFrom w:id="31"/></w:rPr></w:pPr>';
    const movedIn = '<w:pPr><w:rPr><w:moveTo w:id="32"/></w:rPr></w:pPr>';
    const body = paragraph(`${movedAway}${run('source ')}`) + paragraph(`${movedIn}${run('landed ')}`) + paragraph(run('end'));
    expect(project(body)).toEqual({ accept: ['source landed ', 'end'], reject: ['source ', 'landed end'] });
  });

  itAllure('ignores foreign-namespace impostors inside the paragraph mark run properties', () => {
    const impostor = '<w:pPr><w:rPr xmlns:x="urn:foreign"><x:del/><x:ins/></w:rPr></w:pPr>';
    const body = paragraph(`${impostor}${run('left')}`) + paragraph(run('right'));
    expect(project(body)).toEqual({ accept: ['left', 'right'], reject: ['left', 'right'] });
  });

  itAllure('does not read a nested text-box paragraph mark as the host paragraph mark', () => {
    const drawing = `<w:r><w:drawing xmlns:wp="urn:wp" xmlns:a="urn:a" xmlns:wps="urn:wps"><wp:inline><a:graphic><wps:txbx><w:txbxContent><w:p>${insertedMark}<w:r><w:t>BoxOne</w:t></w:r></w:p><w:p><w:r><w:t>BoxTwo</w:t></w:r></w:p></w:txbxContent></wps:txbx></a:graphic></wp:inline></w:drawing></w:r>`;
    const body = paragraph(`${run('Host')}${drawing}`) + paragraph(run('Tail'));
    expect(project(body)).toEqual({
      accept: ['Host', 'BoxOne', 'BoxTwo', 'Tail'],
      reject: ['Host', 'BoxOneBoxTwo', 'Tail'],
    });
  });
});
