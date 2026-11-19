import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { parseXml, serializeXml } from '../primitives/xml.js';
import { acceptChanges } from '../primitives/accept_changes.js';
import { rejectChanges } from '../primitives/reject_changes.js';
import { acceptAllChanges, rejectAllChanges } from '@usejunior/docx-compare';
import { childElements } from '../primitives/dom-helpers.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Table revision resolution' }).conformance(
 ...['17.13.5.1', '17.13.5.2', '17.13.5.33', '17.13.5.35'].map(section => ({ spec: 'ECMA-376', edition: 5, part: 1, section })),
);
const source = new URL('../../../../tests/test_documents/open-agreements/mutual-nda.docx', import.meta.url);
const nodes = (d: Document | Element, name: string) => Array.from(d.getElementsByTagNameNS(W, name));
for (const kind of ['cellDel', 'cellIns', 'tblGridChange', 'tblPrExChange']) {
 test(`resolves ${kind} in the public Mutual NDA`, async () => {
  const zip = await JSZip.loadAsync(await readFile(source));
  const original = await zip.file('word/document.xml')!.async('string');
  const d = parseXml(original);
  const table = nodes(d, 'tbl')[1]!;
  const row = childElements(table).find(n => n.localName === 'tr')!;
  const cell = childElements(row).find(n => n.localName === 'tc')!;
  const create = (name: string) => d.createElementNS(W, `w:${name}`);
  const mark = create(kind); mark.setAttributeNS(W, 'w:id', '900001'); if (kind !== 'tblGridChange') mark.setAttributeNS(W, 'w:author', 'John Smith');
  if (kind.startsWith('cell')) {
    const props = childElements(cell).find(n => n.localName === 'tcPr')!; props.appendChild(mark);
  } else if (kind === 'tblGridChange') {
    const grid = childElements(table).find(n => n.localName === 'tblGrid')!;
    const snapshot = grid.cloneNode(true); mark.appendChild(snapshot); grid.appendChild(mark);
    const col = childElements(grid)[0]!; col.setAttributeNS(W, 'w:w', String(Number(col.getAttributeNS(W, 'w')) + 240));
  } else {
    const props = create('tblPrEx'); const width = create('tblW'); width.setAttributeNS(W, 'w:w', '4000'); width.setAttributeNS(W, 'w:type', 'dxa'); props.appendChild(width);
    mark.appendChild(create('tblPrEx')); props.appendChild(mark); row.insertBefore(props, row.firstChild);
  }
  const input = serializeXml(d);
  for (const mode of ['accept', 'reject'] as const) {
    const resolved = parseXml(input); (mode === 'accept' ? acceptChanges : rejectChanges)(resolved);
    const output = serializeXml(resolved);
    expect(nodes(resolved, kind)).toHaveLength(0);
    const projected = (mode === 'accept' ? acceptAllChanges : rejectAllChanges)(input);
    const projection = (xml: string) => {
      const doc = parseXml(xml); return { text: nodes(doc, 't').map(n => n.textContent), cells: nodes(doc, 'tc').length, grid: nodes(doc, 'gridCol').map(n => n.getAttributeNS(W, 'w')) };
    };
    expect(projection(output)).toEqual(projection(projected));
    const removed = kind === (mode === 'accept' ? 'cellDel' : 'cellIns');
    expect(nodes(resolved, 'tc')).toHaveLength(nodes(d, 'tc').length - Number(removed));
    if (kind === 'tblGridChange' && mode === 'reject') expect(nodes(resolved, 'gridCol').map(n => n.getAttributeNS(W, 'w'))).toEqual(nodes(parseXml(original), 'gridCol').map(n => n.getAttributeNS(W, 'w')));
    if (process.env.SAFE_DOCX_TABLE_REVISION_ARTIFACTS) {
      const dir = process.env.SAFE_DOCX_TABLE_REVISION_ARTIFACTS; await mkdir(dir, { recursive: true });
      zip.file('word/document.xml', output); await writeFile(path.join(dir, `${kind}-${mode}.docx`), await zip.generateAsync({ type: 'nodebuffer' }));
      zip.file('word/document.xml', input); await writeFile(path.join(dir, `${kind}-input.docx`), await zip.generateAsync({ type: 'nodebuffer' }));
    }
  }
 });
}
