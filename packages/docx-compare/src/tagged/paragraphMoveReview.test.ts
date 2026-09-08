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

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Paragraph move review regressions' })
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

  test('rejects duplicated move revision IDs but permits independently identified split content', () => {
    const { document, moves } = moveFixture();
    for (const direction of ['moveFrom', 'moveTo']) {
      const content = Array.from(document.getElementsByTagNameNS(W_NS, direction))
        .find(element => element.parentNode?.nodeName === 'w:p')!;
      content.parentNode!.appendChild(content.cloneNode(true));
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
