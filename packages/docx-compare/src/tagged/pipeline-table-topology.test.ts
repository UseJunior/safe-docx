import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import { DocxArchive, DocxDocument, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { compareDocuments, UnsupportedTableTopologyComparisonError } from '../index.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { bodyTableFootprint } from './tableTopologyGuard.js';

const TEST_FEATURE = 'Table Topology Comparison';
const test = testAllure.epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.17' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.12' },
  );
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const schemaScript = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const grid = (count: number, width = 1000) => `<w:tblGrid>${Array(count).fill(`<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`;
const row = (texts: string[]) => `<w:tr>${texts.map((text) => `<w:tc>${paragraph(text)}</w:tc>`).join('')}</w:tr>`;
const table = (columns: number, rows: string[]) => `<w:tbl><w:tblPr/>${grid(columns)}${rows.join('')}</w:tbl>`;
const twoRows = [row(['A', 'B']), row(['C', 'D'])];
const docx = (body: string) => buildDocxFromBodyXml(body);
const xml = async (buffer: Buffer) => (await DocxArchive.load(buffer)).getDocumentXml();

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-comptable-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertProjections(original: Buffer, revised: Buffer, compared: Buffer): Promise<void> {
  const source = await xml(original);
  const target = await xml(revised);
  const output = await xml(compared);
  const expectedAccept = bodyTableFootprint(acceptAllChanges(target));
  const expectedReject = bodyTableFootprint(rejectAllChanges(source));
  expect(bodyTableFootprint(acceptAllChanges(output))).toBe(expectedAccept);
  expect(bodyTableFootprint(rejectAllChanges(output))).toBe(expectedReject);
  const accepted = await DocxDocument.load(compared);
  const rejected = await DocxDocument.load(compared);
  await accepted.acceptChanges();
  await rejected.rejectChanges();
  expect(bodyTableFootprint(await xml((await accepted.toBuffer()).buffer))).toBe(expectedAccept);
  expect(bodyTableFootprint(await xml((await rejected.toBuffer()).buffer))).toBe(expectedReject);
}

describe('main-body table comparison topology', () => {
  test.openspec('[SDX-COMPTABLE-01] whole-row insertion and deletion remain native')(
    'keeps native whole-row revisions and exact structural projections', async () => {
      const original = await docx(table(2, twoRows));
      const revised = await docx(table(2, [...twoRows, row(['E', 'F'])]));
      for (const [before, after, kind] of [
        [original, revised, 'ins'],
        [revised, original, 'del'],
      ] as const) {
        const result = await compareDocuments(before, after);
        const output = await xml(result.document);
        const parsed = parseXml(output);
        const markers = Array.from(parsed.getElementsByTagNameNS(W_NS, kind)).filter((element) =>
          element.parentNode?.nodeName === 'w:trPr');
        expect(markers).toHaveLength(1);
        expect(result.stats[kind === 'ins' ? 'insertedTableRows' : 'deletedTableRows']).toBe(1);
        await assertProjections(before, after, result.document);
        await assertSchema(result.document);
      }
    },
  );

  test.openspec('[SDX-COMPTABLE-02] changed grid topology fails closed')(
    'refuses changed column count and width before publishing a DOCX', async () => {
      const original = await docx(table(2, twoRows));
      const added = await docx(table(3, [row(['A', 'X', 'B']), row(['C', 'Y', 'D'])]));
      await expect(compareDocuments(original, added)).rejects.toMatchObject({
        name: 'UnsupportedTableTopologyComparisonError', feature: 'tblGrid', tableIndex: 0, columnIndex: 2,
      });
      const widened = await docx(table(2, twoRows).replace('w:w="1000"', 'w:w="2000"'));
      await expect(compareDocuments(original, widened)).rejects.toMatchObject({
        name: 'UnsupportedTableTopologyComparisonError', feature: 'tblGridWidth', tableIndex: 0, columnIndex: 0,
      });
    },
  );

  test.openspec('[SDX-COMPTABLE-03] individual-cell topology fails closed')(
    'refuses a horizontal cell merge in one matched row', async () => {
      const original = await docx(table(2, twoRows));
      const merged = await docx(table(2, [twoRows[0]!,
        `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${paragraph('C')}</w:tc></w:tr>`,
      ]));
      await expect(compareDocuments(original, merged)).rejects.toBeInstanceOf(UnsupportedTableTopologyComparisonError);
      await expect(compareDocuments(original, merged)).rejects.toMatchObject({ feature: 'cellCount', tableIndex: 0, rowIndex: 1 });
    },
  );

  test.openspec('[SDX-COMPTABLE-04] ordinary table content remains comparable')(
    'keeps ordinary text redlines and unusual but structurally unchanged row shapes', async () => {
      const cases = [
        [table(2, twoRows), table(2, [row(['AA', 'B']), twoRows[1]!])],
        [table(1, [`<w:tr><w:tblPrEx/>${row(['A']).slice('<w:tr>'.length)}`]),
          table(1, [`<w:tr><w:tblPrEx/>${row(['AA']).slice('<w:tr>'.length)}`])],
        [table(1, [`<w:sdt><w:sdtPr/><w:sdtContent>${row(['A'])}</w:sdtContent></w:sdt>`]),
          table(1, [`<w:sdt><w:sdtPr/><w:sdtContent>${row(['AA'])}</w:sdtContent></w:sdt>`])],
      ];
      for (const [beforeBody, afterBody] of cases) {
        const before = await docx(beforeBody!);
        const after = await docx(afterBody!);
        const result = await compareDocuments(before, after);
        await assertSchema(result.document);
      }
    },
  );

  test.openspec('[SDX-COMPTABLE-04] ordinary table content remains comparable')(
    'treats omitted and explicit merge-continuation values as the same topology', async () => {
      const start = row(['Top']).replace('<w:tc>',
        '<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>');
      const continuation = row(['Bottom']).replace('<w:tc>',
        '<w:tc><w:tcPr><w:vMerge/></w:tcPr>');
      const explicit = continuation.replace('<w:vMerge/>', '<w:vMerge w:val="continue"/>');
      const original = await docx(table(1, [start, continuation]));
      const revised = await docx(table(1, [start.replace('Top', 'Topped'), explicit]));
      const result = await compareDocuments(original, revised);
      expect(result.stats.insertedTableRows).toBe(0);
      expect(result.stats.deletedTableRows).toBe(0);
      await assertProjections(original, revised, result.document);
      await assertSchema(result.document);
      const changed = await docx(table(1, [start, explicit.replace('continue', 'restart')]));
      await expect(compareDocuments(original, changed)).rejects.toMatchObject({ feature: 'vMerge' });
    },
  );

  test.openspec('[SDX-COMPTABLE-05] row counts are independent of text ranges')(
    'counts generated nested and whole-table rows but excludes a preserved input marker', async () => {
      const preExisting = row(['A', 'B']).replace('<w:tr>',
        '<w:tr><w:trPr><w:ins w:id="90" w:author="Earlier"/></w:trPr>');
      const before = await docx(table(2, [preExisting, twoRows[1]!]));
      const after = await docx(table(2, [preExisting, twoRows[1]!, row(['E', 'F'])]));
      const result = await compareDocuments(before, after);
      expect(result.stats.insertedTableRows).toBe(1);
      expect(result.stats.insertedRanges).toBeGreaterThan(1);
      const parsed = parseXml(await xml(result.document));
      expect(Array.from(parsed.getElementsByTagNameNS(W_NS, 'ins')).filter((element) =>
        element.parentNode?.nodeName === 'w:trPr')).toHaveLength(2);
    },
  );

  test.openspec('[SDX-COMPTABLE-06] unmatched whole tables use native row revisions')(
    'inserts and deletes whole tables, including nested tables, with inverse structures', async () => {
      const nested = table(1, [`<w:tr><w:tc>${paragraph('Outer')}${table(1, [row(['Inner'])])}<w:p/></w:tc></w:tr>`]);
      for (const addedBody of [table(2, twoRows), nested]) {
        const base = await docx(paragraph('Before'));
        const withTable = await docx(paragraph('Before') + addedBody);
        for (const [before, after, kind] of [
          [base, withTable, 'ins'],
          [withTable, base, 'del'],
        ] as const) {
          const result = await compareDocuments(before, after);
          const output = await xml(result.document);
          const parsed = parseXml(output);
          const rows = Array.from(parsed.getElementsByTagNameNS(W_NS, 'tr'));
          expect(Array.from(parsed.getElementsByTagNameNS(W_NS, kind)).filter((element) =>
            element.parentNode?.nodeName === 'w:trPr')).toHaveLength(rows.length);
          expect(result.stats[kind === 'ins' ? 'insertedTableRows' : 'deletedTableRows']).toBe(rows.length);
          expect(output).not.toMatch(/<w:(ins|del)[^>]*><w:tbl>/);
          await assertProjections(before, after, result.document);
          await assertSchema(result.document);
        }
      }
    },
  );

  test.openspec('[SDX-COMPTABLE-06] unmatched whole tables use native row revisions')(
    'removes only the newly inserted table beside an existing or already-empty table', async () => {
      const existing = table(1, [row(['Existing'])]);
      const inserted = table(1, [row(['Inserted'])]);
      for (const baseBody of [existing, table(1, []) + existing]) {
        const before = await docx(baseBody + paragraph('After'));
        const after = await docx(inserted + baseBody + paragraph('After'));
        const result = await compareDocuments(before, after);
        expect(result.stats.insertedTableRows).toBe(1);
        await assertProjections(before, after, result.document);
        await assertSchema(result.document);
      }
    },
  );

  test.openspec('[SDX-COMPTABLE-06] unmatched whole tables use native row revisions')(
    'keeps a wrapped surviving row when an adjacent direct row is deleted', async () => {
      const wrapped = `<w:sdt><w:sdtPr/><w:sdtContent>${row(['Survivor'])}</w:sdtContent></w:sdt>`;
      const original = await docx(table(1, [wrapped, row(['Delete me'])]));
      const revised = await docx(table(1, [wrapped]));
      const result = await compareDocuments(original, revised);
      expect(result.stats.deletedTableRows).toBe(1);
      await assertProjections(original, revised, result.document);
      await assertSchema(result.document);
    },
  );

  test.openspec('[SDX-COMPTABLE-06] unmatched whole tables use native row revisions')(
    'removes an emptied nested table without removing its surviving outer row', async () => {
      const outer = (inner: string) => table(1, [
        `<w:tr><w:tc>${paragraph('Outer')}${inner}<w:p/></w:tc></w:tr>`,
      ]);
      const original = await docx(outer(table(1, [row(['Inner'])])));
      const revised = await docx(outer(''));
      const result = await compareDocuments(original, revised);
      expect(result.stats.deletedTableRows).toBe(1);
      await assertProjections(original, revised, result.document);
      await assertSchema(result.document);
    },
  );

  test.openspec('[SDX-COMPTABLE-08] unsupported unmatched table shape fails closed')(
    'refuses a newly added empty or row-wrapped table', async () => {
      const before = await docx(paragraph('Before'));
      const empty = await docx(paragraph('Before') + table(1, []));
      await expect(compareDocuments(before, empty)).rejects.toMatchObject({ feature: 'emptyTable' });
      const wrapped = await docx(paragraph('Before') + table(1, [
        `<w:sdt><w:sdtPr/><w:sdtContent>${row(['A'])}</w:sdtContent></w:sdt>`,
      ]));
      await expect(compareDocuments(before, wrapped)).rejects.toMatchObject({ feature: 'tableContainer' });
    },
  );

  test.openspec('[SDX-COMPTABLE-08] unsupported unmatched table shape fails closed')(
    'rejects a side-only block container around a whole table in either direction', async () => {
      const wrapped = `<w:sdt><w:sdtPr/><w:sdtContent>${table(1, [row(['Inside'])])}</w:sdtContent></w:sdt>`;
      const plain = await docx(paragraph('Outside'));
      const contained = await docx(paragraph('Outside') + wrapped);
      for (const [before, after] of [[plain, contained], [contained, plain]] as const) {
        await expect(compareDocuments(before, after)).rejects.toMatchObject({
          name: 'UnsupportedTableTopologyComparisonError', feature: 'tableContainer', tableIndex: 0,
        });
      }
    },
  );

  test.openspec('[SDX-COMPTABLE-03] individual-cell topology fails closed')(
    'rejects a changed pending cell-topology revision even when geometry is unchanged', async () => {
      const original = await docx(table(1, [row(['A'])]));
      const pending = await docx(table(1, [row(['A']).replace('<w:tc>',
        '<w:tc><w:tcPr><w:cellDel w:id="4"/></w:tcPr>')]));
      await expect(compareDocuments(original, pending)).rejects.toMatchObject({
        feature: 'topologyRevision', tableIndex: 0,
      });
    },
  );

  test.openspec('[SDX-COMPTABLE-03] individual-cell topology fails closed')(
    'locates the changed legacy horizontal-merge cell rather than the first merge cell', async () => {
      const originalRow = row(['A', 'B', 'C'])
        .replace('<w:tc>', '<w:tc><w:tcPr><w:hMerge w:val="restart"/></w:tcPr>')
        .replace('</w:tc><w:tc>', '</w:tc><w:tc><w:tcPr><w:hMerge/></w:tcPr>');
      const revisedRow = originalRow.replace('<w:tc><w:p><w:r><w:t>C',
        '<w:tc><w:tcPr><w:hMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>C');
      await expect(compareDocuments(await docx(table(3, [originalRow])),
        await docx(table(3, [revisedRow])))).rejects.toMatchObject({
        feature: 'hMerge', tableIndex: 0, rowIndex: 0, cellIndex: 2,
      });
    },
  );

  test.openspec('[SDX-COMPTABLE-03] individual-cell topology fails closed')(
    'preserves offset and wrapped-cell diagnostics when direct cell counts change', async () => {
      const original = await docx(table(2, [row(['A', 'B'])]));
      const offset = await docx(table(2, [row(['B']).replace('<w:tr>',
        '<w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>')]));
      await expect(compareDocuments(original, offset)).rejects.toMatchObject({
        feature: 'gridBefore', tableIndex: 0, rowIndex: 0,
      });
      const wrappedCell = row(['A', 'B']).replace('</w:tc><w:tc>',
        '</w:tc><w:sdt><w:sdtPr/><w:sdtContent><w:tc>')
        .replace('</w:tc></w:tr>', '</w:tc></w:sdtContent></w:sdt></w:tr>');
      await expect(compareDocuments(original, await docx(table(2, [wrappedCell]))))
        .rejects.toMatchObject({ feature: 'occupancy', tableIndex: 0, rowIndex: 0, cellIndex: 1 });
    },
  );
});
