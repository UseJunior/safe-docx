import { describe, expect } from 'vitest';
import { inventoryTableOccupancy, TableOccupancyError } from '../src/primitives/table_occupancy.js';
import { parseXml, serializeXml } from '../src/primitives/xml.js';
import { testAllure } from './helpers/allure-test.js';

const TEST_FEATURE = 'add-merged-table-row-operations';
const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.48' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.17' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.23' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.84' },
  );

function table(rows: string, columns = 3): Element {
  const grid = '<w:gridCol/>'.repeat(columns);
  return parseXml(`<w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:tblPr/><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`).documentElement;
}

const cell = (properties = '') => `<w:tc><w:tcPr>${properties}</w:tcPr><w:p/></w:tc>`;
const row = (cells: string, properties = '') => `<w:tr><w:trPr>${properties}</w:trPr>${cells}</w:tr>`;

describe('logical table occupancy inventory', () => {
  test.openspec('[SDX-MERGEDROW-INV-01] rectangular merge ownership is stable')('tracks a two-dimensional rectangle through omitted-val continuations', () => {
    const source = table(
      row(cell('<w:gridSpan w:val="2"/><w:vMerge w:val="restart"/>') + cell())
      + row(cell('<w:gridSpan w:val="2"/><w:vMerge/>') + cell())
      + row(cell('<w:gridSpan w:val="2"/><w:vMerge w:val="continue"/>') + cell()),
    );
    const before = serializeXml(source.ownerDocument!);
    const occupancy = inventoryTableOccupancy(source);
    expect(occupancy.gridColumns).toBe(3);
    expect(occupancy.rows.map((r) => r.cells.map((c) => [c.start, c.end, c.merge]))).toEqual([
      [[0, 2, 'restart'], [2, 3, 'none']],
      [[0, 2, 'continue'], [2, 3, 'none']],
      [[0, 2, 'continue'], [2, 3, 'none']],
    ]);
    const owner = occupancy.rows[0]!.cells[0];
    expect(occupancy.rows[1]!.slots[0]!.owner).toBe(owner);
    expect(occupancy.rows[2]!.slots[1]!.owner).toBe(owner);
    expect(serializeXml(source.ownerDocument!)).toBe(before);
  });

  test('accounts for explicit row offsets without inventing physical cells', () => {
    const occupancy = inventoryTableOccupancy(table(
      row(cell() + cell(), '<w:gridBefore w:val="1"/>')
      + row(cell('<w:gridSpan w:val="2"/>'), '<w:gridAfter w:val="1"/>'),
    ));
    expect(occupancy.rows[0]!.slots.map((slot) => slot?.cellIndex ?? null)).toEqual([null, 0, 1]);
    expect(occupancy.rows[1]!.slots.map((slot) => slot?.cellIndex ?? null)).toEqual([0, 0, null]);
  });

  test('rejects orphan and changed-width vertical continuations with coordinates', () => {
    const orphan = table(row(cell('<w:vMerge/>') + cell() + cell()));
    expect(() => inventoryTableOccupancy(orphan)).toThrowError(TableOccupancyError);
    expect(() => inventoryTableOccupancy(orphan)).toThrowError('Orphan or changed-width continuation');
    const changed = table(
      row(cell('<w:gridSpan w:val="2"/><w:vMerge w:val="restart"/>') + cell())
      + row(cell('<w:vMerge/>') + cell() + cell()),
    );
    let error: unknown;
    try { inventoryTableOccupancy(changed); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ feature: 'vMerge', rowIndex: 1, cellIndex: 0 });
  });

  test('rejects grid overfill and implicit holes', () => {
    const overfill = table(row(cell('<w:gridSpan w:val="4"/>')));
    expect(() => inventoryTableOccupancy(overfill)).toThrowError('Cell extends beyond effective grid');
    const hole = table(row(cell() + cell()));
    expect(() => inventoryTableOccupancy(hole)).toThrowError('Row occupancy does not match tblGrid');
  });

  test.openspec('[SDX-MERGEDROW-INV-02] invalid or unmodeled topology fails closed')('does not skip wrapped rows or pending topology revisions', () => {
    const wrapped = table(row(cell() + cell() + cell())
      + `<w:sdt><w:sdtContent>${row(cell() + cell() + cell())}</w:sdtContent></w:sdt>`);
    expect(() => inventoryTableOccupancy(wrapped)).toThrowError('Unsupported row container');
    const revised = table(row(cell('<w:cellIns w:id="9" w:author="Other"/>') + cell() + cell()));
    expect(() => inventoryTableOccupancy(revised)).toThrowError('Pending cell topology changes');
    const legacy = table(row(cell('<w:hMerge w:val="restart"/>') + cell('<w:hMerge/>') + cell()));
    expect(() => inventoryTableOccupancy(legacy)).toThrowError('Legacy hMerge');
  });
});
