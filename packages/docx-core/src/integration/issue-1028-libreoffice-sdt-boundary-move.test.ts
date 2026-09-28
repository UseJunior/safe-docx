/** Public synthetic LibreOffice projection gate for block content-control boundary moves (#1028). */
import { describe, expect } from 'vitest';
import { compareDocuments } from '@usejunior/docx-compare';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { paragraphShape, probeSofficeUsable, resolveSoffice, runLibreOfficeOracle } from './libreoffice-oracle.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Block Container Revisions' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.29' });
const soffice = resolveSoffice();
const usable = soffice ? await probeSofficeUsable(soffice) : false;
const oracle = usable ? describe : describe.skip;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const control = (inner: string) => `<w:sdt><w:sdtPr><w:id w:val="1"/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
const paragraphTexts = (xml: string) => Array.from(parseXml(xml).getElementsByTagNameNS(W, 'p'))
  .map(p => Array.from(p.getElementsByTagNameNS(W, 't')).map(t => t.textContent).join(''));

oracle('issue #1028 — LibreOffice block content-control boundary move projection', () => {
  const originalBody = para('Before control.') + control(para('Inside control.')) + para('After control.');
  const revisedBody = control(para('Before control.') + para('Inside control.')) + para('After control, amended.');
  for (const [name, fromBody, toBody] of [
    ['paragraph enters the control', originalBody, revisedBody],
    ['paragraph leaves the control', revisedBody, originalBody],
  ] as const) {
    for (const detectMoves of [false, true]) {
      test(`${name} (detectMoves=${detectMoves}) keeps every paragraph on accept and reject`, async () => {
        const original = await buildDocxFromBodyXml(fromBody);
        const revised = await buildDocxFromBodyXml(toBody);
        const compared = await compareDocuments(original, revised, {
          detectMoves, author: 'Comparator', date: new Date('2026-09-26T00:00:00Z'),
        });
        const xml = (await readZipText(compared.document, 'word/document.xml'))!;
        const [accepted, rejected, expectedAccept, expectedReject] = await runLibreOfficeOracle([
          { op: 'accept', documentXml: xml }, { op: 'reject', documentXml: xml },
          { op: 'identity', documentXml: (await readZipText(revised, 'word/document.xml'))! },
          { op: 'identity', documentXml: (await readZipText(original, 'word/document.xml'))! },
        ], soffice);
        expect(paragraphTexts(accepted!)).toContain('Inside control.');
        expect(paragraphTexts(accepted!)).toEqual(paragraphTexts(expectedAccept!));
        expect(paragraphTexts(rejected!)).toEqual(paragraphTexts(expectedReject!));
        expect(paragraphShape(accepted!)).toEqual(paragraphShape(expectedAccept!));
        expect(paragraphShape(rejected!)).toEqual(paragraphShape(expectedReject!));
      }, 180_000);
    }
  }

  // When the control is the last block of the body, the paragraph crossing its
  // boundary is the story's terminal paragraph. Without a detected move,
  // LibreOffice leaves one empty trailing paragraph on the projection that
  // removes it, exactly as it does for a plain terminal paragraph insertion on
  // main (the #973 family), so those rows pin only what #1028 is about: no
  // content is dropped in either projection. A detected move whose terminal
  // endpoint is inside the story-closing control gets Word-native break
  // ownership (#1101), so the "enters" and "leaves" rows are exact there. The
  // "after it" row's control-side endpoint is not terminal (a body paragraph
  // follows the control), so it keeps the legacy topology and the empty
  // trailing paragraph.
  const nonEmpty = (xml: string) => paragraphTexts(xml).filter(text => text !== '');
  for (const [name, fromBody, toBody, exactWithMoves] of [
    ['paragraph enters a terminal control', para('Move') + control(para('Inside')), control(para('Inside') + para('Move')), true],
    ['paragraph leaves a terminal control', control(para('Inside') + para('Move')), para('Move') + control(para('Inside')), true],
    ['paragraph leaves a terminal control after it', control(para('Inside') + para('Move')), control(para('Inside')) + para('Move'), false],
  ] as const) {
    for (const detectMoves of [false, true]) {
      const exact = detectMoves && exactWithMoves;
      test(`${name} (detectMoves=${detectMoves}) keeps every paragraph${exact ? ' and the paragraph shape' : "'s content"} on accept and reject`, async () => {
        const original = await buildDocxFromBodyXml(fromBody);
        const revised = await buildDocxFromBodyXml(toBody);
        const compared = await compareDocuments(original, revised, {
          detectMoves, author: 'Comparator', date: new Date('2026-09-26T00:00:00Z'),
        });
        const xml = (await readZipText(compared.document, 'word/document.xml'))!;
        const [accepted, rejected, expectedAccept, expectedReject] = await runLibreOfficeOracle([
          { op: 'accept', documentXml: xml }, { op: 'reject', documentXml: xml },
          { op: 'identity', documentXml: (await readZipText(revised, 'word/document.xml'))! },
          { op: 'identity', documentXml: (await readZipText(original, 'word/document.xml'))! },
        ], soffice);
        const project = exact ? paragraphTexts : nonEmpty;
        expect(project(accepted!)).toEqual(project(expectedAccept!));
        expect(project(rejected!)).toEqual(project(expectedReject!));
        if (exact) {
          expect(paragraphShape(accepted!)).toEqual(paragraphShape(expectedAccept!));
          expect(paragraphShape(rejected!)).toEqual(paragraphShape(expectedReject!));
        }
      }, 180_000);
    }
  }
});
