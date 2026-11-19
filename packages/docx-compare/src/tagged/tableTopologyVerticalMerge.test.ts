/**
 * A change to a vertical merge (`w:vMerge`) is redlined as a band
 * replacement: the smallest run of rows that holds every merge chain the
 * change touches, in both documents, is published as all of its original
 * rows deleted, immediately followed by all of its revised rows inserted.
 * Each projection then holds whole, unbroken merge chains, and rows outside
 * the band keep their ordinary redline.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.84
 * @see https://github.com/UseJunior/safe-docx/issues/1397
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import { DocxArchive, DocxDocument, parseXml, serializeXml, validateBookmarkIntegrity } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { compareDocuments } from '../index.js';
import { acceptAllChanges, extractTextWithParagraphs, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { bodyTableFootprint } from './tableTopologyGuard.js';
import { REAL_CORPUS_ENV } from '../integration/real-corpus-fixtures.js';

const TEST_FEATURE = 'Table Topology Vertical Merge Band';
const test = testAllure.epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.12' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.17' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.84' },
  );

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const schemaScript = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));

type Merge = '' | 'R' | 'C';

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (content: string, tcPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${tcPr}</w:tcPr>${content}</w:tc>`;
const vMerge = (merge: Merge) =>
  merge === 'R' ? '<w:vMerge w:val="restart"/>' : merge === 'C' ? '<w:vMerge/>' : '';
/** The first cell of a data row: a restart or unmerged cell holds text, a continuation cell an empty paragraph. */
const lead = (text: string, merge: Merge, span = '') =>
  cell(merge === 'C' ? '<w:p/>' : p(text), span + vMerge(merge));
const row = (cells: string[], trPr = '') => `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const plain = (texts: string[]) => row(texts.map((text) => cell(p(text))));
const NAMES = ['Alpha Capital', 'Bravo Partners', 'Charlie Ventures', 'Delta Fund', 'Echo Holdings', 'Foxtrot Trust',
  'Golf Equity', 'Hotel Group', 'India Partners', 'Juliet Fund', 'Kilo Capital', 'Lima Ventures', 'Mike Holdings',
  'November Trust', 'Oscar Equity', 'Papa Group', 'Quebec Partners', 'Romeo Fund', 'Sierra Capital', 'Tango Ventures'];
/** Data row `k` (0-based) with its first cell in merge state `merge`. */
const data = (k: number, merge: Merge, name = NAMES[k]!) =>
  row([lead(`Series ${String.fromCharCode(65 + k)} Investor`, merge), cell(p(name)), cell(p(`${k + 1} Main Street`))]);
const HEADER = plain(['Role', 'Name', 'Notice address']);
const TRAILER = plain(['Company', 'Example Corp.', '500 Market Street']);
const table = (rows: string[]) =>
  '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid>' +
  `${'<w:gridCol w:w="3000"/>'.repeat(3)}</w:tblGrid>${rows.join('')}</w:tbl>`;
/** A table of header, the data rows in `merges` order, and a trailer. */
const tableOf = (merges: Merge[]) => table([HEADER, ...merges.map((merge, k) => data(k, merge)), TRAILER]);
const intro = 'The parties agree to the schedule below, which lists each investor and its notice address.';
const editedIntro = intro.replace('agree to', 'acknowledge');
const body = (tableXml: string, introText = intro) =>
  p(introText) + tableXml + p('After the table, a closing paragraph.');

const docx = (xml: string) => buildDocxFromBodyXml(xml);
const xmlOf = async (buffer: Buffer) => (await DocxArchive.load(buffer)).getDocumentXml();
const directChildren = (parent: Element, name: string) =>
  Array.from(parent.childNodes).filter((node): node is Element =>
    node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (node as Element).localName === name);

/** Per row of the first table: its `w:trPr` revision marker (`del`, `ins` or ``) and whether its content carries a revision. */
function rowMarkers(xml: string): Array<{ marker: string; contentRevisions: number }> {
  const tbl = parseXml(xml).getElementsByTagNameNS(W_NS, 'tbl')[0]!;
  return directChildren(tbl, 'tr').map((tr) => {
    const trPr = directChildren(tr, 'trPr')[0];
    const marker = trPr ? Array.from(trPr.childNodes)
      .filter((node): node is Element => node.nodeType === 1 && ['ins', 'del'].includes((node as Element).localName))
      .map((node) => node.localName).join(',') : '';
    const contentRevisions = Array.from(tr.getElementsByTagNameNS(W_NS, 'tc'))
      .reduce((count, tc) => count + tc.getElementsByTagNameNS(W_NS, 'ins').length
        + tc.getElementsByTagNameNS(W_NS, 'del').length, 0);
    return { marker, contentRevisions };
  });
}

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-vmerge-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Accept-all projects to the revised document and reject-all to the original,
 * through the comparison acceptor and docx-core `acceptChanges`/`rejectChanges`,
 * on text and on the body table footprint (which carries every cell's
 * `w:vMerge` state).
 */
async function assertParity(original: Buffer, revised: Buffer, compared: Buffer): Promise<void> {
  const output = await xmlOf(compared);
  const accepted = await DocxDocument.load(compared);
  const rejected = await DocxDocument.load(compared);
  await accepted.acceptChanges();
  await rejected.rejectChanges();
  const expectedAccept = acceptAllChanges(await xmlOf(revised));
  const expectedReject = rejectAllChanges(await xmlOf(original));
  for (const [label, projected, expected] of [
    ['comparison accept', acceptAllChanges(output), expectedAccept],
    ['docx-core accept', await xmlOf((await accepted.toBuffer()).buffer), expectedAccept],
    ['comparison reject', rejectAllChanges(output), expectedReject],
    ['docx-core reject', await xmlOf((await rejected.toBuffer()).buffer), expectedReject],
  ] as const) {
    expect(extractTextWithParagraphs(projected), label).toBe(extractTextWithParagraphs(expected));
    expect(bodyTableFootprint(projected), label).toEqual(bodyTableFootprint(expected));
  }
}

async function compareChecked(originalBody: string, revisedBody: string) {
  const original = await docx(originalBody);
  const revised = await docx(revisedBody);
  const result = await compareDocuments(original, revised);
  await assertParity(original, revised, result.document);
  await assertSchema(result.document);
  return { original, revised, result, xml: await xmlOf(result.document) };
}

/** Header, four data rows, trailer: the expected row markers in the redline. */
interface MergeCase {
  readonly name: string;
  readonly original: string;
  readonly revised: string;
  readonly markers: string[];
  readonly deletedRows: number;
  readonly insertedRows: number;
}

const band = (deleted: number, inserted: number, before = 1, after = 1) => [
  ...Array<string>(before).fill(''), ...Array<string>(deleted).fill('del'),
  ...Array<string>(inserted).fill('ins'), ...Array<string>(after).fill('')];

const CASES: MergeCase[] = [
  {
    // The issue's reproduction, in a longer table: a two-row merge extended to a third row.
    name: 'a two-row merge extended to three rows',
    original: tableOf(['R', 'C', '', '']), revised: tableOf(['R', 'C', 'C', '']),
    markers: band(3, 3, 1, 2), deletedRows: 3, insertedRows: 3,
  },
  {
    // The third row's text changes beyond pairing, so it is an unmatched
    // deletion plus insertion; the band still takes the whole merge.
    name: 'a merge extended into a row whose text is rewritten',
    original: tableOf(['R', 'C', '', '']),
    revised: table([HEADER, data(0, 'R'), data(1, 'C'),
      row([lead('', 'C'), cell(p('Zulu Unrelated Holdings Limited')), cell(p('Ninety Nine Elm Avenue Suite'))]),
      data(3, ''), TRAILER]),
    markers: band(3, 3, 1, 2), deletedRows: 3, insertedRows: 3,
  },
  {
    name: 'a three-row merge shrunk to two rows',
    original: tableOf(['R', 'C', 'C', '']), revised: tableOf(['R', 'C', '', '']),
    markers: band(3, 3, 1, 2), deletedRows: 3, insertedRows: 3,
  },
  {
    name: 'two unmerged cells merged vertically',
    original: tableOf(['', '', '', '']), revised: tableOf(['', 'R', 'C', '']),
    markers: band(2, 2, 2, 2), deletedRows: 2, insertedRows: 2,
  },
  {
    name: 'a two-row merge split into two cells',
    original: tableOf(['', 'R', 'C', '']), revised: tableOf(['', '', '', '']),
    markers: band(2, 2, 2, 2), deletedRows: 2, insertedRows: 2,
  },
  {
    name: 'a three-row merge split into a two-row merge and a single cell',
    original: tableOf(['R', 'C', 'C', '']), revised: tableOf(['R', 'C', 'R', '']),
    markers: band(3, 3, 1, 2), deletedRows: 3, insertedRows: 3,
  },
  {
    // A vertical merge combined with a horizontal span on the same cell.
    name: 'a vertical merge combined with a horizontal span',
    original: tableOf(['', '', '', '']),
    revised: table([HEADER, data(0, ''),
      row([lead('Series B Investor Bravo Partners', 'R', '<w:gridSpan w:val="2"/>'), cell(p('2 Main Street'))]),
      row([lead('', 'C', '<w:gridSpan w:val="2"/>'), cell(p('3 Main Street'))]),
      data(3, ''), TRAILER]),
    markers: band(2, 2, 2, 2), deletedRows: 2, insertedRows: 2,
  },
  {
    // Deleting the row where a merge starts: the merged cell's text goes
    // with it, and the next row's empty cell restarts the merge.
    name: 'deleting the row where a merge starts',
    original: tableOf(['R', 'C', 'C', '']),
    revised: table([HEADER,
      row([cell('<w:p/>', vMerge('R')), cell(p(NAMES[1]!)), cell(p('2 Main Street'))]),
      data(2, 'C'), data(3, ''), TRAILER]),
    markers: band(3, 2, 1, 2), deletedRows: 3, insertedRows: 2,
  },
  {
    // Deleting the last continuation row of a two-row merge leaves a single cell.
    name: 'deleting the last row of a two-row merge',
    original: tableOf(['R', 'C', '', '']),
    revised: table([HEADER, data(0, ''), data(2, ''), data(3, ''), TRAILER]),
    markers: band(2, 1, 1, 3), deletedRows: 2, insertedRows: 1,
  },
];

describe('a change to a vertical merge', () => {
  for (const entry of CASES) {
    test.openspec('[SDX-COMPTABLE-10] a vertical-merge change emits a native band replacement')(
      `redlines ${entry.name} as the band's old rows deleted then its new rows inserted`, async () => {
        const { result, xml } = await compareChecked(body(entry.original), body(entry.revised, editedIntro));
        const rows = rowMarkers(xml);
        expect(rows.map((item) => item.marker)).toEqual(entry.markers);
        // Rows outside the band are untouched.
        rows.forEach((item, index) => {
          if (item.marker === '') expect(item.contentRevisions, `row ${index}`).toBe(0);
        });
        expect(result.stats.deletedTableRows).toBe(entry.deletedRows);
        expect(result.stats.insertedTableRows).toBe(entry.insertedRows);
        // The ordinary body edit keeps its word-level redline.
        const first = parseXml(xml).getElementsByTagNameNS(W_NS, 'p')[0]!;
        expect(Array.from(first.getElementsByTagNameNS(W_NS, 'delText')).map((node) => node.textContent).join(''))
          .toContain('agree to');
      },
    );
  }

  test.openspec('[SDX-COMPTABLE-10] a vertical-merge change emits a native band replacement')(
    'deletes a merge continuation row as a plain whole-row deletion when no other row changes', async () => {
      // The merge stays whole on both sides (rows 1-3 become rows 1-2), so no
      // band is needed: a whole-row deletion projects to both chains.
      const { result, xml } = await compareChecked(
        body(tableOf(['R', 'C', 'C', ''])),
        body(table([HEADER, data(0, 'R'), data(2, 'C'), data(3, ''), TRAILER])),
      );
      expect(rowMarkers(xml).map((item) => item.marker)).toEqual(['', '', 'del', '', '', '']);
      expect([result.stats.deletedTableRows, result.stats.insertedTableRows]).toEqual([1, 0]);
    },
  );

  test.openspec('[SDX-COMPTABLE-10] a vertical-merge change emits a native band replacement')(
    'keeps an ordinary text edit in the row next to the band as an in-row redline', async () => {
      const { xml } = await compareChecked(
        body(tableOf(['R', 'C', '', ''])),
        body(table([HEADER, data(0, 'R'), data(1, 'C'), data(2, 'C'), data(3, '', 'Delta Fund II'), TRAILER])),
      );
      const rows = rowMarkers(xml);
      expect(rows.map((item) => item.marker)).toEqual(band(3, 3, 1, 2));
      // Row 4 (after the band) carries its own word-level edit and no row marker.
      expect(rows[7]!.contentRevisions).toBeGreaterThan(0);
      expect(rows[8]!.contentRevisions).toBe(0);
    },
  );

  test.openspec('[SDX-COMPTABLE-10] a vertical-merge change emits a native band replacement')(
    'replaces only the rows of the changed merge in a twenty-row table', async () => {
      const originalMerges: Merge[] = Array<Merge>(20).fill('');
      originalMerges[2] = 'R';
      originalMerges[3] = 'C';
      // An unrelated merge elsewhere in the table must stay untouched.
      originalMerges[10] = 'R';
      originalMerges[11] = 'C';
      originalMerges[12] = 'C';
      const revisedMerges = [...originalMerges];
      revisedMerges[3] = '';
      const { original, result, xml } = await compareChecked(body(tableOf(originalMerges)), body(tableOf(revisedMerges)));
      // Header + data rows 0-1 untouched, data rows 2-3 replaced, the rest untouched.
      expect(rowMarkers(xml).map((item) => item.marker)).toEqual(band(2, 2, 3, 17));
      expect([result.stats.deletedTableRows, result.stats.insertedTableRows]).toEqual([2, 2]);
      // Unchanged rows outside the band are byte-equivalent to the source rows.
      const rowsOf = (documentXml: string) =>
        directChildren(parseXml(documentXml).getElementsByTagNameNS(W_NS, 'tbl')[0]!, 'tr').map(String);
      const sourceRows = rowsOf(await xmlOf(original));
      const outputRows = rowsOf(xml);
      expect(outputRows.slice(0, 3)).toEqual(sourceRows.slice(0, 3));
      expect(outputRows.slice(7)).toEqual(sourceRows.slice(5));
    },
  );

  test.openspec('[SDX-COMPTABLE-10] a vertical-merge change emits a native band replacement')(
    'replaces two separate merge changes in one table as two bands with the row between them untouched', async () => {
      const { result, xml } = await compareChecked(body(tableOf(['R', 'C', '', '', 'R', 'C'])),
        body(tableOf(['R', 'C', 'C', '', '', ''])));
      expect(rowMarkers(xml).map((item) => item.marker))
        .toEqual(['', 'del', 'del', 'del', 'ins', 'ins', 'ins', '', 'del', 'del', 'ins', 'ins', '']);
      expect([result.stats.deletedTableRows, result.stats.insertedTableRows]).toEqual([5, 5]);
    },
  );

  test.openspec('[SDX-COMPTABLE-10] a vertical-merge change emits a native band replacement')(
    'replaces a merge whose restart cell holds a nested table without corrupting either table', async () => {
      const nested = '<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/>' +
        '<w:gridCol w:w="1000"/></w:tblGrid>' +
        `${row([cell(p('Shares')), cell(p('1,000'))])}${row([cell(p('Price')), cell(p('$1.00'))])}</w:tbl><w:p/>`;
      const withNested = (merges: Merge[]) => table([HEADER,
        row([cell(p('Series A Investor') + nested, vMerge(merges[0]!)), cell(p(NAMES[0]!)), cell(p('1 Main Street'))]),
        ...merges.slice(1).map((merge, k) => data(k + 1, merge)), TRAILER]);
      const { result, xml } = await compareChecked(body(withNested(['R', 'C', '', ''])),
        body(withNested(['R', 'C', 'C', '']), editedIntro));
      expect(rowMarkers(xml).map((item) => item.marker)).toEqual(band(3, 3, 1, 2));
      expect([result.stats.deletedTableRows, result.stats.insertedTableRows]).toEqual([3, 3]);
    },
  );
});

/** Unmatched and duplicate boundary counts for one projection. */
function integrity(xml: string): number[] {
  const report = validateBookmarkIntegrity(xml);
  return [report.unmatchedStartIds, report.unmatchedEndIds, report.duplicateStartIds, report.duplicateEndIds]
    .map((ids) => ids.length);
}

describe('bookmarks and comments that cross the edge of a band', () => {
  const start = '<w:bookmarkStart w:id="7" w:name="CrossBand"/>';
  const end = '<w:bookmarkEnd w:id="7"/>';
  /** Data row `k` with `before`/`after` markup around its name text. */
  const marked = (k: number, merge: Merge, before = '', after = '') =>
    row([lead(`Series ${String.fromCharCode(65 + k)} Investor`, merge),
      cell(`<w:p>${before}<w:r><w:t xml:space="preserve">${NAMES[k]}</w:t></w:r>${after}</w:p>`),
      cell(p(`${k + 1} Main Street`))]);

  test.openspec('[SDX-COMPTABLE-10] a vertical-merge change emits a native band replacement')(
    'keeps a bookmark that crosses into or out of a band as balanced as its source in every projection', async () => {
      const extend = (rows: (merges: Merge[]) => string[], before = '', after = ''): [string, string] =>
        [before + table(rows(['R', 'C', '', ''])) + after, before + table(rows(['R', 'C', 'C', ''])) + after];
      const cases: Array<[string, [string, string]]> = [
        // From the row above the band (the header) into the band.
        ['from the row above into the band', extend((m) => [
          HEADER.replace('<w:p>', `<w:p>${start}`), marked(0, m[0]!, '', end), data(1, m[1]!), data(2, m[2]!),
          data(3, m[3]!), TRAILER])],
        // From the band into the row below it.
        ['from the band into the row below', extend((m) => [
          HEADER, marked(0, m[0]!, start), data(1, m[1]!), data(2, m[2]!), marked(3, m[3]!, '', end), TRAILER])],
        // Across the whole band, from body text before the table to the row below the band.
        ['across the whole band', extend((m) => [
          HEADER, data(0, m[0]!), data(1, m[1]!), data(2, m[2]!), marked(3, m[3]!, '', end), TRAILER],
        `<w:p>${start}<w:r><w:t>Before</w:t></w:r></w:p>`)],
        // From the band into body text after the table.
        ['from the band into the body', extend((m) => [
          HEADER, data(0, m[0]!), marked(1, m[1]!, start), data(2, m[2]!), data(3, m[3]!), TRAILER],
        '', `<w:p><w:r><w:t>After</w:t></w:r>${end}</w:p>`)],
      ];
      for (const [name, [originalBody, revisedBody]] of cases) {
        const original = await docx(originalBody);
        const revised = await docx(revisedBody);
        const result = await compareDocuments(original, revised);
        await assertParity(original, revised, result.document);
        await assertSchema(result.document);
        const output = await xmlOf(result.document);
        expect(rowMarkers(output).map((item) => item.marker), name).toEqual(band(3, 3, 1, 2));
        const accepted = await DocxDocument.load(result.document);
        const rejected = await DocxDocument.load(result.document);
        await accepted.acceptChanges();
        await rejected.rejectChanges();
        for (const [projection, projected, expected] of [
          ['comparison accept', acceptAllChanges(output), integrity(acceptAllChanges(await xmlOf(revised)))],
          ['comparison reject', rejectAllChanges(output), integrity(rejectAllChanges(await xmlOf(original)))],
          ['docx-core accept', await xmlOf((await accepted.toBuffer()).buffer), [0, 0, 0, 0]],
          ['docx-core reject', await xmlOf((await rejected.toBuffer()).buffer), [0, 0, 0, 0]],
        ] as const) {
          expect(integrity(projected), `${name}: ${projection}`).toEqual(expected);
        }
      }
    },
    60000,
  );

  test.openspec('[SDX-COMPTABLE-10] a vertical-merge change emits a native band replacement')(
    'keeps a table-level bookmark between band rows once, whether it is kept, removed or inserted', async () => {
      const tableStart = '<w:bookmarkStart w:id="8" w:name="TableLevel"/>';
      const tableEnd = '<w:bookmarkEnd w:id="8"/>';
      // Between data rows 0 and 1, and between data rows 2 and 3: inside and just after the band.
      const rows = (merges: Merge[], marked: boolean) => table([HEADER, data(0, merges[0]!),
        ...(marked ? [tableStart] : []), data(1, merges[1]!), data(2, merges[2]!),
        ...(marked ? [tableEnd] : []), data(3, merges[3]!), TRAILER]);
      for (const [name, originalMarked, revisedMarked] of [
        ['kept', true, true], ['removed', true, false], ['inserted', false, true]] as const) {
        const { original, revised, xml } = await compareChecked(body(rows(['R', 'C', '', ''], originalMarked)),
          body(rows(['R', 'C', 'C', ''], revisedMarked)));
        expect(rowMarkers(xml).map((item) => item.marker), name).toEqual(band(3, 3, 1, 2));
        const starts = parseXml(xml).getElementsByTagNameNS(W_NS, 'bookmarkStart');
        expect(Array.from(starts).filter((node) => node.getAttributeNS(W_NS, 'name') === 'TableLevel'), name)
          .toHaveLength(originalMarked || revisedMarked ? 1 : 0);
        for (const [projection, projected, source] of [
          ['accept', acceptAllChanges(xml), acceptAllChanges(await xmlOf(revised))],
          ['reject', rejectAllChanges(xml), rejectAllChanges(await xmlOf(original))],
        ] as const) {
          expect(integrity(projected), `${name}: ${projection}`).toEqual(integrity(source));
          const names = (documentXml: string) => Array.from(parseXml(documentXml).getElementsByTagNameNS(W_NS, 'bookmarkStart'))
            .map((node) => node.getAttributeNS(W_NS, 'name'));
          expect(names(projected), `${name}: ${projection}`).toEqual(names(source));
        }
      }
    },
    60000,
  );

  test.openspec('[SDX-COMPTABLE-10] a vertical-merge change emits a native band replacement')(
    'pins the comment anchors of a comment that crosses the edge of a band', async () => {
      const commentStart = '<w:commentRangeStart w:id="3"/>';
      const commentEnd = '<w:commentRangeEnd w:id="3"/><w:r><w:commentReference w:id="3"/></w:r>';
      const rows = (m: Merge[]) => [HEADER, marked(0, m[0]!, commentStart), data(1, m[1]!), data(2, m[2]!),
        marked(3, m[3]!, '', commentEnd), TRAILER];
      const { xml } = await compareChecked(body(table(rows(['R', 'C', '', '']))),
        body(table(rows(['R', 'C', 'C', '']))));
      const document = parseXml(xml);
      const ids = (name: string) => Array.from(document.getElementsByTagNameNS(W_NS, name))
        .map((node) => node.getAttributeNS(W_NS, 'id'));
      // Each projection holds one start, one end and one reference. The
      // combined redline holds the start in both the deleted and the inserted
      // copy of its row under one id: the duplicated-anchor shape that every
      // whole-row replacement already has on main (#1227, #1396), which needs
      // comment-identity splitting in the auxiliary-id work (#1333).
      expect(ids('commentRangeStart')).toEqual(['3', '3']);
      expect(ids('commentRangeEnd')).toEqual(['3']);
      expect(ids('commentReference')).toEqual(['3']);
      for (const projected of [acceptAllChanges(xml), rejectAllChanges(xml)]) {
        const projectedDocument = parseXml(projected);
        for (const name of ['commentRangeStart', 'commentRangeEnd', 'commentReference']) {
          expect(projectedDocument.getElementsByTagNameNS(W_NS, name).length, name).toBe(1);
        }
      }
    },
  );
});

const TABLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const TEXT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';

/**
 * LibreOffice's reading of every table: per row, each cell's text, column
 * span and row span, covered cells included, so a broken merge chain shows.
 */
function odtTables(content: string): string[][][] {
  const parsed = parseXml(content);
  return Array.from(parsed.getElementsByTagNameNS(TABLE_NS, 'table')).map((tbl) =>
    Array.from(tbl.getElementsByTagNameNS(TABLE_NS, 'table-row')).map((tr) =>
      Array.from(tr.childNodes)
        .filter((node): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === TABLE_NS
          && ['table-cell', 'covered-table-cell'].includes((node as Element).localName))
        .map((node) => `${node.localName === 'covered-table-cell' ? '(covered)' : ''}${node.textContent ?? ''}`
          + `/${node.getAttributeNS(TABLE_NS, 'number-columns-spanned') || '1'}`
          + `x${node.getAttributeNS(TABLE_NS, 'number-rows-spanned') || '1'}`)));
}

function odtParagraphs(content: string): string[] {
  return Array.from(parseXml(content).getElementsByTagName('*'))
    .filter((node) => node.namespaceURI === TEXT_NS && ['p', 'h'].includes(node.localName))
    .map((node) => node.textContent ?? '');
}

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable LibreOffice or a missing corpus.
const reader = process.env.SAFE_DOCX_TABLE_TOPOLOGY_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice reads vertical-merge band replacements as the source tables', () => {
  test.openspec('[SDX-COMPTABLE-10] a vertical-merge change emits a native band replacement')(
    'accepts and rejects every synthetic band replacement to the revised and original tables', async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const readerCases: Array<{ name: string; original: string; revised: string }> = [...CASES,
        // Shapes published without a band, or beside one, read the same way.
        { name: 'a plain deletion of a merge continuation row', original: tableOf(['R', 'C', 'C', '']),
          revised: table([HEADER, data(0, 'R'), data(2, 'C'), data(3, ''), TRAILER]) },
        { name: 'a band beside an in-row text edit', original: tableOf(['R', 'C', '', '']),
          revised: table([HEADER, data(0, 'R'), data(1, 'C'), data(2, 'C'), data(3, '', 'Delta Fund II'), TRAILER]) },
        { name: 'two separate bands in one table', original: tableOf(['R', 'C', '', '', 'R', 'C']),
          revised: tableOf(['R', 'C', 'C', '', '', '']) }];
      const items = await Promise.all(readerCases.map(async (entry) => {
        const original = await docx(body(entry.original));
        const revised = await docx(body(entry.revised, editedIntro));
        return { original, revised, compared: (await compareDocuments(original, revised)).document };
      }));
      const states = await runLibreOfficeOracle(items.flatMap((item) => [
        { op: 'identity' as const, docx: item.original, saveAs: 'odt' as const },
        { op: 'identity' as const, docx: item.revised, saveAs: 'odt' as const },
        { op: 'accept' as const, docx: item.compared, saveAs: 'odt' as const },
        { op: 'reject' as const, docx: item.compared, saveAs: 'odt' as const },
      ]));
      readerCases.forEach((entry, index) => {
        const [original, revised, accepted, rejected] = states.slice(index * 4, index * 4 + 4).map(odtTables);
        expect(accepted, `${entry.name} accept`).toEqual(revised);
        expect(rejected, `${entry.name} reject`).toEqual(original);
      });
    },
    600000,
  );

  test.openspec('[SDX-COMPTABLE-10] a vertical-merge change emits a native band replacement')(
    'merges two cells vertically in an NVCA investors rights agreement table beside a body edit', async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const corpus = process.env[REAL_CORPUS_ENV];
      const sourcePath = corpus ? join(corpus, 'nvca-investors-rights-agreement', 'source.docx') : '';
      expect(existsSync(sourcePath), `${REAL_CORPUS_ENV} must hold the NVCA corpus`).toBe(true);
      const original = readFileSync(sourcePath);
      const revised = await mergeNvcaGovernanceDeadlines(original);
      const result = await compareDocuments(original, revised);
      await assertParity(original, revised, result.document);
      await assertSchema(result.document);
      expect(result.stats.deletedTableRows).toBe(2);
      expect(result.stats.insertedTableRows).toBe(2);

      const states = await runLibreOfficeOracle([
        { op: 'identity', docx: original, saveAs: 'odt' }, { op: 'identity', docx: revised, saveAs: 'odt' },
        { op: 'accept', docx: result.document, saveAs: 'odt' }, { op: 'reject', docx: result.document, saveAs: 'odt' },
      ]);
      const [originalState, revisedState, acceptedState, rejectedState] = states;
      expect(odtTables(acceptedState!)).toEqual(odtTables(revisedState!));
      expect(odtTables(rejectedState!)).toEqual(odtTables(originalState!));
      const edited = (content: string) => odtParagraphs(content).filter((text) => text.includes('(as amended)')).length;
      expect(edited(acceptedState!)).toBe(edited(revisedState!));
      expect(edited(acceptedState!)).toBeGreaterThan(0);
      expect(edited(rejectedState!)).toBe(0);
    },
    600000,
  );
});

/**
 * Revise the NVCA investors' rights agreement: merge the deadline cells of
 * the first two governance-policy rows into one vertically merged cell, and
 * make an ordinary body edit.
 */
async function mergeNvcaGovernanceDeadlines(original: Buffer): Promise<Buffer> {
  const archive = await DocxArchive.load(original);
  const document = parseXml(await archive.getDocumentXml());
  const governance = Array.from(document.getElementsByTagNameNS(W_NS, 'tbl'))
    .find((tbl) => (tbl.textContent ?? '').includes('Required Governance Policy'))!;
  const rows = directChildren(governance, 'tr');
  const firstPolicy = rows.findIndex((entry) => directChildren(entry, 'tc').length >= 2
    && !(entry.textContent ?? '').includes('Required Governance Policy'));
  const [upper, lower] = [rows[firstPolicy]!, rows[firstPolicy + 1]!];
  const lastCell = (entry: Element) => directChildren(entry, 'tc').at(-1)!;
  const setMerge = (tc: Element, restart: boolean) => {
    const tcPr = directChildren(tc, 'tcPr')[0]!;
    const merge = document.createElementNS(W_NS, 'w:vMerge');
    if (restart) merge.setAttributeNS(W_NS, 'w:val', 'restart');
    // CT_TcPr order: cnfStyle, tcW, gridSpan, hMerge, vMerge, ...
    const after = ['cnfStyle', 'tcW', 'gridSpan', 'hMerge'];
    const anchor = Array.from(tcPr.childNodes).find((node) => node.nodeType === 1
      && !after.includes((node as Element).localName));
    tcPr.insertBefore(merge, anchor ?? null);
  };
  const upperCell = lastCell(upper);
  const lowerCell = lastCell(lower);
  setMerge(upperCell, true);
  setMerge(lowerCell, false);
  // The continuation cell's paragraphs move into the restart cell, as Word does on merge.
  for (const paragraph of directChildren(lowerCell, 'p')) upperCell.appendChild(paragraph);
  lowerCell.appendChild(document.createElementNS(W_NS, 'w:p'));
  const bodyText = Array.from(document.getElementsByTagNameNS(W_NS, 't'))
    .find((text) => (text.textContent ?? '').includes('Investors'))!;
  bodyText.textContent = `${bodyText.textContent} (as amended)`;
  archive.setDocumentXml(serializeXml(document));
  return archive.save();
}
