/**
 * LibreOffice differential regression for a deleted terminal paragraph.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @see https://github.com/UseJunior/safe-docx/issues/891
 */
import { describe, expect } from 'vitest';
import { compareDocuments } from '@usejunior/docx-compare';
import { readZipText } from '../primitives/zip.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { paragraphShape, probeSofficeUsable, resolveSoffice, runLibreOfficeOracle } from './libreoffice-oracle.js';

const TEST_FEATURE = 'LibreOffice Oracle Trust Boundary';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' });
const paragraph = (text: string, alignment: string): string =>
  `<w:p><w:pPr><w:jc w:val="${alignment}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const soffice = resolveSoffice();
// Probe once at collection time. An installed-but-unusable binary (a held profile
// lock, a sandbox) must surface as a skipped suite: skipping the assertions inside
// a running test would report green having verified nothing, which is
// indistinguishable from real oracle evidence.
const sofficeUsable = soffice ? await probeSofficeUsable(soffice) : false;
const describeOracle = sofficeUsable ? describe : describe.skip;

describeOracle('issue #891 — LibreOffice terminal paragraph deletion', () => {
  test('Accept removes the terminal paragraph and Reject restores it', async ({ then }: AllureBddContext) => {
    const original = await buildDocxFromBodyXml(
      paragraph('Alpha', 'left') + paragraph('Bravo', 'center') + paragraph('Charlie', 'right'),
    );
    const revised = await buildDocxFromBodyXml(paragraph('Alpha', 'left') + paragraph('Bravo', 'center'));
    const compared = await compareDocuments(original, revised, {
      comparisonStrategy: 'tagged-tree',
      author: 'Comparator',
      date: new Date('2026-08-17T00:00:00Z'),
    });
    const candidateXml = await readZipText(compared.document, 'word/document.xml');
    const originalXml = await readZipText(original, 'word/document.xml');
    const revisedXml = await readZipText(revised, 'word/document.xml');
    expect(candidateXml).not.toBeNull();
    expect(originalXml).not.toBeNull();
    expect(revisedXml).not.toBeNull();

    const [accepted, rejected, expectedAccept, expectedReject] = await runLibreOfficeOracle([
      { op: 'accept', documentXml: candidateXml! },
      { op: 'reject', documentXml: candidateXml! },
      { op: 'identity', documentXml: revisedXml! },
      { op: 'identity', documentXml: originalXml! },
    ], soffice);

    await then('LibreOffice resolves the same paragraph shapes as the corresponding source resaves', () => {
      expect(paragraphShape(accepted!)).toEqual(paragraphShape(expectedAccept!));
      expect(paragraphShape(rejected!)).toEqual(paragraphShape(expectedReject!));
      const visibleText = (xml: string): string => {
        const matches = xml.matchAll(new RegExp(`<w:t(?:\\s[^>]*)?>([^<]*)</w:t>`, 'g'));
        return Array.from(matches, (match) => match[1]).join('');
      };
      expect(visibleText(accepted!)).toBe(visibleText(expectedAccept!));
      expect(visibleText(rejected!)).toBe(visibleText(expectedReject!));
    });
  }, 180_000);
});
