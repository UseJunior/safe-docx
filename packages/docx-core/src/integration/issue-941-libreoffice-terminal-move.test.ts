/** Public synthetic LibreOffice projection gate for whole-paragraph moves (#973). */
import { describe, expect } from 'vitest';
import { compareDocuments } from '@usejunior/docx-compare';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { buildDocxFromBodyXml, paragraphWithText } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { paragraphShape, probeSofficeUsable, resolveSoffice, runLibreOfficeOracle } from './libreoffice-oracle.js';

const TEST_FEATURE = 'refactor-tracked-paragraph-move-ownership';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const soffice = resolveSoffice();
const usable = soffice ? await probeSofficeUsable(soffice) : false;
const oracle = usable ? describe : describe.skip;
const paragraphs = [
  'the movable clause paragraph that changes position here',
  'first stable anchor paragraph of ordinary prose text',
  'second stable anchor paragraph of ordinary prose text',
];
const text = (xml: string) => Array.from(parseXml(xml).getElementsByTagNameNS(
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 't',
)).map(element => element.textContent).join('');

oracle('issue #973 — LibreOffice whole-paragraph move projection', () => {
  for (const [name, originalOrder, revisedOrder] of [
    ['middle destination', [0, 1, 2], [1, 0, 2]],
    ['terminal destination', [0, 1, 2], [1, 2, 0]],
    ['terminal source', [1, 2, 0], [0, 1, 2]],
  ] as const) {
    test.openspec('Supported readers project exact states')(`${name} accepts and rejects to the exact paragraph state`, async () => {
      const build = (order: readonly number[]) => buildDocxFromBodyXml(
        order.map(index => paragraphWithText(paragraphs[index]!)).join(''),
      );
      const original = await build(originalOrder);
      const revised = await build(revisedOrder);
      const compared = await compareDocuments(original, revised, {
        detectMoves: true, author: 'Comparator', date: new Date('2026-09-07T00:00:00Z'),
      });
      const xml = (await readZipText(compared.document, 'word/document.xml'))!;
      expect(xml).toContain('moveFromRangeStart');
      const [accepted, rejected, expectedAccept, expectedReject] = await runLibreOfficeOracle([
        { op: 'accept', documentXml: xml }, { op: 'reject', documentXml: xml },
        { op: 'identity', documentXml: (await readZipText(revised, 'word/document.xml'))! },
        { op: 'identity', documentXml: (await readZipText(original, 'word/document.xml'))! },
      ], soffice);
      expect(text(accepted!)).toBe(text(expectedAccept!));
      expect(text(rejected!)).toBe(text(expectedReject!));
      expect(paragraphShape(accepted!)).toEqual(paragraphShape(expectedAccept!));
      expect(paragraphShape(rejected!)).toEqual(paragraphShape(expectedReject!));
    }, 180_000);
  }
});
