/**
 * A change to a table's own properties (`w:tblPr`) or to a row's table-property
 * exceptions (`w:tblPrEx`) is redlined as a native property revision, never as
 * `w:ins`/`w:del` among the children of `w:tblPr`, `w:tblGrid` or `w:tblPrEx`
 * (which their schema types do not admit):
 *
 * - a `w:tblPr` difference publishes the revised properties with a
 *   `w:tblPrChange` holding the original ones, and every row of that table
 *   carries a row-level `w:tblPrExChange`, the form Word needs to show the
 *   revision at all;
 * - a `w:tblPrEx` difference publishes the revised exceptions with a
 *   `w:tblPrExChange` holding the original ones;
 * - a pending `w:tblPrChange`, `w:tblGridChange` or `w:tblPrExChange` that
 *   only one input carries is kept when it is the original's (its snapshot is
 *   the original's reject projection) and dropped when it is the revised's.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.34
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.35
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.33
 * @see https://github.com/UseJunior/safe-docx/issues/1399
 * @see https://github.com/UseJunior/safe-docx/issues/1395
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { XMLSerializer } from '@xmldom/xmldom';
import { describe, expect } from 'vitest';
import { childElements, DocxArchive, DocxDocument, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { compareDocuments } from '../index.js';
import { acceptAllChanges, extractTextWithParagraphs, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { bodyTableFootprint } from './tableTopologyGuard.js';
import { compareSourceProjectedFormattingFidelity } from './formattingFidelity.js';

const TEST_FEATURE = 'Table Property Revision Comparison';
const test = testAllure.epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.34' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.35' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.33' },
  );

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const schemaScript = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (text: string) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
const row = (texts: [string, string], tblPrEx = '') => `<w:tr>${tblPrEx}${cell(texts[0])}${cell(texts[1])}</w:tr>`;
const GRID = '<w:gridCol w:w="3000"/><w:gridCol w:w="3000"/>';
const table = (tblPr: string, rows: string[], grid = GRID) =>
  `<w:tbl><w:tblPr>${tblPr}</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows.join('')}</w:tbl>`;
const ROWS = [row(['Alpha', 'Bravo']), row(['Charlie', 'Delta'])];
const intro = 'The parties agree to the schedule below, which lists each signatory.';
const editedIntro = intro.replace('agree to', 'acknowledge');
const body = (tableXml: string, introText = intro) => p(introText) + tableXml + p('A closing paragraph.');
const WIDTH = '<w:tblW w:w="6000" w:type="dxa"/>';
const BORDER = '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders>';
const ROW_BORDER = `<w:tblPrEx>${BORDER}</w:tblPrEx>`;
const prior = (kind: string, inner: string, id = 90) =>
  `<w:${kind} w:id="${id}" w:author="Prior" w:date="2026-11-01T00:00:00Z">${inner}</w:${kind}>`;

const xmlOf = async (buffer: Buffer) => (await DocxArchive.load(buffer)).getDocumentXml();
const directChildren = (parent: Element, name: string): Element[] =>
  childElements(parent).filter((child) => child.namespaceURI === W_NS && child.localName === name);
const serialize = (element: Element | undefined): string =>
  element ? new XMLSerializer().serializeToString(element) : '';

/** Live table-level properties of every body table, revision records excluded. */
function tableProperties(xml: string): Array<{ tblPr: string[]; grid: string[]; rowExceptions: string[][] }> {
  const live = (container: Element | undefined, record: string): string[] => container
    ? childElements(container).filter((child) => child.localName !== record).map(serialize)
    : [];
  return Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'tbl')).map((tbl) => ({
    tblPr: live(directChildren(tbl, 'tblPr')[0], 'tblPrChange'),
    grid: live(directChildren(tbl, 'tblGrid')[0], 'tblGridChange'),
    rowExceptions: directChildren(tbl, 'tr').map((tr) => live(directChildren(tr, 'tblPrEx')[0], 'tblPrExChange')),
  }));
}

/** Revision elements found among the children of table-level property elements. */
function wrappersInsideTableProperties(xml: string): string[] {
  const found: string[] = [];
  for (const name of ['tblPr', 'tblGrid', 'tblPrEx']) {
    for (const container of Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, name))) {
      for (const child of childElements(container)) {
        if (['ins', 'del', 'moveFrom', 'moveTo'].includes(child.localName)) found.push(`${name}/${child.localName}`);
      }
    }
  }
  return found;
}

const records = (xml: string, name: string): Element[] =>
  Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, name));

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-tblpr-'));
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
 * Accept-all projects to the revised document and reject-all to the original:
 * text, table footprint and every table-level property through the comparison
 * acceptor; text, footprint, `w:tblPr` and `w:tblGrid` through docx-core
 * `acceptChanges`/`rejectChanges`. docx-core does not resolve
 * `w:tblPrExChange` or `w:tblGridChange` yet (#1401; pinned below), so its row
 * exceptions are left out, and so is its grid when the output carries a
 * `w:tblGridChange`.
 */
async function assertParity(original: Buffer, revised: Buffer, compared: Buffer): Promise<void> {
  const output = await xmlOf(compared);
  const accepted = await DocxDocument.load(compared);
  const rejected = await DocxDocument.load(compared);
  await accepted.acceptChanges();
  await rejected.rejectChanges();
  const expectedAccept = acceptAllChanges(await xmlOf(revised));
  const expectedReject = rejectAllChanges(await xmlOf(original));
  // Measured as the pipeline does: against each source side's own projection.
  expect(compareSourceProjectedFormattingFidelity(expectedReject, expectedAccept, output).score).toBe(1);
  const carriesGridRecord = records(output, 'tblGridChange').length > 0;
  const withoutGrid = (footprint: ReturnType<typeof bodyTableFootprint>) => ({
    ...footprint,
    tables: footprint.tables.map(({ gridColumnWidths: _grid, ...rest }) => rest),
  });
  for (const [projected, expected, engine] of [
    [acceptAllChanges(output), expectedAccept, 'comparison'],
    [await xmlOf((await accepted.toBuffer()).buffer), expectedAccept, 'docx-core'],
    [rejectAllChanges(output), expectedReject, 'comparison'],
    [await xmlOf((await rejected.toBuffer()).buffer), expectedReject, 'docx-core'],
  ] as const) {
    expect(extractTextWithParagraphs(projected)).toBe(extractTextWithParagraphs(expected));
    const skipGrid = engine === 'docx-core' && carriesGridRecord;
    if (skipGrid) {
      expect(withoutGrid(bodyTableFootprint(projected))).toEqual(withoutGrid(bodyTableFootprint(expected)));
    } else {
      expect(bodyTableFootprint(projected)).toEqual(bodyTableFootprint(expected));
    }
    const actualProperties = tableProperties(projected);
    const expectedProperties = tableProperties(expected);
    if (engine === 'comparison') {
      expect(actualProperties).toEqual(expectedProperties);
    } else {
      const coreView = (properties: typeof actualProperties) =>
        properties.map(({ tblPr, grid }) => (skipGrid ? { tblPr } : { tblPr, grid }));
      expect(coreView(actualProperties)).toEqual(coreView(expectedProperties));
    }
  }
}

async function compareChecked(originalBody: string, revisedBody: string, options: { ignoreFormatting?: boolean } = {}) {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  const result = await compareDocuments(original, revised, { author: 'Comparison', ...options });
  const xml = await xmlOf(result.document);
  expect(wrappersInsideTableProperties(xml)).toEqual([]);
  await assertSchema(result.document);
  if (!options.ignoreFormatting) await assertParity(original, revised, result.document);
  return { result, xml };
}

/** Every row of the first table carries a comparison `w:tblPrExChange` snapshotting its live exceptions. */
function expectRowCompanions(xml: string): void {
  const tbl = parseXml(xml).getElementsByTagNameNS(W_NS, 'tbl')[0]!;
  for (const tr of directChildren(tbl, 'tr')) {
    const exceptions = directChildren(tr, 'tblPrEx')[0];
    expect(exceptions, 'row carries w:tblPrEx').toBeDefined();
    expect(childElements(tr)[0]).toBe(exceptions);
    const change = directChildren(exceptions!, 'tblPrExChange');
    expect(change).toHaveLength(1);
    expect(change[0]!.getAttributeNS(W_NS, 'author')).toBe('Comparison');
    const snapshot = directChildren(change[0]!, 'tblPrEx')[0]!;
    expect(childElements(snapshot).map(serialize))
      .toEqual(childElements(exceptions!).filter((child) => child.localName !== 'tblPrExChange').map(serialize));
  }
}

describe('table property changes', () => {
  test.openspec('[SDX-COMPTABLE-11] a table property change emits a native table-property revision')(
    'redlines a table style change as w:tblPrChange with row-level w:tblPrExChange companions', async () => {
      const { result, xml } = await compareChecked(
        body(table(`<w:tblStyle w:val="TableGrid"/>${WIDTH}`, ROWS)),
        body(table(`<w:tblStyle w:val="PlainTable1"/>${WIDTH}`, ROWS), editedIntro),
      );
      const [change, ...extra] = records(xml, 'tblPrChange');
      expect(extra).toHaveLength(0);
      expect(change!.getAttributeNS(W_NS, 'author')).toBe('Comparison');
      const snapshot = directChildren(change!, 'tblPr')[0]!;
      expect(directChildren(snapshot, 'tblStyle')[0]!.getAttributeNS(W_NS, 'val')).toBe('TableGrid');
      const live = change!.parentNode as Element;
      expect(directChildren(live, 'tblStyle')[0]!.getAttributeNS(W_NS, 'val')).toBe('PlainTable1');
      // The record is the last child of w:tblPr (CT_TblPr).
      expect(childElements(live).at(-1)).toBe(change);
      expectRowCompanions(xml);
      expect(records(xml, 'tblGridChange')).toHaveLength(0);
      expect(result.stats.formatChanges).toBe(1);
      // The ordinary body edit keeps its word-level redline.
      expect(records(xml, 'delText').map((node) => node.textContent).join('')).toContain('agree to');
    },
  );

  test.openspec('[SDX-COMPTABLE-11] a table property change emits a native table-property revision')(
    'redlines added table borders as w:tblPrChange holding the borderless properties', async () => {
      const { xml } = await compareChecked(
        body(table(WIDTH, ROWS)),
        body(table(`${WIDTH}${BORDER}`, ROWS)),
      );
      const [change] = records(xml, 'tblPrChange');
      expect(childElements(directChildren(change!, 'tblPr')[0]!).map((child) => child.localName)).toEqual(['tblW']);
      expectRowCompanions(xml);
    },
  );

  test.openspec('[SDX-COMPTABLE-11] a table property change emits a native table-property revision')(
    'redlines a row exception change as w:tblPrExChange on the changed rows only', async () => {
      const { result, xml } = await compareChecked(
        body(table(WIDTH, [row(['Alpha', 'Bravo']), row(['Charlie', 'Delta'])])),
        body(table(WIDTH, [row(['Alpha', 'Bravo'], ROW_BORDER), row(['Charlie', 'Delta'])])),
      );
      expect(records(xml, 'tblPrChange')).toHaveLength(0);
      const tbl = parseXml(xml).getElementsByTagNameNS(W_NS, 'tbl')[0]!;
      const [first, second] = directChildren(tbl, 'tr');
      const change = first!.getElementsByTagNameNS(W_NS, 'tblPrExChange');
      expect(change).toHaveLength(1);
      expect(childElements(directChildren(change[0]!, 'tblPrEx')[0]!)).toHaveLength(0);
      expect(directChildren(second!, 'tblPrEx')).toHaveLength(0);
      expect(result.stats.formatChanges).toBe(1);
    },
  );

  test.openspec('[SDX-COMPTABLE-11] a table property change emits a native table-property revision')(
    'redlines removed row exceptions with a snapshot of the original ones', async () => {
      const { xml } = await compareChecked(
        body(table(WIDTH, [row(['Alpha', 'Bravo'], ROW_BORDER)])),
        body(table(WIDTH, [row(['Alpha', 'Bravo'])])),
      );
      const [change] = records(xml, 'tblPrExChange');
      expect(childElements(directChildren(change!, 'tblPrEx')[0]!).map((child) => child.localName))
        .toEqual(['tblBorders']);
      const exceptions = change!.parentNode as Element;
      expect(childElements(exceptions)).toEqual([change]);
    },
  );

  test.openspec('[SDX-COMPTABLE-11] a table property change emits a native table-property revision')(
    'gives every row of the changed table a companion, including inserted and wrapped rows, but not nested tables', async () => {
      const nested = table(WIDTH, [row(['Inner', 'Cell'])]);
      const nestedRow = `<w:tr>${cell('Holder').replace('</w:tc>', `${nested}<w:p/></w:tc>`)}${cell('Side')}</w:tr>`;
      const wrapped = `<w:sdt><w:sdtPr><w:id w:val="5"/></w:sdtPr><w:sdtContent>${row(['Wrapped', 'Row'])}</w:sdtContent></w:sdt>`;
      const { xml } = await compareChecked(
        body(table(`<w:tblStyle w:val="TableGrid"/>${WIDTH}`, [row(['Alpha', 'Bravo']), wrapped, nestedRow])),
        body(table(`<w:tblStyle w:val="PlainTable1"/>${WIDTH}`,
          [row(['Alpha', 'Bravo']), row(['Inserted', 'Row']), wrapped, nestedRow])),
      );
      const [outer, inner] = Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'tbl'));
      const outerRows = Array.from(outer!.getElementsByTagNameNS(W_NS, 'tr'))
        .filter((tr) => tr.parentNode && !inner!.contains(tr));
      expect(outerRows).toHaveLength(4);
      for (const tr of outerRows) {
        expect(directChildren(directChildren(tr, 'tblPrEx')[0]!, 'tblPrExChange'), 'outer row companion').toHaveLength(1);
      }
      expect(inner!.getElementsByTagNameNS(W_NS, 'tblPrExChange')).toHaveLength(0);
      expect(inner!.getElementsByTagNameNS(W_NS, 'tblPrChange')).toHaveLength(0);
    },
  );

  test.openspec('[SDX-COMPTABLE-11] a table property change emits a native table-property revision')(
    'publishes the revised table properties without a record when formatting is ignored', async () => {
      const { xml } = await compareChecked(
        body(table(`<w:tblStyle w:val="TableGrid"/>${WIDTH}`, ROWS)),
        body(table(`<w:tblStyle w:val="PlainTable1"/>${WIDTH}`, ROWS)),
        { ignoreFormatting: true },
      );
      expect(records(xml, 'tblPrChange')).toHaveLength(0);
      expect(records(xml, 'tblPrExChange')).toHaveLength(0);
      expect(records(xml, 'tblStyle')[0]!.getAttributeNS(W_NS, 'val')).toBe('PlainTable1');
    },
  );
});

describe('pending table-level records carried by one input', () => {
  const CASES: Array<[string, string, string, string]> = [
    ['w:tblPrChange', 'tblPrChange',
      table(`${WIDTH}${prior('tblPrChange', '<w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr>')}`, ROWS),
      table(WIDTH, ROWS)],
    ['w:tblGridChange', 'tblGridChange',
      table(WIDTH, ROWS, `${GRID}<w:tblGridChange w:id="90"><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="4000"/></w:tblGrid></w:tblGridChange>`),
      table(WIDTH, ROWS)],
    ['w:tblPrExChange', 'tblPrExChange',
      table(WIDTH, [row(['Alpha', 'Bravo'], `<w:tblPrEx>${BORDER}${prior('tblPrExChange', '<w:tblPrEx/>')}</w:tblPrEx>`)]),
      table(WIDTH, [row(['Alpha', 'Bravo'], ROW_BORDER)])],
  ];

  for (const [label, name, withRecord, withoutRecord] of CASES) {
    test.openspec('[SDX-COMPTABLE-11] a table property change emits a native table-property revision')(
      `keeps an original-only pending ${label} with its attribution and a fresh ID`, async () => {
        const { xml } = await compareChecked(body(withRecord), body(withoutRecord));
        const kept = records(xml, name);
        expect(kept).toHaveLength(1);
        expect(kept[0]!.getAttributeNS(W_NS, 'id')).not.toBe('90');
        if (name !== 'tblGridChange') expect(kept[0]!.getAttributeNS(W_NS, 'author')).toBe('Prior');
        expect(records(xml, 'tblPrExChange').length + records(xml, 'tblPrChange').length
          + records(xml, 'tblGridChange').length).toBe(1);
      },
    );

    test.openspec('[SDX-COMPTABLE-11] a table property change emits a native table-property revision')(
      `drops a revised-only pending ${label}, which the original's reject projection does not hold`, async () => {
        const { xml } = await compareChecked(body(withoutRecord), body(withRecord));
        expect(records(xml, name)).toHaveLength(0);
      },
    );

    test.openspec('[SDX-COMPTABLE-11] a table property change emits a native table-property revision')(
      `keeps a pending ${label} that both inputs carry unchanged`, async () => {
        const { xml } = await compareChecked(body(withRecord), body(withRecord, editedIntro));
        const kept = records(xml, name);
        expect(kept).toHaveLength(1);
        expect(kept[0]!.getAttributeNS(W_NS, 'id')).toBe('90');
      },
    );
  }
});

describe('docx-core resolution of the emitted records', () => {
  test('docx-core acceptChanges/rejectChanges resolve w:tblPrChange but still keep w:tblPrExChange (#1401)', async () => {
    const original = await buildDocxFromBodyXml(body(table(`<w:tblStyle w:val="TableGrid"/>${WIDTH}`, ROWS)));
    const revised = await buildDocxFromBodyXml(body(table(`<w:tblStyle w:val="PlainTable1"/>${WIDTH}`, ROWS)));
    const { document } = await compareDocuments(original, revised);
    for (const resolve of ['acceptChanges', 'rejectChanges'] as const) {
      const doc = await DocxDocument.load(document);
      await doc[resolve]();
      const xml = await xmlOf((await doc.toBuffer()).buffer);
      expect(records(xml, 'tblPrChange'), resolve).toHaveLength(0);
      // Characterization: docx-core's native engines do not resolve
      // w:tblPrExChange yet. The companions' snapshots equal their live
      // exceptions, so the residue changes no property value.
      expect(records(xml, 'tblPrExChange'), resolve).toHaveLength(2);
    }
  });
});
