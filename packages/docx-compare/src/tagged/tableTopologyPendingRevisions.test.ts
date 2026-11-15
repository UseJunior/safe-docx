/**
 * Tables that already hold revisions from an earlier reviewer, and tables
 * with no rows (#1400).
 *
 * A matched row whose pending cell-level topology revisions (`w:cellIns`
 * §17.13.5.2, `w:cellDel` §17.13.5.1, `w:cellMerge` §17.13.5.3) or pending
 * row markers (`w:trPr/w:ins` §17.13.5.17, `w:trPr/w:del` §17.13.5.12)
 * differ, or that holds a pending cell-level revision while its skeleton
 * changes, is redlined as the original row deleted then the revised row
 * inserted, each copy keeping its own source's pending revisions. Reject All
 * then resolves exactly the original's pending revisions and Accept All the
 * revised's. A whole table inserted or deleted whose rows carry pending row
 * markers gets ordinary whole-table row markers. An unmatched table with no
 * rows, which no row marker can carry, is left out and reported.
 *
 * Neither acceptor resolves `w:cellIns`/`w:cellDel`/`w:cellMerge` (docx-core:
 * #1401), so the projections are compared with the same acceptor's
 * projection of each source.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.13.5.1 — pending w:cellDel is preserved in place, not resolved by either acceptor
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.13.5.2 — pending w:cellIns is preserved in place, not resolved by either acceptor
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.13.5.3 — pending w:cellMerge is preserved in place, not resolved by either acceptor
 * @see https://github.com/UseJunior/safe-docx/issues/1400
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import { DocxArchive, DocxDocument, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { duplicateRevisionIdsInPackage } from '../testing/revisionIdUniqueness.js';
import { compareDocuments, formatUnrepresentedChangeWarnings } from '../index.js';
import { acceptAllChanges, extractTextWithParagraphs, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { bodyTableFootprint } from './tableTopologyGuard.js';

const TEST_FEATURE = 'Table Topology Pending Revisions';
const test = testAllure.epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.12' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.17' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.1' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.2' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.3' },
  );

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const schemaScript = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));
const EARLIER = 'w:author="Earlier" w:date="2026-01-01T00:00:00Z"';

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (text: string, tcPr = '') => `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ''}${p(text)}</w:tc>`;
const row = (cells: string[], trPr = '') => `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const plain = (...texts: string[]) => row(texts.map((text) => cell(text)));
const table = (rows: string[], columns = 2, grid = '') =>
  `<w:tbl><w:tblPr/><w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(columns)}${grid}</w:tblGrid>${rows.join('')}</w:tbl>`;
const intro = 'The parties agree to the schedule below.';
const edited = 'The parties acknowledge the schedule below.';
const body = (blocks: string, introText = intro) => p(introText) + blocks + p('After the table.');
const docx = (xml: string) => buildDocxFromBodyXml(xml);
const xmlOf = async (buffer: Buffer) => (await DocxArchive.load(buffer)).getDocumentXml();

const PENDING = {
  cellIns: `<w:cellIns w:id="80" ${EARLIER}/>`,
  cellDel: `<w:cellDel w:id="81" ${EARLIER}/>`,
  cellMerge: `<w:cellMerge w:id="82" ${EARLIER} w:vMerge="cont" w:vMergeOrig="rest"/>`,
} as const;
const rowIns = `<w:ins w:id="90" ${EARLIER}/>`;
const rowDel = `<w:del w:id="91" ${EARLIER}/>`;

const children = (parent: Element, name?: string) =>
  Array.from(parent.childNodes).filter((node): node is Element =>
    node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (!name || (node as Element).localName === name));

/** Per row of the first table: its `w:trPr` revision markers, each as `name:author`. */
function rowMarkers(xml: string): string[][] {
  const tbl = parseXml(xml).getElementsByTagNameNS(W_NS, 'tbl')[0]!;
  return children(tbl, 'tr').map((tr) => {
    const trPr = children(tr, 'trPr')[0];
    return trPr ? children(trPr).filter((node) => ['ins', 'del'].includes(node.localName))
      .map((node) => `${node.localName}:${node.getAttributeNS(W_NS, 'author')}`) : [];
  });
}

/** Every pending revision from the earlier reviewer, by element name, in document order. */
function earlierRevisions(xml: string): string[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, '*'))
    .filter((element) => element.getAttributeNS(W_NS, 'author') === 'Earlier')
    .map((element) => element.localName);
}

/** Revision wrappers holding a cell or row. */
function wrappedCells(xml: string): number {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, '*'))
    .filter((element) => ['ins', 'del', 'moveFrom', 'moveTo'].includes(element.localName)
      && children(element).some((child) => ['tr', 'tc'].includes(child.localName))).length;
}

/** `w:trPrChange` snapshots that record a row insertion or deletion, which `CT_TrPrBase` forbids. */
function rowMarkersInsidePropertyChanges(xml: string): number {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'trPrChange'))
    .flatMap((change) => Array.from(change.getElementsByTagNameNS(W_NS, '*')))
    .filter((element) => ['ins', 'del'].includes(element.localName)).length;
}

async function assertSchema(buffer: Buffer): Promise<void> {
  expect(await duplicateRevisionIdsInPackage(buffer)).toEqual([]);
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1400-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function coreProjection(buffer: Buffer, projection: 'accept' | 'reject'): Promise<string> {
  const document = await DocxDocument.load(buffer);
  if (projection === 'accept') await document.acceptChanges();
  else await document.rejectChanges();
  return xmlOf((await document.toBuffer()).buffer);
}

/**
 * Accept All of the comparison equals Accept All of the revised document, and
 * Reject All equals Reject All of the original, with the comparison acceptor
 * and with docx-core `acceptChanges`/`rejectChanges`, each acceptor against
 * its own projection of the source: on text, the table footprint and the
 * earlier reviewer's revisions left in place.
 */
async function assertProjections(original: Buffer, revised: Buffer, compared: Buffer, footprint = {}): Promise<void> {
  const output = await xmlOf(compared);
  const source = { accept: await xmlOf(revised), reject: await xmlOf(original) };
  const view = (xml: string) => ({
    text: extractTextWithParagraphs(xml),
    footprint: bodyTableFootprint(xml, footprint),
    earlier: earlierRevisions(xml),
  });
  for (const projection of ['accept', 'reject'] as const) {
    const ast = projection === 'accept' ? acceptAllChanges : rejectAllChanges;
    const sourceBuffer = projection === 'accept' ? revised : original;
    expect(view(ast(output)), `comparison ${projection}`).toEqual(view(ast(source[projection])));
    expect(view(await coreProjection(compared, projection)), `docx-core ${projection}`)
      .toEqual(view(await coreProjection(sourceBuffer, projection)));
  }
}

async function compareChecked(originalBody: string, revisedBody: string) {
  const original = await docx(originalBody);
  const revised = await docx(revisedBody);
  const result = await compareDocuments(original, revised);
  await assertProjections(original, revised, result.document);
  await assertSchema(result.document);
  const xml = await xmlOf(result.document);
  // The ordinary body edit beside the table keeps its word-level redline.
  const first = parseXml(xml).getElementsByTagNameNS(W_NS, 'p')[0]!;
  if (originalBody.includes(intro) && revisedBody.includes(edited)) {
    expect(Array.from(first.getElementsByTagNameNS(W_NS, 'delText')).map((node) => node.textContent).join(''))
      .toContain('agree to');
  }
  return { result, xml };
}

describe('a table holding pending cell-level revisions from an earlier reviewer (#1400)', () => {
  for (const [name, revision] of Object.entries(PENDING)) {
    const pendingRow = row([cell('Acme'), cell('Corp', revision)]);

    test.openspec('[SDX-COMPTABLE-09] a row holding a pending cell-level revision emits a native row replacement')(
      `keeps an in-cell redline beside a pending ${name} whose row keeps its skeleton`, async () => {
        for (const revisedRow of [pendingRow.replace('Acme', 'Acme Holdings'), pendingRow.replace('Corp', 'Corp Ltd')]) {
          const { xml } = await compareChecked(
            body(table([pendingRow, plain('Delta', 'Echo')])),
            body(table([revisedRow, plain('Delta', 'Echo')]), edited),
          );
          expect(rowMarkers(xml)).toEqual([[], []]);
          expect(earlierRevisions(xml)).toEqual([name]);
        }
      },
      30000,
    );

    test.openspec('[SDX-COMPTABLE-09] a row holding a pending cell-level revision emits a native row replacement')(
      `replaces a row whose skeleton changes beside a pending ${name}, each copy keeping it`, async () => {
        const grown = row([cell('Acme'), cell('Corp', revision), cell('Inc')]);
        const { xml, result } = await compareChecked(
          body(table([row([cell('Acme'), cell('Corp', revision)], '<w:gridAfter w:val="1"/>'), plain('Delta', 'Echo', 'Foxtrot')], 3)),
          body(table([grown, plain('Delta', 'Echo', 'Foxtrot')], 3), edited),
        );
        expect(rowMarkers(xml)).toEqual([['del:Comparison'], ['ins:Comparison'], []]);
        expect(earlierRevisions(xml)).toEqual([name, name]);
        expect(wrappedCells(xml)).toBe(0);
        expect(result.stats.deletedTableRows).toBe(1);
        expect(result.stats.insertedTableRows).toBe(1);
      },
      30000,
    );

    test.openspec('[SDX-COMPTABLE-09] a row holding a pending cell-level revision emits a native row replacement')(
      `replaces a row whose pending ${name} is added or resolved between the documents`, async () => {
        for (const [before, after] of [[plain('Acme', 'Corp'), pendingRow], [pendingRow, plain('Acme', 'Corp')]]) {
          const { xml } = await compareChecked(
            body(table([before!, plain('Delta', 'Echo')])),
            body(table([after!, plain('Delta', 'Echo')]), edited),
          );
          expect(rowMarkers(xml)).toEqual([['del:Comparison'], ['ins:Comparison'], []]);
          expect(earlierRevisions(xml)).toEqual([name]);
          expect(wrappedCells(xml)).toBe(0);
        }
      },
      30000,
    );
  }

  test.openspec('[SDX-COMPTABLE-09] a row holding a pending cell-level revision emits a native row replacement')(
    'replaces a vertical-merge band whose rows hold a pending cell insertion', async () => {
      const restart = row([cell('Acme', '<w:vMerge w:val="restart"/>'), cell('Corp')]);
      const continuation = row([cell('', '<w:vMerge/>'), cell('Delta', PENDING.cellIns)]);
      const { xml } = await compareChecked(
        body(table([plain('Acme', 'Corp'), row([cell('Echo'), cell('Delta', PENDING.cellIns)])])),
        body(table([restart, continuation]), edited),
      );
      expect(rowMarkers(xml)).toEqual([['del:Comparison'], ['del:Comparison'], ['ins:Comparison'], ['ins:Comparison']]);
      expect(earlierRevisions(xml)).toEqual(['cellIns', 'cellIns']);
    },
    30000,
  );

  test.openspec('[SDX-COMPTABLE-09] a row holding a pending cell-level revision emits a native row replacement')(
    'keeps a pending table-grid revision beside an ordinary cell edit', async () => {
      const grid = `<w:tblGridChange w:id="83"><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="1000"/></w:tblGrid></w:tblGridChange>`;
      const { xml } = await compareChecked(
        body(table([plain('Acme', 'Corp')], 2, grid)),
        body(table([plain('Acme Holdings', 'Corp')], 2, grid), edited),
      );
      expect(rowMarkers(xml)).toEqual([[]]);
      expect(parseXml(xml).getElementsByTagNameNS(W_NS, 'tblGridChange')).toHaveLength(1);
    },
    30000,
  );
});

describe('a table whose rows carry pending row revisions from an earlier reviewer (#1400)', () => {
  for (const [name, marker] of [['insertion', rowIns], ['deletion', rowDel]] as const) {
    test.openspec('[SDX-COMPTABLE-13] pending row revisions in a changed table keep each projection')(
      `inserts and deletes a whole table whose row carries a pending row ${name}`, async () => {
        const tracked = table([row([cell('Acme'), cell('Corp')], marker), plain('Delta', 'Echo')]);
        for (const [before, after, kind] of [[p('Lead'), p('Lead') + tracked, 'ins'], [p('Lead') + tracked, p('Lead'), 'del']] as const) {
          const { xml, result } = await compareChecked(body(before), body(after, edited));
          const markers = rowMarkers(xml);
          // Every row carries the comparison's marker of its kind, unless the pending marker is that kind.
          for (const rowMarker of markers) expect(rowMarker.some((entry) => entry.startsWith(`${kind}:`))).toBe(true);
          expect(markers[0]).toContain(marker === rowIns ? 'ins:Earlier' : 'del:Earlier');
          expect(result.stats[kind === 'ins' ? 'insertedTableRows' : 'deletedTableRows'])
            .toBe((marker === rowIns) === (kind === 'ins') ? 1 : 2);
        }
      },
      30000,
    );
  }

  const states = { none: '', ins: rowIns, del: rowDel, both: rowIns + rowDel } as const;
  const pendingNames = { none: [], ins: ['ins'], del: ['del'], both: ['ins', 'del'] } as const;
  for (const [from, fromMarkers] of Object.entries(states) as Array<[keyof typeof states, string]>) {
    for (const [to, toMarkers] of Object.entries(states) as Array<[keyof typeof states, string]>) {
      if (from === to) continue;
      test.openspec('[SDX-COMPTABLE-13] pending row revisions in a changed table keep each projection')(
        `replaces a matched row whose pending row markers change from ${from} to ${to}`, async () => {
          const { xml } = await compareChecked(
            body(table([row([cell('Acme'), cell('Corp')], fromMarkers), plain('Delta', 'Echo')])),
            body(table([row([cell('Acme Holdings'), cell('Corp')], toMarkers), plain('Delta', 'Echo')]), edited),
          );
          const markers = rowMarkers(xml);
          expect(markers).toHaveLength(3);
          expect(markers[0]!.some((entry) => entry.startsWith('del:'))).toBe(true);
          expect(markers[1]!.some((entry) => entry.startsWith('ins:'))).toBe(true);
          expect(markers[2]).toEqual([]);
          // Each copy keeps its own source's pending markers.
          expect(earlierRevisions(xml)).toEqual([...pendingNames[from], ...pendingNames[to]]);
          expect(rowMarkersInsidePropertyChanges(xml)).toBe(0);
        },
        30000,
      );
    }
  }

  test.openspec('[SDX-COMPTABLE-13] pending row revisions in a changed table keep each projection')(
    'records a row height change beside an unchanged pending row marker without copying the marker', async () => {
      for (const marker of [rowIns, rowDel]) {
        const { xml } = await compareChecked(
          body(table([row([cell('Acme'), cell('Corp')], `<w:trHeight w:val="300"/>${marker}`), plain('Delta', 'Echo')])),
          body(table([row([cell('Acme'), cell('Corp')], `<w:trHeight w:val="600"/>${marker}`), plain('Delta', 'Echo')]), edited),
        );
        expect(rowMarkers(xml)[0]).toEqual([`${marker === rowIns ? 'ins' : 'del'}:Earlier`]);
        expect(parseXml(xml).getElementsByTagNameNS(W_NS, 'trPrChange')).toHaveLength(1);
        expect(rowMarkersInsidePropertyChanges(xml)).toBe(0);
      }
    },
    30000,
  );
});

/** One section whose default header holds `headerContent`. */
async function headerPackage(bodyXml: string, headerContent: string): Promise<Buffer> {
  const archive = await DocxArchive.load(await docx(bodyXml));
  archive.setDocumentXml((await archive.getDocumentXml())
    .replace('<w:sectPr/>', `<w:sectPr><w:headerReference xmlns:r="${R_NS}" w:type="default" r:id="rIdHeader"/></w:sectPr>`));
  archive.setFile('word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}"><Relationship Id="rIdHeader" Type="${R_NS}/header" Target="header1.xml"/></Relationships>`);
  archive.setFile('word/header1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W_NS}">${headerContent}</w:hdr>`);
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>',
    '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'));
  return archive.save();
}

describe('an unmatched table with no rows (#1400)', () => {
  const empty = table([]);
  for (const [kind, before, after] of [
    ['added', body(''), body(empty, edited)],
    ['removed', body(empty), body('', edited)],
  ] as const) {
    test.openspec('[SDX-COMPTABLE-14] an unmatched table with no rows is left out and reported')(
      `leaves out and reports a table with no rows ${kind} beside a body edit`, async () => {
        const original = await docx(before);
        const revised = await docx(after);
        const result = await compareDocuments(original, revised);
        const xml = await xmlOf(result.document);
        expect(parseXml(xml).getElementsByTagNameNS(W_NS, 'tbl')).toHaveLength(0);
        expect(result.unrepresentedChanges).toEqual([
          { scope: 'table', kind, sectionIndex: 0, table: { story: 'body', index: 0 } },
        ]);
        const [warning] = formatUnrepresentedChangeWarnings(result.unrepresentedChanges);
        expect(warning).toContain(`${kind} table with no rows (w:tbl #1 of the ${kind === 'added' ? 'revised' : 'original'} document)`);
        expect(warning).toContain(`${kind === 'added' ? 'Accept All' : 'Reject All'} lacks it`);
        // Apart from the table left out, each projection reproduces its source.
        await assertProjections(original, revised, result.document, { omitRowlessTables: true });
        await assertSchema(result.document);
      },
      30000,
    );
  }

  test.openspec('[SDX-COMPTABLE-14] an unmatched table with no rows is left out and reported')(
    'refuses a table with no rows that holds a bookmark start, instead of unbalancing the range', async () => {
      const held = table([]).replace('<w:tblPr/>', '<w:bookmarkStart w:id="5" w:name="Target"/><w:tblPr/>');
      const target = '<w:p><w:bookmarkEnd w:id="5"/><w:r><w:t>Target text</w:t></w:r></w:p>';
      for (const [before, after] of [[body(target), body(held + target, edited)], [body(held + target), body(target, edited)]]) {
        await expect(compareDocuments(await docx(before!), await docx(after!))).rejects.toMatchObject({
          name: 'UnsupportedTableTopologyComparisonError', feature: 'emptyTable',
        });
      }
    },
    30000,
  );

  test.openspec('[SDX-COMPTABLE-14] an unmatched table with no rows is left out and reported')(
    'names the section that holds a removed table in the original document', async () => {
      const sectionBreak = '<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>End of section one</w:t></w:r></w:p>';
      const result = await compareDocuments(
        await docx(body(sectionBreak + p('Same') + empty)),
        await docx(body(p('Same'), edited)),
      );
      expect(result.unrepresentedChanges?.filter((change) => change.scope === 'table')).toEqual([
        { scope: 'table', kind: 'removed', sectionIndex: 1, table: { story: 'body', index: 0 } },
      ]);
    },
    30000,
  );

  test.openspec('[SDX-COMPTABLE-14] an unmatched table with no rows is left out and reported')(
    'names the left-out table by its ordinal beside a table with rows', async () => {
      const kept = table([plain('Acme', 'Corp')]);
      const result = await compareDocuments(await docx(body(kept)), await docx(body(kept + p('Between') + empty)));
      expect(result.unrepresentedChanges).toEqual([
        { scope: 'table', kind: 'added', sectionIndex: 0, table: { story: 'body', index: 1 } },
      ]);
      expect(parseXml(await xmlOf(result.document)).getElementsByTagNameNS(W_NS, 'tbl')).toHaveLength(1);
    },
    30000,
  );

  test.openspec('[SDX-COMPTABLE-14] an unmatched table with no rows is left out and reported')(
    'publishes a table with no rows present in both documents as it is', async () => {
      const original = await docx(body(empty));
      const revised = await docx(body(empty, edited));
      const result = await compareDocuments(original, revised);
      expect(result.unrepresentedChanges).toBeUndefined();
      expect(parseXml(await xmlOf(result.document)).getElementsByTagNameNS(W_NS, 'tbl')).toHaveLength(1);
      await assertProjections(original, revised, result.document);
    },
    30000,
  );

  test.openspec('[SDX-COMPTABLE-14] an unmatched table with no rows is left out and reported')(
    'keeps the header contract for a header gaining a table with no rows', async () => {
      const original = await headerPackage(body(''), p('Header'));
      const revised = await headerPackage(body('', edited), p('Header') + empty);
      const result = await compareDocuments(original, revised);
      // The header part is left uncompared and listed, as for any table topology its guard refuses.
      expect(result.unrepresentedChanges).toEqual([{ scope: 'header', kind: 'changed', sectionIndex: 0, role: 'default' }]);
      expect(extractTextWithParagraphs(acceptAllChanges(await xmlOf(result.document))))
        .toBe(extractTextWithParagraphs(await xmlOf(revised)));
      expect(extractTextWithParagraphs(rejectAllChanges(await xmlOf(result.document))))
        .toBe(extractTextWithParagraphs(await xmlOf(original)));
    },
    30000,
  );
});
