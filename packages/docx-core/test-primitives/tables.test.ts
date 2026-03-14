import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { parseXml } from '../src/primitives/xml.js';
import { OOXML } from '../src/primitives/namespaces.js';
import { extractTables, type ExtractTablesResult } from '../src/primitives/tables.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Table Extraction' });

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${OOXML.W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

function simpleTable(headers: string[], rows: string[][]): string {
  const headerRow = `<w:tr>${headers.map((h) => `<w:tc><w:p><w:r><w:t>${h}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`;
  const dataRows = rows
    .map(
      (row) =>
        `<w:tr>${row.map((cell) => `<w:tc><w:p><w:r><w:t>${cell}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`,
    )
    .join('');
  return `<w:tbl>${headerRow}${dataRows}</w:tbl>`;
}

describe('extractTables', () => {
  test('extracts a simple 2-column table', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ExtractTablesResult;

    await given('a document with a 2-column table', async () => {
      doc = makeDoc(simpleTable(['Name', 'Value'], [['alpha', '1'], ['beta', '2']]));
    });

    await when('extractTables is called', async () => {
      result = extractTables(doc!);
    });

    await then('one table with correct headers and rows is returned', async () => {
      expect(result!.tables).toHaveLength(1);
      const table = result!.tables[0]!;
      expect(table.headers).toEqual(['Name', 'Value']);
      expect(table.rows).toHaveLength(2);
      expect(table.rows[0]).toEqual({ Name: 'alpha', Value: '1' });
      expect(table.rows[1]).toEqual({ Name: 'beta', Value: '2' });
      expect(table.tableIndex).toBe(0);
    });
  });

  test('extracts multiple tables', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ExtractTablesResult;

    await given('a document with two tables', async () => {
      const t1 = simpleTable(['A', 'B'], [['1', '2']]);
      const t2 = simpleTable(['X', 'Y'], [['3', '4']]);
      doc = makeDoc(`${t1}${t2}`);
    });

    await when('extractTables is called', async () => {
      result = extractTables(doc!);
    });

    await then('both tables are returned with correct indexes', async () => {
      expect(result!.tables).toHaveLength(2);
      expect(result!.tables[0]!.tableIndex).toBe(0);
      expect(result!.tables[0]!.headers).toEqual(['A', 'B']);
      expect(result!.tables[1]!.tableIndex).toBe(1);
      expect(result!.tables[1]!.headers).toEqual(['X', 'Y']);
    });
  });

  test('multi-paragraph cell returns joined text and paragraph parts', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ExtractTablesResult;

    await given('a table with a multi-paragraph cell', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr><w:tc><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:tc></w:tr>` +
        `<w:tr><w:tc>` +
        `<w:p><w:r><w:t>Line one</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Line two</w:t></w:r></w:p>` +
        `</w:tc></w:tr>` +
        `</w:tbl>`;
      doc = makeDoc(bodyXml);
    });

    await when('extractTables is called', async () => {
      result = extractTables(doc!);
    });

    await then('rawRows contains both joined text and paragraph parts', async () => {
      expect(result!.tables).toHaveLength(1);
      const dataRow = result!.tables[0]!.rawRows[1]!;
      expect(dataRow.cells[0]!.text).toBe('Line one\nLine two');
      expect(dataRow.cells[0]!.paragraphs).toEqual(['Line one', 'Line two']);
      expect(dataRow.cells[0]!.paragraphCount).toBe(2);
    });
  });

  test('detects hMerge and rejects table when rejectMergedCells is true', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ExtractTablesResult;

    await given('a table with w:hMerge in a cell', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `<w:tr>` +
        `<w:tc><w:tcPr><w:hMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>merged</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:tcPr><w:hMerge w:val="continue"/></w:tcPr><w:p><w:r><w:t></w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `</w:tbl>`;
      doc = makeDoc(bodyXml);
    });

    await when('extractTables is called with rejectMergedCells true', async () => {
      result = extractTables(doc!, { rejectMergedCells: true });
    });

    await then('no tables are returned but merged cell diagnostics are present', async () => {
      expect(result!.tables).toHaveLength(0);
      expect(result!.mergedCellDiagnostics.length).toBeGreaterThan(0);
      expect(result!.mergedCellDiagnostics[0]!.mergeType).toBe('hMerge');
    });
  });

  test('detects vMerge and rejects table when rejectMergedCells is true', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ExtractTablesResult;

    await given('a table with w:vMerge in a cell', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `<w:tr>` +
        `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p><w:r><w:t></w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `</w:tbl>`;
      doc = makeDoc(bodyXml);
    });

    await when('extractTables is called with rejectMergedCells true', async () => {
      result = extractTables(doc!, { rejectMergedCells: true });
    });

    await then('table is rejected with vMerge diagnostic', async () => {
      expect(result!.tables).toHaveLength(0);
      expect(result!.mergedCellDiagnostics.some((d) => d.mergeType === 'vMerge')).toBe(true);
    });
  });

  test('detects gridSpan > 1 and rejects table when rejectMergedCells is true', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ExtractTablesResult;

    await given('a table with w:gridSpan val=2 in a cell', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `<w:tr>` +
        `<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>wide</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `</w:tbl>`;
      doc = makeDoc(bodyXml);
    });

    await when('extractTables is called with rejectMergedCells true', async () => {
      result = extractTables(doc!, { rejectMergedCells: true });
    });

    await then('table is rejected with gridSpan diagnostic', async () => {
      expect(result!.tables).toHaveLength(0);
      expect(result!.mergedCellDiagnostics.some((d) => d.mergeType === 'gridSpan')).toBe(true);
    });
  });

  test('allows merged cells when rejectMergedCells is false', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ExtractTablesResult;

    await given('a table with merged cells', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `<w:tr>` +
        `<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>val</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `</w:tbl>`;
      doc = makeDoc(bodyXml);
    });

    await when('extractTables is called with rejectMergedCells false', async () => {
      result = extractTables(doc!, { rejectMergedCells: false });
    });

    await then('table is returned despite merged cells', async () => {
      expect(result!.tables).toHaveLength(1);
      expect(result!.mergedCellDiagnostics.length).toBeGreaterThan(0);
    });
  });

  test('headerFilter selects correct table', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ExtractTablesResult;

    await given('a document with two tables with different headers', async () => {
      const t1 = simpleTable(['A', 'B'], [['1', '2']]);
      const t2 = simpleTable(['X', 'Y', 'Z'], [['3', '4', '5']]);
      doc = makeDoc(`${t1}${t2}`);
    });

    await when('extractTables is called filtering for X/Y/Z headers', async () => {
      result = extractTables(doc!, { headerFilter: [['X', 'Y', 'Z']] });
    });

    await then('only the matching table is returned', async () => {
      expect(result!.tables).toHaveLength(1);
      expect(result!.tables[0]!.headers).toEqual(['X', 'Y', 'Z']);
      expect(result!.tables[0]!.tableIndex).toBe(1);
    });
  });

  test('empty cells produce empty string', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ExtractTablesResult;

    await given('a table with an empty data cell', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr><w:tc><w:p><w:r><w:t>H</w:t></w:r></w:p></w:tc></w:tr>` +
        `<w:tr><w:tc><w:p/></w:tc></w:tr>` +
        `</w:tbl>`;
      doc = makeDoc(bodyXml);
    });

    await when('extractTables is called', async () => {
      result = extractTables(doc!);
    });

    await then('the empty cell has empty string text', async () => {
      expect(result!.tables).toHaveLength(1);
      expect(result!.tables[0]!.rows[0]!['H']).toBe('');
    });
  });

  test('no tables returns empty result', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ExtractTablesResult;

    await given('a document with no tables', async () => {
      doc = makeDoc(`<w:p><w:r><w:t>Just text</w:t></w:r></w:p>`);
    });

    await when('extractTables is called', async () => {
      result = extractTables(doc!);
    });

    await then('empty tables array is returned', async () => {
      expect(result!.tables).toHaveLength(0);
      expect(result!.mergedCellDiagnostics).toHaveLength(0);
    });
  });

  test('duplicate header keys cause table to be skipped', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ExtractTablesResult;

    await given('a table with duplicate header names', async () => {
      doc = makeDoc(simpleTable(['Name', 'Name'], [['a', 'b']]));
    });

    await when('extractTables is called', async () => {
      result = extractTables(doc!);
    });

    await then('the table is skipped', async () => {
      expect(result!.tables).toHaveLength(0);
    });
  });

  test('trims cell text by default', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ExtractTablesResult;

    await given('a table with whitespace-padded cells', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr><w:tc><w:p><w:r><w:t xml:space="preserve">  Key  </w:t></w:r></w:p></w:tc></w:tr>` +
        `<w:tr><w:tc><w:p><w:r><w:t xml:space="preserve">  value  </w:t></w:r></w:p></w:tc></w:tr>` +
        `</w:tbl>`;
      doc = makeDoc(bodyXml);
    });

    await when('extractTables is called with default options', async () => {
      result = extractTables(doc!);
    });

    await then('cell text is trimmed', async () => {
      expect(result!.tables).toHaveLength(1);
      expect(result!.tables[0]!.headers[0]).toBe('Key');
      expect(result!.tables[0]!.rows[0]!['Key']).toBe('value');
    });
  });

  test('preserves cell text when trimCellText is false', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ExtractTablesResult;

    await given('a table with whitespace-padded cells', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr><w:tc><w:p><w:r><w:t>Key</w:t></w:r></w:p></w:tc></w:tr>` +
        `<w:tr><w:tc><w:p><w:r><w:t xml:space="preserve">  value  </w:t></w:r></w:p></w:tc></w:tr>` +
        `</w:tbl>`;
      doc = makeDoc(bodyXml);
    });

    await when('extractTables is called with trimCellText false', async () => {
      result = extractTables(doc!, { trimCellText: false });
    });

    await then('cell text preserves whitespace', async () => {
      expect(result!.tables).toHaveLength(1);
      expect(result!.tables[0]!.rows[0]!['Key']).toBe('  value  ');
    });
  });

  test('rawRows includes the header row at index 0', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ExtractTablesResult;

    await given('a simple table', async () => {
      doc = makeDoc(simpleTable(['H1'], [['D1']]));
    });

    await when('extractTables is called', async () => {
      result = extractTables(doc!);
    });

    await then('rawRows has header at index 0 and data at index 1', async () => {
      const table = result!.tables[0]!;
      expect(table.rawRows).toHaveLength(2);
      expect(table.rawRows[0]!.cells[0]!.text).toBe('H1');
      expect(table.rawRows[1]!.cells[0]!.text).toBe('D1');
    });
  });

  test('extra cells beyond headers produce empty keys gracefully', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ExtractTablesResult;

    await given('a table where a data row has fewer cells than headers', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>only-one</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `</w:tbl>`;
      doc = makeDoc(bodyXml);
    });

    await when('extractTables is called', async () => {
      result = extractTables(doc!);
    });

    await then('missing cells default to empty string', async () => {
      expect(result!.tables).toHaveLength(1);
      const row = result!.tables[0]!.rows[0]!;
      expect(row['A']).toBe('only-one');
      expect(row['B']).toBe('');
    });
  });

  test('headerFilter accepts multiple filter arrays', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ExtractTablesResult;

    await given('a document with three tables', async () => {
      const t1 = simpleTable(['A', 'B'], [['1', '2']]);
      const t2 = simpleTable(['C', 'D', 'E'], [['3', '4', '5']]);
      const t3 = simpleTable(['F', 'G'], [['6', '7']]);
      doc = makeDoc(`${t1}${t2}${t3}`);
    });

    await when('headerFilter matches two of three tables', async () => {
      result = extractTables(doc!, { headerFilter: [['A', 'B'], ['F', 'G']] });
    });

    await then('two matching tables are returned', async () => {
      expect(result!.tables).toHaveLength(2);
      expect(result!.tables[0]!.headers).toEqual(['A', 'B']);
      expect(result!.tables[1]!.headers).toEqual(['F', 'G']);
    });
  });
});
