/**
 * The comparison's own acceptor resolves table-level revisions in both
 * directions. Each revision's single child is the complete prior state of its
 * live parent, so accepting drops the record and keeps the live state, and
 * rejecting replaces the live state with the snapshot:
 *
 * - `w:tblGridChange` inside `w:tblGrid` holds the former `w:gridCol` list;
 * - `w:tblPrChange` inside `w:tblPr` holds the former table properties;
 * - `w:tblPrExChange` inside `w:tblPrEx` holds the former row-level
 *   table-property exceptions.
 *
 * The post-comparison table projection check runs these projections, so a
 * table-topology redline is only checkable once both directions resolve.
 * docx-core's native `acceptChanges`/`rejectChanges` already resolve
 * `w:tblPrChange` and must agree here; their `w:tblGridChange` and
 * `w:tblPrExChange` handling is tracked separately (#1401).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.33
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.34
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.35
 * @see https://github.com/UseJunior/safe-docx/issues/1395
 */

import { describe, expect } from 'vitest';
import { acceptChanges, parseXml, rejectChanges, serializeXml } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const TEST_FEATURE = 'Track Changes Acceptor';
const test = testAllure.epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, story: 'Table-Level Property Revisions' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.33' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.34' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.35' },
  );

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const gridCols = (...widths: number[]) => widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('');
const documentXml = (body: string) =>
  `<w:document xmlns:w="${W_NS}"><w:body>${body}<w:sectPr/></w:body></w:document>`;

interface TableParts {
  tblPr?: string;
  tblGrid?: string;
  tblPrEx?: string;
  rows?: string;
}

function table({ tblPr = '', tblGrid = gridCols(1500, 1500), tblPrEx = '', rows }: TableParts): string {
  return `<w:tbl><w:tblPr>${tblPr}</w:tblPr><w:tblGrid>${tblGrid}</w:tblGrid>`
    + (rows ?? `<w:tr>${tblPrEx}${cell('A')}${cell('B')}</w:tr>`) + '</w:tbl>';
}

const gridChange = (...widths: number[]) =>
  `<w:tblGridChange w:id="10"><w:tblGrid>${gridCols(...widths)}</w:tblGrid></w:tblGridChange>`;
const tblPrChange = (snapshot: string) =>
  `<w:tblPrChange w:id="11" w:author="Prior" w:date="2026-11-01T00:00:00Z"><w:tblPr>${snapshot}</w:tblPr></w:tblPrChange>`;
const tblPrExChange = (snapshot: string) =>
  `<w:tblPrExChange w:id="12" w:author="Prior" w:date="2026-11-01T00:00:00Z"><w:tblPrEx>${snapshot}</w:tblPrEx></w:tblPrExChange>`;

function tables(xml: string): Element[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'tbl'));
}

function directChild(parent: Element, localName: string): Element | undefined {
  return Array.from(parent.childNodes).find((node): node is Element =>
    node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (node as Element).localName === localName);
}

function directChildNames(parent: Element | undefined): string[] {
  if (!parent) return [];
  return Array.from(parent.childNodes)
    .filter((node): node is Element => node.nodeType === 1)
    .map((element) => element.localName);
}

function gridWidths(table: Element): Array<string | null> {
  const grid = directChild(table, 'tblGrid')!;
  return Array.from(grid.childNodes)
    .filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === 'gridCol')
    .map((column) => column.getAttributeNS(W_NS, 'w'));
}

function tableWidth(container: Element | undefined): string | null {
  const width = container && directChild(container, 'tblW');
  return width ? `${width.getAttributeNS(W_NS, 'w')}/${width.getAttributeNS(W_NS, 'type')}` : null;
}

function countRevision(xml: string, localName: string): number {
  return parseXml(xml).getElementsByTagNameNS(W_NS, localName).length;
}

function nativeProjection(xml: string, resolve: typeof acceptChanges | typeof rejectChanges): string {
  const document = parseXml(xml);
  resolve(document);
  return serializeXml(document);
}

describe('comparison acceptor: table-grid revisions (w:tblGridChange)', () => {
  test('accept keeps the current grid and drops the revision record', () => {
    const input = documentXml(table({ tblGrid: gridCols(1548, 8028) + gridChange(4788, 4788) }));
    const accepted = acceptAllChanges(input);
    const [result] = tables(accepted);
    expect(gridWidths(result!)).toEqual(['1548', '8028']);
    expect(countRevision(accepted, 'tblGridChange')).toBe(0);
  });

  test('reject restores the prior grid columns, including a changed column count', () => {
    const input = documentXml(table({
      tblGrid: gridCols(1000, 1000, 1000) + gridChange(1500, 1500),
      rows: `<w:tr>${cell('A')}${cell('B')}${cell('C')}</w:tr>`,
    }));
    const rejected = rejectAllChanges(input);
    const [result] = tables(rejected);
    expect(gridWidths(result!)).toEqual(['1500', '1500']);
    expect(countRevision(rejected, 'tblGridChange')).toBe(0);
    expect(directChildNames(directChild(result!, 'tblGrid'))).toEqual(['gridCol', 'gridCol']);
  });

  test('resolves an outer and a nested table independently', () => {
    const inner = table({
      tblGrid: gridCols(700) + gridChange(900),
      rows: `<w:tr>${cell('Inner')}</w:tr>`,
    });
    const outer = table({
      tblGrid: gridCols(3000) + gridChange(2000),
      rows: `<w:tr><w:tc><w:p/>${inner}<w:p/></w:tc></w:tr>`,
    });
    const input = documentXml(outer);
    expect(tables(acceptAllChanges(input)).map(gridWidths)).toEqual([['3000'], ['700']]);
    expect(tables(rejectAllChanges(input)).map(gridWidths)).toEqual([['2000'], ['900']]);
  });

  test('a record without its required snapshot leaves the current grid in both directions', () => {
    const input = documentXml(table({ tblGrid: gridCols(1500, 1500) + '<w:tblGridChange w:id="10"/>' }));
    for (const resolved of [acceptAllChanges(input), rejectAllChanges(input)]) {
      expect(gridWidths(tables(resolved)[0]!)).toEqual(['1500', '1500']);
      expect(countRevision(resolved, 'tblGridChange')).toBe(0);
    }
  });
});

describe('comparison acceptor: table-property revisions (w:tblPrChange)', () => {
  const live = '<w:tblStyle w:val="LightShading"/><w:tblW w:w="5000" w:type="dxa"/>';
  const prior = '<w:tblStyle w:val="LightList"/><w:tblW w:w="0" w:type="auto"/>';
  const input = documentXml(table({ tblPr: live + tblPrChange(prior) }));

  test('accept keeps the current table properties and drops the revision record', () => {
    const accepted = acceptAllChanges(input);
    const tblPr = directChild(tables(accepted)[0]!, 'tblPr');
    expect(directChildNames(tblPr)).toEqual(['tblStyle', 'tblW']);
    expect(directChild(tblPr!, 'tblStyle')!.getAttributeNS(W_NS, 'val')).toBe('LightShading');
    expect(tableWidth(tblPr)).toBe('5000/dxa');
  });

  test('reject restores the prior table properties', () => {
    const rejected = rejectAllChanges(input);
    const tblPr = directChild(tables(rejected)[0]!, 'tblPr');
    expect(directChildNames(tblPr)).toEqual(['tblStyle', 'tblW']);
    expect(directChild(tblPr!, 'tblStyle')!.getAttributeNS(W_NS, 'val')).toBe('LightList');
    expect(tableWidth(tblPr)).toBe('0/auto');
  });

  test('keeps a required w:tblPr even when the restored snapshot is empty', () => {
    const rejected = rejectAllChanges(documentXml(table({ tblPr: live + tblPrChange('') })));
    const tblPr = directChild(tables(rejected)[0]!, 'tblPr');
    expect(tblPr).toBeDefined();
    expect(directChildNames(tblPr)).toEqual([]);
  });

  test('agrees with docx-core native accept and reject', () => {
    const project = (xml: string) => {
      const tblPr = directChild(tables(xml)[0]!, 'tblPr');
      return { children: directChildNames(tblPr), width: tableWidth(tblPr) };
    };
    expect(project(acceptAllChanges(input))).toEqual(project(nativeProjection(input, acceptChanges)));
    expect(project(rejectAllChanges(input))).toEqual(project(nativeProjection(input, rejectChanges)));
  });
});

describe('comparison acceptor: table-property-exception revisions (w:tblPrExChange)', () => {
  const tableWithException = (exception: string) =>
    documentXml(table({ tblPrEx: `<w:tblPrEx>${exception}</w:tblPrEx>` }));

  test('accept keeps the current exceptions and drops the revision record', () => {
    const accepted = acceptAllChanges(tableWithException(
      '<w:tblW w:w="14400" w:type="dxa"/>' + tblPrExChange('<w:tblW w:w="0" w:type="auto"/>')));
    const row = tables(accepted)[0]!.getElementsByTagNameNS(W_NS, 'tr')[0]!;
    const tblPrEx = directChild(row, 'tblPrEx');
    expect(directChildNames(tblPrEx)).toEqual(['tblW']);
    expect(tableWidth(tblPrEx)).toBe('14400/dxa');
  });

  test('reject restores the prior exceptions', () => {
    const rejected = rejectAllChanges(tableWithException(
      '<w:tblW w:w="14400" w:type="dxa"/>' + tblPrExChange('<w:tblW w:w="0" w:type="auto"/>')));
    const row = tables(rejected)[0]!.getElementsByTagNameNS(W_NS, 'tr')[0]!;
    const tblPrEx = directChild(row, 'tblPrEx');
    expect(directChildNames(tblPrEx)).toEqual(['tblW']);
    expect(tableWidth(tblPrEx)).toBe('0/auto');
    expect(countRevision(rejected, 'tblPrExChange')).toBe(0);
  });

  test('accept drops an exception container whose only child was the revision record', () => {
    const accepted = acceptAllChanges(tableWithException(tblPrExChange('<w:jc w:val="center"/>')));
    const row = tables(accepted)[0]!.getElementsByTagNameNS(W_NS, 'tr')[0]!;
    expect(directChildNames(row)).toEqual(['tc', 'tc']);
  });

  test('reject of exceptions added by the revision restores the empty prior set', () => {
    const rejected = rejectAllChanges(tableWithException(
      '<w:jc w:val="center"/>' + tblPrExChange('')));
    const row = tables(rejected)[0]!.getElementsByTagNameNS(W_NS, 'tr')[0]!;
    expect(directChildNames(directChild(row, 'tblPrEx'))).toEqual([]);
  });
});
