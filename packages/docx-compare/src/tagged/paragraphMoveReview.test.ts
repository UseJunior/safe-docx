import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { XMLSerializer } from '@xmldom/xmldom';
import { describe, expect } from 'vitest';
import { DocxArchive, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml, paragraphWithText, resultText } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { compareDocuments } from '../index.js';
import { constructTaggedTree } from './taggedTreeConstruction.js';
import { createPreservePlan, serializeTaggedTree, verifySerializedMoveRanges } from './taggedTreeSerializer.js';
import { moveBalanceIssues } from '../integration/strategy-differential-harness.js';
import { isParagraphMoveMarker } from './revisionMarkup.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const TEST_FEATURE = 'refactor-tracked-paragraph-move-ownership';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.21' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.22' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.25' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.26' },
  );
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const schemaScript = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));

function moveFixture() {
  const body = (text: string[]) => parseXml(`<w:document xmlns:w="${W_NS}"><w:body>${text.map(paragraphWithText).join('')}</w:body></w:document>`).documentElement;
  const original = body(['A', 'B']);
  const revised = body(['B', 'A']);
  const { tree, moves } = constructTaggedTree(original, revised);
  const xml = serializeTaggedTree(tree, createPreservePlan(original, revised, tree, {
    author: 'Comparator', date: '2026-09-07T00:00:00Z',
  }), { moves });
  return { document: parseXml(xml), moves };
}

describe('paragraph move review regressions', () => {
  test.openspec('Adjacent detected moves retain conservative ownership')
    ('preserves exact projections and valid ranges across all three-to-five-paragraph reorderings', () => {
    const labels = ['alpha paragraph one', 'bravo paragraph two', 'charlie paragraph three',
      'delta paragraph four', 'echo paragraph five'];
    const permutations = (items: string[]): string[][] => items.length === 0 ? [[]] :
      items.flatMap((item, index) => permutations(items.filter((_, position) => position !== index))
        .map((rest) => [item, ...rest]));
    for (const count of [3, 4, 5]) {
      const originalTexts = labels.slice(0, count);
      for (const revisedTexts of permutations(originalTexts)) {
        const makeBody = (texts: string[]) => parseXml(`<w:document xmlns:w="${W_NS}"><w:body>${texts.map(paragraphWithText).join('')}</w:body></w:document>`).documentElement;
        const original = makeBody(originalTexts);
        const revised = makeBody(revisedTexts);
        const { tree, moves } = constructTaggedTree(original, revised);
        const xml = serializeTaggedTree(tree, createPreservePlan(original, revised, tree, {
          author: 'Comparator', date: '2026-09-23T00:00:00Z',
        }), { moves });
        const texts = (projection: string) => Array.from(parseXml(projection).getElementsByTagNameNS(W_NS, 'p'))
          .map((paragraph) => paragraph.textContent);
        expect(texts(acceptAllChanges(xml)), revisedTexts.join('|')).toEqual(revisedTexts);
        expect(texts(rejectAllChanges(xml)), revisedTexts.join('|')).toEqual(originalTexts);
        expect(verifySerializedMoveRanges(xml, moves), revisedTexts.join('|')).toEqual([]);
      }
    }
  });
  // coverage-rationale: One placement matrix compares all three paragraph-break ownership topologies with identical structural and projection assertions.
  test.openspec('Terminal destination uses created-break ownership')
    .openspec('Terminal source uses removed-break ownership')
    .openspec('Middle move retains paragraph-mark move ownership')
    ('uses Word-native paragraph-break ownership when a move crosses the body terminus', async () => {
    const moved = 'the complete movable clause paragraph changes its position here';
    const first = 'first stable anchor paragraph remains unchanged in its position';
    const second = 'second stable anchor paragraph remains unchanged throughout';
    for (const scenario of [
      {
        name: 'terminal destination',
        original: [moved, first, second],
        revised: [first, second, moved],
        marks: [['del'], [], ['ins'], []],
        terminalCrossing: true,
      },
      {
        name: 'terminal source',
        original: [first, second, moved],
        revised: [moved, first, second],
        marks: [['ins'], [], ['del'], []],
        terminalCrossing: true,
      },
      {
        name: 'middle',
        original: [moved, first, second],
        revised: [first, moved, second],
        marks: [['moveFrom'], [], ['moveTo'], []],
        terminalCrossing: false,
      },
    ]) {
      const compared = await compareDocuments(
        await buildDocxFromBodyXml(scenario.original.map((text) => paragraphWithText(text)).join('')),
        await buildDocxFromBodyXml(scenario.revised.map((text) => paragraphWithText(text)).join('')),
        { detectMoves: true, author: 'Comparator', date: new Date('2026-09-23T00:00:00Z') },
      );
      const xml = await (await DocxArchive.load(compared.document)).getDocumentXml();
      const document = parseXml(xml);
      const body = document.getElementsByTagNameNS(W_NS, 'body')[0]!;
      const paragraphs = Array.from(body.childNodes).filter((node): node is Element =>
        node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (node as Element).localName === 'p');
      const markNames = paragraphs.map((paragraph) => {
        const pPr = Array.from(paragraph.childNodes).find((node) =>
          node.nodeType === 1 && (node as Element).localName === 'pPr') as Element | undefined;
        const rPr = pPr && Array.from(pPr.childNodes).find((node) =>
          node.nodeType === 1 && (node as Element).localName === 'rPr') as Element | undefined;
        return rPr ? Array.from(rPr.childNodes).filter((node): node is Element => node.nodeType === 1)
          .map((node) => node.localName) : [];
      });
      expect(markNames, scenario.name).toEqual(scenario.marks);
      if (scenario.terminalCrossing) {
        expect(paragraphs.every((paragraph) =>
          paragraph.hasAttributeNS(W_NS, 'rsidR') &&
          paragraph.hasAttributeNS(W_NS, 'rsidRDefault')), `${scenario.name} revision sessions`).toBe(true);
      }
      for (const direction of ['From', 'To']) {
        const start = document.getElementsByTagNameNS(W_NS, `move${direction}RangeStart`)[0]!;
        const end = document.getElementsByTagNameNS(W_NS, `move${direction}RangeEnd`)[0]!;
        expect((start.parentNode as Element).localName, `${scenario.name} ${direction} start`).toBe('p');
        expect((end.parentNode as Element).localName, `${scenario.name} ${direction} end`)
          .toBe(scenario.terminalCrossing ? 'p' : 'body');
      }
      expect(Array.from(parseXml(acceptAllChanges(xml)).getElementsByTagNameNS(W_NS, 'p'))
        .map((paragraph) => paragraph.textContent), `${scenario.name} accept`).toEqual(scenario.revised);
      expect(Array.from(parseXml(rejectAllChanges(xml)).getElementsByTagNameNS(W_NS, 'p'))
        .map((paragraph) => paragraph.textContent), `${scenario.name} reject`).toEqual(scenario.original);
    }
  });

  test.openspec('Accept removes source-range bookmarks')
    .openspec('Reject removes destination-range bookmarks')
    ('allocates distinct revisions when interior bookmarks split moved paragraph content', async () => {
    const movedText = 'Moved opening bookmarked words trailing words';
    const moved = `<w:p>${resultText('Moved opening ')}<w:bookmarkStart w:id="7" w:name="Clause"/>`
      + '<w:r><w:rPr><w:b/></w:rPr><w:t>bookmarked words</w:t></w:r>'
      + `<w:bookmarkEnd w:id="7"/>${resultText(' trailing words')}</w:p>`;
    const stable = paragraphWithText('Stable paragraph');
    const compared = await compareDocuments(
      await buildDocxFromBodyXml(moved + stable), await buildDocxFromBodyXml(stable + moved),
      { detectMoves: true },
    );
    const xml = await (await DocxArchive.load(compared.document)).getDocumentXml();
    const document = parseXml(xml);
    const ids: string[] = [];
    for (const direction of ['moveFrom', 'moveTo']) {
      const wrappers = Array.from(document.getElementsByTagNameNS(W_NS, direction))
        .filter(element => !isParagraphMoveMarker(element));
      expect(wrappers).toHaveLength(3);
      ids.push(...wrappers.map(element => element.getAttributeNS(W_NS, 'id')!));
    }
    expect(new Set(ids).size).toBe(6);
    expect(moveBalanceIssues(xml)).toEqual([]);
    expect(verifySerializedMoveRanges(xml, [])).toEqual([]);
    for (const [projection, expected, bookmarkName] of [
      [acceptAllChanges(xml), ['Stable paragraph', movedText], 'Clause'],
      [rejectAllChanges(xml), [movedText, 'Stable paragraph'], '_safe_docx_original_1'],
    ] as const) {
      const projected = parseXml(projection);
      expect(Array.from(projected.getElementsByTagNameNS(W_NS, 'p')).map(p => p.textContent)).toEqual(expected);
      const start = projected.getElementsByTagNameNS(W_NS, 'bookmarkStart');
      const end = projected.getElementsByTagNameNS(W_NS, 'bookmarkEnd');
      expect(start).toHaveLength(1);
      expect(end).toHaveLength(1);
      expect(start[0]!.getAttributeNS(W_NS, 'id')).toBe(end[0]!.getAttributeNS(W_NS, 'id'));
      expect(start[0]!.getAttributeNS(W_NS, 'name')).toBe(bookmarkName);
      expect(projected.getElementsByTagNameNS(W_NS, 'b')).toHaveLength(1);
    }
    const directory = await mkdtemp(join(tmpdir(), 'sdx-split-move-'));
    try {
      const path = join(directory, 'move.docx');
      await writeFile(path, compared.document);
      const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
      expect(check.status, check.stdout + check.stderr).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('retains ordinary source text when a run moves between existing paragraphs', async () => {
    const moved = 'this complete paragraph moves away';
    const stable = 'a second sufficiently long paragraph of stable prose here';
    const final = 'third stable paragraph containing plenty of ordinary words';
    const compared = await compareDocuments(
      await buildDocxFromBodyXml(`<w:p>${resultText(stable)}${resultText(moved)}</w:p>` + paragraphWithText(final)),
      await buildDocxFromBodyXml(paragraphWithText(stable) + `<w:p>${resultText(final)}${resultText(moved)}</w:p>`),
      { detectMoves: true },
    );
    const document = parseXml(await (await DocxArchive.load(compared.document)).getDocumentXml());
    const sources = Array.from(document.getElementsByTagNameNS(W_NS, 'moveFrom'));
    expect(sources).toHaveLength(1);
    expect(sources[0]!.parentNode?.nodeName).toBe('w:p');
    expect(sources[0]!.getElementsByTagNameNS(W_NS, 't')[0]?.textContent).toBe(moved);
    expect(sources[0]!.getElementsByTagNameNS(W_NS, 'delText')).toHaveLength(0);
  });

  test('does not mistake an invalid ordinary-run move marker for a paragraph mark', async () => {
    const xml = `<w:p><w:r><w:rPr><w:moveFrom w:id="1" w:author="Prior" w:date="2020-01-01T00:00:00Z"/></w:rPr><w:t>text</w:t></w:r></w:p>`;
    const packageBytes = await buildDocxFromBodyXml(xml);
    const document = parseXml(await (await DocxArchive.load(packageBytes)).getDocumentXml());
    expect(isParagraphMoveMarker(document.getElementsByTagNameNS(W_NS, 'moveFrom')[0]!)).toBe(false);
    const directory = await mkdtemp(join(tmpdir(), 'sdx-move-property-'));
    try {
      const path = join(directory, 'invalid-run-properties.docx');
      await writeFile(path, packageBytes);
      const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
      expect(check.status, check.stdout + check.stderr).toBe(1);
      expect(check.stdout + check.stderr).toContain('moveFrom');
      expect(check.stdout + check.stderr).toContain('not expected');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  for (const prior of ['ins', 'del'] as const) {
    test(`keeps prior ${prior} before new move paragraph marks in generated DOCX`, async () => {
      const marked = `<w:p><w:pPr><w:rPr><w:${prior} w:id="900" w:author="Prior" w:date="2020-01-01T00:00:00Z"/></w:rPr></w:pPr>${resultText('this complete paragraph moves away')}</w:p>`;
      const stable = paragraphWithText('stable paragraph');
      const compared = await compareDocuments(
        await buildDocxFromBodyXml(marked + stable), await buildDocxFromBodyXml(stable + marked),
        { detectMoves: true, author: 'Comparator', date: new Date('2026-09-07T00:00:00Z') },
      );
      const document = parseXml(await (await DocxArchive.load(compared.document)).getDocumentXml());
      const marks = Array.from(document.getElementsByTagNameNS(W_NS, 'rPr'));
      expect(marks.map(mark => Array.from(mark.childNodes).filter(node => node.nodeType === 1)
        .map(node => (node as Element).localName))).toEqual([[prior, 'moveFrom'], [prior, 'moveTo']]);
      expect(Array.from(document.getElementsByTagNameNS(W_NS, prior))
        .every(marker => marker.getAttributeNS(W_NS, 'author') === 'Prior')).toBe(true);
      const directory = await mkdtemp(join(tmpdir(), 'sdx-move-review-'));
      try {
        const path = join(directory, 'move.docx');
        await writeFile(path, compared.document);
        const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
        expect(check.status, check.stdout + check.stderr).toBe(0);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }

  for (const directions of [['moveFrom'], ['moveTo'], ['moveFrom', 'moveTo']]) {
    test(`rejects missing content wrappers: ${directions.join(' and ')}`, () => {
      const { document, moves } = moveFixture();
      for (const direction of directions) {
        const content = Array.from(document.getElementsByTagNameNS(W_NS, direction))
          .find(element => element.parentNode?.nodeName === 'w:p')!;
        content.parentNode!.removeChild(content);
      }
      const xml = new XMLSerializer().serializeToString(document);
      expect(verifySerializedMoveRanges(xml, moves).length).toBeGreaterThan(0);
      expect(moveBalanceIssues(xml).length).toBeGreaterThan(0);
    });
  }

  test('rejects moved content outside its named range', () => {
    const { document, moves } = moveFixture();
    const content = Array.from(document.getElementsByTagNameNS(W_NS, 'moveFrom'))
      .find(element => element.parentNode?.nodeName === 'w:p')!;
    const start = document.getElementsByTagNameNS(W_NS, 'moveFromRangeStart')[0]!;
    const container = document.createElementNS(W_NS, 'w:p');
    container.appendChild(content);
    start.parentNode!.insertBefore(container, start);
    const xml = new XMLSerializer().serializeToString(document);
    expect(verifySerializedMoveRanges(xml, moves).length).toBeGreaterThan(0);
    expect(moveBalanceIssues(xml).length).toBeGreaterThan(0);
  });

  test('rejects the legacy terminal paragraph-marker ownership topology', () => {
    const { document, moves } = moveFixture();
    const deletedBreak = Array.from(document.getElementsByTagNameNS(W_NS, 'del'))
      .find((element) => element.parentNode?.nodeName === 'w:rPr')!;
    deletedBreak.parentNode!.removeChild(deletedBreak);
    const xml = new XMLSerializer().serializeToString(document);
    expect(verifySerializedMoveRanges(xml, moves))
      .toContain(`${moves[0]!.name} terminal paragraph move lacks Word-native break ownership`);
  });

  test('rejects duplicated move revision IDs but permits independently identified split content', () => {
    const { document, moves } = moveFixture();
    for (const direction of ['moveFrom', 'moveTo']) {
      const content = Array.from(document.getElementsByTagNameNS(W_NS, direction))
        .find(element => element.parentNode?.nodeName === 'w:p')!;
      const rangeEnd = Array.from(document.getElementsByTagNameNS(W_NS, `${direction}RangeEnd`))
        .find((element) => element.parentNode === content.parentNode)!;
      content.parentNode!.insertBefore(content.cloneNode(true), rangeEnd);
    }
    const serialize = () => new XMLSerializer().serializeToString(document);
    expect(verifySerializedMoveRanges(serialize(), moves).length).toBeGreaterThan(0);
    for (const [i, direction] of ['moveFrom', 'moveTo'].entries()) {
      const content = Array.from(document.getElementsByTagNameNS(W_NS, direction))
        .filter(element => element.parentNode?.nodeName === 'w:p');
      content[1]!.setAttributeNS(W_NS, 'w:id', String(900 + i));
    }
    expect(verifySerializedMoveRanges(serialize(), moves)).toEqual([]);
  });

  test('ignores foreign-namespace range lookalikes', () => {
    const { document, moves } = moveFixture();
    const start = document.getElementsByTagNameNS(W_NS, 'moveFromRangeStart')[0]!;
    const foreign = document.createElementNS('urn:foreign', 'x:moveFromRangeEnd');
    foreign.setAttributeNS(W_NS, 'w:id', start.getAttributeNS(W_NS, 'id')!);
    start.parentNode!.insertBefore(foreign, start);
    const xml = new XMLSerializer().serializeToString(document);
    expect(verifySerializedMoveRanges(xml, moves)).toEqual([]);
    expect(moveBalanceIssues(xml)).toEqual([]);
  });
});
