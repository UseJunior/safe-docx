/**
 * Public synthetic LibreOffice projection gate for whole-paragraph moves whose
 * terminal endpoint is the last paragraph of a block content control that
 * closes the body story (#1101). #1055 gave body-level terminal moves ordinary
 * break ownership so LibreOffice Accept All / Reject All stop leaving an empty
 * trailing paragraph; the same move inside a story-closing control needs the
 * same ownership. The body-level and middle-move rows are controls.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.34
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.21
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.22
 * @see https://github.com/UseJunior/safe-docx/issues/1101
 */
import { describe, expect } from 'vitest';
import { compareDocuments } from '@usejunior/docx-compare';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { paragraphShape, probeSofficeUsable, resolveSoffice, runLibreOfficeOracle } from './libreoffice-oracle.js';

const TEST_FEATURE = 'refactor-tracked-paragraph-move-ownership';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.34' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.21' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.22' },
  );
const soffice = resolveSoffice();
// Probe once at collection time so an unusable binary skips the suite rather
// than reporting green without oracle evidence.
const usable = soffice ? await probeSofficeUsable(soffice) : false;
const oracle = usable ? describe : describe.skip;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const control = (inner: string) =>
  `<w:sdt><w:sdtPr><w:id w:val="1"/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
const A = 'first movable clause paragraph of ordinary prose text';
const B = 'second stable anchor paragraph of ordinary prose text';
const C = 'third stable anchor paragraph of ordinary prose text';
/** Every paragraph in document order, including those nested in a control. */
const paragraphTexts = (xml: string) => Array.from(parseXml(xml).getElementsByTagNameNS(W, 'p'))
  .map(p => Array.from(p.getElementsByTagNameNS(W, 't')).map(t => t.textContent).join(''));

oracle('issue #1101 — LibreOffice terminal move inside a story-closing content control', () => {
  for (const [name, fromBody, toBody] of [
    // The two cases #1101 reports: an extra empty paragraph after Accept All / Reject All.
    ['last paragraph of a terminal control moves to its front', control(para(A) + para(B) + para(C)), control(para(C) + para(A) + para(B))],
    ['first paragraph of a terminal control moves to its end', control(para(A) + para(B) + para(C)), control(para(B) + para(C) + para(A))],
    // Controls that must keep matching: a middle move inside the control, and body-level moves.
    ['middle move inside a terminal control', control(para(A) + para(B) + para(C)), control(para(B) + para(A) + para(C))],
    ['last paragraph of a terminal control moves to its middle', control(para(A) + para(B) + para(C)), control(para(A) + para(C) + para(B))],
    ['terminal control preceded by a body paragraph', para('Lead') + control(para(A) + para(B) + para(C)), para('Lead') + control(para(C) + para(A) + para(B))],
    ['body-level last paragraph moves to front', para(A) + para(B) + para(C), para(C) + para(A) + para(B)],
    ['body-level first paragraph moves to end', para(A) + para(B) + para(C), para(B) + para(C) + para(A)],
  ] as const) {
    test.openspec('Supported readers project exact states')(
      `${name}: LibreOffice Accept and Reject match identity`, async () => {
        const original = await buildDocxFromBodyXml(fromBody);
        const revised = await buildDocxFromBodyXml(toBody);
        const compared = await compareDocuments(original, revised, {
          detectMoves: true, author: 'Comparator', date: new Date('2026-09-28T00:00:00Z'),
        });
        const xml = (await readZipText(compared.document, 'word/document.xml'))!;
        expect(xml).toContain('moveFromRangeStart');
        const [accepted, rejected, expectedAccept, expectedReject] = await runLibreOfficeOracle([
          { op: 'accept', documentXml: xml }, { op: 'reject', documentXml: xml },
          { op: 'identity', documentXml: (await readZipText(revised, 'word/document.xml'))! },
          { op: 'identity', documentXml: (await readZipText(original, 'word/document.xml'))! },
        ], soffice);
        // Paragraph texts include the control's paragraphs, so an extra empty
        // paragraph anywhere in the story fails here; paragraphShape pins the
        // direct body children as the issue's acceptance criteria state.
        expect(paragraphTexts(accepted!)).toEqual(paragraphTexts(expectedAccept!));
        expect(paragraphTexts(rejected!)).toEqual(paragraphTexts(expectedReject!));
        expect(paragraphShape(accepted!)).toEqual(paragraphShape(expectedAccept!));
        expect(paragraphShape(rejected!)).toEqual(paragraphShape(expectedReject!));
      }, 240_000);
  }
});
