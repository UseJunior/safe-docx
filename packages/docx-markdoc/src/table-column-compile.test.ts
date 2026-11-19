import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { expect } from 'vitest';
import { DocxDocument, childElements, parseXml, serializeXml } from '@usejunior/docx-core';
import { testAllure } from '../../docx-core/src/testing/allure-test.js';
import { buildDocxWithAncillaryParts } from '../../docx-core/src/testing/ooxml-fixtures.js';
import { importDocxToMarkdoc } from './import.js';
import { compileMarkdoc } from './compile.js';
import { requireMarkdoc } from './markdoc.js';
import { exportAdjacentRevisionPairs, exportEditPairs } from './export.js';
import type { ImportResult } from './types.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('DOCX Markdoc').withLabels({ feature: 'add-markdoc-table-columns' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.16' }, { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.33' });
const schema = fileURLToPath(new URL('../../../scripts/check_emitted_document_schema.mjs', import.meta.url));
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string, fill: string) => '<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>'
  + `<w:tcBorders><w:bottom w:val="single" w:sz="4" w:color="112233"/></w:tcBorders><w:shd w:val="clear" w:fill="${fill}"/></w:tcPr>${p(text)}</w:tc>`;
const table = '<w:tbl><w:tblPr><w:tblW w:w="4800" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>'
  + '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + cell('A1', 'AABBCC') + cell('B1', 'DDEEFF') + '</w:tr>'
  + '<w:tr>' + cell('A2', 'AABBCC') + cell('B2', 'DDEEFF') + '</w:tr></w:tbl>';
const page = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
const fixture = (body = table + p('Outside.')) => buildDocxWithAncillaryParts({ bodyXml: body, sectPrXml: page });

function authored(imported: ImportResult, cells: string[][], attributes = '', anchorText = 'A1'): string {
  const anchor = requireMarkdoc(imported.markdoc).scaffold.find(paragraph => paragraph.originalText === anchorText)!;
  expect(anchor).toBeDefined();
  return imported.markdoc + `\n{% insert-table-column anchor="${anchor.id}" width-twips=1200 edit="responses" ${attributes} %}\n`
    + cells.map(paragraphs => paragraphs.length === 1 ? `{% column-cell text=${JSON.stringify(paragraphs[0])} /%}`
      : '{% column-cell %}\n' + paragraphs.join('\n\n') + '\n{% /column-cell %}').join('\n')
    + '\n{% /insert-table-column %}\n';
}

async function document(buffer: Buffer) {
  return parseXml(await (await JSZip.loadAsync(buffer)).file('word/document.xml')!.async('string'));
}
async function shape(buffer: Buffer, tableIndex = 0) {
  const xml = await document(buffer);
  const body = xml.getElementsByTagNameNS(W, 'body')[0]!;
  const table = childElements(body).filter(node => node.localName === 'tbl')[tableIndex]!;
  const grid = childElements(table).find(node => node.localName === 'tblGrid')!;
  const tableProps = childElements(table).find(node => node.localName === 'tblPr');
  return {
    grid: childElements(grid).filter(node => node.localName === 'gridCol').map(node => node.getAttributeNS(W, 'w')),
    width: tableProps?.getElementsByTagNameNS(W, 'tblW')[0]?.getAttributeNS(W, 'w'),
    rows: childElements(table).filter(node => node.localName === 'tr').map(row => childElements(row).filter(node => node.localName === 'tc').map(cell => ({
      xml: serializeXml(cell),
      width: cell.getElementsByTagNameNS(W, 'tcW')[0]?.getAttributeNS(W, 'w'),
      fill: cell.getElementsByTagNameNS(W, 'shd')[0]?.getAttributeNS(W, 'fill'),
      paragraphs: childElements(cell).filter(node => node.localName === 'p').map(paragraph => Array.from(paragraph.getElementsByTagNameNS(W, 't')).map(node => node.textContent).join('')),
    }))),
    pages: (await DocxDocument.load(buffer)).getSections().map(section => section.pageSize),
  };
}
async function schemaValid(buffer: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'sdx-column-'));
  try {
    const file = join(dir, 'tracked.docx'); await writeFile(file, buffer);
    const checked = spawnSync(process.execPath, [schema, file], { encoding: 'utf8' });
    expect(checked.status, checked.stdout + checked.stderr).toBe(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
async function verifyProjection(tracked: Buffer, expected: Buffer, mode: 'accept' | 'reject', tableIndex = 0) {
  const resolved = await DocxDocument.load(tracked); await resolved[mode === 'accept' ? 'acceptChanges' : 'rejectChanges']();
  const output = (await resolved.toBuffer({ cleanBookmarks: false })).buffer;
  const semantic = (state: Awaited<ReturnType<typeof shape>>) => ({ ...state, pages: state.pages.map(page => ({ ...page, orientation: page.orientation ?? 'portrait' })), rows: state.rows.map(row => row.map(({ xml: _xml, ...cell }) => cell)) });
  expect(semantic(await shape(output, tableIndex)), mode).toEqual(semantic(await shape(expected, tableIndex)));
  expect((await document(output)).getElementsByTagNameNS(W, 'tblGridChange')).toHaveLength(0);
}

test.openspec('[SDX-MDOC-COLUMN-01] a response column compiles with inverse tracked projections')(
  'appends or inserts cells with multiple paragraphs, inherited properties and unchanged source cells', async () => {
    const imported = await importDocxToMarkdoc(await fixture());
    const before = await shape(imported.anchoredSource);
    for (const index of [undefined, 0, 1]) {
      const at = index ?? 2;
      const result = await compileMarkdoc(imported.anchoredSource, authored(imported, [['Response'], ['First answer.', 'Second answer.']], index === undefined ? '' : `column-index=${index}`));
      expect(result.certificate.passed).toBe(true);
      expect(result.certificate.tableTopology?.passed).toBe(true);
      const clean = await shape(result.clean);
      const widths = ['2400', '2400']; widths.splice(at, 0, '1200');
      expect(clean.grid).toEqual(widths); expect(clean.width).toBe('6000');
      clean.rows.forEach((row, rowIndex) => {
        expect(row[at]!.paragraphs).toEqual(rowIndex === 0 ? ['Response'] : ['First answer.', 'Second answer.']);
        expect(row[at]!.width).toBe('1200');
        expect(row[at]!.fill).toBe(before.rows[rowIndex]![Math.min(at, 1)]!.fill);
        expect(row.filter((_, index) => index !== at).map(cell => cell.xml)).toEqual(before.rows[rowIndex]!.map(cell => cell.xml));
      });
      await verifyProjection(result.tracked, result.clean, 'accept');
      await verifyProjection(result.tracked, imported.anchoredSource, 'reject');
      await schemaValid(result.tracked);
    }
  }, 30000,
);

test.openspec('[SDX-MDOC-COLUMN-02] landscape applies to the containing section')(
  'rotates only the containing section and restores its source page setup on Reject All', async () => {
    const firstBoundary = '<w:p><w:pPr>' + page + '</w:pPr><w:r><w:t>First section.</w:t></w:r></w:p>';
    for (const boundary of [firstBoundary, '<w:sdt><w:sdtPr/><w:sdtContent>' + firstBoundary + '</w:sdtContent></w:sdt>']) {
      const imported = await importDocxToMarkdoc(await fixture(boundary + table + p('Outside.')));
      const result = await compileMarkdoc(imported.anchoredSource, authored(imported, [['Response'], ['Reviewed.']], 'landscape=true'));
      const before = await shape(imported.anchoredSource); const clean = await shape(result.clean);
      expect(clean.pages[0]).toEqual(before.pages[0]);
      expect(clean.pages[1]).toMatchObject({ widthTwips: 15840, heightTwips: 12240, orientation: 'landscape' });
      await verifyProjection(result.tracked, result.clean, 'accept');
      await verifyProjection(result.tracked, imported.anchoredSource, 'reject');
      await schemaValid(result.tracked);
    }
  }, 30000,
);

test('retains a required paragraph in empty response cells and refuses ambiguous column rationales', async () => {
  const imported = await importDocxToMarkdoc(await fixture());
  for (const cells of [[['Response'], ['']], [[''], ['']]]) {
    const result = await compileMarkdoc(imported.anchoredSource, authored(imported, cells));
    expect(result.certificate.passed).toBe(true);
    expect((await shape(result.clean)).rows.map(row => row.at(-1)!.paragraphs)).toEqual(cells);
    await verifyProjection(result.tracked, result.clean, 'accept');
    await verifyProjection(result.tracked, imported.anchoredSource, 'reject');
    await schemaValid(result.tracked);
  }
  const rationale = authored(imported, [['Response'], ['Reviewed.']])
    + '\n{% rationale for="responses" visibility="external-facing" %}\nRecord the reviewer response.\n{% /rationale %}';
  await expect(compileMarkdoc(imported.anchoredSource, rationale, {
    author: 'John Smith', date: new Date('2026-11-19T00:00:00Z'), externalComments: true,
    rationaleComments: { author: 'John Smith', initials: 'JS' },
  })).rejects.toMatchObject({
    code: 'RATIONALE_ANCHOR_AMBIGUOUS',
    details: { cause: 'operation responses has no emitted attributed revision' },
  });
}, 30000);

test('compiles a real public NDA response column and exposes verified clean landscape output', async () => {
  const imported = await importDocxToMarkdoc(await readFile(new URL('../../../tests/test_documents/open-agreements/mutual-nda.docx', import.meta.url)));
  const markdoc = authored(imported, Array.from({ length: 7 }, (_, row) => row === 0 ? ['Response'] : ['Reviewed.', 'No further comments.']), 'landscape=true', 'Purpose')
    .replace('width-twips=1200', 'width-twips=1800');
  const result = await compileMarkdoc(imported.anchoredSource, markdoc, { author: 'John Smith', date: new Date('2026-11-19T00:00:00Z') });
  expect(result.certificate.passed).toBe(true);
  expect(result.certificate.tableTopology?.passed).toBe(true);
  const before = await shape(imported.anchoredSource, 1); const clean = await shape(result.clean, 1);
  expect(clean.grid).toEqual([...before.grid, '1800']);
  expect(clean.pages[0]).toMatchObject({ widthTwips: before.pages[0]!.heightTwips, heightTwips: before.pages[0]!.widthTwips, orientation: 'landscape' });
  clean.rows.forEach((row, index) => expect(row.at(-1)!.paragraphs).toEqual(index === 0 ? ['Response'] : ['Reviewed.', 'No further comments.']));
  await verifyProjection(result.tracked, result.clean, 'accept', 1);
  await verifyProjection(result.tracked, imported.anchoredSource, 'reject', 1);
  await schemaValid(result.tracked);
  if (process.env.SAFE_DOCX_COLUMN_ARTIFACTS) {
    const dir = process.env.SAFE_DOCX_COLUMN_ARTIFACTS; await mkdir(dir, { recursive: true });
    for (const [suffix, bytes] of [['original', imported.anchoredSource], ['revised', result.clean], ['redline', result.tracked]] as const) await writeFile(join(dir, `real-column-${suffix}.docx`), bytes);
    await writeFile(join(dir, 'real-column.mdoc'), markdoc);
  }
}, 120000);

test.openspec('[SDX-MDOC-COLUMN-03] ambiguous or unsupported column requests fail before output')(
  'rejects wrong counts, bounds and structural conflicts, and refuses lossy paragraph exports', async () => {
    const imported = await importDocxToMarkdoc(await fixture()); const original = Buffer.from(imported.anchoredSource);
    const ir = requireMarkdoc(imported.markdoc); const anchor = ir.scaffold.find(p => p.originalText === 'A1')!;
    const valid = authored(imported, [['Response'], ['Reviewed.']]);
    for (const [request, code] of [
      [authored(imported, [['Only one.']]), 'COLUMN_CELL_COUNT_MISMATCH'],
      [authored(imported, [['Response'], ['Reviewed.']], 'column-index=3'), 'INVALID_COLUMN_INDEX'],
      [valid + valid.slice(imported.markdoc.length).replace('edit="responses"', 'edit="second"'), 'CONFLICTING_TABLE_OPERATIONS'],
      [valid + `\n{% delete-table-row anchor="${anchor.id}" edit="delete-row" /%}`, 'CONFLICTING_TABLE_OPERATIONS'],
      [authored(imported, [['Response'], ['Reviewed.']], '', 'Outside.'), 'UNSUPPORTED_TABLE_COLUMN'],
    ]) await expect(compileMarkdoc(imported.anchoredSource, request!)).rejects.toMatchObject({ code });
    for (const block of ['![Lost](https://example.com/a.png)', '---', '```\n\n```']) {
      const request = valid.replace('{% column-cell', block + '\n{% column-cell');
      await expect(compileMarkdoc(imported.anchoredSource, request)).rejects.toMatchObject({ code: 'INVALID_MARKDOC' });
    }
    expect(imported.anchoredSource).toEqual(original);
    const columnIR = requireMarkdoc(valid);
    expect(() => exportEditPairs(columnIR)).toThrowError(expect.objectContaining({ code: 'STRUCTURAL_EDIT_PAIR_EXPORT_UNSUPPORTED' }));
    expect(() => exportAdjacentRevisionPairs(columnIR, columnIR)).toThrowError(expect.objectContaining({ code: 'STRUCTURAL_EDIT_PAIR_EXPORT_UNSUPPORTED' }));
  }, 30000,
);

test.openspec('[SDX-MDOC-COLUMN-03] ambiguous or unsupported column requests fail before output')(
  'refuses merged, offset, nested, wrapped and previously revised tables without changing the source', async () => {
    const replaceFirstRow = (row: string) => table.replace(/<w:tr>.*?<\/w:tr>/u, row);
    const span = cell('A1', 'AABBCC').replace('<w:tcW w:w="2400" w:type="dxa"/>', '<w:tcW w:w="4800" w:type="dxa"/><w:gridSpan w:val="2"/>');
    const firstCell = cell('A1', 'AABBCC');
    const withVertical = table.replace(firstCell, firstCell.replace('<w:tcW w:w="2400" w:type="dxa"/>', '<w:tcW w:w="2400" w:type="dxa"/><w:vMerge w:val="restart"/>'))
      .replace(cell('A2', 'AABBCC'), cell('', 'AABBCC').replace('<w:tcW w:w="2400" w:type="dxa"/>', '<w:tcW w:w="2400" w:type="dxa"/><w:vMerge/>'));
    const firstRow = table.match(/<w:tr>.*?<\/w:tr>/u)![0];
    const shapes: Array<[string, string, string]> = [
      [replaceFirstRow('<w:tr>' + span + '</w:tr>'), 'A1', 'UNSUPPORTED_TABLE_COLUMN'],
      [withVertical, 'A1', 'UNSUPPORTED_TABLE_COLUMN'],
      [replaceFirstRow('<w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>' + cell('A1', 'AABBCC') + '</w:tr>'), 'A1', 'UNSUPPORTED_TABLE_COLUMN'],
      [table.replace(p('A1'), table + p('Outer anchor.')), 'Outer anchor.', 'UNSUPPORTED_TABLE_COLUMN'],
      [table.replace(firstCell, '<w:sdt><w:sdtPr/><w:sdtContent>' + firstCell + '</w:sdtContent></w:sdt>'), 'A1', 'UNSUPPORTED_TABLE_COLUMN'],
      [table.replace(firstRow, '<w:sdt><w:sdtPr/><w:sdtContent>' + firstRow + '</w:sdtContent></w:sdt>'), 'A1', 'UNSUPPORTED_TABLE_COLUMN'],
      [replaceFirstRow('<w:tr>' + firstCell.replace('<w:tcW w:w="2400" w:type="dxa"/>', '<w:tcW w:w="2400" w:type="dxa"/><w:hMerge w:val="restart"/>')
        + cell('B1', 'DDEEFF').replace('<w:tcW w:w="2400" w:type="dxa"/>', '<w:tcW w:w="2400" w:type="dxa"/><w:hMerge/>') + '</w:tr>'), 'A1', 'UNSUPPORTED_TABLE_COLUMN'],
      [table.replace('<w:trPr><w:tblHeader/></w:trPr>', '<w:trPr><w:tblHeader/><w:ins w:id="900" w:author="John Smith"/></w:trPr>'), 'A1', 'EXISTING_REVISIONS_WITH_OPERATIVE_EDITS_UNSUPPORTED'],
      [table.replace('</w:tblGrid>', '<w:tblGridChange w:id="900"><w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="3600"/></w:tblGrid></w:tblGridChange></w:tblGrid>'), 'A1', 'EXISTING_REVISIONS_WITH_OPERATIVE_EDITS_UNSUPPORTED'],
    ];
    for (const [body, anchor, code] of shapes) {
      const imported = await importDocxToMarkdoc(await fixture(body + p('Outside.')));
      const before = Buffer.from(imported.anchoredSource);
      await schemaValid(imported.anchoredSource);
      await expect(compileMarkdoc(imported.anchoredSource, authored(imported, [['Response'], ['Reviewed.']], '', anchor))).rejects.toMatchObject({ code });
      expect(imported.anchoredSource).toEqual(before);
    }
    const noPage = await importDocxToMarkdoc(await buildDocxWithAncillaryParts({ bodyXml: table, sectPrXml: '<w:sectPr/>' }));
    await expect(compileMarkdoc(noPage.anchoredSource, authored(noPage, [['Response'], ['Reviewed.']], 'landscape=true')))
      .rejects.toMatchObject({ code: 'COLUMN_LANDSCAPE_PAGE_SIZE_REQUIRED' });
  }, 30000,
);
