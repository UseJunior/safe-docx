import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { parseXml, serializeXml, acceptChanges, rejectChanges, DocxArchive, buildSyntheticDocx } from '@usejunior/docx-core';
import { compareDocuments } from '../index.js';
import { acceptAllChanges, rejectAllChanges, extractTextWithParagraphs } from './trackChangesAcceptorAst.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Native move paragraph parity' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.22' });
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const attrs = 'w:author="Comparator" w:date="2026-09-17T00:00:00Z"';
const source = `<w:moveFromRangeStart w:id="1" w:name="move1" ${attrs}/>` +
  `<w:p><w:pPr><w:rPr><w:moveFrom w:id="2" ${attrs}/></w:rPr></w:pPr>` +
  `<w:moveFrom w:id="3" ${attrs}><w:r><w:t>Moved paragraph</w:t></w:r></w:moveFrom></w:p><w:moveFromRangeEnd w:id="1"/>`;
const destination = `<w:moveToRangeStart w:id="4" w:name="move1" ${attrs}/>` +
  `<w:p><w:pPr><w:rPr><w:moveTo w:id="5" ${attrs}/></w:rPr></w:pPr>` +
  `<w:moveTo w:id="6" ${attrs}><w:r><w:t>Moved paragraph</w:t></w:r></w:moveTo></w:p><w:moveToRangeEnd w:id="4"/>`;
const stable = '<w:p><w:r><w:t>Stable paragraph</w:t></w:r></w:p>';
const wrap = (body: string) => `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
const texts = (xml: string) => Array.from(parseXml(xml).getElementsByTagNameNS(W, 'p')).map(p =>
  Array.from(p.getElementsByTagNameNS(W, 't')).map(t => t.textContent).join(''));

describe('complete move ranges through native paragraph-mark resolution', () => {
  for (const [name, body] of [
    ['middle', source + destination + stable],
    ['terminal destination', source + stable + destination],
    ['terminal source', destination + stable + source],
    ['table cell', '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>' + source + destination + stable + '</w:tc></w:tr></w:tbl>'],
    ['terminal table cell', '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>' + source + stable + destination + '</w:tc></w:tr></w:tbl>'],
  ]) {
    for (const [operation, nativeProject, astProject] of [
      ['Accept', acceptChanges, acceptAllChanges], ['Reject', rejectChanges, rejectAllChanges],
    ] as const) {
      test(`${operation}: ${name} agrees with AST without empty moved containers`, () => {
        const input = wrap(body!);
        const doc = parseXml(input);
        nativeProject(doc);
        const output = serializeXml(doc);
        expect(texts(output)).toEqual(texts(astProject(input)));
        expect(texts(output).filter(t => t === 'Moved paragraph')).toHaveLength(1);
        expect(texts(output).filter(t => t === '')).toHaveLength(0);
        expect(output).not.toContain('moveFrom');
        expect(output).not.toContain('moveTo');
      });
    }
  }

  test('selective native resolution leaves foreign complete move endpoints and boundaries untouched', () => {
    const input = wrap(source + stable + destination);
    for (const project of [acceptChanges, rejectChanges]) {
      const doc = parseXml(input);
      const before = serializeXml(doc);
      project(doc, { filter: e => e.getAttributeNS(W, 'author') === 'AI' });
      expect(serializeXml(doc)).toBe(before);
    }
  });

  test('content-only move wrappers retain untracked paragraph containers', () => {
    const input = wrap((source + stable + destination).replace(/<w:pPr>.*?<\/w:pPr>/g, ''));
    for (const [nativeProject, astProject] of [[acceptChanges, acceptAllChanges], [rejectChanges, rejectAllChanges]] as const) {
      const doc = parseXml(input);
      nativeProject(doc);
      expect(texts(serializeXml(doc))).toEqual(texts(astProject(input)));
      expect(doc.getElementsByTagNameNS(W, 'p').length).toBe(3);
    }
  });

  for (const movedContent of [false, true]) {
    test(`Reject preserves local bookmarks around ${movedContent ? 'mixed moved and' : 'only'} untracked surviving content`, () => {
      const surviving = '<w:bookmarkStart w:id="90" w:name="keepme"/><w:r><w:t>Untracked survivor</w:t></w:r><w:bookmarkEnd w:id="90"/>';
      const to = (movedContent ? destination : destination.replace(/<w:moveTo w:id="6"[\s\S]*?<\/w:moveTo>/, ''))
        .replace('</w:p>', `${surviving}</w:p>`);
      const input = wrap(source + to + stable);
      for (const project of [(xml: string) => { const doc = parseXml(xml); rejectChanges(doc); return serializeXml(doc); }, rejectAllChanges]) {
        const output = parseXml(project(input));
        expect(Array.from(output.getElementsByTagNameNS(W, 'bookmarkStart')).map(b => b.getAttributeNS(W, 'name'))).toEqual(['keepme']);
        expect(Array.from(output.getElementsByTagNameNS(W, 'bookmarkEnd')).map(b => b.getAttributeNS(W, 'id'))).toEqual(['90']);
        expect(texts(serializeXml(output))).toEqual(['Moved paragraph', 'Untracked survivorStable paragraph']);
      }
    });
  }

  test('selective resolution resolves one author while preserving another complete move', () => {
    const foreign = (source + stable + destination).replaceAll('Comparator', 'Human')
      .replaceAll('move1', 'move2').replace(/w:id="(\d+)"/g, (_, id: string) => `w:id="${Number(id) + 10}"`);
    for (const project of [acceptChanges, rejectChanges]) {
      const doc = parseXml(wrap(source + stable + destination + foreign));
      const before = Array.from(doc.getElementsByTagNameNS(W, 'p')).slice(3).map(p => p.toString());
      project(doc, { filter: e => e.getAttributeNS(W, 'author') === 'Comparator' });
      const remaining = Array.from(doc.getElementsByTagNameNS(W, 'p'));
      expect(remaining.slice(-3).map(p => p.toString())).toEqual(before);
      expect(remaining.length).toBe(5);
      expect(Array.from(doc.getElementsByTagNameNS(W, 'moveTo')).map(e => e.getAttributeNS(W, 'author'))).toEqual(['Human', 'Human']);
      expect(Array.from(doc.getElementsByTagNameNS(W, 'moveFrom')).map(e => e.getAttributeNS(W, 'author'))).toEqual(['Human', 'Human']);
    }
  });

  for (const terminal of [false, true]) {
    test(`resolves local endpoint bookmarks without relocating removed ${terminal ? 'terminal' : 'middle'} pairs`, () => {
      const bookmarked = (xml: string, id: number) => xml.replace('</w:pPr>', `</w:pPr><w:bookmarkStart w:id="${id}" w:name="anchor${id}"/>`)
        .replace('</w:p>', `<w:bookmarkEnd w:id="${id}"/></w:p>`);
      const from = bookmarked(source, 21);
      const to = bookmarked(destination, 22);
      const input = wrap(terminal ? from + stable + to : from + to + stable);
      for (const [project, astProject, expectedId] of [[acceptChanges, acceptAllChanges, '22'], [rejectChanges, rejectAllChanges, '21']] as const) {
        const doc = parseXml(input);
        project(doc);
        const ast = parseXml(astProject(input));
        for (const kind of ['bookmarkStart', 'bookmarkEnd']) {
          const ids = (d: Document) => Array.from(d.getElementsByTagNameNS(W, kind)).map(e => e.getAttributeNS(W, 'id'));
          expect(ids(doc)).toEqual([expectedId]);
          expect(ids(doc)).toEqual(ids(ast));
        }
        expect(texts(serializeXml(doc))).toEqual(texts(serializeXml(ast)));
      }
    });
  }

  test('native Accept/Reject resolve actual comparison-authored terminal moves to source paragraphs', async () => {
    const moving = 'the complete movable paragraph changes its position in the document';
    const anchored = 'the long stable anchor paragraph remains unchanged in its position';
    const finish = 'the second stable anchor paragraph remains unchanged throughout';
    const build = (values: string[]) => buildSyntheticDocx({ paragraphs: values });
    const original = await build([moving, anchored, finish]);
    const revised = await build([anchored, finish, moving]);
    const result = await compareDocuments(original, revised, { detectMoves: true });
    const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
    expect(xml).toContain('moveToRangeStart');
    for (const [project, control] of [[acceptChanges, revised], [rejectChanges, original]] as const) {
      const doc = parseXml(xml);
      project(doc);
      expect(extractTextWithParagraphs(serializeXml(doc)))
        .toBe(extractTextWithParagraphs(await (await DocxArchive.load(control)).getDocumentXml()));
    }
  });
});
