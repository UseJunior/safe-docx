/**
 * The post-comparison projection check compares each projection of the
 * comparison output with its source through `bodyTableFootprint`. Beyond
 * row counts and nesting, the footprint carries the table grid (column count
 * and widths), each row's `w:gridBefore`/`w:gridAfter` offsets, and each
 * cell's grid interval and merge states, so a projection that lands on a
 * different table topology is caught and located even where the input guard
 * would let it through.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.48
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.84
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.33
 * @see https://github.com/UseJunior/safe-docx/issues/1395
 */

import { describe, expect } from 'vitest';
import { DocxArchive } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { compareDocuments } from '../index.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { bodyTableFootprint, findTableFootprintMismatch } from './tableTopologyGuard.js';

const TEST_FEATURE = 'Table Topology Comparison';
const test = testAllure.epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, story: 'Table Projection Footprint' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.48' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.17' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.84' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.33' },
  );

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const documentXml = (body: string) =>
  `<w:document xmlns:w="${W_NS}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
const grid = (...widths: number[]) =>
  `<w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`;
const cell = (text: string, tcPr = '') => `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ''}${paragraph(text)}</w:tc>`;
const span = (count: number) => `<w:gridSpan w:val="${count}"/>`;
const row = (cells: string[], trPr = '') => `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const table = (tblGrid: string, rows: string[]) => `<w:tbl><w:tblPr/>${tblGrid}${rows.join('')}</w:tbl>`;
const footprint = (body: string) => bodyTableFootprint(documentXml(body));
const mismatch = (expectedBody: string, actualBody: string) =>
  findTableFootprintMismatch(footprint(expectedBody), footprint(actualBody));

const base = table(grid(1000, 1000, 1000), [
  row([cell('A'), cell('B'), cell('C')]),
  row([cell('D', span(2)), cell('E')]),
]);

describe('bodyTableFootprint', () => {
  test('describes the grid, row offsets, cell intervals and merge states', () => {
    const body = table(grid(1000, 2000, 3000), [
      row([cell('A', '<w:vMerge w:val="restart"/>'), cell('B', span(2))]),
      row([cell('C', '<w:vMerge/>'), cell('D')], '<w:gridAfter w:val="1"/>'),
    ]);
    expect(footprint(body)).toEqual({
      topLevelTableBlocks: ['tbl'],
      tables: [{
        depth: 0,
        rowContainers: 2,
        gridColumnWidths: ['1000', '2000', '3000'],
        rows: [
          { gridBefore: 0, gridAfter: 0, cells: [
            { start: 0, end: 1, vMerge: 'restart', hMerge: 'none' },
            { start: 1, end: 3, vMerge: 'none', hMerge: 'none' },
          ] },
          { gridBefore: 0, gridAfter: 1, cells: [
            { start: 0, end: 1, vMerge: 'continue', hMerge: 'none' },
            { start: 1, end: 2, vMerge: 'none', hMerge: 'none' },
          ] },
        ],
      }],
    });
  });

  test('distinguishes topologies that share row counts and nesting', () => {
    const changes: Array<[string, string]> = [
      ['grid column count', table(grid(1000, 1000, 1000, 1000), [
        row([cell('A'), cell('B'), cell('C', span(2))]),
        row([cell('D', span(2)), cell('E', span(2))]),
      ])],
      ['grid column width', base.replace('<w:gridCol w:w="1000"/>', '<w:gridCol w:w="1200"/>')],
      ['cell interval', table(grid(1000, 1000, 1000), [
        row([cell('A'), cell('B'), cell('C')]),
        row([cell('D'), cell('E', span(2))]),
      ])],
      ['row offset', table(grid(1000, 1000, 1000), [
        row([cell('A'), cell('B'), cell('C')]),
        row([cell('D'), cell('E')], '<w:gridBefore w:val="1"/>'),
      ])],
      ['vertical merge', base.replace(cell('A'), cell('A', '<w:vMerge w:val="restart"/>'))
        .replace(cell('D', span(2)), cell('D', span(2) + '<w:vMerge/>'))],
    ];
    for (const [name, changed] of changes) {
      expect(footprint(changed), name).not.toEqual(footprint(base));
    }
  });

  test('compares equal for identical projections, including unusual and malformed tables', () => {
    const unusual = table(grid(1000, 1000), [
      `<w:sdt><w:sdtPr/><w:sdtContent>${row([cell('A'), cell('B')])}</w:sdtContent></w:sdt>`,
      row([cell('C'), `<w:sdt><w:sdtPr/><w:sdtContent>${cell('D')}</w:sdtContent></w:sdt>`]),
      row([cell('Overflow', span(5))], '<w:gridBefore w:val="bogus"/>'),
    ]);
    expect(findTableFootprintMismatch(footprint(unusual), footprint(unusual.replace('Overflow', 'Text')))).toBeNull();
    expect(footprint(unusual).tables[0]!.rows.map((entry) => entry.cells.map(({ start, end }) => [start, end])))
      .toEqual([[[0, 1], [1, 2]], [[0, 1], [1, 2]], [[0, 5]]]);
  });

  test('omitted and explicit merge continuation values share one state', () => {
    const omitted = table(grid(1000), [row([cell('A', '<w:vMerge w:val="restart"/>')]), row([cell('B', '<w:vMerge/>')])]);
    const explicit = omitted.replace('<w:vMerge/>', '<w:vMerge w:val="continue"/>');
    expect(mismatch(omitted, explicit)).toBeNull();
  });
});

describe('findTableFootprintMismatch', () => {
  test('locates each kind of topology difference for reporting', () => {
    const wrapped = (count: number) => table(grid(1000), [
      `<w:sdt><w:sdtPr/><w:sdtContent>${Array(count).fill(row([cell('W')])).join('')}</w:sdtContent></w:sdt>`,
    ]);
    const nested = table(grid(3000), [row([`<w:tc>${paragraph('Outer')}${base}<w:p/></w:tc>`])]);
    const cases: Array<[string, string, object]> = [
      [base, paragraph('Before') + base + base, { feature: 'tableBlocks', tableIndex: -1 }],
      [nested, nested.replace(base, base.replace('<w:gridCol w:w="1000"/>', '<w:gridCol w:w="900"/>')),
        { feature: 'gridColumnWidth', tableIndex: 1, columnIndex: 0, expected: '1000', actual: '900' }],
      [base, base.replace(grid(1000, 1000, 1000), grid(1000, 1000, 1000, 1000)),
        { feature: 'gridColumns', tableIndex: 0, columnIndex: 3, expected: 3, actual: 4 }],
      [base, base.replace('</w:tbl>', `${row([cell('F'), cell('G'), cell('H')])}</w:tbl>`),
        { feature: 'rowContainers', tableIndex: 0, expected: 2, actual: 3 }],
      [wrapped(1), wrapped(2), { feature: 'rowCount', tableIndex: 0, rowIndex: 1, expected: 1, actual: 2 }],
      [base, base.replace(row([cell('D', span(2)), cell('E')]), row([cell('D'), cell('E')], '<w:gridBefore w:val="1"/>')),
        { feature: 'gridBefore', tableIndex: 0, rowIndex: 1, expected: 0, actual: 1 }],
      [base, base.replace(row([cell('D', span(2)), cell('E')]), row([cell('D'), cell('E')], '<w:gridAfter w:val="1"/>')),
        { feature: 'gridAfter', tableIndex: 0, rowIndex: 1, expected: 0, actual: 1 }],
      [base, base.replace(row([cell('D', span(2)), cell('E')]), row([cell('D'), cell('X'), cell('E')])),
        { feature: 'cellCount', tableIndex: 0, rowIndex: 1, cellIndex: 2, expected: 2, actual: 3 }],
      [base, base.replace(row([cell('D', span(2)), cell('E')]), row([cell('D'), cell('E', span(2))])),
        { feature: 'cellInterval', tableIndex: 0, rowIndex: 1, cellIndex: 0, columnIndex: 0, expected: [0, 2], actual: [0, 1] }],
      [base, base.replace(cell('B'), cell('B', '<w:vMerge w:val="restart"/>')),
        { feature: 'vMerge', tableIndex: 0, rowIndex: 0, cellIndex: 1, columnIndex: 1, expected: 'none', actual: 'restart' }],
      [base, base.replace(cell('C'), cell('C', '<w:hMerge/>')),
        { feature: 'hMerge', tableIndex: 0, rowIndex: 0, cellIndex: 2, columnIndex: 2, expected: 'none', actual: 'continue' }],
    ];
    for (const [expectedBody, actualBody, located] of cases) {
      expect(mismatch(expectedBody, actualBody)).toMatchObject(located);
    }
    expect(mismatch(base, base.replace('>A<', '>Changed<'))).toBeNull();
  });

  test('sees a tracked grid revision through the comparison acceptor projections', () => {
    const tracked = base.replace(grid(1000, 1000, 1000), grid(1000, 1000, 1000).replace('</w:tblGrid>',
      '<w:tblGridChange w:id="5"><w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="1500"/></w:tblGrid></w:tblGridChange></w:tblGrid>'));
    const accepted = bodyTableFootprint(acceptAllChanges(documentXml(tracked)));
    const rejected = bodyTableFootprint(rejectAllChanges(documentXml(tracked)));
    expect(findTableFootprintMismatch(footprint(base), accepted)).toBeNull();
    expect(findTableFootprintMismatch(footprint(base), rejected)).toMatchObject({
      feature: 'gridColumns', tableIndex: 0, expected: 3, actual: 2,
    });
  });
});

describe('comparison projection check with table-level revisions', () => {
  test('publishes a text redline beside a preserved grid and table-property revision', async () => {
    const trackedTable = table(grid(1000, 1000, 1000), [row([cell('A'), cell('B'), cell('C')])])
      .replace('<w:tblPr/>', '<w:tblPr><w:tblW w:w="3000" w:type="dxa"/><w:tblPrChange w:id="6" w:author="Prior"><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr></w:tblPrChange></w:tblPr>')
      .replace('</w:tblGrid>', '<w:tblGridChange w:id="7"><w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="1500"/><w:gridCol w:w="0"/></w:tblGrid></w:tblGridChange></w:tblGrid>');
    const original = await buildDocxFromBodyXml(trackedTable + paragraph('Old words'));
    const revised = await buildDocxFromBodyXml(trackedTable + paragraph('New words'));
    const result = await compareDocuments(original, revised);
    const output = await (await DocxArchive.load(result.document)).getDocumentXml();
    const sourceXml = await (await DocxArchive.load(original)).getDocumentXml();
    expect(findTableFootprintMismatch(bodyTableFootprint(rejectAllChanges(sourceXml)),
      bodyTableFootprint(rejectAllChanges(output)))).toBeNull();
    expect(bodyTableFootprint(rejectAllChanges(output)).tables[0]!.gridColumnWidths).toEqual(['1500', '1500', '0']);
    expect(bodyTableFootprint(acceptAllChanges(output)).tables[0]!.gridColumnWidths).toEqual(['1000', '1000', '1000']);
  });
});
