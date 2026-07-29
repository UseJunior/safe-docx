/**
 * Relationship-selected header/footer parts are independent
 * WordprocessingML stories. A footer selected exclusively by an inserted
 * section can therefore carry ordinary tracked paragraph insertions.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.17
 * @see https://github.com/UseJunior/safe-docx/issues/648
 */

import { describe, expect } from 'vitest';
import {
  DocxArchive,
  OOXML,
  parseXml,
} from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { extractRoundTripComparisonText } from '../../fieldComparisonSemantics.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import {
  acceptAllChanges,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';

const FOOTER_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'In-Place Reconstruction',
    story: 'Inserted Section Footer Stories',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.17' },
  );

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function footerXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:ftr xmlns:w="${OOXML.W_NS}" xmlns:v="urn:schemas-microsoft-com:vml">` +
    `<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>` +
    paragraph('First nested footer line') +
    paragraph('Second nested footer line') +
    `</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>` +
    `<w:p/><w:p/>` +
    paragraph('Fourth footer line') +
    paragraph('Fifth footer line') +
    `</w:ftr>`
  );
}

describe('relationship-selected footer story comparison (#648)', () => {
  test.openspec('[SDX-CMP-UNREP-03] Footer selected by a tracked inserted section is represented')(
    'tracks every paragraph in a footer owned by an inserted section',
    async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const original = await given('one body section without a footer', () =>
      buildDocxFromBodyXml(paragraph('Stable body')),
    );
    const insertedSection =
      `<w:p><w:pPr><w:sectPr>` +
      `<w:footerReference w:type="default" r:id="rIdFooter"/>` +
      `</w:sectPr></w:pPr><w:r><w:t>Inserted section</w:t></w:r></w:p>`;
    const revisedFooterTexts = [
      'First nested footer line',
      'Second nested footer line',
      'Fourth footer line',
      'Fifth footer line',
    ];
    const revised = await given('an inserted section selecting a five-paragraph footer', () =>
      buildDocxFromBodyXml(
        paragraph('Stable body') + insertedSection,
        [],
        {
          namespaces: {
            r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
          },
        },
      ).then(async (buffer) => {
        const archive = await DocxArchive.load(buffer);
        archive.setFile(
          'word/_rels/document.xml.rels',
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
            `<Relationship Id="rIdFooter" Type="${FOOTER_RELATIONSHIP}" Target="footer1.xml"/>` +
            `</Relationships>`,
        );
        archive.setFile('word/footer1.xml', footerXml());
        return archive.save();
      }),
    );

    const result = await when('the pair is compared in place', () =>
      compareDocumentsAtomizer(original, revised, {
        reconstructionMode: 'inplace',
        author: 'Comparison',
        date: new Date('2026-07-29T00:00:00.000Z'),
      }),
    );
    const archive = await DocxArchive.load(result.document);
    const outputFooter = await archive.getFile('word/footer1.xml');
    const outputDocument = await archive.getDocumentXml();

    await then('all five footer paragraphs are visible tracked insertions', () => {
      expect(outputFooter).not.toBeNull();
      const footer = parseXml(outputFooter!);
      const revisionParagraphs = Array.from(
        footer.documentElement.childNodes,
      ).filter((item): item is Element =>
        item.nodeType === 1 &&
        (item as Element).namespaceURI === OOXML.W_NS &&
        (item as Element).localName === 'p' &&
        (item as Element).getElementsByTagNameNS(OOXML.W_NS, 'ins').length > 0,
      );
      expect(revisionParagraphs).toHaveLength(5);
      const insertions = Array.from(
        footer.getElementsByTagNameNS(OOXML.W_NS, 'ins'),
      );
      expect(insertions.every((insertion) =>
        insertion.getElementsByTagNameNS(OOXML.W_NS, 'pict').length === 0 &&
        insertion.getElementsByTagNameNS(OOXML.W_NS, 'drawing').length === 0
      )).toBe(true);
      const footerIds = insertions.map((insertion) =>
        insertion.getAttributeNS(OOXML.W_NS, 'id') ||
        insertion.getAttribute('w:id'),
      );
      const bodyIds = Array.from(
        parseXml(outputDocument).getElementsByTagNameNS(OOXML.W_NS, 'ins'),
      ).map((insertion) =>
        insertion.getAttributeNS(OOXML.W_NS, 'id') ||
        insertion.getAttribute('w:id'),
      );
      expect(new Set(footerIds).size).toBe(footerIds.length);
      expect(footerIds.some((id) => bodyIds.includes(id))).toBe(false);
      expect(result.stats.insertions).toBeGreaterThanOrEqual(5);
      expect(result.unrepresentedChanges ?? []).toEqual(
        expect.not.arrayContaining([
          expect.objectContaining({
            scope: 'footer',
            kind: 'added',
            role: 'default',
          }),
        ]),
      );
    });

    await then('the footer story recovers its revised and absent-side text', () => {
      const acceptedText = extractRoundTripComparisonText(
        acceptAllChanges(outputFooter!),
      );
      expect(revisedFooterTexts.every((text) => acceptedText.includes(text))).toBe(true);
      expect(
        extractRoundTripComparisonText(rejectAllChanges(outputFooter!)).trim(),
      ).toBe('');
    });
    },
  );
});
