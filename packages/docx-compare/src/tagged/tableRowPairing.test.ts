/**
 * Table rows in an alignment gap pair by cell-text similarity, never by
 * position alone, and the cells of a paired row pair by grid interval. An
 * edited row beside an inserted row is then an in-cell edit plus one
 * whole-row insertion, and a deleted row beside an unrelated inserted row is
 * a whole-row deletion plus a whole-row insertion rather than in-row edits
 * that carry no row marker. Rows cannot be moved inside a table, so a
 * reordered row is a deletion plus an insertion.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.17
 * @see https://github.com/UseJunior/safe-docx/issues/1227
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import { DocxArchive, DocxDocument, parseXml, serializeXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { compareDocuments } from '../index.js';
import { acceptAllChanges, extractTextWithParagraphs, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { bodyTableFootprint } from './tableTopologyGuard.js';
import { REAL_CORPUS_ENV } from '../integration/real-corpus-fixtures.js';

const TEST_FEATURE = 'Table Row Pairing';
const test = testAllure.epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.12' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.17' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.17' },
  );

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const schemaScript = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));

// The issue's generator (mkdocx2.py), ported to body XML.
const p = (text: string, bold = false) =>
  `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const row = (cells: string[], bold = false) =>
  `<w:tr>${cells.map((text) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${p(text, bold)}</w:tc>`).join('')}</w:tr>`;
const table = (rows: Array<[string[], boolean]>, columns = 3) =>
  `<w:tbl><w:tblPr><w:tblW w:w="${columns * 3000}" w:type="dxa"/></w:tblPr><w:tblGrid>` +
  `${'<w:gridCol w:w="3000"/>'.repeat(columns)}</w:tblGrid>${rows.map(([cells, bold]) => row(cells, bold)).join('')}</w:tbl>`;
const issueBody = (paragraphs: string[], rows: Array<[string[], boolean]>) =>
  paragraphs.map((text) => p(text)).join('') + table(rows) + p('After the table, a closing paragraph.');

const base = Array.from({ length: 12 }, (_, index) =>
  `Clause ${index + 1}. The parties agree to the terms in clause ${index + 1} of this sample agreement, ` +
  'which runs for several more words to look like real prose.');
const editedBody = (() => {
  const edited = [...base];
  edited[1] = edited[1]!.replace('agree to the terms', 'agree to the revised terms');
  edited[4] = edited[4]!.replace('several more words', 'a few more words');
  edited.splice(6, 0, 'A newly inserted paragraph that did not exist in the original document at all.');
  edited.splice(9, 0, 'Another inserted paragraph, also new, placed later in the body.');
  edited[11] = edited[11]!.replace('sample agreement', 'sample contract');
  return edited;
})();
const R0: Array<[string[], boolean]> = [
  [['Item', 'Description', 'Price'], true],
  [['A', 'Widgets', '$100'], false],
  [['B', 'Gadgets', '$50'], false],
  [['', 'Total', '$150'], true],
];
const variants: Array<[string, Array<[string[], boolean]>, string]> = [
  ['row appended', [...R0, [['', 'Total with option', '$180'], false]], 'Total with option'],
  ['cell changed', [...R0.slice(0, 3), [['Option', 'Optional extra service, if authorized', '$30'], true],
    [['', 'Total with option', '$180'], false]], 'Optional extra service, if authorized'],
  ['row inserted before Total', [...R0.slice(0, 3), [['Option', 'Optional extra service', '$30'], false],
    [['', 'Total with option', '$180'], true]], 'Optional extra service'],
];

const docx = (body: string) => buildDocxFromBodyXml(body);
const xmlOf = async (buffer: Buffer) => (await DocxArchive.load(buffer)).getDocumentXml();
const directChildren = (parent: Element, name: string) =>
  Array.from(parent.childNodes).filter((node): node is Element =>
    node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (node as Element).localName === name);

interface RowView { marker: string; cells: Array<{ inserted: string; deleted: string; text: string }> }

/** Row markers and per-cell inserted, deleted and current text of the first table. */
function tableView(xml: string, tableIndex = 0): RowView[] {
  const tbl = parseXml(xml).getElementsByTagNameNS(W_NS, 'tbl')[tableIndex]!;
  const textIn = (element: Element, wrapper: 'ins' | 'del') => Array.from(element.getElementsByTagNameNS(W_NS, wrapper))
    .filter((node) => node.parentNode && (node.parentNode as Element).localName !== 'rPr')
    .map((node) => Array.from(node.getElementsByTagNameNS(W_NS, wrapper === 'ins' ? 't' : 'delText'))
      .map((text) => text.textContent).join(''))
    .join(' ');
  return directChildren(tbl, 'tr').map((tr) => {
    const trPr = directChildren(tr, 'trPr')[0];
    const marker = trPr ? ['ins', 'del'].filter((name) => directChildren(trPr, name).length > 0).join(',') : '';
    return {
      marker,
      cells: directChildren(tr, 'tc').map((tc) => ({
        inserted: textIn(tc, 'ins'),
        deleted: textIn(tc, 'del'),
        text: Array.from(tc.getElementsByTagNameNS(W_NS, 't')).map((text) => text.textContent).join(''),
      })),
    };
  });
}

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-rowpair-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Accept-all is the revised document and reject-all the original, with both appliers and the table footprint. */
async function assertParity(original: Buffer, revised: Buffer, compared: Buffer): Promise<void> {
  const source = await xmlOf(original);
  const target = await xmlOf(revised);
  const output = await xmlOf(compared);
  const accepted = await DocxDocument.load(compared);
  const rejected = await DocxDocument.load(compared);
  await accepted.acceptChanges();
  await rejected.rejectChanges();
  const coreAccepted = await xmlOf((await accepted.toBuffer()).buffer);
  const coreRejected = await xmlOf((await rejected.toBuffer()).buffer);
  for (const [projected, expected] of [
    [acceptAllChanges(output), target],
    [coreAccepted, target],
    [rejectAllChanges(output), source],
    [coreRejected, source],
  ] as const) {
    expect(extractTextWithParagraphs(projected)).toBe(extractTextWithParagraphs(expected));
    expect(bodyTableFootprint(projected)).toEqual(bodyTableFootprint(expected));
  }
}

async function compareChecked(originalBody: string, revisedBody: string, detectMoves?: boolean) {
  const original = await docx(originalBody);
  const revised = await docx(revisedBody);
  const result = await compareDocuments(original, revised, detectMoves === undefined ? {} : { detectMoves });
  await assertParity(original, revised, result.document);
  await assertSchema(result.document);
  return { result, xml: await xmlOf(result.document) };
}

describe('table rows pair by cell-text similarity', () => {
  for (const [name, rows, insertedDescription] of variants) {
    // The issue compared with move detection off (`compare_moves: false`).
    test(`marks the issue generator's ${name} variant per cell and per word`, async () => {
      const { result, xml } = await compareChecked(issueBody(base, R0), issueBody(editedBody, rows), false);
      const view = tableView(xml);
      // Only the truly new row carries a row marker; nothing is deleted.
      expect(view.map((entry) => entry.marker)).toEqual(['', '', '', name === 'row appended' ? '' : 'ins',
        name === 'row appended' ? 'ins' : '']);
      expect(result.stats.insertedTableRows).toBe(1);
      expect(result.stats.deletedTableRows).toBe(0);
      const inserted = view.find((entry) => entry.marker === 'ins')!;
      expect(inserted.cells[1]!.inserted).toBe(insertedDescription);
      // The Total row is edited in place: the changed words, cell by cell.
      const total = view.find((entry) => entry.marker === '' && entry.cells[1]!.text.startsWith('Total'))!;
      if (name === 'row appended') {
        expect(total.cells.map((cell) => [cell.inserted, cell.deleted])).toEqual([['', ''], ['', ''], ['', '']]);
      } else {
        expect(total.cells.map((cell) => [cell.inserted, cell.deleted]))
          .toEqual([['', ''], [' with option', ''], ['$180', '$150']]);
      }
      // Body paragraphs keep word-level marks whatever the table does.
      const paragraphs = Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'body')[0]!.childNodes)
        .filter((node): node is Element => (node as Element).localName === 'p');
      const marksIn = (clause: number) => {
        const paragraph = paragraphs.find((entry) => (entry.textContent ?? '').startsWith(`Clause ${clause}.`))!;
        return {
          inserted: Array.from(paragraph.getElementsByTagNameNS(W_NS, 'ins'))
            .map((node) => node.textContent).join(' '),
          deleted: Array.from(paragraph.getElementsByTagNameNS(W_NS, 'delText'))
            .map((node) => node.textContent).join(' '),
        };
      };
      expect(marksIn(2)).toEqual({ inserted: 'revised ', deleted: '' });
      expect(marksIn(10)).toEqual({ inserted: 'contract', deleted: 'agreement' });
      expect(marksIn(5)).toEqual({ inserted: 'a few ', deleted: 'several' });
      expect(result.stats.moves).toBe(0);
      expect(result.stats.modifiedParagraphs).toBeGreaterThanOrEqual(3);
    });
  }

  test('turns a deleted row beside an unrelated inserted row into whole-row revisions', async () => {
    const { result, xml } = await compareChecked(
      table(R0),
      table([R0[0]!, R0[1]!, [['C', 'Gizmos', '$75'], false], R0[3]!]),
    );
    const view = tableView(xml);
    expect(view.map((entry) => entry.marker)).toEqual(['', '', 'del', 'ins', '']);
    expect(view[2]!.cells.map((cell) => cell.deleted)).toEqual(['B', 'Gadgets', '$50']);
    expect(view[3]!.cells.map((cell) => cell.inserted)).toEqual(['C', 'Gizmos', '$75']);
    expect(result.stats).toMatchObject({ insertedTableRows: 1, deletedTableRows: 1 });
  });

  test('turns a reordered row into a deletion plus an insertion', async () => {
    const { xml } = await compareChecked(
      table(R0),
      table([R0[0]!, R0[2]!, R0[1]!, R0[3]!]),
    );
    expect(tableView(xml).map((entry) => entry.marker).sort()).toEqual(['', '', '', 'del', 'ins']);
  });

  test('pairs an edited row across an inserted row beside it', async () => {
    const { result, xml } = await compareChecked(
      table(R0),
      table([R0[0]!, [['A', 'Widgets', '$120'], false], [['A2', 'Sprockets', '$20'], false], R0[2]!, R0[3]!]),
    );
    const view = tableView(xml);
    expect(view.map((entry) => entry.marker)).toEqual(['', '', 'ins', '', '']);
    expect(view[1]!.cells.map((cell) => [cell.inserted, cell.deleted])).toEqual([['', ''], ['', ''], ['$120', '$100']]);
    expect(result.stats).toMatchObject({ insertedTableRows: 1, deletedTableRows: 0 });
  });

  test('pairs the cells of a paired row by grid interval, not by equal text', async () => {
    // Text keys would anchor the revised first cell to the original second
    // cell and leave the original first and revised second cells side-only.
    const spanned = (cells: string[]) => `<w:tr>${cells.map((text, index) =>
      `<w:tc><w:tcPr>${index === 0 ? '<w:gridSpan w:val="2"/>' : ''}</w:tcPr>${p(text)}</w:tc>`).join('')}</w:tr>`;
    const grid = `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(4)}</w:tblGrid>`;
    const tableOf = (rows: string[]) => `<w:tbl><w:tblPr/>${grid}${rows.join('')}</w:tbl>`;
    const { result, xml } = await compareChecked(
      tableOf([spanned(['Heading', 'Kept', 'Third']), spanned(['Alpha beta', 'Gamma delta', 'Shared column'])]),
      tableOf([spanned(['Heading', 'Kept', 'Third']), spanned(['Gamma delta', 'Epsilon zeta', 'Shared column'])]),
    );
    const view = tableView(xml);
    expect(view.map((entry) => entry.marker)).toEqual(['', '']);
    expect(view[1]!.cells.map((cell) => [cell.inserted, cell.deleted]))
      .toEqual([['Gamma delta', 'Alpha beta'], ['Epsilon zeta', 'Gamma delta'], ['', '']]);
    expect(result.stats).toMatchObject({ insertedTableRows: 0, deletedTableRows: 0 });
  });

  test('pairs across positions only rows whose cell skeleton matches', async () => {
    // The edited row merges two cells and a row is inserted beside it: the
    // topology guard owns skeleton changes, so the rows are not paired.
    const merged = `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${p('A Widgets')}</w:tc>` +
      `<w:tc><w:tcPr/>${p('$100')}</w:tc></w:tr>`;
    const original = await docx(table(R0));
    const revised = await docx(table(R0).replace(row(R0[1]![0], false),
      `${merged}${row(['New', 'Row', '$1'], false)}`));
    const result = await compareDocuments(original, revised);
    await assertParity(original, revised, result.document);
    await assertSchema(result.document);
    expect(tableView(await xmlOf(result.document)).map((entry) => entry.marker)).toEqual(['', 'del', 'ins', 'ins', '', '']);
  });
});

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable LibreOffice or a missing corpus.
const reader = process.env.SAFE_DOCX_TABLE_ROW_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice table-row projections on a real document', () => {
  test('accepts and rejects an edited row beside an inserted row in the NVCA investors rights agreement', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const corpus = process.env[REAL_CORPUS_ENV];
    const sourcePath = corpus ? join(corpus, 'nvca-investors-rights-agreement', 'source.docx') : '';
    expect(existsSync(sourcePath), `${REAL_CORPUS_ENV} must hold the NVCA corpus`).toBe(true);
    const original = readFileSync(sourcePath);
    const archive = await DocxArchive.load(original);
    const document = parseXml(await archive.getDocumentXml());
    const governance = Array.from(document.getElementsByTagNameNS(W_NS, 'tbl'))
      .find((tbl) => (tbl.textContent ?? '').includes('Required Governance Policy'))!;
    const rows = directChildren(governance, 'tr');
    const conduct = rows.find((entry) => (entry.textContent ?? '').includes('Code of conduct'))!;
    // Edit the deadline cell in place.
    const deadline = Array.from(directChildren(conduct, 'tc')[1]!.getElementsByTagNameNS(W_NS, 't'))
      .find((text) => (text.textContent ?? '').includes('60'))!;
    deadline.textContent = deadline.textContent!.replace('60', '45');
    // Insert an unrelated row after it.
    const added = conduct.cloneNode(true) as Element;
    for (const marker of ['bookmarkStart', 'bookmarkEnd']) {
      for (const node of Array.from(added.getElementsByTagNameNS(W_NS, marker))) node.parentNode!.removeChild(node);
    }
    for (const paragraph of Array.from(added.getElementsByTagNameNS(W_NS, 'p'))) {
      for (const attribute of ['paraId', 'textId']) {
        paragraph.removeAttributeNS('http://schemas.microsoft.com/office/word/2010/wordml', attribute);
      }
    }
    directChildren(added, 'tc').forEach((cell, index) => {
      const texts = Array.from(cell.getElementsByTagNameNS(W_NS, 't'));
      texts.forEach((text, position) => {
        text.textContent = position === 0 ? (index === 0 ? '[Data retention policy' : '[120] days post-Closing]') : '';
      });
    });
    conduct.parentNode!.insertBefore(added, conduct.nextSibling);
    // And an ordinary body edit.
    const bodyText = Array.from(document.getElementsByTagNameNS(W_NS, 't'))
      .find((text) => (text.textContent ?? '').includes('Investors'))!;
    bodyText.textContent = `${bodyText.textContent} (as amended)`;
    archive.setDocumentXml(serializeXml(document));
    const revised = await archive.save();

    const result = await compareDocuments(original, revised);
    await assertParity(original, revised, result.document);
    await assertSchema(result.document);
    const view = tableView(await xmlOf(result.document),
      Array.from(parseXml(await xmlOf(result.document)).getElementsByTagNameNS(W_NS, 'tbl'))
        .findIndex((tbl) => (tbl.textContent ?? '').includes('Required Governance Policy')));
    expect(view.filter((entry) => entry.marker !== '').map((entry) => entry.marker)).toEqual(['ins']);
    expect(view.find((entry) => entry.cells[0]!.text.includes('Code of conduct'))!.cells[1])
      .toMatchObject({ inserted: '45', deleted: '60' });

    const states = await runLibreOfficeOracle([
      { op: 'identity', docx: original, saveAs: 'odt' }, { op: 'identity', docx: revised, saveAs: 'odt' },
      { op: 'accept', docx: result.document, saveAs: 'odt' }, { op: 'reject', docx: result.document, saveAs: 'odt' },
    ]);
    const TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
    const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
    const project = (content: string) => {
      const parsed = parseXml(content);
      return {
        paragraphs: Array.from(parsed.getElementsByTagName('*'))
          .filter((node) => node.namespaceURI === TEXT && ['p', 'h'].includes(node.localName))
          .map((node) => node.textContent),
        rows: Array.from(parsed.getElementsByTagNameNS(TABLE, 'table')).map((tbl) =>
          Array.from(tbl.getElementsByTagNameNS(TABLE, 'table-row')).map((tr) =>
            Array.from(tr.getElementsByTagNameNS(TABLE, 'table-cell')).map((cell) => cell.textContent))),
      };
    };
    // Every table, row by row and cell by cell, matches LibreOffice's own
    // reading of the revised and original documents. Paragraph text outside
    // tables is compared only for the body edit: LibreOffice recomputes REF
    // field results when it resolves the comparison output, which is not a
    // table-row concern.
    const [originalState, revisedState, acceptedState, rejectedState] = states.map(project);
    expect(acceptedState!.rows).toEqual(revisedState!.rows);
    expect(rejectedState!.rows).toEqual(originalState!.rows);
    const edited = (state: ReturnType<typeof project>) =>
      state.paragraphs.filter((text) => (text ?? '').includes('(as amended)')).length;
    expect(edited(acceptedState!)).toBe(edited(revisedState!));
    expect(edited(acceptedState!)).toBeGreaterThan(0);
    expect(edited(rejectedState!)).toBe(0);
  }, 240000);
});
