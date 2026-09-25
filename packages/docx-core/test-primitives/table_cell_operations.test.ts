import { describe, expect } from 'vitest';
import { DocxDocument } from '../src/primitives/document.js';
import { DocxZip } from '../src/primitives/zip.js';
import { getParagraphBookmarkId } from '../src/primitives/bookmarks.js';
import { createRevisionContext } from '../src/primitives/track-changes-emitter.js';
import { absorbTableCell as absorbCore, splitTableCell as splitCore } from '../src/primitives/table_cells.js';
import { inventoryTableOccupancy } from '../src/primitives/table_occupancy.js';
import { getDirectChildrenByName } from '../src/primitives/dom-helpers.js';
import { SafeDocxError } from '../src/primitives/errors.js';
import { serializeXml } from '../src/primitives/xml.js';
import { buildDocxFromBodyXml } from '../src/testing/ooxml-fixtures.js';
import { testAllure } from './helpers/allure-test.js';

const TEST_FEATURE = 'add-structural-table-cell-operations';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('DOCX Primitives')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.16' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.17' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.48' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.71' },
  );

const BODY = `<w:tbl><w:tblPr><w:tblW w:w="600" w:type="dxa"/></w:tblPr>
  <w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="200"/><w:gridCol w:w="300"/></w:tblGrid>
  <w:tr><w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/><w:gridSpan w:val="3"/><w:shd w:val="clear" w:color="auto" w:fill="FFFF00"/></w:tcPr>
    <w:p><w:r><w:t>Heading</w:t></w:r></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:tcPr><w:tcW w:w="100" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Left</w:t></w:r></w:p></w:tc>
    <w:tc><w:tcPr><w:tcW w:w="200" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Middle</w:t></w:r></w:p></w:tc>
    <w:tc><w:tcPr><w:tcW w:w="300" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Right</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>`;

async function loaded(body = BODY) {
  const doc = await DocxDocument.load(await buildDocxFromBodyXml(body));
  doc.insertParagraphBookmarks('cell-test');
  const ids = doc.getParagraphs().map((paragraph) => getParagraphBookmarkId(paragraph)!);
  return { doc, ids };
}

async function xml(doc: DocxDocument): Promise<string> {
  const { buffer } = await doc.toBuffer({ cleanBookmarks: false });
  return (await DocxZip.load(buffer)).readText('word/document.xml');
}

function rows(doc: DocxDocument) {
  const table = doc.getDocumentXmlClone().getElementsByTagNameNS(W_NS, 'tbl')[0]!;
  return inventoryTableOccupancy(table).rows;
}

function cellText(cell: Element): string {
  return Array.from(cell.getElementsByTagNameNS(W_NS, 't')).map((text) => text.textContent ?? '').join('');
}

function cellWidth(cell: Element): string | null {
  const width = cell.getElementsByTagNameNS(W_NS, 'tcW')[0];
  return width?.getAttributeNS(W_NS, 'w') ?? null;
}

function errorDetail(fn: () => unknown): Record<string, unknown> {
  try { fn(); } catch (error) {
    expect(error).toBeInstanceOf(SafeDocxError);
    return (error as SafeDocxError).detail as Record<string, unknown>;
  }
  throw new Error('Expected SafeDocxError');
}

describe('clean horizontal table-cell operations', () => {
  test.openspec('[SDX-TABLECELL-01] split a horizontal span into two physical cells')('splits either side of an interior grid boundary', async () => {
    for (const existingSide of ['left', 'right'] as const) {
      const { doc, ids } = await loaded();
      const sourceParagraph = doc.getParagraphs()[0]!;
      const result = doc.splitTableCell({ anchorParagraphId: ids[0]!, splitColumnIndex: 1, existingSide, newCellText: 'Fresh' });
      expect(result).toEqual({ tableIndex: 0, rowIndex: 0,
        retained: existingSide === 'left' ? { start: 0, end: 1 } : { start: 1, end: 3 },
        created: existingSide === 'left' ? { start: 1, end: 3 } : { start: 0, end: 1 },
        newParagraphId: expect.stringMatching(/^_bk_/),
      });
      expect(doc.getParagraphTextById(result.newParagraphId)).toBe('Fresh');
      expect(doc.getParagraphs()).toContain(sourceParagraph);
      const splitCells = rows(doc)[0]!.cells;
      expect(splitCells.map((cell) => [cell.start, cell.end])).toEqual([[0, 1], [1, 3]]);
      expect(splitCells.map((cell) => cellText(cell.element)))
        .toEqual(existingSide === 'left' ? ['Heading', 'Fresh'] : ['Fresh', 'Heading']);
      expect(splitCells.map((cell) => cellWidth(cell.element))).toEqual(['100', '500']);
      const output = await xml(doc);
      expect(output).toContain('<w:tcW w:w="100" w:type="dxa"/>');
      expect(output).toContain('<w:tcW w:w="500" w:type="dxa"/>');
      expect(output).toContain('<w:tblW w:w="600" w:type="dxa"/>');
    }
  });

  test.openspec('[SDX-TABLECELL-02] delete one cell and absorb its interval')('absorbs either neighbor without changing other rows', async () => {
    for (const [target, side, expected, widths] of [
      [2, 'left', [2, 3], ['300', '300']],
      [2, 'right', [1, 3], ['100', '500']],
    ] as const) {
      const { doc, ids } = await loaded();
      const heldTitle = doc.getParagraphs()[0]!;
      const result = doc.absorbTableCell({ anchorParagraphId: ids[target]!, absorbSide: side });
      expect(result).toEqual({ tableIndex: 0, rowIndex: 1,
        absorbedInto: side === 'left' ? { start: 0, end: 2 } : { start: 1, end: 3 } });
      const absorbedCells = rows(doc)[1]!.cells;
      expect(absorbedCells.map((cell) => cell.end)).toEqual(expected);
      expect(absorbedCells.map((cell) => cellWidth(cell.element))).toEqual(widths);
      expect(doc.getParagraphs()[0]).toBe(heldTitle);
      expect(await xml(doc)).not.toContain('Middle');
      expect(await xml(doc)).toContain('Heading');
    }
  });

  test.openspec('[SDX-TABLECELL-03] split and absorb preferred widths')('rejects ambiguous percentages and mismatched split widths transactionally', async () => {
    const cases = [
      { body: BODY.replace('w:w="600" w:type="dxa"/><w:gridSpan', 'w:w="5000" w:type="pct"/><w:gridSpan'), operation: 'split' },
      { body: BODY.replace('w:w="600" w:type="dxa"/><w:gridSpan', 'w:w="599" w:type="dxa"/><w:gridSpan'), operation: 'split' },
      { body: BODY.replace('w:w="100" w:type="dxa"/></w:tcPr>', 'w:w="5000" w:type="pct"/></w:tcPr>'), operation: 'absorb' },
      { body: BODY.replace('<w:gridCol w:w="200"/>', '<w:gridCol/>'), operation: 'split' },
    ];
    for (const { body, operation } of cases) {
      const { doc, ids } = await loaded(body);
      const before = await xml(doc);
      const detail = operation === 'split'
        ? errorDetail(() => doc.splitTableCell({ anchorParagraphId: ids[0]!, splitColumnIndex: 1, existingSide: 'left', newCellText: '' }))
        : errorDetail(() => doc.absorbTableCell({ anchorParagraphId: ids[2]!, absorbSide: 'left' }));
      expect(detail.feature).toBe('width');
      expect(await xml(doc)).toBe(before);
    }
  });

  test.openspec('[SDX-TABLECELL-04] unsupported or invalid cell edit leaves no trace')('rejects topology, pending content, final cell and tracked contexts', async () => {
    const pendingRow = BODY.replace('<w:tr><w:tc><w:tcPr><w:tcW w:w="600"', '<w:tr><w:trPr><w:del w:id="8" w:author="Tester" w:date="2026-09-24T00:00:00Z"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="600"');
    const pendingContent = BODY.replace('<w:r><w:t>Middle</w:t></w:r>', '<w:ins w:id="8" w:author="Tester" w:date="2026-09-24T00:00:00Z"><w:r><w:t>Middle</w:t></w:r></w:ins>');
    const nested = BODY.replace('<w:p><w:r><w:t>Right</w:t></w:r></w:p>', '<w:p><w:r><w:t>Right</w:t></w:r></w:p><w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="300"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl><w:p/>');
    for (const [body, index, operation, feature] of [
      [pendingRow, 0, 'split', 'topologyRevision'], [pendingContent, 2, 'absorb', 'contentRevision'],
      [nested, 0, 'split', 'nestedTable'], [BODY, 0, 'absorb', 'lastCell'],
    ] as const) {
      const { doc, ids } = await loaded(body);
      const before = await xml(doc);
      const result = errorDetail(() => operation === 'split'
        ? doc.splitTableCell({ anchorParagraphId: ids[index]!, splitColumnIndex: 1, existingSide: 'left', newCellText: 'Fresh' })
        : doc.absorbTableCell({ anchorParagraphId: ids[index]!, absorbSide: 'left' }));
      expect(result.feature).toBe(feature);
      if (body === pendingRow) expect(result).toMatchObject({ tableIndex: 0, rowIndex: 0, cellIndex: 0, columnIndex: 1 });
      expect(await xml(doc)).toBe(before);
    }
    const { doc, ids } = await loaded();
    const ctx = createRevisionContext({ author: 'Tester', date: '2026-09-24T00:00:00Z' });
    const before = await xml(doc);
    const nextId = ctx.idState.nextId;
    expect(errorDetail(() => doc.splitTableCell({ anchorParagraphId: ids[0]!, splitColumnIndex: 1, existingSide: 'left', newCellText: '' }, ctx)).feature).toBe('revisionContext');
    expect(errorDetail(() => doc.absorbTableCell({ anchorParagraphId: ids[2]!, absorbSide: 'left' }, ctx)).feature).toBe('revisionContext');
    expect(ctx.idState.nextId).toBe(nextId);
    expect(await xml(doc)).toBe(before);

    const { doc: illegal, ids: illegalIds } = await loaded();
    const illegalBefore = await xml(illegal);
    expect(errorDetail(() => illegal.splitTableCell({ anchorParagraphId: illegalIds[0]!, splitColumnIndex: 1, existingSide: 'left', newCellText: 'bad\u0000text' })).feature).toBe('newCellText');
    expect(await xml(illegal)).toBe(illegalBefore);
  });

  test.openspec('[SDX-TABLECELL-05] unaffected cell content and identities survive')('preserves neighboring XML and repairs a range cut by absorption', async () => {
    const { doc, ids } = await loaded();
    const middle = doc.getParagraphs()[2]!;
    const right = doc.getParagraphs()[3]!;
    const before = await xml(doc);
    const rightXml = before.match(/<w:tc><w:tcPr><w:tcW w:w="300" w:type="dxa"\/><\/w:tcPr>.*?<\/w:tc>/s)?.[0];
    expect(rightXml).toBeDefined();
    doc.splitTableCell({ anchorParagraphId: ids[0]!, splitColumnIndex: 1, existingSide: 'left', newCellText: 'Fresh' });
    expect(doc.getParagraphs()).toContain(middle);
    expect(doc.getParagraphs()).toContain(right);
    expect(await xml(doc)).toContain(rightXml!);

    const rangeBody = BODY.replace('<w:r><w:t>Middle</w:t></w:r>', '<w:commentRangeStart w:id="9"/><w:r><w:t>Middle</w:t></w:r>')
      .replace('<w:r><w:t>Right</w:t></w:r>', '<w:commentRangeEnd w:id="9"/><w:r><w:t>Right</w:t></w:r>');
    const { doc: ranged, ids: rangeIds } = await loaded(rangeBody);
    ranged.absorbTableCell({ anchorParagraphId: rangeIds[2]!, absorbSide: 'left' });
    expect(await xml(ranged)).not.toContain('commentRangeEnd w:id="9"');
    expect(getDirectChildrenByName(rows(ranged)[1]!.cells[0]!.element, 'p')).toHaveLength(1);

    const crossRow = BODY.replace('<w:r><w:t>Heading</w:t></w:r>', '<w:bookmarkStart w:id="77" w:name="cut"/><w:r><w:t>Heading</w:t></w:r>')
      .replace('<w:r><w:t>Middle</w:t></w:r>', '<w:r><w:t>Middle</w:t></w:r><w:bookmarkEnd w:id="77"/>');
    const { doc: cross, ids: crossIds } = await loaded(crossRow);
    cross.absorbTableCell({ anchorParagraphId: crossIds[2]!, absorbSide: 'left' });
    expect(await xml(cross)).not.toContain('w:name="cut"');
  });

  test('keeps exported core functions transactional on malformed widths', async () => {
    const { doc, ids } = await loaded(BODY.replace('<w:gridCol w:w="200"/>', '<w:gridCol w:w="bad"/>'));
    const source = doc.getDocumentXmlClone();
    const before = serializeXml(source);
    expect(errorDetail(() => splitCore(source, { anchorParagraphId: ids[0]!, splitColumnIndex: 1, existingSide: 'left', newCellText: '' })).feature).toBe('width');
    expect(serializeXml(source)).toBe(before);
    expect(errorDetail(() => absorbCore(source, { anchorParagraphId: ids[2]!, absorbSide: 'left' })).feature).toBe('width');
    expect(serializeXml(source)).toBe(before);

    for (const [body, operation] of [
      [BODY.replace('<w:tcW w:w="600" w:type="dxa"/>', '<w:tcW w:w="600" w:type="dxa"/><w:tcW w:w="7" w:type="dxa"/>'), 'split'],
      [BODY.replace('<w:tcW w:w="100" w:type="dxa"/>', '<w:tcW w:w="100" w:type="dxa"/><w:tcW w:w="7" w:type="dxa"/>'), 'absorb'],
    ] as const) {
      const { doc: duplicate, ids: duplicateIds } = await loaded(body);
      const duplicateXml = duplicate.getDocumentXmlClone();
      const unchanged = serializeXml(duplicateXml);
      const result = operation === 'split'
        ? errorDetail(() => splitCore(duplicateXml, { anchorParagraphId: duplicateIds[0]!, splitColumnIndex: 1, existingSide: 'left', newCellText: '' }))
        : errorDetail(() => absorbCore(duplicateXml, { anchorParagraphId: duplicateIds[2]!, absorbSide: 'left' }));
      expect(result.feature).toBe('width');
      expect(serializeXml(duplicateXml)).toBe(unchanged);
    }
  });
});
