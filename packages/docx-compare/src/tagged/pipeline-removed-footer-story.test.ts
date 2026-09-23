/**
 * Deletion-side mirror of the inserted-section footer work (#648): when the
 * revised document removes the section slot that selected a header/footer,
 * the story's content is a tracked deletion, not plain content that survives
 * accept-all.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @see https://github.com/UseJunior/safe-docx/issues/754
 */

import { describe, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { XMLSerializer } from '@xmldom/xmldom';
import {
  auditSectPr,
  DocxArchive,
  OOXML,
  parseXml,
} from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import {
  acceptAllChanges,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';
import { deletedAncillaryStoryOutputPaths } from './textBoxRevisionSafety.js';

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEADER_RELATIONSHIP = `${R_NS}/header`;
const FOOTER_RELATIONSHIP = `${R_NS}/footer`;
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TEST_FEATURE = 'docx-comparison';
const COMPARE_OPTIONS = {
  author: 'Comparison',
  date: new Date('2026-09-23T00:00:00.000Z'),
};

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: TEST_FEATURE,
    story: 'Removed Section Footer Stories',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' },
  );

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

const FOOTER_TEXTS = [
  'First nested footer line',
  'Second nested footer line',
  'Fourth footer line',
  'Fifth footer line',
];

function footerWithTextBoxXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:ftr xmlns:w="${OOXML.W_NS}" xmlns:v="urn:schemas-microsoft-com:vml">` +
    `<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>` +
    paragraph(FOOTER_TEXTS[0]!) +
    paragraph(FOOTER_TEXTS[1]!) +
    `</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>` +
    `<w:p/><w:p/>` +
    paragraph(FOOTER_TEXTS[2]!) +
    paragraph(FOOTER_TEXTS[3]!) +
    `</w:ftr>`
  );
}

interface SelectedStoryFixture {
  bodyXml: string;
  /** Replaces the trailing `<w:sectPr/>` when given. */
  sectPrXml?: string;
  kind: 'header' | 'footer';
  target: string;
  storyXml: string;
}

async function packageWithSelectedStory(fixture: SelectedStoryFixture): Promise<Buffer> {
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(
    fixture.bodyXml,
    [],
    { namespaces: { r: R_NS } },
  ));
  if (fixture.sectPrXml) {
    archive.setDocumentXml(
      (await archive.getDocumentXml()).replace('<w:sectPr/>', fixture.sectPrXml),
    );
  }
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PACKAGE_REL_NS}">` +
      `<Relationship Id="rIdStory" Type="${fixture.kind === 'header' ? HEADER_RELATIONSHIP : FOOTER_RELATIONSHIP}" Target="${fixture.target}"/>` +
      `</Relationships>`,
  );
  archive.setFile(`word/${fixture.target}`, fixture.storyXml);
  return archive.save();
}

function revisionIds(xml: string, localNames: readonly string[]): string[] {
  const document = parseXml(xml);
  return localNames.flatMap((localName) =>
    Array.from(document.getElementsByTagNameNS(OOXML.W_NS, localName)).map(
      (element) =>
        element.getAttributeNS(OOXML.W_NS, 'id') || element.getAttribute('w:id') || '',
    ),
  );
}

async function selectedTargets(archive: DocxArchive, documentXml: string): Promise<string[]> {
  const relationshipsXml = await archive.getFile('word/_rels/document.xml.rels');
  return auditSectPr(documentXml, relationshipsXml).bindings.map((binding) => binding.targetPath);
}

describe('relationship-selected story removed with its section (#754)', () => {
  const deletedSectionParagraph =
    `<w:p><w:pPr><w:sectPr>` +
    `<w:footerReference w:type="default" r:id="rIdStory"/>` +
    `</w:sectPr></w:pPr><w:r><w:t>Deleted section</w:t></w:r></w:p>`;

  test.openspec('[SDX-CMP-UNREP-04] Story selected only by a removed section slot is a tracked deletion')(
    'tracks every paragraph of a footer whose selecting section was deleted',
    async ({ given, when, then }: AllureBddContext) => {
      const original = await given('a two-section original whose second section selects a footer', () =>
        packageWithSelectedStory({
          bodyXml: paragraph('Stable body') + deletedSectionParagraph,
          kind: 'footer',
          target: 'footer1.xml',
          storyXml: footerWithTextBoxXml(),
        }),
      );
      const revised = await given('a revision that removed that section', () =>
        buildDocxFromBodyXml(paragraph('Stable body'), [], { namespaces: { r: R_NS } }),
      );

      const result = await when('the pair is compared in place', () =>
        compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS),
      );
      const archive = await DocxArchive.load(result.document);
      const outputFooter = await archive.getFile('word/footer1.xml');
      const outputDocument = await archive.getDocumentXml();
      if (outputFooter === null) throw new Error('compared package lost word/footer1.xml');

      await then('every footer paragraph carries a tracked paragraph-mark deletion and w:delText runs', () => {
        const footer = parseXml(outputFooter);
        const paragraphs = Array.from(footer.getElementsByTagNameNS(OOXML.W_NS, 'p'));
        expect(paragraphs).toHaveLength(7);
        for (const item of paragraphs) {
          const markers = Array.from(item.getElementsByTagNameNS(OOXML.W_NS, 'rPr')).filter(
            (rPr) => rPr.parentNode && (rPr.parentNode as Element).localName === 'pPr' &&
              rPr.getElementsByTagNameNS(OOXML.W_NS, 'del').length === 1,
          );
          expect(markers.length, 'paragraph-mark w:del').toBeGreaterThanOrEqual(1);
        }
        expect(footer.getElementsByTagNameNS(OOXML.W_NS, 't')).toHaveLength(0);
        expect(footer.getElementsByTagNameNS(OOXML.W_NS, 'delText')).toHaveLength(4);
        expect(result.stats.deletions).toBeGreaterThanOrEqual(5);
      });

      await then('the VML carrier is not wrapped in a revision element', () => {
        const footer = parseXml(outputFooter);
        for (const deletion of Array.from(footer.getElementsByTagNameNS(OOXML.W_NS, 'del'))) {
          expect(deletion.getElementsByTagNameNS(OOXML.W_NS, 'pict')).toHaveLength(0);
          expect(deletion.getElementsByTagNameNS(OOXML.W_NS, 'drawing')).toHaveLength(0);
        }
        const pict = footer.getElementsByTagNameNS(OOXML.W_NS, 'pict').item(0);
        expect(pict).not.toBeNull();
        expect((pict!.parentNode!.parentNode as Element).localName).toBe('p');
      });

      await then('revision identifiers stay unique across the package', () => {
        const footerIds = revisionIds(outputFooter, ['ins', 'del']);
        const bodyIds = revisionIds(outputDocument, ['ins', 'del']);
        expect(footerIds).not.toContain('');
        expect(new Set([...footerIds, ...bodyIds]).size).toBe(footerIds.length + bodyIds.length);
      });

      await then('accept-all yields the revised package and reject-all the original', async () => {
        const acceptedDocument = acceptAllChanges(outputDocument);
        const rejectedDocument = rejectAllChanges(outputDocument);
        expect(extractRoundTripComparisonText(acceptedDocument)).toBe(
          extractRoundTripComparisonText(await (await DocxArchive.load(revised)).getDocumentXml()),
        );
        expect(extractRoundTripComparisonText(rejectedDocument)).toBe(
          extractRoundTripComparisonText(await (await DocxArchive.load(original)).getDocumentXml()),
        );
        expect(await selectedTargets(archive, acceptedDocument)).toEqual([]);
        expect(await selectedTargets(archive, rejectedDocument)).toEqual(['word/footer1.xml']);
        expect(extractRoundTripComparisonText(acceptAllChanges(outputFooter)).trim()).toBe('');
        const rejectedFooter = extractRoundTripComparisonText(rejectAllChanges(outputFooter));
        for (const text of FOOTER_TEXTS) expect(rejectedFooter).toContain(text);
      });

      await then('the footer is no longer reported as unrepresented; the section removal still is', () => {
        expect(result.unrepresentedChanges).toEqual([
          { scope: 'section', kind: 'removed', sectionIndex: 1 },
        ]);
      });
    },
  );

  test.openspec('[SDX-CMP-UNREP-04] Story selected only by a removed section slot is a tracked deletion')(
    'tracks a first-page header dropped from a surviving section',
    async () => {
      const storyXml =
        `<?xml version="1.0"?><w:hdr xmlns:w="${OOXML.W_NS}">` +
        paragraph('Cover page header') + `</w:hdr>`;
      const original = await packageWithSelectedStory({
        bodyXml: paragraph('Body'),
        sectPrXml: `<w:sectPr><w:headerReference w:type="first" r:id="rIdStory"/><w:titlePg/></w:sectPr>`,
        kind: 'header',
        target: 'header1.xml',
        storyXml,
      });
      // Only the header selection changes; w:titlePg stays so no section
      // property difference is reported alongside it.
      const revisedArchive = await DocxArchive.load(
        await buildDocxFromBodyXml(paragraph('Body, revised'), [], { namespaces: { r: R_NS } }),
      );
      revisedArchive.setDocumentXml(
        (await revisedArchive.getDocumentXml()).replace('<w:sectPr/>', '<w:sectPr><w:titlePg/></w:sectPr>'),
      );
      const revised = await revisedArchive.save();

      const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
      const archive = await DocxArchive.load(result.document);
      const header = await archive.getFile('word/header1.xml');
      if (header === null) throw new Error('compared package lost word/header1.xml');

      expect(header).toContain('<w:del');
      expect(header).toContain('<w:delText>Cover page header</w:delText>');
      expect(extractRoundTripComparisonText(acceptAllChanges(header)).trim()).toBe('');
      expect(extractRoundTripComparisonText(rejectAllChanges(header))).toContain('Cover page header');
      const documentXml = await archive.getDocumentXml();
      expect(await selectedTargets(archive, acceptAllChanges(documentXml))).toEqual([]);
      expect(await selectedTargets(archive, rejectAllChanges(documentXml))).toEqual(['word/header1.xml']);
      expect(result.unrepresentedChanges).toBeUndefined();
    },
  );

  test.openspec('[SDX-CMP-UNREP-04] Story selected only by a removed section slot is a tracked deletion')(
    'leaves a story unrepresented when accept-all would still select it',
    async () => {
      // A package with no revisions selects the footer on both projections, so
      // a tracked deletion could not project to the revised state.
      const unchanged = await packageWithSelectedStory({
        bodyXml: paragraph('Body'),
        sectPrXml: `<w:sectPr><w:footerReference w:type="default" r:id="rIdStory"/></w:sectPr>`,
        kind: 'footer',
        target: 'footer1.xml',
        storyXml: `<?xml version="1.0"?><w:ftr xmlns:w="${OOXML.W_NS}">${paragraph('Kept')}</w:ftr>`,
      });
      const story = {
        index: 0,
        visualIndex: 0,
        partPath: 'word/footer1.xml',
        container: 'ancillaryPart' as const,
        ancillaryMode: 'deleted' as const,
        selectedSlots: [{ sectionOrdinal: 0, kind: 'footer' as const, role: 'default' as const }],
        original: unchanged,
        revised: unchanged,
      };
      expect((await deletedAncillaryStoryOutputPaths(unchanged, [story])).size).toBe(0);
    },
  );

  test.openspec('[SDX-CMP-UNREP-04] Story selected only by a removed section slot is a tracked deletion')(
    'tracks the CC BY footer dropped from the real OpenAgreements Mutual NDA',
    async () => {
      const original = await readFile(new URL(
        '../../../../tests/test_documents/open-agreements/mutual-nda.docx',
        import.meta.url,
      ));
      const revisedArchive = await DocxArchive.load(original);
      const document = parseXml(await revisedArchive.getDocumentXml());
      const footerReference = document
        .getElementsByTagNameNS(OOXML.W_NS, 'footerReference')
        .item(0);
      if (!footerReference) throw new Error('Real fixture has no footerReference');
      footerReference.parentNode!.removeChild(footerReference);
      const bodyText = Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 't'))
        .find((element) => element.textContent === 'Mutual Non-Disclosure Agreement');
      if (!bodyText) throw new Error('Real fixture body text changed unexpectedly');
      bodyText.textContent = 'Mutual Confidentiality Agreement';
      revisedArchive.setDocumentXml(new XMLSerializer().serializeToString(document));

      const result = await compareDocumentsAtomizer(original, await revisedArchive.save(), COMPARE_OPTIONS);
      const archive = await DocxArchive.load(result.document);
      const footer = await archive.getFile('word/footer1.xml');
      if (footer === null) throw new Error('compared package lost word/footer1.xml');

      const parsed = parseXml(footer);
      expect(parsed.getElementsByTagNameNS(OOXML.W_NS, 't')).toHaveLength(0);
      const hyperlinkDeletions = Array.from(parsed.getElementsByTagNameNS(OOXML.W_NS, 'hyperlink'))
        .map((hyperlink) => hyperlink.getElementsByTagNameNS(OOXML.W_NS, 'del').length);
      expect(hyperlinkDeletions).toEqual([1, 1]);
      expect(extractRoundTripComparisonText(acceptAllChanges(footer)).trim()).toBe('');
      expect(extractRoundTripComparisonText(rejectAllChanges(footer)))
        .toContain('Common Paper Mutual Non-Disclosure Agreement (Version 1.0) free to use under CC BY 4.0.');
      const documentXml = await archive.getDocumentXml();
      expect(await selectedTargets(archive, acceptAllChanges(documentXml))).toEqual(['word/header1.xml']);
      expect(await selectedTargets(archive, rejectAllChanges(documentXml)))
        .toEqual(['word/header1.xml', 'word/footer1.xml']);
      expect(result.unrepresentedChanges).toBeUndefined();
    },
    30_000,
  );
});
