/**
 * A matched table row that holds a cell-level content control (`w:sdt`
 * wrapping `w:tc`, ECMA-376 Part 1 §17.5.2.32) and whose cell skeleton
 * changes, for example a cell added or removed beside the control, is
 * redlined like any other skeleton change: the original row deleted
 * (`w:trPr/w:del`, §17.13.5.12) immediately followed by the revised row
 * inserted (`w:trPr/w:ins`, §17.13.5.17). Each row keeps its content control
 * whole, and no revision wrapper ever holds a cell.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.32
 * @see https://github.com/UseJunior/safe-docx/issues/1483
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import { XMLSerializer } from '@xmldom/xmldom';
import { DocxArchive, DocxDocument, parseXml, validateBookmarkIntegrity } from '@usejunior/docx-core';
import { buildDocxFromBodyXml, COMPLETE_PAGE_FIELD } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { duplicateRevisionIdsInPackage } from '../testing/revisionIdUniqueness.js';
import { compareDocuments, UnsupportedTableTopologyComparisonError } from '../index.js';
import { acceptAllChanges, extractTextWithParagraphs, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { bodyTableFootprint } from './tableTopologyGuard.js';

const TEST_FEATURE = 'Table Topology Row Replacement';
const test = testAllure.epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.12' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.17' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.32' },
  );

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const serializer = new XMLSerializer();
const serializeXml = (node: Node): string => serializer.serializeToString(node);
const schemaScript = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (content: string, tcPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${tcPr}</w:tcPr>${content}</w:tc>`;
const text = (value: string) => cell(p(value));
const row = (cells: string[], trPr = '') => `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const control = (cells: string[], id = 501, extra = '') =>
  `<w:sdt><w:sdtPr><w:alias w:val="Party"/><w:tag w:val="party"/><w:id w:val="${id}"/>${extra}</w:sdtPr>`
  + `<w:sdtContent>${cells.join('')}</w:sdtContent></w:sdt>`;
const custom = (cells: string[]) => `<w:customXml w:element="party">${cells.join('')}</w:customXml>`;
const table = (rows: string[]) =>
  '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid>' +
  `${'<w:gridCol w:w="3000"/>'.repeat(3)}</w:tblGrid>${rows.join('')}</w:tbl>`;
const intro = 'The parties agree to the schedule below, which lists each signatory and its notice address.';
const editedIntro = intro.replace('agree to', 'acknowledge');
const body = (rows: string[], introText = intro) =>
  p(introText) + table(rows) + p('After the table, a closing paragraph.');
const secondRow = row([text('Delta'), text('Echo'), text('Foxtrot')]);
const AFTER = '<w:gridAfter w:val="1"/>';
const earlierInsertion = '<w:p><w:r><w:t xml:space="preserve">Acme </w:t></w:r>'
  + '<w:ins w:id="90" w:author="Earlier" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Holdings</w:t></w:r></w:ins></w:p>';
const bookmarked = '<w:p><w:bookmarkStart w:id="7" w:name="PartyName"/><w:r><w:t>Acme</w:t></w:r><w:bookmarkEnd w:id="7"/></w:p>';
const bound = '<w:dataBinding w:xpath="/party[1]/name[1]" w:storeItemID="{11111111-2222-3333-4444-555555555555}"/>';

/** [name, original row, revised row]: every other row and paragraph matches except one body edit. */
const CASES: Array<[string, string, string]> = [
  // The issue's reproduction: a cell added beside a cell-level content control.
  ['cell added beside the control', row([control([text('Acme')]), text('Corp')], AFTER),
    row([control([text('Acme')]), text('Corp'), text('Inc')])],
  ['cell removed beside the control', row([control([text('Acme')]), text('Corp'), text('Inc')]),
    row([control([text('Acme')]), text('Corp')], AFTER)],
  ['cell added inside the control', row([control([text('Acme'), text('Corp')])], AFTER),
    row([control([text('Acme'), text('Corp'), text('Inc')])])],
  ['controlled cell merged with its neighbour', row([control([text('Acme')]), text('Corp'), text('Inc')]),
    row([control([cell(p('Acme') + p('Corp'), '<w:gridSpan w:val="2"/>')]), text('Inc')])],
  ['cell added beside a control holding a field', row([control([cell(p('Page') + `<w:p>${COMPLETE_PAGE_FIELD}</w:p>`)]), text('Corp')], AFTER),
    row([control([cell(p('Page') + `<w:p>${COMPLETE_PAGE_FIELD}</w:p>`)]), text('Corp'), text('Inc')])],
  ['cell added beside a control holding a pending insertion', row([control([cell(earlierInsertion)]), text('Corp')], AFTER),
    row([control([cell(earlierInsertion)]), text('Corp'), text('Inc')])],
  ['cell removed beside a control holding a pending insertion', row([control([cell(earlierInsertion)]), text('Corp'), text('Inc')]),
    row([control([cell(earlierInsertion)]), text('Corp')], AFTER)],
  ['cell added beside a data-bound control holding a bookmark', row([control([cell(bookmarked)], 501, bound), text('Corp')], AFTER),
    row([control([cell(bookmarked)], 501, bound), text('Corp'), text('Inc')])],
  ['cell added beside a control in a later column', row([text('Acme'), control([text('Corp')])], AFTER),
    row([text('Acme'), control([text('Corp')]), text('Inc')])],
  ['cell added beside a cell-level custom XML element', row([custom([text('Acme')]), text('Corp')], AFTER),
    row([custom([text('Acme')]), text('Corp'), text('Inc')])],
];

const docx = (xml: string) => buildDocxFromBodyXml(xml);
const xmlOf = async (buffer: Buffer) => (await DocxArchive.load(buffer)).getDocumentXml();
const directChildren = (parent: Element, name?: string) =>
  Array.from(parent.childNodes).filter((node): node is Element =>
    node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (!name || (node as Element).localName === name));

/** Per row of the first table: its `w:trPr` revision markers. */
function rowMarkers(xml: string): string[][] {
  const tbl = parseXml(xml).getElementsByTagNameNS(W_NS, 'tbl')[0]!;
  return directChildren(tbl, 'tr').map((tr) => {
    const trPr = directChildren(tr, 'trPr')[0];
    return trPr ? directChildren(trPr).filter((node) => ['ins', 'del'].includes(node.localName))
      .map((node) => node.localName) : [];
  });
}

/** Revision wrappers holding a cell or row, directly or through a content control or custom XML element. */
function wrappedCells(xml: string): number {
  const holds = (element: Element): boolean => directChildren(element).some((child) =>
    ['tr', 'tc'].includes(child.localName)
    || (['sdt', 'sdtContent', 'customXml'].includes(child.localName) && holds(child)));
  return Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, '*'))
    .filter((element) => ['ins', 'del', 'moveFrom', 'moveTo'].includes(element.localName) && holds(element)).length;
}

/**
 * Each cell-level wrapper of the body's tables, in order: its properties as
 * serialized and the text of each cell it holds, so a lost, doubled or
 * emptied content control reads differently.
 */
function cellWrappers(xml: string): string[] {
  const document = parseXml(xml);
  return Array.from(document.getElementsByTagNameNS(W_NS, 'tr')).flatMap((tr) =>
    directChildren(tr).filter((child) => ['sdt', 'customXml'].includes(child.localName)).map((wrapper) => {
      const properties = directChildren(wrapper).filter((child) => ['sdtPr', 'customXmlPr'].includes(child.localName))
        .map((child) => serializeXml(child)).join('');
      const content = directChildren(wrapper, 'sdtContent')[0] ?? wrapper;
      const cells = directChildren(content, 'tc').map((tc) => extractTextWithParagraphs(serializeXml(tc)));
      return `${wrapper.localName}${wrapper.getAttributeNS(W_NS, 'element') ?? ''}:${properties}:${cells.join('|')}`;
    }));
}

async function assertSchema(buffer: Buffer): Promise<void> {
  expect(await duplicateRevisionIdsInPackage(buffer)).toEqual([]);
  const directory = await mkdtemp(join(tmpdir(), 'sdx-cellcontrol-'));
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
 * on text, the body table footprint, the cell-level wrappers and bookmark
 * balance.
 */
async function assertParity(original: Buffer, revised: Buffer, compared: Buffer): Promise<void> {
  const output = await xmlOf(compared);
  const accepted = await DocxDocument.load(compared);
  const rejected = await DocxDocument.load(compared);
  await accepted.acceptChanges();
  await rejected.rejectChanges();
  const expectedAccept = acceptAllChanges(await xmlOf(revised));
  const expectedReject = rejectAllChanges(await xmlOf(original));
  const bookmarks = (xml: string) => {
    const report = validateBookmarkIntegrity(xml);
    return [report.unmatchedStartIds, report.unmatchedEndIds, report.duplicateStartIds, report.duplicateEndIds]
      .map((ids) => ids.length);
  };
  for (const [label, projected, expected] of [
    ['comparison accept', acceptAllChanges(output), expectedAccept],
    ['docx-core accept', await xmlOf((await accepted.toBuffer()).buffer), expectedAccept],
    ['comparison reject', rejectAllChanges(output), expectedReject],
    ['docx-core reject', await xmlOf((await rejected.toBuffer()).buffer), expectedReject],
  ] as const) {
    expect(extractTextWithParagraphs(projected), label).toBe(extractTextWithParagraphs(expected));
    expect(bodyTableFootprint(projected), label).toEqual(bodyTableFootprint(expected));
    expect(cellWrappers(projected), label).toEqual(cellWrappers(expected));
    expect(bookmarks(projected), label).toEqual([0, 0, 0, 0]);
  }
}

async function compareChecked(originalBody: string, revisedBody: string) {
  const original = await docx(originalBody);
  const revised = await docx(revisedBody);
  const result = await compareDocuments(original, revised);
  await assertParity(original, revised, result.document);
  await assertSchema(result.document);
  return { result, xml: await xmlOf(result.document) };
}

describe('matched rows holding a cell-level content control whose cell skeleton changes (#1483)', () => {
  for (const [name, originalRow, revisedRow] of CASES) {
    test.openspec('[SDX-COMPTABLE-12] a row holding a cell-level content control emits a native row replacement')(
      `redlines a ${name} as the old row deleted then the new row inserted`, async () => {
        const { result, xml } = await compareChecked(
          body([originalRow, secondRow]),
          body([revisedRow, secondRow], editedIntro),
        );
        expect(rowMarkers(xml)).toEqual([['del'], ['ins'], []]);
        expect(wrappedCells(xml)).toBe(0);
        expect(result.stats.deletedTableRows).toBe(1);
        expect(result.stats.insertedTableRows).toBe(1);
        // Each replaced row keeps its own whole wrapper: one per side.
        expect(cellWrappers(xml)).toEqual([
          ...cellWrappers(await xmlOf(await docx(table([originalRow])))),
          ...cellWrappers(await xmlOf(await docx(table([revisedRow])))),
        ]);
        // The ordinary body edit keeps its word-level redline.
        const first = parseXml(xml).getElementsByTagNameNS(W_NS, 'p')[0]!;
        expect(Array.from(first.getElementsByTagNameNS(W_NS, 'delText')).map((node) => node.textContent).join(''))
          .toContain('agree to');
      },
      30000,
    );
  }

  test.openspec('[SDX-COMPTABLE-12] a row holding a cell-level content control emits a native row replacement')(
    'keeps the pending insertion inside a replaced control cell with its attribution', async () => {
      const { xml } = await compareChecked(
        body([CASES[5]![1], secondRow]),
        body([CASES[5]![2], secondRow]),
      );
      const earlier = Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'ins'))
        .filter((element) => element.getAttributeNS(W_NS, 'author') === 'Earlier');
      // Once in the deleted row and once in the inserted row, each inside the control.
      expect(earlier).toHaveLength(2);
      for (const element of earlier) {
        let parent = element.parentNode as Element | null;
        while (parent && parent.localName !== 'sdtContent') parent = parent.parentNode as Element | null;
        expect(parent?.localName).toBe('sdtContent');
      }
    },
    30000,
  );

  test.openspec('[SDX-COMPTABLE-12] a row holding a cell-level content control emits a native row replacement')(
    'leaves a text-only edit inside a control cell as an in-cell redline', async () => {
      const { xml } = await compareChecked(
        body([row([control([text('Acme')]), text('Corp'), text('Inc')]), secondRow]),
        body([row([control([text('Acme Holdings')]), text('Corp'), text('Inc')]), secondRow]),
      );
      expect(rowMarkers(xml)).toEqual([[], []]);
      expect(wrappedCells(xml)).toBe(0);
    },
    30000,
  );

  test.openspec('[SDX-COMPTABLE-10] a vertical-merge change emits a native band replacement')(
    'replaces a vertical-merge band whose rows hold a cell-level content control', async () => {
      const original = [row([text('Alpha'), control([text('Bravo')]), text('Charlie')]),
        row([text('Delta'), control([text('Echo')]), text('Foxtrot')])];
      const revised = [row([cell(p('Alpha'), '<w:vMerge w:val="restart"/>'), control([text('Bravo')]), text('Charlie')]),
        row([cell('<w:p/>', '<w:vMerge/>'), control([text('Echo')]), text('Foxtrot')])];
      const { xml } = await compareChecked(body(original), body(revised, editedIntro));
      expect(rowMarkers(xml)).toEqual([['del'], ['del'], ['ins'], ['ins']]);
      expect(wrappedCells(xml)).toBe(0);
    },
    30000,
  );

  test.openspec('[SDX-COMPTABLE-09] cell topology without a native row replacement fails closed')(
    'keeps refusing a skeleton change in a row holding a pending cell-level topology revision', async () => {
      const pending = row([control([text('Acme')]), cell(p('Corp'), '<w:cellIns w:id="80" w:author="Earlier"/>')], AFTER);
      await expect(compareDocuments(
        await docx(body([pending, secondRow])),
        await docx(body([pending.replace(`<w:trPr>${AFTER}</w:trPr>`, '').replace('</w:tr>', `${text('Inc')}</w:tr>`), secondRow])),
      )).rejects.toBeInstanceOf(UnsupportedTableTopologyComparisonError);
    },
    30000,
  );
});

const TABLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';

/** LibreOffice's reading of every table: per row, each cell's text and column span, covered cells included. */
function odtTables(content: string): string[][][] {
  const parsed = parseXml(content);
  return Array.from(parsed.getElementsByTagNameNS(TABLE_NS, 'table')).map((tbl) =>
    Array.from(tbl.getElementsByTagNameNS(TABLE_NS, 'table-row')).map((tr) =>
      Array.from(tr.childNodes)
        .filter((node): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === TABLE_NS
          && ['table-cell', 'covered-table-cell'].includes((node as Element).localName))
        .map((node) => `${node.localName === 'covered-table-cell' ? '(covered)' : ''}${node.textContent ?? ''}`
          + `/${node.getAttributeNS(TABLE_NS, 'number-columns-spanned') || '1'}`)));
}

/** Whether a row's first cell sits in a cell-level content control. */
function leadsWithControl(rowXml: string): boolean {
  const tr = parseXml(`<w:tbl xmlns:w="${W_NS}">${rowXml}</w:tbl>`).getElementsByTagNameNS(W_NS, 'tr')[0]!;
  return directChildren(tr).find((child) => child.localName !== 'trPr')?.localName === 'sdt';
}

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable LibreOffice.
const reader = process.env.SAFE_DOCX_TABLE_TOPOLOGY_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice reads a row replacement beside a cell-level content control as the source tables (#1483)', () => {
  test.openspec('[SDX-COMPTABLE-12] a row holding a cell-level content control emits a native row replacement')(
    'accepts and rejects every body replacement to the revised and original tables', async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const items = await Promise.all(CASES.map(async ([, originalRow, revisedRow]) => {
        const original = await docx(body([originalRow, secondRow]));
        const revised = await docx(body([revisedRow, secondRow], editedIntro));
        return { original, revised, compared: (await compareDocuments(original, revised)).document };
      }));
      // One oracle batch per case, so a reader failure names its case.
      const results: Array<[string, string[][][][] | string]> = [];
      for (const [index, item] of items.entries()) {
        try {
          const states = await runLibreOfficeOracle([
            // The sources' own projections: a source may carry pending revisions.
            { op: 'reject' as const, docx: item.original, saveAs: 'odt' as const },
            { op: 'accept' as const, docx: item.revised, saveAs: 'odt' as const },
            { op: 'accept' as const, docx: item.compared, saveAs: 'odt' as const },
            { op: 'reject' as const, docx: item.compared, saveAs: 'odt' as const },
          ]);
          results.push([CASES[index]![0], states.map(odtTables)]);
        } catch (error) {
          results.push([CASES[index]![0], String(error)]);
        }
        if (process.env.SDX_1483_DUMP) {
          const { writeFileSync } = await import('node:fs');
          writeFileSync(process.env.SDX_1483_DUMP, JSON.stringify(results, null, 1));
        }
      }
      for (const [index, [name, states]] of results.entries()) {
        expect(typeof states, `${name}: ${String(states)}`).not.toBe('string');
        const [original, revised, accepted, rejected] = states as string[][][][];
        expect(original, `${name} source tables differ`).not.toEqual(revised);
        expect(rejected, `${name} reject`).toEqual(original);
        // LibreOffice (26.2) ignores the w:trPr/w:del of a deleted row whose
        // first cell sits in a cell-level content control: Accept All empties
        // the row but keeps it. That holds for a plain whole-row deletion on
        // the base too, so it is a reader limitation, not this replacement's;
        // a control in a later column reads as compared.
        if (!leadsWithControl(CASES[index]![1])) expect(accepted, `${name} accept`).toEqual(revised);
      }
    },
    // One LibreOffice start per case, on a loaded host.
    1800000,
  );
});
