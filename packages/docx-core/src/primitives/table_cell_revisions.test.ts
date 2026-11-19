import { XMLSerializer } from '@xmldom/xmldom';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { parseXml, serializeXml } from './xml.js';
import { acceptChanges } from './accept_changes.js';
import { rejectChanges } from './reject_changes.js';
import { acceptAllChanges, rejectAllChanges } from '@usejunior/docx-compare';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Table revision resolution' }).conformance(
  ...['17.13.5.1', '17.13.5.2', '17.13.5.3', '17.13.5.33', '17.13.5.35'].map(section => ({ spec: 'ECMA-376', edition: 5, part: 1, section })),
);
const doc = (body: string) => parseXml(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);
const nodes = (d: Document, name: string) => Array.from(d.getElementsByTagNameNS(W, name));
const cell = (i: number, revision = '') => `<w:tc><w:tcPr><w:tcW w:w="${[1500, 2000, 2500][i]}" w:type="dxa"/>${revision}</w:tcPr><w:p><w:r><w:t>Cell ${i}</w:t></w:r></w:p></w:tc>`;
const table = (cells: string, secondRow = '') => '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="2000"/><w:gridCol w:w="2500"/></w:tblGrid><w:tr>' + cells + '</w:tr>' + secondRow + '</w:tbl>';
for (const mode of ['accept', 'reject'] as const) {
 const resolve = mode === 'accept' ? acceptChanges : rejectChanges;
 const project = mode === 'accept' ? acceptAllChanges : rejectAllChanges;
 describe(mode, () => {
  for (const kind of ['cellDel', 'cellIns']) for (const index of [0, 1, 2]) {
   test(`resolves ${kind} at cell ${index} like Word`, () => {
    const d = doc(table([0, 1, 2].map(i => cell(i, i === index ? `<w:${kind} w:id="1" w:author="John Smith"/>` : '')).join('')));
    const projected = parseXml(project(serializeXml(d)));
    resolve(d);
    expect(serializeXml(d)).toBe(serializeXml(projected));
    const removed = (mode === 'accept') === (kind === 'cellDel');
    expect(nodes(d, kind)).toHaveLength(0);
    expect(nodes(d, 'tc')).toHaveLength(removed ? 2 : 3);
    expect(nodes(d, 'gridCol').map(n => n.getAttributeNS(W, 'w'))).toEqual(removed ? index === 2 ? ['1500', '4500'] : ['3500', '2500'] : ['1500', '2000', '2500']);
    expect(nodes(d, 'tcW').map(n => n.getAttributeNS(W, 'w'))).toEqual(nodes(d, 'gridCol').map(n => n.getAttributeNS(W, 'w')));
   });
  }
  test('retains a grid boundary used by another row', () => {
    const kind = mode === 'accept' ? 'cellDel' : 'cellIns';
    const d = doc(table(cell(0) + cell(1, `<w:${kind} w:id="1" w:author="John Smith"/>`) + cell(2), `<w:tr>${cell(0) + cell(1) + cell(2)}</w:tr>`));
    resolve(d);
    expect(nodes(d, 'gridCol')).toHaveLength(3);
    expect(nodes(d, 'gridSpan')[0]!.getAttributeNS(W, 'val')).toBe('2');
  });
  test('keeps a wrapped surviving cell when its adjacent direct cell disappears', () => {
    const kind = mode === 'accept' ? 'cellDel' : 'cellIns';
    const d = doc(table(cell(0, `<w:${kind} w:id="1" w:author="John Smith"/>`) + `<w:sdt><w:sdtPr/><w:sdtContent>${cell(1)}</w:sdtContent></w:sdt>` + cell(2)));
    resolve(d);
    expect(nodes(d, 'tc')).toHaveLength(2);
    expect(nodes(d, 't').map(n => n.textContent)).toEqual(['Cell 1', 'Cell 2']);
    expect(nodes(d, 'sdt')).toHaveLength(1);
  });
  test('resolves a marker inside a wrapped cell and prunes its empty wrapper', () => {
    const kind = mode === 'accept' ? 'cellDel' : 'cellIns';
    const d = doc(table(`<w:customXml>${cell(0, `<w:${kind} w:id="1" w:author="John Smith"/>`)}</w:customXml>` + cell(1) + cell(2)));
    resolve(d); expect(nodes(d, kind)).toHaveLength(0); expect(nodes(d, 'customXml')).toHaveLength(0);
    expect(nodes(d, 't').map(n => n.textContent)).toEqual(['Cell 1', 'Cell 2']);
  });
  for (const offset of ['gridBefore', 'gridAfter']) {
    test(`updates ${offset} when grid boundaries collapse`, () => {
      const kind = mode === 'accept' ? 'cellDel' : 'cellIns';
      const grid = '<w:gridCol w:w="1000"/>'.repeat(5);
      const d = doc(`<w:tbl><w:tblPr/><w:tblGrid>${grid}</w:tblGrid><w:tr><w:trPr><w:${offset} w:val="2"/></w:trPr>` + cell(0) + cell(1, `<w:${kind} w:id="1" w:author="John Smith"/>`) + cell(2) + '</w:tr></w:tbl>');
      resolve(d);
      expect(nodes(d, 'gridCol')).toHaveLength(3);
      expect(nodes(d, offset)[0]!.getAttributeNS(W, 'val')).toBe('1');
      expect(nodes(d, 'tc')).toHaveLength(2);
    });
  }
  test('preserves an unselected cell revision byte for byte', () => {
    const d = doc(table(cell(0, '<w:cellDel w:id="1" w:author="Human"/>') + cell(1) + cell(2)));
    const before = serializeXml(d); resolve(d, { filter: el => el.getAttributeNS(W, 'author') === 'AI' }); expect(serializeXml(d)).toBe(before);
  });
  test('resolves cellMerge current/original states', () => {
    const d = doc(table(cell(0, '<w:vMerge w:val="restart"/><w:cellMerge w:id="1" w:author="John Smith" w:vMerge="rest" w:vMergeOrig="cont"/>') + cell(1) + cell(2)));
    resolve(d); expect(nodes(d, 'cellMerge')).toHaveLength(0);
    expect(nodes(d, 'vMerge')[0]!.getAttributeNS(W, 'val')).toBe(mode === 'accept' ? 'restart' : 'continue');
  });
  test('resolves grid and row exception snapshots and removes empty exceptions', () => {
    const d = doc('<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/><w:tblGridChange w:id="1" w:author="John Smith"><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid></w:tblGridChange></w:tblGrid><w:tr><w:tblPrEx><w:tblPrExChange w:id="2" w:author="John Smith"><w:tblPrEx/></w:tblPrExChange></w:tblPrEx>' + cell(0) + '</w:tr></w:tbl>');
    resolve(d); expect(nodes(d, 'tblGridChange')).toHaveLength(0); expect(nodes(d, 'tblPrEx')).toHaveLength(0);
    expect(nodes(d, 'gridCol')[0]!.getAttributeNS(W, 'w')).toBe(mode === 'accept' ? '4000' : '3000');
  });
 });
}

test('selective property rejection keeps only the live foreign cell-mark alternative', () => {
  const d = doc('<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/><w:vMerge w:val="restart"/><w:cellMerge w:id="2" w:author="Human" w:vMerge="rest"/><w:tcPrChange w:id="3" w:author="AI"><w:tcPr><w:tcW w:w="1000" w:type="dxa"/><w:cellIns w:id="1" w:author="Human"/></w:tcPr></w:tcPrChange></w:tcPr><w:p/></w:tc></w:tr></w:tbl><w:p/>');
  const validate = (xml: string) => {
    const schema = fileURLToPath(new URL('../../../../spec-compliance/ecma-376/validation/wml-document-transitional.xsd', import.meta.url));
    const result = spawnSync('xmllint', ['--noout', '--nonet', '--schema', schema, '-'], { input: xml, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  };
  validate(serializeXml(d));
  const marker = new XMLSerializer().serializeToString(nodes(d, 'cellMerge')[0]!);
  rejectChanges(d, { filter: el => el.getAttributeNS(W, 'author') === 'AI' });
  expect(nodes(d, 'cellIns')).toHaveLength(0);
  expect(new XMLSerializer().serializeToString(nodes(d, 'cellMerge')[0]!)).toBe(marker);
  validate(serializeXml(d));
});
