import { describe, expect } from 'vitest';
import { compareDocuments } from '@usejunior/docx-compare';
import {
  buildDocxWithAncillaryParts,
  paragraphWithText,
} from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_BASE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const FOOTER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
const LAYOUT =
  '<w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'surface-unrepresented-section-changes' });

async function issue648Pair(): Promise<readonly [Buffer, Buffer]> {
  const body = paragraphWithText('Page one body.') + paragraphWithText('Page two body.');
  const original = await buildDocxWithAncillaryParts({
    bodyXml: body,
    sectPrXml: `<w:sectPr>${LAYOUT}</w:sectPr>`,
  });
  const revised = await buildDocxWithAncillaryParts({
    bodyXml:
      `<w:p><w:pPr><w:sectPr>` +
      `<w:footerReference w:type="default" r:id="rIdFooter"/>${LAYOUT}` +
      `</w:sectPr></w:pPr><w:r><w:t>Page one body.</w:t></w:r></w:p>` +
      paragraphWithText('Page two body.'),
    sectPrXml: `<w:sectPr>${LAYOUT}</w:sectPr>`,
    relationships: [{
      id: 'rIdFooter',
      type: `${REL_BASE}/footer`,
      target: 'footer1.xml',
    }],
    parts: [{
      path: 'word/footer1.xml',
      contentType: FOOTER_CONTENT_TYPE,
      xml:
        `<w:ftr xmlns:w="${W_NS}">` +
        `${paragraphWithText('Appendix footer')}</w:ftr>`,
    }],
  });
  return [original, revised];
}

async function packageWithFooter(id: string, text: string): Promise<Buffer> {
  return buildDocxWithAncillaryParts({
    bodyXml: paragraphWithText('Body'),
    sectPrXml:
      `<w:sectPr><w:footerReference w:type="default" r:id="${id}"/>` +
      `${LAYOUT}</w:sectPr>`,
    relationships: [{
      id,
      type: `${REL_BASE}/footer`,
      target: `./footer-${id}.xml`,
    }],
    parts: [{
      path: `word/footer-${id}.xml`,
      contentType: FOOTER_CONTENT_TYPE,
      xml:
        `<w:ftr xmlns:w="${W_NS}">` +
        `${paragraphWithText(text)}</w:ftr>`,
    }],
  });
}

describe('unrepresented section and header/footer reporting', () => {
  test.openspec('[SDX-CMP-UNREP-01] Added section and footer are surfaced')(
    'reports issue #648 package-level changes on the successful inplace path',
    async () => {
      testAllure.conformance({
        spec: 'ECMA-376',
        edition: 5,
        part: 1,
        section: '17.6.18',
      });
      testAllure.conformance({
        spec: 'ECMA-376',
        edition: 5,
        part: 1,
        section: '17.10.2',
      });
      const [original, revised] = await issue648Pair();
      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });
      expect(result.stats.insertions).toBe(0);
      expect(result.stats.deletions).toBe(0);
      expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
        expect.objectContaining({ scope: 'section', kind: 'added' }),
        expect.objectContaining({
          scope: 'footer',
          kind: 'added',
          role: 'default',
        }),
      ]));
    },
  );

  test('reports changed selected footer content in both reconstruction modes', async () => {
    const original = await packageWithFooter('rIdOriginal', 'Original footer');
    const revised = await packageWithFooter('rIdRevised', 'Revised footer');
    for (const reconstructionMode of ['inplace', 'rebuild'] as const) {
      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode,
      });
      expect(result.unrepresentedChanges).toEqual([{
        scope: 'footer',
        kind: 'changed',
        sectionIndex: 0,
        role: 'default',
      }]);
    }
  });

  test('does not mistake relationship identifier changes for story changes', async () => {
    const original = await packageWithFooter('rIdOriginal', 'Same footer');
    const revised = await packageWithFooter('rIdRevised', 'Same footer');
    const result = await compareDocuments(original, revised, {
      engine: 'atomizer',
      reconstructionMode: 'inplace',
    });
    expect(result.unrepresentedChanges).toBeUndefined();
  });

  test('does not re-report an existing sectPrChange as unrepresented', async () => {
    const original = await buildDocxWithAncillaryParts({
      bodyXml: paragraphWithText('Body'),
      sectPrXml: `<w:sectPr>${LAYOUT}</w:sectPr>`,
    });
    const revised = await buildDocxWithAncillaryParts({
      bodyXml: paragraphWithText('Body'),
      sectPrXml:
        `<w:sectPr>${LAYOUT}` +
        `<w:sectPrChange w:id="1" w:author="Reviewer">` +
        `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>` +
        `</w:sectPrChange></w:sectPr>`,
    });
    const result = await compareDocuments(original, revised, {
      engine: 'atomizer',
      reconstructionMode: 'inplace',
    });
    expect(result.unrepresentedChanges).toBeUndefined();
  });

  test.openspec('[SDX-CMP-UNREP-02] Identical package state reports no unrepresented changes')(
    'omits diagnostics for identical packages',
    async () => {
      const [document] = await issue648Pair();
      const result = await compareDocuments(document, document, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });
      expect(result.unrepresentedChanges).toBeUndefined();
    },
  );
});
