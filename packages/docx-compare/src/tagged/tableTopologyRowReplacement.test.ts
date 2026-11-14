/**
 * A matched table row whose cell skeleton changes (cell count, a horizontal
 * merge or split through `w:gridSpan`/`w:hMerge`, or the `w:gridBefore`/
 * `w:gridAfter` offsets) is redlined as the original row deleted, immediately
 * followed by the revised row inserted, in the same table. Unchanged rows keep
 * no marker, and the rest of the document keeps its ordinary redline.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.17
 * @see https://github.com/UseJunior/safe-docx/issues/1396
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
import { duplicateRevisionIdsInPackage } from '../testing/revisionIdUniqueness.js';
import { compareDocuments } from '../index.js';
import { acceptAllChanges, extractTextWithParagraphs, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { bodyTableFootprint } from './tableTopologyGuard.js';
import { REAL_CORPUS_ENV } from '../integration/real-corpus-fixtures.js';

const TEST_FEATURE = 'Table Topology Row Replacement';
const test = testAllure.epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.12' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.17' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.17' },
  );

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const schemaScript = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (texts: string[], tcPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${tcPr}</w:tcPr>${texts.map(p).join('')}</w:tc>`;
const row = (cells: string[], trPr = '') => `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const plain = (texts: string[], trPr = '') => row(texts.map((text) => cell([text])), trPr);
const table = (rows: string[]) =>
  '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid>' +
  `${'<w:gridCol w:w="3000"/>'.repeat(3)}</w:tblGrid>${rows.join('')}</w:tbl>`;
const intro = 'The parties agree to the schedule below, which lists each signatory and its notice address.';
const body = (rows: string[], introText = intro) =>
  p(introText) + table(rows) + p('After the table, a closing paragraph.');
const secondRow = plain(['Delta', 'Echo', 'Foxtrot']);
const editedIntro = intro.replace('agree to', 'acknowledge');

/** Original first row, revised first row: every other row and paragraph matches except one body edit. */
const CASES: Array<[string, string, string]> = [
  // The issue's reproduction: the last two cells of row 1 merge.
  ['horizontal merge through gridSpan', plain(['Alpha', 'Bravo', 'Charlie']),
    row([cell(['Alpha']), cell(['Bravo', 'Charlie'], '<w:gridSpan w:val="2"/>')])],
  ['horizontal split of a gridSpan cell', row([cell(['Alpha']), cell(['Bravo Charlie'], '<w:gridSpan w:val="2"/>')]),
    plain(['Alpha', 'Bravo', 'Charlie'])],
  ['cell insert into a short row', plain(['Alpha', 'Bravo'], '<w:gridAfter w:val="1"/>'),
    plain(['Alpha', 'Bravo', 'Charlie'])],
  ['cell delete from a full row', plain(['Alpha', 'Bravo', 'Charlie']),
    plain(['Alpha', 'Bravo'], '<w:gridAfter w:val="1"/>')],
  ['gridBefore offset change', plain(['Alpha', 'Bravo', 'Charlie']),
    plain(['Bravo', 'Charlie'], '<w:gridBefore w:val="1"/>')],
  ['gridBefore to gridAfter shift', plain(['Bravo', 'Charlie'], '<w:gridBefore w:val="1"/>'),
    plain(['Bravo', 'Charlie'], '<w:gridAfter w:val="1"/>')],
  ['legacy horizontal merge through hMerge', plain(['Alpha', 'Bravo', 'Charlie']),
    row([cell(['Alpha'], '<w:hMerge w:val="restart"/>'), cell(['Bravo'], '<w:hMerge/>'), cell(['Charlie'])])],
];

const docx = (xml: string) => buildDocxFromBodyXml(xml);
const xmlOf = async (buffer: Buffer) => (await DocxArchive.load(buffer)).getDocumentXml();
const directChildren = (parent: Element, name: string) =>
  Array.from(parent.childNodes).filter((node): node is Element =>
    node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (node as Element).localName === name);

/** Per row of the first table: its `w:trPr` revision markers and whether its content carries any revision. */
function rowMarkers(xml: string): Array<{ markers: string[]; contentRevisions: number }> {
  const tbl = parseXml(xml).getElementsByTagNameNS(W_NS, 'tbl')[0]!;
  return directChildren(tbl, 'tr').map((tr) => {
    const trPr = directChildren(tr, 'trPr')[0];
    const markers = trPr ? Array.from(trPr.childNodes)
      .filter((node): node is Element => node.nodeType === 1 && ['ins', 'del'].includes((node as Element).localName))
      .map((node) => node.localName) : [];
    const contentRevisions = Array.from(tr.getElementsByTagNameNS(W_NS, 'tc'))
      .reduce((count, tc) => count + tc.getElementsByTagNameNS(W_NS, 'ins').length
        + tc.getElementsByTagNameNS(W_NS, 'del').length, 0);
    return { markers, contentRevisions };
  });
}

async function assertSchema(buffer: Buffer): Promise<void> {
  // Every revision keeps its own identifier (#1466).
  expect(await duplicateRevisionIdsInPackage(buffer)).toEqual([]);
  const directory = await mkdtemp(join(tmpdir(), 'sdx-rowreplace-'));
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
 * on text and on the body table footprint.
 */
async function assertParity(original: Buffer, revised: Buffer, compared: Buffer): Promise<void> {
  const output = await xmlOf(compared);
  const accepted = await DocxDocument.load(compared);
  const rejected = await DocxDocument.load(compared);
  await accepted.acceptChanges();
  await rejected.rejectChanges();
  const expectedAccept = acceptAllChanges(await xmlOf(revised));
  const expectedReject = rejectAllChanges(await xmlOf(original));
  for (const [projected, expected] of [
    [acceptAllChanges(output), expectedAccept],
    [await xmlOf((await accepted.toBuffer()).buffer), expectedAccept],
    [rejectAllChanges(output), expectedReject],
    [await xmlOf((await rejected.toBuffer()).buffer), expectedReject],
  ] as const) {
    expect(extractTextWithParagraphs(projected)).toBe(extractTextWithParagraphs(expected));
    expect(bodyTableFootprint(projected)).toEqual(bodyTableFootprint(expected));
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

describe('matched rows whose cell skeleton changes', () => {
  for (const [name, originalRow, revisedRow] of CASES) {
    test.openspec('[SDX-COMPTABLE-03] individual-cell topology emits a native row replacement')(
      `redlines a ${name} as the old row deleted then the new row inserted`, async () => {
        const { result, xml } = await compareChecked(
          body([originalRow, secondRow]),
          body([revisedRow, secondRow], editedIntro),
        );
        const rows = rowMarkers(xml);
        expect(rows.map((entry) => entry.markers)).toEqual([['del'], ['ins'], []]);
        // The unchanged row is untouched.
        expect(rows[2]!.contentRevisions).toBe(0);
        expect(result.stats.deletedTableRows).toBe(1);
        expect(result.stats.insertedTableRows).toBe(1);
        // The ordinary body edit keeps its word-level redline.
        const first = parseXml(xml).getElementsByTagNameNS(W_NS, 'p')[0]!;
        expect(Array.from(first.getElementsByTagNameNS(W_NS, 'delText')).map((node) => node.textContent).join(''))
          .toContain('agree to');
      },
    );
  }

  test.openspec('[SDX-COMPTABLE-03] individual-cell topology emits a native row replacement')(
    'replaces only the changed row in the middle of a longer table', async () => {
      const first = plain(['Name', 'Title', 'Address']);
      const { xml } = await compareChecked(
        body([first, plain(['Alpha', 'Bravo', 'Charlie']), secondRow]),
        body([first, row([cell(['Alpha']), cell(['Bravo', 'Charlie'], '<w:gridSpan w:val="2"/>')]), secondRow]),
      );
      expect(rowMarkers(xml).map((entry) => entry.markers)).toEqual([[], ['del'], ['ins'], []]);
      expect(rowMarkers(xml)[0]!.contentRevisions).toBe(0);
    },
  );

  test.openspec('[SDX-COMPTABLE-03] individual-cell topology emits a native row replacement')(
    'publishes a paragraph moved into a replaced row as a plain deletion and insertion, never a move', async () => {
      const moved = 'Notices to the Company shall be sent to its registered office by certified mail.';
      const { result, xml } = await compareChecked(
        p(moved) + body([plain(['Alpha', 'Bravo', 'Charlie']), secondRow]),
        body([row([cell(['Alpha']), cell(['Bravo', moved], '<w:gridSpan w:val="2"/>')]), secondRow]),
      );
      expect(rowMarkers(xml).map((entry) => entry.markers)).toEqual([['del'], ['ins'], []]);
      const parsed = parseXml(xml);
      for (const name of ['moveFrom', 'moveTo', 'moveFromRangeStart', 'moveToRangeStart']) {
        expect(parsed.getElementsByTagNameNS(W_NS, name).length, name).toBe(0);
      }
      expect(result.stats.moves).toBe(0);
    },
  );

  test.openspec('[SDX-COMPTABLE-03] individual-cell topology emits a native row replacement')(
    'keeps a bookmark that crosses out of a replaced or whole-row-revised row balanced in both projections', async () => {
      const start = '<w:bookmarkStart w:id="7" w:name="CrossRow"/>';
      const end = '<w:bookmarkEnd w:id="7"/>';
      const marked = (text: string, before = '', after = '') =>
        `<w:p>${before}<w:r><w:t xml:space="preserve">${text}</w:t></w:r>${after}</w:p>`;
      const split = (first: string) => row([cell([]).replace('</w:tcPr>', `</w:tcPr>${first}`), cell(['Bravo']), cell(['Charlie'])]);
      const merged = (first: string) => row([cell([]).replace('</w:tcPr>', `</w:tcPr>${first}`),
        cell(['Bravo', 'Charlie'], '<w:gridSpan w:val="2"/>')]);
      const endingRow = row([cell([]).replace('</w:tcPr>', `</w:tcPr>${marked('Delta', '', end)}`), cell(['Echo']), cell(['Foxtrot'])]);
      const startingRow = row([cell([]).replace('</w:tcPr>', `</w:tcPr>${marked('Delta', start)}`), cell(['Echo']), cell(['Foxtrot'])]);
      const pending = (source: string, kind: 'ins' | 'del') =>
        source.replace('<w:tr>', `<w:tr><w:trPr><w:${kind} w:id="90" w:author="Earlier" w:date="2026-01-01T00:00:00Z"/></w:trPr>`);
      const earlierStart = (kind: 'ins' | 'del') => {
        const textTag = kind === 'del' ? 'w:delText' : 'w:t';
        return `<w:p><w:${kind} w:id="92" w:author="Earlier" w:date="2026-01-01T00:00:00Z">${start}<w:r>` +
          `<${textTag} xml:space="preserve">Alpha</${textTag}></w:r></w:${kind}></w:p>`;
      };
      const earlierAfter = (kind: 'ins' | 'del') => {
        const textTag = kind === 'del' ? 'w:delText' : 'w:t';
        return `<w:p><w:${kind} w:id="91" w:author="Earlier" w:date="2026-01-01T00:00:00Z"><w:r>` +
          `<${textTag} xml:space="preserve">After</${textTag}></w:r>${end}</w:${kind}></w:p>`;
      };
      const cases: Array<[string, string, string]> = [
        // Start in the replaced row, end in the next row.
        ['into the next row', table([split(marked('Alpha', start)), endingRow]), table([merged(marked('Alpha', start)), endingRow])],
        // Start in the replaced row, end in body text after the table.
        ['into the body', table([split(marked('Alpha', start)), secondRow]) + marked('After', '', end),
          table([merged(marked('Alpha', start)), secondRow]) + marked('After', '', end)],
        // Start in an earlier row, end in the replaced row.
        ['from an earlier row', table([startingRow, split(marked('Alpha', '', end))]),
          table([startingRow, merged(marked('Alpha', '', end))])],
        // The same crossing from a dissimilar same-skeleton row, published as whole-row revisions (#1227).
        ['from a dissimilar row', table([plain(['Apple', 'Orchard', 'Red']).replace('<w:p>', `<w:p>${start}`), endingRow]),
          table([plain(['Zebra', 'Crossing', 'Black']).replace('<w:p>', `<w:p>${start}`), endingRow])],
        // A replaced row that already carries a pending revision of the other
        // kind leaves with both Accept All and Reject All, and so must the
        // outside end of its side's range (here inside an earlier revision).
        ['from a row with a pending insertion',
          table([pending(split(marked('Alpha', start)), 'ins'), secondRow]) + earlierAfter('ins'),
          table([merged(marked('Alpha', start)), secondRow]) + marked('After', '', end)],
        ['into a row with a pending deletion', table([split(marked('Alpha', start)), secondRow]) + marked('After', '', end),
          table([pending(merged(marked('Alpha', start)), 'del'), secondRow]) + earlierAfter('del')],
        // The same rows with the outside end in plain text: one source
        // projection already lacks the start, and the redline must not add an
        // orphan to the other.
        ['from a row with a pending insertion to plain text',
          table([pending(split(marked('Alpha', start)), 'ins'), secondRow]) + marked('After', '', end),
          table([merged(marked('Alpha', start)), secondRow]) + marked('After', '', end)],
        ['into a row with a pending deletion from plain text',
          table([split(marked('Alpha', start)), secondRow]) + marked('After', '', end),
          table([pending(merged(marked('Alpha', start)), 'del'), secondRow]) + marked('After', '', end)],
        // A pending inline revision around the start inside the replaced row:
        // the outside end is left to the projection's own counterpart cleanup.
        ...(['ins', 'del'] as const).map((kind): [string, string, string] => [
          `from a pending inline ${kind === 'ins' ? 'insertion' : 'deletion'} in a replaced row`,
          table([split(earlierStart(kind)), secondRow]) + marked('After', '', end),
          table([merged(earlierStart(kind)), secondRow]) + marked('After', '', end)]),
      ];
      // Unmatched and duplicate boundary counts: a projection of the redline
      // must be as balanced as the same projection of its source.
      const integrity = (xml: string) => {
        const report = validateBookmarkIntegrity(xml);
        return [report.unmatchedStartIds, report.unmatchedEndIds, report.duplicateStartIds, report.duplicateEndIds]
          .map((ids) => ids.length);
      };
      for (const [name, originalBody, revisedBody] of cases) {
        const original = await docx(originalBody);
        const revised = await docx(revisedBody);
        const result = await compareDocuments(original, revised);
        await assertParity(original, revised, result.document);
        await assertSchema(result.document);
        const output = await xmlOf(result.document);
        const accepted = await DocxDocument.load(result.document);
        const rejected = await DocxDocument.load(result.document);
        await accepted.acceptChanges();
        await rejected.rejectChanges();
        const sourceAccept = integrity(acceptAllChanges(await xmlOf(revised)));
        const sourceReject = integrity(rejectAllChanges(await xmlOf(original)));
        // Comparison projections match their source; docx-core repairs any
        // orphan the source carried, so its projections are always balanced.
        for (const [projection, projected, expected] of [
          ['comparison accept', acceptAllChanges(output), sourceAccept],
          ['comparison reject', rejectAllChanges(output), sourceReject],
          ['docx-core accept', await xmlOf((await accepted.toBuffer()).buffer), [0, 0, 0, 0]],
          ['docx-core reject', await xmlOf((await rejected.toBuffer()).buffer), [0, 0, 0, 0]],
        ] as const) {
          expect(integrity(projected), `${name}: ${projection}`).toEqual(expected);
        }
      }
    },
    // Several full comparisons, each with schema and projection checks.
    60000,
  );

  test.openspec('[SDX-COMPTABLE-03] individual-cell topology emits a native row replacement')(
    'keeps a crossing bookmark as balanced as its source under every mix of pending row, inline and paragraph-mark revisions', async () => {
      // A start inside the replaced row and an end in the next paragraph, each
      // optionally inside earlier inline revisions, with an optional pending
      // row revision on either side. Each comparison projection must be at
      // least as balanced as the same projection of its source, and a range
      // the source keeps whole must cover the same text.
      const crossStart = '<w:bookmarkStart w:id="7" w:name="Cross"/>';
      const crossEnd = '<w:bookmarkEnd w:id="7"/>';
      const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
      const wrappers: string[][] = [[], ['ins'], ['del'], ['moveFrom'], ['moveTo'], ['ins', 'del'], ['del', 'ins']];
      let revisionId = 50;
      const wrap = (path: string[], content: string) => path.reduceRight((inner, kind) =>
        `<w:${kind} w:id="${revisionId++}" w:author="Earlier">${inner}</w:${kind}>`, content);
      // `mark` optionally gives the start's paragraph (`inside`) or the end's
      // paragraph (`outside`) a tracked paragraph mark.
      const source = (merged: boolean, rowKind: string, inner: string[], outer: string[], mark = '', at = '') => {
        revisionId = 50;
        const pPr = mark ? `<w:pPr><w:rPr><w:${mark} w:id="49" w:author="Earlier"/></w:rPr></w:pPr>` : '';
        const trPr = rowKind ? `<w:trPr><w:${rowKind} w:id="40" w:author="Earlier"/></w:trPr>` : '';
        const first = `<w:tc><w:tcPr>${merged ? '<w:gridSpan w:val="2"/>' : ''}</w:tcPr>` +
          `<w:p>${at === 'inside' ? pPr : ''}${wrap(inner, crossStart + run('Alpha'))}</w:p>` +
          `${merged ? `<w:p>${run('Beta')}</w:p>` : ''}</w:tc>`;
        const second = merged ? '' : `<w:tc><w:tcPr/><w:p>${run('Beta')}</w:p></w:tc>`;
        return '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
          `<w:tr>${trPr}${first}${second}</w:tr></w:tbl>` +
          `<w:p>${at === 'outside' ? pPr : ''}${run('Before')}${wrap(outer, run('After') + crossEnd)}</w:p>`;
      };
      const summary = (xml: string) => {
        const report = validateBookmarkIntegrity(xml);
        const document = parseXml(xml);
        let inside = false;
        let span = '';
        for (const element of Array.from(document.getElementsByTagNameNS(W_NS, '*'))) {
          if (element.localName === 'bookmarkStart') inside = true;
          else if (element.localName === 'bookmarkEnd') inside = false;
          else if (inside && (element.localName === 't' || element.localName === 'delText')) span += element.textContent;
        }
        return {
          starts: document.getElementsByTagNameNS(W_NS, 'bookmarkStart').length,
          ends: document.getElementsByTagNameNS(W_NS, 'bookmarkEnd').length,
          span,
          broken: report.unmatchedStartIds.length + report.unmatchedEndIds.length +
            report.duplicateStartIds.length + report.duplicateEndIds.length,
        };
      };
      const failures: string[] = [];
      const check = async (label: string, originalBody: string, revisedBody: string) => {
        const original = await docx(originalBody);
        const revised = await docx(revisedBody);
        const output = await xmlOf((await compareDocuments(original, revised)).document);
        for (const [side, project, from] of [
          ['accept', acceptAllChanges, revised], ['reject', rejectAllChanges, original],
        ] as const) {
          const expected = summary(project(await xmlOf(from)));
          const actual = summary(project(output));
          const wholeRange = expected.starts === 1 && expected.ends === 1 && actual.starts === 1 && actual.ends === 1;
          if (actual.broken > expected.broken || (wholeRange && actual.span !== expected.span)) {
            failures.push(`${side} ${label}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);
          }
        }
      };
      for (const originalRowKind of ['', 'ins', 'del']) for (const revisedRowKind of ['', 'ins', 'del']) {
        for (const inner of wrappers) for (const outer of wrappers) {
          await check(`row=${originalRowKind || '-'}/${revisedRowKind || '-'} start=${inner.join('>') || '-'} ` +
            `end=${outer.join('>') || '-'}`,
          source(false, originalRowKind, inner, outer), source(true, revisedRowKind, inner, outer));
        }
      }
      // A tracked paragraph mark on either paragraph, with the same pending row revision on both sides.
      for (const mark of ['ins', 'del', 'moveFrom', 'moveTo']) for (const at of ['inside', 'outside']) {
        for (const rowKind of ['', 'ins', 'del']) for (const inner of wrappers) for (const outer of wrappers.slice(0, 3)) {
          await check(`mark=${mark}@${at} row=${rowKind || '-'} start=${inner.join('>') || '-'} end=${outer.join('>') || '-'}`,
            source(false, rowKind, inner, outer, mark, at), source(true, rowKind, inner, outer, mark, at));
        }
      }
      expect(failures).toEqual([]);
    },
    120000,
  );

  test.openspec('[SDX-COMPTABLE-03] individual-cell topology emits a native row replacement')(
    'never gives a replaced row a second marker of the kind its trPr already carries', async () => {
      const earlier = (kind: 'ins' | 'del') =>
        `<w:${kind} w:id="90" w:author="Earlier" w:date="2026-01-01T00:00:00Z"/>`;
      const merged = row([cell(['Alpha']), cell(['Bravo', 'Charlie'], '<w:gridSpan w:val="2"/>')]);
      const split = (trPr = '') => plain(['Alpha', 'Bravo', 'Charlie'], trPr);
      const withMarker = (source: string, kind: 'ins' | 'del') => source.replace('<w:tr>',
        `<w:tr><w:trPr>${earlier(kind)}</w:trPr>`);
      // [original row, revised row, deletedTableRows, insertedTableRows]: the
      // counters count only the row markers this comparison emits, so a kept
      // pending marker of the same kind (with its attribution) is not counted.
      for (const [originalRow, revisedRow, deletedRows, insertedRows] of [
        // A pending insertion or deletion on the original row being replaced.
        [split(earlier('ins')), merged, 1, 1],
        [split(earlier('del')), merged, 0, 1],
        // A pending insertion or deletion on the revised row replacing it.
        [split(), withMarker(merged, 'ins'), 1, 0],
        [split(), withMarker(merged, 'del'), 1, 1],
      ] as const) {
        const { result, xml } = await compareChecked(body([originalRow, secondRow]), body([revisedRow, secondRow]));
        for (const trPr of Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'trPr'))) {
          for (const kind of ['ins', 'del']) expect(directChildren(trPr, kind).length).toBeLessThanOrEqual(1);
        }
        expect([result.stats.deletedTableRows, result.stats.insertedTableRows]).toEqual([deletedRows, insertedRows]);
        const kept = Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'trPr'))
          .flatMap((trPr) => [...directChildren(trPr, 'ins'), ...directChildren(trPr, 'del')])
          .filter((marker) => marker.getAttributeNS(W_NS, 'author') === 'Earlier');
        expect(kept).toHaveLength(1);
      }
    },
    // Several full comparisons, each with schema and projection checks.
    60000,
  );
});

const TABLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const TEXT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';

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

function odtParagraphs(content: string): string[] {
  return Array.from(parseXml(content).getElementsByTagName('*'))
    .filter((node) => node.namespaceURI === TEXT_NS && ['p', 'h'].includes(node.localName))
    .map((node) => node.textContent ?? '');
}

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable LibreOffice or a missing corpus.
const reader = process.env.SAFE_DOCX_TABLE_TOPOLOGY_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice reads row replacements as the source tables', () => {
  test.openspec('[SDX-COMPTABLE-03] individual-cell topology emits a native row replacement')(
    'accepts and rejects every synthetic row replacement to the revised and original tables', async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      // LibreOffice drops the row marker of any row holding legacy `w:hMerge`
      // cells on import (a plain whole-row insertion of such a row leaves an
      // empty spanned row on Reject too), so that case is Word-verified only.
      const readerCases = CASES.filter(([name]) => !name.includes('hMerge'));
      const items = await Promise.all(readerCases.map(async ([, originalRow, revisedRow]) => {
        const original = await docx(body([originalRow, secondRow]));
        const revised = await docx(body([revisedRow, secondRow], editedIntro));
        return { original, revised, compared: (await compareDocuments(original, revised)).document };
      }));
      const states = await runLibreOfficeOracle(items.flatMap((item) => [
        { op: 'identity' as const, docx: item.original, saveAs: 'odt' as const },
        { op: 'identity' as const, docx: item.revised, saveAs: 'odt' as const },
        { op: 'accept' as const, docx: item.compared, saveAs: 'odt' as const },
        { op: 'reject' as const, docx: item.compared, saveAs: 'odt' as const },
      ]));
      readerCases.forEach(([name], index) => {
        const [original, revised, accepted, rejected] = states.slice(index * 4, index * 4 + 4).map(odtTables);
        expect(accepted, `${name} accept`).toEqual(revised);
        expect(rejected, `${name} reject`).toEqual(original);
      });
    },
    600000,
  );

  test.openspec('[SDX-COMPTABLE-03] individual-cell topology emits a native row replacement')(
    'replaces a merged row in the NVCA investors rights agreement governance table beside a body edit', async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const corpus = process.env[REAL_CORPUS_ENV];
      const sourcePath = corpus ? join(corpus, 'nvca-investors-rights-agreement', 'source.docx') : '';
      expect(existsSync(sourcePath), `${REAL_CORPUS_ENV} must hold the NVCA corpus`).toBe(true);
      const original = readFileSync(sourcePath);
      const archive = await DocxArchive.load(original);
      const document = parseXml(await archive.getDocumentXml());
      const governance = Array.from(document.getElementsByTagNameNS(W_NS, 'tbl'))
        .find((tbl) => (tbl.textContent ?? '').includes('Required Governance Policy'))!;
      const conduct = directChildren(governance, 'tr')
        .find((entry) => (entry.textContent ?? '').includes('Code of conduct'))!;
      // Merge the policy and deadline cells into one cell spanning both columns.
      const [policy, deadline] = directChildren(conduct, 'tc') as [Element, Element];
      const tcPr = directChildren(policy, 'tcPr')[0]!;
      const span = document.createElementNS(W_NS, 'w:gridSpan');
      span.setAttributeNS(W_NS, 'w:val', '2');
      tcPr.insertBefore(span, directChildren(tcPr, 'tcW')[0]?.nextSibling ?? tcPr.firstChild);
      for (const paragraph of directChildren(deadline, 'p')) policy.appendChild(paragraph);
      conduct.removeChild(deadline);
      // And an ordinary body edit.
      const bodyText = Array.from(document.getElementsByTagNameNS(W_NS, 't'))
        .find((text) => (text.textContent ?? '').includes('Investors'))!;
      bodyText.textContent = `${bodyText.textContent} (as amended)`;
      archive.setDocumentXml(serializeXml(document));
      const revised = await archive.save();

      const result = await compareDocuments(original, revised);
      await assertParity(original, revised, result.document);
      await assertSchema(result.document);
      expect(result.stats.deletedTableRows).toBe(1);
      expect(result.stats.insertedTableRows).toBe(1);

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
