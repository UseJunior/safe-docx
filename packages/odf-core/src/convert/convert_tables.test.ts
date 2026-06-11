import { describe, it, expect } from 'vitest';
import { buildDocxFromParts, parseXml } from '@usejunior/docx-core';

import { convertDocxToOdt } from './docx_to_odt.js';
import { OdfArchive } from '../shared/odf/OdfArchive.js';
import { ODF_NS } from '../shared/odf/namespaces.js';

function tc(content: string, gridSpan?: number): string {
  const span = gridSpan ? `<w:tcPr><w:gridSpan w:val="${gridSpan}"/></w:tcPr>` : '';
  return `<w:tc>${span}${content}</w:tc>`;
}

function cellP(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

describe('convertDocxToOdt — tables', () => {
  it('[CONV-09] tables become a complete rectangular grid with header rows, multi-para cells, and filled gaps', async () => {
    const bodyXml =
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>` +
      `<w:tr>${tc(cellP('H1'))}${tc(cellP('H2'))}${tc(cellP('H3'))}</w:tr>` +
      `<w:tr>${tc(cellP('A1 first') + cellP('A1 second'))}${tc(cellP('wide cell'), 2)}</w:tr>` +
      `</w:tbl>` +
      cellP('After the table');
    const docx = await buildDocxFromParts({ bodyXml });
    const { odt, lossiness } = await convertDocxToOdt(docx);

    const doc = parseXml(await (await OdfArchive.load(odt)).getContentXml());
    const tables = Array.from(doc.getElementsByTagNameNS(ODF_NS.TABLE, 'table'));
    expect(tables).toHaveLength(1);
    const table = tables[0]!;
    expect(table.getAttributeNS(ODF_NS.TABLE, 'name')).toBe('Table1');

    const columns = table.getElementsByTagNameNS(ODF_NS.TABLE, 'table-column');
    expect(columns).toHaveLength(1);
    expect(columns[0]!.getAttributeNS(ODF_NS.TABLE, 'number-columns-repeated')).toBe('3');

    // First row (the view model's header heuristic) sits in table:table-header-rows.
    const headerContainers = table.getElementsByTagNameNS(ODF_NS.TABLE, 'table-header-rows');
    expect(headerContainers).toHaveLength(1);
    const headerCells = Array.from(headerContainers[0]!.getElementsByTagNameNS(ODF_NS.TABLE, 'table-cell'));
    expect(headerCells.map((c) => c.textContent)).toEqual(['H1', 'H2', 'H3']);

    // Every row carries the full column count; the gridSpan gap is filled with an empty cell.
    const bodyRows = Array.from(table.getElementsByTagNameNS(ODF_NS.TABLE, 'table-row')).filter(
      (r) => r.parentNode === table,
    );
    expect(bodyRows).toHaveLength(1);
    const bodyCells = Array.from(bodyRows[0]!.getElementsByTagNameNS(ODF_NS.TABLE, 'table-cell'));
    expect(bodyCells).toHaveLength(3);
    expect(bodyCells[2]!.textContent).toBe('');
    expect(lossiness.some((e) => e.construct === 'table-grid-gaps-filled')).toBe(true);

    // The multi-paragraph cell keeps separate text:p children (no flattening).
    const multiPara = Array.from(bodyCells[0]!.getElementsByTagNameNS(ODF_NS.TEXT, 'p'));
    expect(multiPara.map((p) => p.textContent)).toEqual(['A1 first', 'A1 second']);

    // Body text after the table is outside any table element.
    const after = Array.from(doc.getElementsByTagNameNS(ODF_NS.TEXT, 'p')).find(
      (p) => p.textContent === 'After the table',
    );
    expect(after).toBeDefined();
    let inTable = false;
    for (let n = after!.parentNode; n; n = n.parentNode) {
      if ((n as Element).localName === 'table') inTable = true;
    }
    expect(inTable).toBe(false);
  });
});
